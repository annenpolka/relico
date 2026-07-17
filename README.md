# relico

Warframeのボイドの亀裂(Void Fissure)を監視し、指定条件に合致した亀裂だけを通知するmacOSメニューバー常駐アプリ。鋼の道のり(Steel Path)と通常を区別でき、デスクトップ通知に加えてDiscord Webhook経由でスマホにも届く。

## 機能

- tier(Lith/Meso/Neo/Axi/Requiem/Omnia)、ミッション種別、惑星、鋼/通常、ボイドストームの有無でフィルタ
- 新規出現した合致亀裂のみ通知(同一亀裂は高々1回。再起動しても再通知しない)
- デスクトップ通知 + Discord Webhook(embedの残り時間はスマホで見た瞬間の相対表示)
- メニューバーから監視状態の確認・一時停止・コンソール表示
- データソース: [warframestat.us worldstate API](https://api.warframestat.us/pc/fissures)(60秒間隔、失敗時は最大600秒までバックオフ)

## セットアップ

前提ツール:

| ツール | 用途 |
|:---|:---|
| Rust (cargo) | Tauriコア |
| Bun | フロントエンド・spec-gen実行 |
| Pkl (`brew install pkl`) | 仕様正本の評価 |
| just (`brew install just`) | タスクランナー |

```bash
bun install
just dev     # 開発起動
just build   # .app / .dmg 生成
```

## 開発フロー(仕様駆動)

このリポジトリは仕様正本を `specs/*.pkl` に置き、テストオラクルと仕様ドキュメントを機械生成する。**生成物(`docs/SPEC.md`, `src-tauri/tests/oracles_generated.rs`)は手編集禁止。** 詳細ルールは [AGENTS.md](AGENTS.md)、条項一覧は [docs/SPEC.md](docs/SPEC.md) を参照。

```bash
just spec-gen     # specs/ からオラクルとSPEC.mdを再生成
just spec-check   # 鮮度検査(生成物と正本のズレ検出) + cargo test
```

挙動を変えたいとき(テストを直したくなったときを含む)は、必ず `specs/notifier.pkl` を編集して `just spec-gen` から始める。

## 構成

```
specs/          仕様の正本(Pkl)。唯一の手編集対象の仕様
tools/          spec-gen.ts(オラクル+SPEC.md生成器)
docs/           SPEC.md(生成物) / ARCHITECTURE.md(設計資料)
src-tauri/      Rustコア(ポーリング・フィルタ・通知・トレイ)
src/            設定UI(Vite + TypeScript、OPS CONSOLEデザイン)
```

設計の詳細は [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) を参照。
