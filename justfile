# 開発タスク。仕様正本は specs/、生成物は docs/SPEC.md と src-tauri/tests/oracles_generated.rs

# 正本(specs/)からオラクルとSPEC.mdを再生成する
spec-gen:
    bun tools/spec-gen.ts

# 生成物の鮮度検査(再生成して差分が出たら、生成物が正本より古い) + 全テスト
spec-check:
    #!/usr/bin/env bash
    set -euo pipefail
    generated="docs/SPEC.md src-tauri/tests/oracles_generated.rs tests/unit/oracles_generated.test.ts tests/renderer/oracles_generated.spec.ts tests/e2e/oracles_generated.e2e.ts"
    before=$(shasum $generated 2>/dev/null || true)
    bun tools/spec-gen.ts
    after=$(shasum $generated)
    if [ "$before" != "$after" ]; then
        echo "NG: 生成物が specs/ より古かった。just spec-gen の結果を確認してコミットすること" >&2
        exit 1
    fi
    bun test tests/unit
    cd src-tauri && cargo test

# renderer統合テスト(Playwright/WebKit、Tauri IPCはmock。docs/E2E.mdの線引き)
# 初回は bunx playwright install webkit が必要
renderer-test:
    bunx playwright test

# MAN-009の機械検査部分(macOS)。build/notification-test後に実行し、残余だけを目視する
macos-smoke:
    bash tools/macos-smoke.sh

# WDIO Tauri E2E。e2e featureビルド(WebDriverサーバ内蔵・専用identity)で実IPCを検査する。
# wdio capabilityはe2e feature無効ビルドでACLエラーになるため、ビルド中だけ配置する
e2e:
    #!/usr/bin/env bash
    set -euo pipefail
    bundle_root="$PWD/src-tauri/target.noindex"
    app_binary="$bundle_root/debug/relico"
    e2e_lease="$bundle_root/e2e-process.lease"
    e2e_port=4445
    cap="src-tauri/capabilities/e2e.json"
    cleanup() {
        status=$?
        trap - EXIT INT TERM
        set +e
        bun tools/e2e-process.ts cleanup --port "$e2e_port" --executable "$app_binary" --lease "$e2e_lease"
        janitor_status=$?
        lease_status=0
        if [[ $janitor_status -eq 0 ]]; then
            rm -f "$e2e_lease"
            lease_status=$?
        fi
        rm -f "$cap"
        cap_status=$?
        if [[ $status -eq 0 && $janitor_status -ne 0 ]]; then
            status=$janitor_status
        elif [[ $status -eq 0 && $lease_status -ne 0 ]]; then
            status=$lease_status
        elif [[ $status -eq 0 && $cap_status -ne 0 ]]; then
            status=$cap_status
        fi
        exit "$status"
    }
    trap cleanup EXIT
    trap 'exit 130' INT
    trap 'exit 143' TERM
    mkdir -p "$bundle_root"
    touch "$e2e_lease"
    # 前回runnerだけが異常終了して残したE2E専用lease holderも、build前に対象限定で回収する。
    bun tools/e2e-process.ts cleanup --port "$e2e_port" --executable "$app_binary" --lease "$e2e_lease"
    # 回収済みの旧run inodeは再利用せず、このrunだけのlease inodeへ入れ替える。
    rm -f "$e2e_lease"
    touch "$e2e_lease"
    cp tools/e2e-capability.json "$cap"
    CARGO_TARGET_DIR="$bundle_root" bun tauri build --debug --no-bundle --features e2e --config src-tauri/tauri.e2e.conf.json
    TAURI_WEBDRIVER_PORT="$e2e_port" RELICO_E2E_LEASE_PATH="$e2e_lease" bunx wdio run wdio.conf.ts

dev:
    bun tauri dev

# macOS通知用。配布版と権限・設定・LaunchServices identityを共有しない専用bundleを使う
notification-test:
    #!/usr/bin/env bash
    set -euo pipefail
    bundle_root="$PWD/src-tauri/target.noindex"
    CARGO_TARGET_DIR="$bundle_root" bun tauri build --debug --bundles app --config src-tauri/tauri.notification-test.conf.json
    open "$bundle_root/debug/bundle/macos/RELICO Notification Test.app"

build:
    #!/usr/bin/env bash
    set -euo pipefail
    bundle_root="$PWD/src-tauri/target.noindex"
    app_path="$bundle_root/release/bundle/macos/relico.app"
    lsregister_path=/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister

    # hdiutilもrelease .appを一時的に登録する。成功/失敗にかかわらず配布元だけを解除する。
    cleanup_launchservices() {
        if [[ "$(uname -s)" == "Darwin" && -d "$app_path" ]]; then
            "$lsregister_path" -u "$app_path" >/dev/null 2>&1 || true
        fi
    }
    trap cleanup_launchservices EXIT

    # Finderが一時DMGを開くと、その中の.appがLaunchServicesへ残る。CI=trueでFinder処理だけを省く。
    CARGO_TARGET_DIR="$bundle_root" CI=true bun tauri build
