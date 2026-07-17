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
   ├─ デスクトップ: UNUserNotificationCenter (mac-usernotifications)
   └─ モバイル: Discord Webhook POST (wait=true、Message receipt検証)
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

惑星は独立フィールドがないため、`node`(常に「ノード名 (惑星名)」形式)の括弧内を `filter::extract_planet` で抽出する(SPEC: PRS-001)。未知の惑星名が来ても文字列一致で動く。VOID嵐ではAPIが `Earth` / `Veil` のような基底名を返すため、UIの `Earth Proxima` / `Veil Proxima` など6星系だけをVOID嵐時に対応づける。通常亀裂にはこの別名を適用しない(SPEC: FLT-012)。

ポーリングマナー: 既定60秒間隔(設定可、下限30秒)+ User-Agent明示。失敗時は指数バックオフで最大600秒(SPEC: POL-001)。

## Rustモジュール構成

| モジュール | 責務 | オラクル対象 |
|:---|:---|:---|
| `model.rs` | APIレスポンスのserde型(`Fissure`) | — |
| `filter.rs` | 有効ルールORの純粋関数(`matches`)・通知scope射影・惑星抽出。現在時刻は引数 | FLT-001〜014, PRS-001 |
| `dedup.rs` | 通知済みidの集合(`NotifiedSet`)。mark/prune | DED-001〜003 |
| `backoff.rs` | 指数バックオフ(`Backoff`) | POL-001 |
| `config.rs` | `AppConfig` の読み書き(JSON)と `tokio::sync::watch` による配信 | — |
| `poller.rs` | ポーリングループ。fetch→filter→dedup→notify。scope変更時はsilent seed | POL-002, 003, VIS-001 |
| `notify.rs` | desktop payload/結果集約、UNUserNotificationCenter、Discord Webhook送信 | NTF-001〜004, MAN-001, 002 |
| `commands.rs` | Tauriコマンド(get/set config / rule activation / notification test等) | — |

判定ロジックはRust側にのみ存在する。フロントエンド(TS)はUI表示専用で、判定を複製しない。

## 設定モデル(ルールOR)

フィルタは通知ルールのリスト。各ルール内はAND条件で、亀裂が**enabled=trueのどれか1つのルールに合致すれば**通知・表示対象(SPEC: FLT-008/009/013)。「Axi鋼」と「Requiem何でも」の同時監視ができる。`enabled=false`は保存・編集できるdraftで、runtime判定には参加しない。UIのedit focusとは別概念である。

```rust
struct WatchRule {
    enabled: bool,                 // 通知判定への参加。旧設定で欠落時はtrue
    tiers: Vec<String>,            // 空 = 全tier対象
    mission_types: Vec<String>,    // 空 = 全種別対象
    planets: Vec<String>,          // 空 = 全惑星対象
    mode: Mode,                    // Normal | SteelPath | Both
    storms: StormMode,             // Exclude | Include | Only
}

struct AppConfig {
    rules: Vec<WatchRule>,         // 既定は全対象ルール1本。空なら何も監視しない
    min_remaining_secs: u64,       // 既定300(時間軸はルール共通)
    poll_interval_secs: u64,       // 既定60、下限30
    desktop_notification: bool,
    discord_webhook_url: Option<String>,
    paused: bool,
}
```

## ファジーパレット(palette.rs)

どこでも打鍵で開くコマンドパレットからルールを編集する。スコアラ・候補カタログ・適用ロジックはすべてRust側(`palette.rs`)にあり、フロントは表示だけ(SPEC: FZY-001..004)。

- **スコアラ**: fzf風部分列マッチ。先頭一致+12 / 語境界+9 / 連続+8、ギャップと候補長で減点、完全一致は最優先。候補はlabelとalias(日本語・ローマ字・略語)の最良スコア
- **候補カタログ**: tier / ミッション / 惑星 / モード / VOID嵐(除外/含む/嵐のみ) / アクション(NEW RULE, DELETE RULE, CLEAR, PAUSE)。日本語・ローマ字aliasを持つ
- **上書き解決(SPEC: SAT-001)**: ルール内で両立しない選択(例: Requiem×Sedna)は、ドメイン互換表(Requiem↔クバ要塞、Omnia↔ザリマン、VOID嵐↔Proxima星系、鋼VOID嵐不存在、Railjackミッション↔VOID嵐)に対する充足可能性検査で検出し、直近の変更を残して古い方を緩める(stormsを`Include`へ緩和→mode緩和→非互換メンバー除去→最終手段は他軸全対象)
- **有効化(SPEC: EDT-001)**: ルール行のtoggleはruntime activationだけを変更し、行本体の選択はedit focusだけを変更する。有効ルールはすべてORで監視する
- **安全な新規作成(SPEC: EDT-002)**: NEW RULEは無効なdraftとして追加し、条件が決まる前に通知範囲を広げない
- **一発クリア(SPEC: CLR-001)**: CLEARボタン/候補でenabled=trueの既定ルール1本に戻す
- レール(サイドバー)のチェック操作も同じ`apply_candidate`経路を通るため、どこから編集しても上書き解決が働く

保存先: `~/Library/Application Support/com.annenpolka.relico/config.json`。通知済みidも同ディレクトリに永続化し、再起動時の再通知を防ぐ(DED-001の実運用面)。設定変更は `watch` チャネルで即ポーリングタスクへ反映する。旧設定の `includeStorms: false/true` は `storms: Exclude/Include` へ、`enabled`欠落ルールは`enabled: true`へ移行する(SPEC: CFG-001/002)。

## 通知フォーマット

