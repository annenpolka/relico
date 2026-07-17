# AGENTS.md — このリポジトリで作業するエージェントへの規約

## プロジェクト概要

Warframeのボイドの亀裂を条件フィルタして通知するTauri v2製メニューバー常駐アプリ。仕様駆動(dspec方式のPBT限定版)で開発する。

## 仕様駆動の絶対ルール

1. **仕様の正本は `specs/*.pkl` だけ。** 自然言語の要求も、生成ドキュメントも、生成テストもすべてビュー(生成物)である。
2. **生成物は手編集禁止。** 対象: `docs/SPEC.md`、`src-tauri/tests/oracles_generated.rs`、`tests/unit/oracles_generated.test.ts`、`tests/renderer/oracles_generated.spec.ts`、`tests/e2e/oracles_generated.e2e.ts`。テストを直したくなったら、それは仕様変更なので `specs/notifier.pkl` を編集して `just spec-gen` で再生成する。
3. **挙動の変更は必ず specs/ 経由。** UI由来でも実装由来でも、通知判定・重複排除・バックオフ等の振る舞いを変えるときは正本を先に変える。パターンに載らない要求は `Manual` 条項として明示的に残す(黙って丸めない)。
4. **保証の勾配を平らに見せない。** このプロジェクトの機械保証の最上位はproperty-based test。保証ラベルは `property-tested` / `example-tested` / `manual` の3種のみ。renderer統合テスト(IPC mock)はexample-testedであり、Rust commandやOS通知を通った証明とは呼ばない(`docs/E2E.md` の線引き)。
5. **新しいパターン(語彙)の追加**は `specs/patterns.pkl` のクラス定義と `tools/spec-gen.ts` の生成テンプレートを同時に変更する。
6. **目視で承認するアセット(アイコン等)は `ApprovedAsset` でsha256を固定する。** 変更したら目視で再承認し、specs側のsha256を更新する。「毎リリース目視」を仕様に残さない。

## コマンド

```bash
just spec-gen      # specs/ → Rust/TSオラクル + SPEC.md 再生成
just spec-check    # 生成物の鮮度検査 + bun test(unit) + cargo test。CI相当
just renderer-test # renderer統合テスト(Playwright/WebKit、IPC mock。初回: bunx playwright install webkit)
just e2e           # WDIO Tauri E2E(e2e featureビルド + 実IPC。専用identity com.annenpolka.relico.e2e)
just macos-smoke   # MAN-009の機械検査部分(build/notification-test後に実行)
just dev           # bun tauri dev
just build         # bun tauri build
```

コミット前は `just spec-check` を通すこと。UI(src/)や生成rendererテストへ触れた変更は `just renderer-test` も通す。command結線(commands.rs/lib.rs)やIPCの形へ触れた変更は `just e2e` も通す。

E2Eの隔離: `e2e` cargo featureはWebDriverサーバをアプリへ埋め込むため、通常のdebug/releaseビルドで有効にしない。wdio capability(`tools/e2e-capability.json`)は`just e2e`がビルド中だけ`capabilities/e2e.json`へ配置する(常設するとfeature無効ビルドがACLエラーになる)。frontendの`@wdio/tauri-plugin`はVITE_E2E=1ビルドだけが読み込む。

## 仕様変更の手順(要求→実装)

1. 要求を自然言語で整理する(これは正本ではない)
2. `specs/notifier.pkl` の条項を追加・変更する(パターンはpatterns.pklの語彙から選ぶ)
3. `just spec-gen` で再生成し、`docs/SPEC.md` を読んで意図と一致するか確認する(逆翻訳レビュー)
4. オラクルが赤になることを確認してから実装を変更し、緑にする
5. `just spec-check` を通してコミット

## 実装の要点

- 通知判定(`filter.rs`)・重複排除(`dedup.rs`)・バックオフ(`backoff.rs`)は純粋関数/自己完結型で、オラクルの直接対象。副作用(時刻取得・HTTP・通知発火)を持ち込まない。現在時刻は引数で渡す
- `raw`なAPIレスポンスの取り回しは `model.rs`(serde)。フィールド追加時はarb_fissure生成器(spec-gen.ts内)も追随させる
- フロントエンド(`src/`)はUIのみ。判定ロジックをTS側に複製しない
- rendererテストのIPC mock(`tests/renderer/harness.ts`)は手書き。Rustの判定・fuzzy・dedupを再現せず、DOM結線とレイアウトの証拠だけを扱う。commandのUI向け結線を変えたらharnessも追随させる
