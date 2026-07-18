# Stratal Brief

## Goal

Warframeの時限コンテンツを、公式ライブ・コミュニティライブ・コミュニティ予測の由来を区別しながら一つの常駐コンソールで確認でき、通知をローカル時刻の区間で安全に抑制でき、日本語・英語・簡体字中国語で同じ機能と表示保証を持つ状態にする。

## Current Working Contract

- `specs/*.pkl`を挙動の正本とし、生成物を直接編集しない。
- コンテンツは亀裂、仲裁、ソーティー、アルコン、シンジケート、エリアミッション、Circuit、アルキメデア、Descendiaの9タブで扱う。
- 公式ライブ値、コミュニティによるライブ整形、コミュニティ予測scheduleをcard上で分離し、各sourceの一時的な取得障害ではそのsourceの最後の有効snapshotとエラーを併記する。
- 公開sourceから個人状態を取得できないネットセル等は取得タブ化せず、必要になっても明示的なローカルtrackerとして分離する。
- i18nは同一の依存なしカタログをTSとRustから利用し、意味DOMのgoldenで3言語を検査する。

## Fit Conditions

- 720x480でも本文・右rail・statusbarへ到達でき、タブ列以外に意図しない横スクロールがない。
- 既存のVIEW選択、通知参加、edit focusの分離を維持する。
- 一つの時限コンテンツ取得失敗が亀裂通知や他タブの更新を止めない。
- キーボードだけでタブ巡回・直接移動・既存ルール編集が行える。
- ミュート終了時に、区間中の亀裂が一括通知されない。

## Hard Constraints

- Authority: Human stated and repo evidence. `specs/*.pkl`が仕様正本であり、生成テストと`docs/SPEC.md`は手編集しない。
- Authority: Human stated. 外部i18n依存を追加せず、日本語・英語・簡体字中国語を提供する。
- Authority: Repo evidence. フィルタ・通知・dedupの判定をフロントエンドへ複製しない。
- Authority: Human stated and external source. 取得可能な公開データだけをタブ化し、ネットセル、アルキメデア、Descendiaのプレイヤー固有進捗を公開worldstateから推測しない。
- Authority: Human stated and external source. browse.wf由来の仲裁は公式ライブ値と呼ばず、予測scheduleであることと出典を表示する。

## Preference Gradients

- 画像goldenより、文字列・ARIA・placeholder・overflowを比較する意味DOM goldenを優先する。
- API生値のWarframe固有名詞は翻訳せず、アプリ固有のUI chromeを翻訳する。
- 対応タブの部分データや取得エラー表示を、もっともらしい合成ミッション詳細より優先する。
- 設定不足や不正値では通知を誤って永久停止しないfail-openを優先する。

## Judgment Bindings

### 公開データの境界と部分失敗
Authority: Human stated and external source
Evidence: Stated by user to adopt the re-researched sources; Observed WFCD `/pc`、DE `worldState.php`、browse.wf公開実装と各payloadを2026-07-18に実測
Working default:
- WFCD集約から亀裂・ソーティー・アルコン・シンジケート・エリアミッション・アルキメデアを取得する。
- DescendiaはDE公式worldstateの`Descents`、Circuitは`EndlessXpSchedule`から取得する。
- Holdfasts・Cavia・Hexはbrowse.wf Oracleの期限内`bounty-cycle`とPublic Exportを結合し、仲裁はbrowse.wfの連続した有効期間内scheduleとPublic Exportを結合する。
- WFCD、DE公式、browse.wf Oracle、browse.wf scheduleは独立に失敗でき、source別の最後の有効snapshotを保持する。
- 動的payloadとvalidated static assetの結合に失敗したsourceだけstatic assetを短期再取得し、他sourceのcacheとLKGは維持する。
- static join不整合が続く場合は1分→5分→30分→2時間上限で再取得をbackoffし、join成功でresetする。
- static asset取得障害は60秒retryへ分離し、その間はjoin backoff段を消費しない。
Why it matters:
- 補助タブの障害で主要な亀裂通知を止めない。
Validation:
- fixtureによるserde試験、仲裁scheduleの連続性・範囲property、Oracle expiry検査、source単位の全成功/各失敗matrix、static cache再取得hint試験を通す。
Revisit when:
- WFCDが仲裁・追加Bounty・`Descents`・ネットセル進捗を安定した公開schemaへ追加したとき、またはbrowse.wfのsource契約・配布場所・有効期間が変わったとき。
Status: active
Retention: repo-contract

