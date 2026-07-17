# ARCHITECTURE

設計資料(手書き)。仕様条項の一覧は生成物の [SPEC.md](SPEC.md) を参照。

## 全体像

```
[tokio ポーリングタスク (Rust)]
   毎60秒 GET api.warframestat.us/pc/fissures
      ↓ serde でパース (model.rs)
[フィルタ判定 (filter.rs)] tier / missionType / 惑星 / 鋼(isHard) / storm / 残り時間
      ↓ 新規IDのみ (dedup.rs: NotifiedSet)
[通知ディスパッチ (notify.rs)]
   ├─ デスクトップ: tauri-plugin-notification
   └─ モバイル: Discord Webhook POST (reqwest, embed形式)
[トレイメニュー] 監視状態表示 / 一時停止 / OPEN CONSOLE / QUIT
[コンソールウィンドウ (WebView, TS)] 亀裂テーブル + フィルタレール + ステータスバー
```

## データソース

`https://api.warframestat.us/pc/fissures`(WFCDのworldstate API)。認証不要。主要フィールド:

| フィールド | 用途 |
|:---|:---|
| `tier` / `tierNum` | Lith / Meso / Neo / Axi / Requiem / Omnia |
| `missionType` | Defense, Survival など |
| `isHard` | **鋼の道のりフラグ**(鋼と通常の区別はこれ) |
| `isStorm` | Railjackボイドストーム |
| `id`, `node`, `enemy`, `activation`, `expiry` | 識別・表示・残り時間 |

惑星は独立フィールドがないため、`node`(常に「ノード名 (惑星名)」形式)の括弧内を `filter::extract_planet` で抽出する(SPEC: PRS-001)。未知の惑星名が来ても文字列一致で動く。

ポーリングマナー: 既定60秒間隔(設定可、下限30秒)+ User-Agent明示。失敗時は指数バックオフで最大600秒(SPEC: POL-001)。

## Rustモジュール構成

| モジュール | 責務 | オラクル対象 |
|:---|:---|:---|
| `model.rs` | APIレスポンスのserde型(`Fissure`) | — |
| `filter.rs` | 通知判定の純粋関数(`matches`)・惑星抽出。現在時刻は引数 | FLT-001〜007, PRS-001 |
| `dedup.rs` | 通知済みidの集合(`NotifiedSet`)。mark/prune | DED-001, 002 |
| `backoff.rs` | 指数バックオフ(`Backoff`) | POL-001 |
| `config.rs` | `AppConfig` の読み書き(JSON)と `tokio::sync::watch` による配信 | — |
| `poller.rs` | ポーリングループ。fetch→filter→dedup→notify | — |
| `notify.rs` | デスクトップ通知とDiscord Webhook送信 | MAN-001, 002(手動) |
| `commands.rs` | Tauriコマンド(get_config / set_config / test_notification / get_fissures) | — |

判定ロジックはRust側にのみ存在する。フロントエンド(TS)はUI表示専用で、判定を複製しない。

## 設定モデル

```rust
struct AppConfig {
    tiers: Vec<String>,            // 空 = 全tier対象
    mission_types: Vec<String>,    // 空 = 全種別対象
    planets: Vec<String>,          // 空 = 全惑星対象
    mode: Mode,                    // Normal | SteelPath | Both
    include_storms: bool,
    min_remaining_secs: u64,       // 既定300
    poll_interval_secs: u64,       // 既定60、下限30
    desktop_notification: bool,
    discord_webhook_url: Option<String>,
    paused: bool,
}
```

保存先: `~/Library/Application Support/com.annenpolka.warframe-fissure-notifier/config.json`。通知済みidも同ディレクトリに永続化し、再起動時の再通知を防ぐ(DED-001の実運用面)。設定変更は `watch` チャネルで即ポーリングタスクへ反映する。

## 通知フォーマット

Discordはembedで送る。残り時間は動的タイムスタンプ `<t:unix:R>` を使い、スマホで見た瞬間の相対時間で表示される。

> **Axi A5 — Kappa (Sedna) 【鋼】**
> Disruption / Grineer / 消滅 <t:1789…:R>

## エッジケース

- **API障害**: 指数バックオフ(60s→最大600s)。復旧まで通知しない。トレイのツールチップにエラー状態を表示
- **スリープ復帰**: 復帰後の次回ポーリングで未通知idが拾われる。期限切れはフィルタが除外するので特別処理不要
- **設定変更時**: 既存の亀裂に再通知しない。以後の新規出現分にのみ新フィルタを適用
- **ウィンドウを閉じる**: 非表示化のみ(アプリは常駐継続)。終了はトレイのQUITから

## UIデザイン(OPS CONSOLE)

採用モック: https://claude.ai/code/artifact/012f4382-45c7-4912-9eae-93088032d9d3 (案B)

- パレット: 地 `#0C0E0C` / アンバー `#FFB454`(主色) / 減光アンバー `#8A6A3A`(ラベル) / 文字 `#E8E2D4` / 赤 `#FF6B5E`(鋼・残り10分未満) / シアン `#6ECFDB`(ストーム)
- 書体: すべて `ui-monospace, "SF Mono", Menlo`。ラベルは大文字 + letter-spacing
- レイアウト: 左=亀裂テーブル(TIER/NODE/MISSION/FACTION/T-REMAIN/FLAGS)、右=フィルタレール(`[x]`チェック)、下=ステータスバー(ポーリング間隔・API状態・次回更新・当日通知数)
- フィルタ合致行はアンバーのインセットボーダー+背景8%で強調。残り時間は `tabular-nums`、10分未満で赤
- トレイ: 状態2行(WATCH条件 / NEXT対象と残り時間)+ PAUSE / OPEN CONSOLE / QUIT

## macOS常駐の実装メモ

- `ActivationPolicy::Accessory` でDockアイコン非表示(メニューバーのみ)
- `WindowEvent::CloseRequested` で `prevent_close()` + `hide()`
- ログイン時起動は tauri-plugin-autostart
