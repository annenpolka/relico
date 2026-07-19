# relico

Warframeのボイドの亀裂(Void Fissure)を監視し、指定条件に合致した亀裂だけを通知するmacOSメニューバー常駐アプリ。鋼の道のり(Steel Path)と通常を区別でき、デスクトップ通知に加えてDiscord Webhook経由でスマホにも届く。

## 機能

- tier(Lith/Meso/Neo/Axi/Requiem/Omnia)、ミッション種別、惑星、鋼/通常、VOID嵐(除外/含む/嵐のみ)を組み合わせた通知ルールを複数定義
- 一覧のVIEW選択(`enabled`)と通知参加(`notify`)を独立管理。非表示ルールも通知でき、通知OFFのdraftは安全に編集可能
- コマンドパレットの `DESELECT ALL RULES` (`全ルール解除`)で通知設定を保ったままVIEW選択だけを全解除
- VIEW選択なしでピッカーから条件を選ぶと、既存ルールを触らずVIEW ON・NOTIFY OFFの新ルールを作成
- 新規出現した合致亀裂のみ通知(同一亀裂は高々1回。再起動しても再通知しない)
- デスクトップ通知 + Discord Webhook(embedの残り時間はスマホで見た瞬間の相対表示)
- メニューバーから監視状態の確認・一時停止・コンソール表示
- 亀裂は期限到達時に次回ポーリングを待たず一覧から除去
- ログイン時起動は `.app` bundleをLogin Itemへ登録し、macOSのアプリアイコンを維持
- データソース: [warframestat.us worldstate API](https://api.warframestat.us/pc/fissures)(60秒間隔、失敗時は最大600秒までバックオフ)

時限コンテンツ表示は、Digital Extremesの公式World State、[Warframe Community Developersのworldstate API](https://api.warframestat.us/pc)、および[browse.wf](https://browse.wf/about)の公開データを組み合わせる。Holdfasts・Cavia・The Hexはbrowse.wf Oracle、仲裁はbrowse.wfの公開scheduleとPublic Exportに由来する。仲裁は公式ライブ値ではなくコミュニティ予測としてアプリ内でも明示し、scheduleの範囲外を推測で補完しない。browse.wfフロントエンドは[MITライセンスで公開](https://github.com/calamity-inc/browse.wf)されている。

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
just dev                # UI・ポーラーの開発起動(raw dev)
just notification-test  # 通知TEST用のdebug .appをビルドして起動
just build              # .app / .dmg 生成
```

macOSの通知APIはbundle identityと署名済み `.app` を必要とするため、rawの `just dev` ではRELICO名義のデスクトップ通知を送らない。通知を試すときは `just notification-test` で、配布版とは権限・設定・重複排除を共有しない `RELICO Notification Test` (`com.annenpolka.relico.notification-test`) を起動してTESTを使う。TESTの成功表示は、macOSまたはDiscordが通知要求を受理したことまでを意味し、バナーを目視できたことまでは意味しない。

正式版のcanonical install先は `~/Applications/relico.app` とする。`just build` は `.app` と `.dmg` を生成するが、DMG作成中の一時mountをFinderで開かないため、存在しない `/Volumes/dmg.*/relico.app` がLaunchServicesへ残らない。ビルド成果物は配布元であり、正式版として常用する `.app` はcanonical install先へ配置する。

## 開発フロー(仕様駆動)

このリポジトリは仕様正本を `specs/*.pkl` に置き、テストオラクルと仕様ドキュメントを機械生成する。**生成物(`docs/SPEC.md`, `src-tauri/tests/oracles_generated.rs`, `tests/unit/oracles_generated.test.ts`, `tests/renderer/oracles_generated.spec.ts`, `tests/e2e/oracles_generated.e2e.ts`)は手編集禁止。** 詳細ルールは [AGENTS.md](AGENTS.md)、条項一覧は [docs/SPEC.md](docs/SPEC.md) を参照。

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

設計の詳細は [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)、外部通知とUIのE2E境界は [docs/E2E.md](docs/E2E.md)、Windows対応の現状と実装計画は [docs/WINDOWS.md](docs/WINDOWS.md) を参照。