### 予測可能な共通状態と取得不能な個人状態を分離する
Authority: Human stated
Evidence: Stated by user to adopt the investigated sources; Observed that WFCD Arbitration is sentinelでもbrowse.wf `arbys.txt`は2029-10-12まで1時間連続し、Netracellsはbrowse.wfでもlocalStorage手動checkのみ
Working default:
- 仲裁はコミュニティ予測scheduleとしてtabを設け、source・予測表示・有効期間外の取得不能を明示する。
- ネットセルは取得tab、tabpanel、合成ミッションcardを設けない。週次消化管理が要求されたらローカルtrackerとして別仕様にする。
- アルキメデアとDescendiaは取得できる公開ミッション情報を表示するが、個人の残り回数・checkpoint・獲得報酬は表示しない。
Why it matters:
- 決定的な共通rotationを利用しつつ、それを公式ライブ値や個人進捗と誤認させない。
Validation:
- renderer試験で9タブの完全な順序、仲裁の予測・出典表示、ネットセルDOMの不在を検査し、schedule範囲propertyとlive source fixtureを確認する。
Revisit when:
- DE公式またはWFCDが仲裁の安定したライブ値を提供したとき、またはネットセルを返す認証済みプレイヤーAPIが利用可能になったとき。
Status: active
Retention: carry-forward

### 9タブのブラウザ風操作と既存ルール操作
Authority: Human stated
Evidence: Stated for browser-like shortcuts; Observed existing Cmd/Ctrl+1..9 rule focus in `src/main.ts`
Working default:
- macOSのCmd+1..9を9タブへ直接割り当て、Ctrl+Tab / Ctrl+Shift+Tabで巡回する。
- 既存ルールedit focusはCtrl+1..9へ限定して保持する。
- tablist上ではArrowLeft/Right/Home/Endのroving focusを提供する。
Why it matters:
- 同一キー競合を解消しつつ既存の高速編集を失わない。
Validation:
- renderer試験でタブ、active panel、rule focus、入力欄・IME非干渉を検査する。
Revisit when:
- Windows/Linuxを正式配布対象にするとき、またはユーザーが別割当を指定したとき。
Status: active
Retention: repo-contract

### 通知ミュートは日次ローカル区間で破棄する
Authority: Agent inference
Evidence: Derived from requested mute interval and existing silent-seed/dedup behavior
Working default:
- `[start,end)`、同日・跨日対応、`start==end`は空区間、システムローカル時刻で評価する。
- 区間中の候補IDはdedupへ記録するが配送せず、ATTEMPTEDを増やさない。
- TEST DELIVERYは明示操作なのでミュートを無視する。
Why it matters:
- 誤設定による全日停止と、解除時の通知洪水を避ける。
Validation:
- 全1440分のproperty test、境界例、解除後の新規ID試験を通す。
Revisit when:
- 複数区間、曜日指定、スヌーズ、解除後catch-upが要求されたとき。
Status: active
Retention: repo-contract

### i18nは単一カタログと意味DOM goldenで保証する
Authority: Human stated
Evidence: Stated for dependency-free ja/en/zh; Derived for the least brittle display regression method
Working default:
- localeは`ja | en | zh-Hans`をAppConfigへ保存し、欠落した旧設定は`ja`にする。
- 同一JSONカタログをTSはimport、Rustは`include_str!`で読む。
- UI chrome、ARIA、tooltip、tray、通知本文を翻訳し、API固有名詞・ユーザー入力名は原文を保つ。
- 辞書完全性とlocale別semantic DOM goldenを生成試験で検査する。
Why it matters:
- frontend/tray/notificationの言語分裂と、CJK font差によるpixel goldenの偽陽性を避ける。
Validation:
- key・placeholder一致unit test、3言語renderer golden、locale永続化E2Eを通す。
Revisit when:
- ゲーム固有名詞の公式localized sourceを導入するとき、または繁体字が要求されたとき。
Status: active
Retention: repo-contract

## Open Questions And Discomfort

- `.stratal/brief.md`は今回のような複数機能に跨る判断の再発見を防ぐため、リポジトリへ追跡することを推奨する。
- 仲裁scheduleとPublic Exportの更新頻度にはSLAがないため、期限・連続性・node解決率を検査し、範囲外では補間や循環をしない。

## Rejected Directions

- WFCDの`SolNode000/Unknown/1970`仲裁sentinelを現在値として表示しない。仲裁は検証済みbrowse.wf scheduleだけから作り、範囲外を剰余で循環させない。
- ネットセルを週次リセットだけの合成タブとして表示せず、Descendiaの個人進捗も端末ローカルの推測値として自動管理しない。明示的な手動tracker要求が出たら別機能として再検討する。
- 画像pixel goldenを主要回帰契約にしない。固定レンダリング環境が導入されたら補助証拠として再検討する。

## Evidence Notes

- `AGENTS.md`, `specs/patterns.pkl`, `specs/notifier.pkl`, `src-tauri/src/poller.rs`, `src/main.ts`, `tests/renderer/harness.ts`を確認。
- 2026-07-18に`https://api.warframestat.us/pc`、`https://api.warframe.com/cdn/worldState.php`、`https://browse.wf/arbys.txt`、Public Export、`https://oracle.browse.wf/bounty-cycle`とbrowse.wf公開実装を実測。
- DE Update 41はDescendiaを21階・月曜00:00 UTC更新と説明している。
