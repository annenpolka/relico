# AGENTS.md — このリポジトリで作業するエージェントへの規約

## プロジェクト概要

Warframeのボイドの亀裂を条件フィルタして通知するTauri v2製メニューバー常駐アプリ。仕様駆動(dspec方式のPBT限定版)で開発する。

## 仕様駆動の絶対ルール

1. **仕様の正本は `specs/*.pkl` だけ。** 自然言語の要求も、生成ドキュメントも、生成テストもすべてビュー(生成物)である。
2. **生成物は手編集禁止。** 対象: `docs/SPEC.md`、`src-tauri/tests/oracles_generated.rs`。テストを直したくなったら、それは仕様変更なので `specs/notifier.pkl` を編集して `just spec-gen` で再生成する。
3. **挙動の変更は必ず specs/ 経由。** UI由来でも実装由来でも、通知判定・重複排除・バックオフ等の振る舞いを変えるときは正本を先に変える。パターンに載らない要求は `Manual` 条項として明示的に残す(黙って丸めない)。
4. **保証の勾配を平らに見せない。** このプロジェクトの機械保証の最上位はproperty-based test。保証ラベルは `property-tested` / `example-tested` / `manual` の3種のみ。
5. **新しいパターン(語彙)の追加**は `specs/patterns.pkl` のクラス定義と `tools/spec-gen.ts` の生成テンプレートを同時に変更する。

## コマンド

```bash
just spec-gen     # specs/ → oracles_generated.rs + SPEC.md 再生成
just spec-check   # 鮮度検査(git diff --exit-code) + cargo test。CI相当
just dev          # bun tauri dev
just build        # bun tauri build
```

コミット前は `just spec-check` を通すこと。

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
