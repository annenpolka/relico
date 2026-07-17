# 開発タスク。仕様正本は specs/、生成物は docs/SPEC.md と src-tauri/tests/oracles_generated.rs

# 正本(specs/)からオラクルとSPEC.mdを再生成する
spec-gen:
    bun tools/spec-gen.ts

# 生成物の鮮度検査(差分が出たら正本と生成物がズレている) + 全テスト
spec-check: spec-gen
    git diff --exit-code -- docs/SPEC.md src-tauri/tests/oracles_generated.rs
    cd src-tauri && cargo test

dev:
    bun tauri dev

build:
    bun tauri build
