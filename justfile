# 開発タスク。仕様正本は specs/、生成物は docs/SPEC.md と src-tauri/tests/oracles_generated.rs

# 正本(specs/)からオラクルとSPEC.mdを再生成する
spec-gen:
    bun tools/spec-gen.ts

# 生成物の鮮度検査(再生成して差分が出たら、生成物が正本より古い) + 全テスト
spec-check:
    #!/usr/bin/env bash
    set -euo pipefail
    before=$(shasum docs/SPEC.md src-tauri/tests/oracles_generated.rs 2>/dev/null || true)
    bun tools/spec-gen.ts
    after=$(shasum docs/SPEC.md src-tauri/tests/oracles_generated.rs)
    if [ "$before" != "$after" ]; then
        echo "NG: 生成物が specs/ より古かった。just spec-gen の結果を確認してコミットすること" >&2
        exit 1
    fi
    cd src-tauri && cargo test

dev:
    bun tauri dev

build:
    bun tauri build