macOSは `UNUserNotificationCenter` へ実行中アプリのbundle identityで要求する。初回の権限要求はユーザーがTESTを押したときだけ行い、バックグラウンドpollerは勝手に権限ダイアログを出さない。rawの `just dev` にはbundle identityがないため明示的に失敗させ、`just notification-test` でad-hoc署名した `RELICO Notification Test` (`com.annenpolka.relico.notification-test`) を使う。配布版 `relico` (`com.annenpolka.relico`) とは通知権限・設定・重複排除を共有しない。要求APIの成功はmacOSによる受付であり、バナーの知覚までは主張しない(SPEC: NTF-001〜003 / MAN-001)。

Discordはembedを `wait=true` で送り、Discordが返す非空Message IDまで検証する(SPEC: NTF-004)。残り時間は動的タイムスタンプ `<t:unix:R>` を使い、スマホで見た瞬間の相対時間で表示される。reqwestのエラーからWebhook URLを除去し、tokenをUIやログへ出さない。

> **Axi A5 — Kappa (Sedna) 【鋼】**
> Disruption / Grineer / 消滅 <t:1789…:R>

## エッジケース

- **起動直後**: 初回ポーリングはシードのみ(SPEC: POL-002)。既存の合致亀裂を通知済みとして記録するが通知は発火しない。これがないと起動のたびに合致亀裂全件の通知洪水が起きる(スモークテストで20連発を確認して仕様化した)
- **API障害**: 指数バックオフ(60s→最大600s)。復旧まで通知しない。トレイのツールチップにエラー状態を表示
- **スリープ復帰**: 復帰後の次回ポーリングで未通知idが拾われる。期限切れはフィルタが除外するので特別処理不要
- **通知scope変更時**: 有効ルール、共通残り時間、または有効ルールの条件が変わると現存対象をsilent seedし、一括通知しない。以後の新規出現分にのみ新scopeを適用する。無効draftの追加・削除・編集や配送先変更では再seedしない(SPEC: POL-003)
- **ウィンドウを閉じる**: 非表示化のみ(アプリは常駐継続)。終了はトレイのQUITから

## UIデザイン(OPS CONSOLE)

採用モック: https://claude.ai/code/artifact/012f4382-45c7-4912-9eae-93088032d9d3 (案B)

- パレット: 地 `#0C0E0C` / アンバー `#FFB454`(主色) / 減光アンバー `#8A6A3A`(ラベル) / 文字 `#E8E2D4` / 赤 `#FF6B5E`(鋼・残り10分未満) / シアン `#6ECFDB`(ストーム)
- 書体: すべて `ui-monospace, "SF Mono", Menlo`。ラベルは大文字 + letter-spacing
- レイアウト: 左=亀裂テーブル(TIER/NODE/MISSION/FACTION/T-REMAIN/MODE/STORM)、右=210px固定の通知ルールeditor、下=ステータスバー(ポーリング間隔・API状態・次回更新・当日通知試行数)。表領域740px以上では7列1段を維持し、740px未満(現在の構成ではviewport 949px以下)では1段目をTIER/NODE/T-REMAIN、2段目をMISSION/FACTION/MODE/STORMにする。NODE/MISSIONは表示だけellipsisし、全文と行tooltipを保持する。難易度とVOID嵐は独立軸なので、狭幅でもMODE/STORMを別セルにする。右側は全候補の置き場ではなく「現在値と編集入口」とし、compact rule navigatorを固定表示し、FILTERS/DELIVERYタブで5軸の要約と配送設定を切り替える。要約行を押すと既存パレットをその軸に絞って開き、候補数が増えてもsidebarを縦スクロールさせない。ルールのruntime有効化toggleとedit focusは別操作にする。通知試行数はdedupで新規選択された亀裂数であり、OS上の表示完了数ではない(SPEC: MAN-010, MAN-011)
- テーブルにはフィルタ合致亀裂のみ表示する(SPEC: VIS-001。対象外は非表示)。合致0件時は「NO MATCHING FISSURES」を表示。残り時間は `tabular-nums`、10分未満で赤
- トレイ: 状態2行(WATCH条件 / NEXT対象と残り時間)+ PAUSE / OPEN CONSOLE / QUIT

## macOS常駐の実装メモ

- 正式版のcanonical install先は `~/Applications/relico.app`。`com.annenpolka.relico` のLaunchServices候補をここへ一本化し、bundle系recipeはSpotlightの自動発見を避ける `src-tauri/target.noindex` に配布元を生成する。配布元 `.app` は直接起動しない
- `just build` は `CI=true` でTauriのFinder整形処理を省略する。DMG自体は生成するが、Finderが `/Volumes/dmg.*` 内のアプリをLaunchServicesへ自動登録する経路を通さない。`hdiutil` が生成中にrelease `.app`を登録する場合もあるため、EXIT trapで成否を問わずその配布元pathだけを登録解除する
- コンソール表示中は `ActivationPolicy::Regular`、非表示中は `Accessory` に切り替える。Dock・Paneru・Raycast Switch Windowsには表示中だけ現れる
- Paneruは管理中ウィンドウの位置・サイズをアプリ外から再適用する。最小サイズのlayout検査ではPaneruを停止するかRELICOをfloating化し、保存済みsessionのmanaged状態も解除してから測定する
- `WindowEvent::CloseRequested` で `prevent_close()` + `hide()` 後に `Accessory` へ戻す
- トレイの `OPEN CONSOLE` とmacOSの再オープンイベントでは `Regular` へ切り替えてから再表示・フォーカスする
- ログイン時起動は tauri-plugin-autostart
