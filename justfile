# 開発タスク。仕様正本は specs/、生成物は docs/SPEC.md と src-tauri/tests/oracles_generated.rs

set windows-shell := ["powershell.exe", "-NoLogo", "-NoProfile", "-Command"]

# 正本(specs/)からオラクルとSPEC.mdを再生成する
spec-gen:
    bun tools/spec-gen.ts

# 生成物の鮮度検査(再生成して差分が出たら、生成物が正本より古い) + 全テスト
spec-check:
    bun tools/spec-check.ts

# renderer統合テスト(macOS=WebKit / Windows=Chromium、Tauri IPCはmock。docs/E2E.mdの線引き)
renderer-test:
    node node_modules/@playwright/test/cli.js test

# MAN-009の機械検査部分(macOS)。build/notification-test後に実行し、残余だけを目視する
macos-smoke:
    bash tools/macos-smoke.sh

# WDIO Tauri E2E。e2e featureビルド(WebDriverサーバ内蔵・専用identity)で実IPCを検査する。
# wdio capabilityはe2e feature無効ビルドでACLエラーになるため、ビルド中だけ配置する
e2e:
    bun tools/run-e2e.ts

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
    bun tools/build.ts
