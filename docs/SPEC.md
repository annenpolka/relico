# relico — Warframe亀裂通知 仕様

> **生成物 — 手編集禁止。** 正本は `specs/notifier.pkl`。変更は正本を編集して `just spec-gen`。
>
> 保証の勾配: このプロジェクトの機械保証の最上位は property-based test である。
> proven(証明) / model-checked(モデル検査) の条項は存在しない。勾配を平らに見せない。
>
> フィルタの意味論は有効ルールOR: 設定は監視ルール(WatchRule)のリストで、亀裂が
> enabled=trueのどれか1つのルールに合致すれば通知・表示対象になる。
> enabled=falseのルールは保存・編集できるがruntime判定には参加しない。ルール内はAND。
> UIのedit focusはruntime activationとは独立する。

## 条項一覧

| ID | パターン | 保証 | 内容 |
|:---|:---|:---|:---|
| FLT-001 | `rule_reject_when` | property-tested | mode=鋼のみ のルールは、isHard=false の亀裂にどんな入力でも合致しない |
| FLT-002 | `rule_reject_when` | property-tested | mode=通常のみ のルールは、isHard=true の亀裂にどんな入力でも合致しない |
| FLT-003 | `rule_reject_when` | property-tested | storms=除外 のルールは、isStorm=true の亀裂(VOID嵐)に合致しない |
| FLT-010 | `rule_reject_when` | property-tested | storms=嵐のみ のルールは、isStorm=false の通常亀裂に合致しない(storm only指定) |
| FLT-011 | `storm_truth_table` | property-tested | 他の条件が全対象なら、storms=除外/含む/嵐のみ は isStorm=false/true に対してそれぞれ (合致/棄却)/(合致/合致)/(棄却/合致) となる |
| FLT-012 | `proxima_node_aliases` | property-tested | VOID嵐ではUIのEarth/Venus/Saturn/Neptune/Pluto/Veil Proxima条件がAPI nodeの基底名Earth/Venus/Saturn/Neptune/Pluto/Veilに合致するが、通常亀裂にはProxima別名を適用しない |
| FLT-004 | `rule_pass_when_empty` | property-tested | ルールのtiersが空のとき、tierを理由に棄却しない(空=全tier対象) |
| FLT-005 | `rule_pass_when_empty` | property-tested | ルールのmission_typesが空のとき、ミッション種別を理由に棄却しない(空=全種別対象) |
| FLT-006 | `rule_pass_when_empty` | property-tested | ルールのplanetsが空のとき、惑星を理由に棄却しない(空=全惑星対象) |
| FLT-007 | `settings_reject_when` | property-tested | 残り時間がmin_remaining_secs未満の亀裂は、ルール構成に依らず合致しない(期限切れ含む) |
| FLT-008 | `single_rule_embedding` | property-tested | ルール1つの設定では、全体合致 = (残り時間OK ∧ rule.enabled ∧ そのルールの条件が合致) |
| FLT-009 | `rule_additivity` | property-tested | 有効ルールを追加しても、それまで合致していた亀裂は合致し続ける(有効ルールORの単調性) |
| FLT-013 | `enabled_rules_or` | property-tested | 全体合致は、残り時間条件を満たし、enabled=trueのルールの少なくとも1本が条件合致する場合に限る。disabledルールだけ、またはルールなしでは合致しない |
| FLT-014 | `enabled_projection` | property-tested | enabled projectionは有効ルールを元の順序で保持してdisabledルールだけを除き、共通のmin_remaining_secsを保持する。disabled draftの追加・削除・条件編集では変わらず、enabled切替・有効ルール条件・min_remaining_secsの変更は通知範囲へ反映される |
| DED-001 | `at_most_once` | property-tested | 同一亀裂idは任意のポーリング列で高々1回しか通知されない |
| DED-002 | `prune_preserves_live` | property-tested | pruneは生存中idの通知済み状態を保持し、期限切れidを除去する |
| DED-003 | `overlapping_rules_at_most_once` | property-tested | 同じ亀裂へ複数の有効ルールが合致しても、一覧・通知候補では亀裂id単位の1件として扱い、同一亀裂は高々1回しか通知されない |
| PRS-001 | `parse_total` | property-tested | 惑星抽出は任意文字列でパニックせず、"Node (Planet)" 形式でPlanetを返す |
| POL-001 | `bounded` | property-tested | APIバックオフの遅延は失敗・成功がどう並んでも常に[60s, 600s]に収まる |
| POL-002 | `seed_silent` | property-tested | 起動直後の初回ポーリングはシードのみ: 既存の合致亀裂を通知済みとして記録するが、通知は1件も発火しない(起動時の通知洪水を防ぐ) |
| POL-003 | `notification_scope_change` | property-tested | 初回評価とenabled projectionが変わった設定変更だけを通知範囲変更とし、変更時点で現存する合致亀裂はsilent seedして一括通知しない。その後に現れた新規idは1回だけ通知候補となる。disabled draftだけの追加・削除・条件編集や配送設定だけの変更では再seedしない |
| VIS-001 | `filtered_view` | property-tested | 一覧に表示されるのはいずれかの有効ルールに合致する亀裂のみ(対象外は非表示)。かつ合致する亀裂は1件も取りこぼさない |
| FZY-001 | `fuzzy_subsequence` | property-tested | パレットのファジーマッチが成立するのは、クエリ文字が候補文字列(またはalias)に順序どおり現れる場合に限る(健全性) |
| FZY-002 | `fuzzy_empty_query` | property-tested | 空クエリはパレット候補の全件を返す(完全性) |
| FZY-003 | `fuzzy_exact_first` | property-tested | クエリと完全一致する候補(label/alias)が存在すれば、先頭候補は完全一致である |
| FZY-004 | `fuzzy_deterministic` | property-tested | 同一クエリ・同一候補集合に対するパレットの結果順序は決定的 |
| SAT-001 | `satisfiable_after_ops` | property-tested | パレット操作列をどう並べても、適用後のすべてのルールはドメイン互換表(Requiem↔クバ要塞、Omnia↔ザリマン、VOID嵐↔Proxima星系等)に関して充足可能。ルール内で両立しない選択は新しい方を残して上書き解決される |
| EDT-001 | `editor_activation_independent` | property-tested | edit focusとruntime activationは独立する。ルールのenabled切替は条件とedit indexを変えず、edit index変更はrulesを変えず、disabledルールへ任意のfilter候補を適用してもdisabledのまま編集できる |
| EDT-002 | `new_rule_disabled` | property-tested | NEW RULEは既存ルールを一切変更せず、enabled=falseのdraftを末尾へ追加し、そのdraftをedit対象にする |
| CLR-001 | `clear_resets` | property-tested | クリア操作は1回でルール構成を既定(enabled=trueの全対象ルール1本、ストーム除外、両方モード)に戻す |
| CFG-001 | `legacy_storm_config` | property-tested | 旧設定のincludeStorms=false/trueは、読込時にstorms=除外/含むへそれぞれ無損失移行される |
| CFG-002 | `legacy_rule_enabled` | example-tested | enabledを持たない既存WatchRule JSONはenabled=trueとして読み込み、明示したenabled=falseはserialize/deserialize後もfalseのまま保持する |
| NTF-001 | `notification_example` | example-tested | 通知テストは全選択先の要求受付時だけ成功し、desktopを表示済み・配信済みとは扱わない。1件でも失敗すれば失敗先・理由・要求受付済みの部分成功先を保持して失敗し、通知先なしも失敗する |
| NTF-002 | `notification_example` | example-tested | desktop通知payloadは呼出側から渡した同一nowで残り時間を計算し、HARDとSTORMを独立にtitleへ含め、期限切れの残り時間を0分に丸める |
| NTF-003 | `notification_example` | example-tested | 未バンドルのraw devでdesktop通知を利用できない場合は、失敗詳細を保持し、デバッグbundle .appを使う just notification-test を案内する |
| NTF-004 | `notification_example` | example-tested | Discord Webhook URLは既存queryを保持しながらwait=trueをちょうど1つに正規化し、レスポンスが非空Message IDを含むJSONのときだけ要求受付と判定する。ID欠落・空文字・不正JSONは失敗する |
| MAN-001 | `manual` | manual | 通知テスト専用bundleと配布bundleの各名義で、macOSの初回権限許可とバナー表示を人が知覚できる |
| MAN-002 | `manual` | manual | Discord Webhook通知がスマホのDiscordアプリでpush表示される |
| MAN-003 | `manual` | manual | ファジーパレットのUX: どこでも打鍵で開き、連続トグルでき、日本語aliasが引ける |
| MAN-004 | `manual` | manual | Tier・惑星・ミッション種別・ファクション・難易度・VOID嵐を、文字ラベルを保ったまま識別用SVGアイコンでも表示する |
| MAN-005 | `manual` | manual | macOSメニューバーにRELICO専用のモノクロテンプレートアイコンを表示する |
| MAN-006 | `manual` | manual | 配布バンドルにRELICO専用アプリアイコンを使用する |
| MAN-007 | `manual` | manual | macOSではコンソール表示中だけ通常アプリとしてDockとウィンドウ切替ツールに現れ、閉じるとメニューバー常駐へ戻る |
| MAN-008 | `manual` | manual | ルール一覧でruntime有効化とedit focusを別々に操作でき、複数の有効ルールをORとして監視できる |
| MAN-009 | `manual` | manual | 配布版・通知テスト版・DMG一時mountがLaunchServicesで競合せず、配布版のcanonical appだけがcom.annenpolka.relicoとして残る |
| MAN-010 | `manual` | manual | 右サイドバーは最小ウィンドウでも縦スクロールを必要とせず、現在の通知ルールと全編集入口を常時表示する |
| MAN-011 | `manual` | manual | 亀裂表の利用幅が740px未満では各亀裂を2段compact rowで表示し、横スクロールせず全7項目を比較できる |

保証ラベルの意味: **property-tested** = proptestオラクルで機械検証 / **example-tested** = 具体例テストで機械検証 / **manual** = 手動確認(残余)

## 手動確認手順(manual条項)

リリース前に以下を実施する。

### MAN-001: 通知テスト専用bundleと配布bundleの各名義で、macOSの初回権限許可とバナー表示を人が知覚できる

just notification-testでRELICO Notification Test bundleを起動し、同名義に対するmacOS初回通知許可を承認してバナーを目視確認する。配布bundle .appではRELICO名義の権限とバナーを別途目視確認する。両bundleは権限・設定・重複排除状態を共有しない。title/body生成と結果表示はNTF-001〜003で機械検証し、この条項には各名義の初回権限UIと人間によるバナー知覚だけを残す。

### MAN-002: Discord Webhook通知がスマホのDiscordアプリでpush表示される

専用Webhookへテスト通知を送り、スマホのDiscordアプリでpush通知が表示されることだけを目視確認する。HTTP送信結果やpayload内容はこのmanual残余に含めない。

### MAN-003: ファジーパレットのUX: どこでも打鍵で開き、連続トグルでき、日本語aliasが引ける

1) どこにもフォーカスがない状態で打鍵→パレットが開き入力が引き継がれる。2) axi⏎ hagane⏎ のように連続トグルでき、escで閉じる。3) IME有効のまま打鍵しても即確定せず、「鋼」「耐久」「分裂」などの日本語aliasを変換して入力できる。4) taikyu/taikyuu のようなローマ字読み揺れでもヒットする。5) NEW RULE/DELETE RULE/CLEARが候補から実行できる。6) パレットが閉じた一覧画面でesc→条件が一発クリアされる(CLR-001と同じ挙動)。

### MAN-004: Tier・惑星・ミッション種別・ファクション・難易度・VOID嵐を、文字ラベルを保ったまま識別用SVGアイコンでも表示する

一覧・フィルタレール・ファジーパレットを開き、各カテゴリの既知値に対応する小型SVGアイコンが文字ラベルと並んで表示されることを目視確認する。一覧では難易度をMODE列、VOID嵐をSTORM列へ分離し、HARDかつSTORMのような組合せも独立に読めることを確認する。未知のAPI値でも一覧が壊れず、カテゴリ別の汎用アイコンへフォールバックすること、アイコンを非表示にしても文字だけで意味が失われないことも確認する。

### MAN-005: macOSメニューバーにRELICO専用のモノクロテンプレートアイコンを表示する

アプリを起動し、メニューバーに既定のTauriアイコンではなくRELICO専用アイコンが表示されることを確認する。macOSのライト/ダーク外観を切り替え、テンプレートアイコンとして自動反転し、輪郭が欠けず判別できることを目視確認する。

### MAN-006: 配布バンドルにRELICO専用アプリアイコンを使用する

just buildで生成した.appをFinderで表示し、既定のTauriアイコンではなくRELICO専用アプリアイコンが通常表示と小サイズ表示の両方で判別できることを確認する。

### MAN-007: macOSではコンソール表示中だけ通常アプリとしてDockとウィンドウ切替ツールに現れ、閉じるとメニューバー常駐へ戻る

just devと配布.appの両方で確認する。1) コンソール表示中はDockにRELICOアイコンが現れ、PaneruとRaycastのSwitch Windowsからウィンドウを選択・フォーカスできる。2) 閉じるとプロセスとメニューバー監視は継続したままコンソールとDockアイコンが消える。3) トレイのOPEN CONSOLE、またはアプリの再オープンでコンソールが再表示・フォーカスされ、Dockと各ウィンドウ切替ツールに再び現れる。

### MAN-008: ルール一覧でruntime有効化とedit focusを別々に操作でき、複数の有効ルールをORとして監視できる

異なる条件のルールを3本作成して確認する。1) ルール行本体を選ぶとedit focusだけが移り、enabled checkboxは変わらない。2) checkboxを切り替えてもedit focusと条件は変わらない。3) disabledルールを選択して条件を編集してもdisabledのまま保持される。4) 複数ルールをenabledにするとそのORが一覧・通知対象になり、同じ亀裂が複数ルールへ合致しても1件だけ表示・通知される。5) 全ルールをdisabledにするとNO ENABLED RULES相当の状態が明示され、一覧・通知対象は0件になる。6) 全ルールdisabledでもTEST DELIVERYはルールをバイパスし、選択した配送経路のテストだけを実行する。

### MAN-009: 配布版・通知テスト版・DMG一時mountがLaunchServicesで競合せず、配布版のcanonical appだけがcom.annenpolka.relicoとして残る

1) 配布版はproductName=relico / identifier=com.annenpolka.relico、通知テスト版はproductName=RELICO Notification Test / identifier=com.annenpolka.relico.notification-testであることを各Info.plistで確認する。2) just notification-testを続けて実行しても通知テスト版のプロセスを複数起動しない。3) just build前後のLaunchServices dumpを比較し、存在しない/Volumes/dmg.*/relico.app登録が増えないことを確認する。4) 配布版を~/Applications/relico.appへ配置後、同identifierの登録がcanonical app 1件だけで、コンソール表示中のウィンドウをDock・Paneru・Raycast Switch Windowsから選択できることを確認する。

### MAN-010: 右サイドバーは最小ウィンドウでも縦スクロールを必要とせず、現在の通知ルールと全編集入口を常時表示する

Paneru等の外部ウィンドウマネージャがサイズを再適用しない状態(停止、またはRELICOをfloating化して保存済み管理状態も解除)で、ウィンドウを設定上の最小720x480へ縮めて確認する。1) 右サイドバー自身が縦スクロールせず、FILTERS/DELIVERYタブだけでルール切替・有効化・NEW/DEL/CLEAR、Tier/Mode/VOID嵐/Mission/Planet、配送先、TEST/PAUSE、残り時間、poll間隔へ到達できる。2) ルールは件数に比例して縦へ伸ばさず、前後移動できるcompact navigatorでedit focusだけを切り替え、enabled toggleは独立している。3) 各filter軸は現在値の要約を1行で表示し、押すと既存パレットをその軸に絞って開く。候補数の多いMission/Planetは検索して選べる。4) 候補の増加はsidebarの高さを変えず、亀裂表と一時的な検索パレットだけが必要に応じて独立スクロールする。5) 960x620の既定サイズでも要約が判読でき、選択値の文字とアイコンを併記する。

### MAN-011: 亀裂表の利用幅が740px未満では各亀裂を2段compact rowで表示し、横スクロールせず全7項目を比較できる

代表的な長い値(Requiem、Taveuni (Kuva Fortress)、Mobile Defense、Corrupted、HARD、STORM)を含むfixtureで確認する。1) 亀裂表の利用幅が740px以上ではTIER/NODE/MISSION/FACTION/T-REMAIN/MODE/STORMの7列1段表示を維持する。2) 740px未満では1段目をTIER/NODE/T-REMAIN、2段目をMISSION/FACTION/MODE/STORMのgridへ切り替え、MODEとSTORMは別セル・別ラベル・別アイコンのまま表示する。3) 最小720x480(表領域約510px)と800px幅でtablewrapのscrollWidthがclientWidth以下となり、横スクロールを必要としない。4) 長いNODE/MISSIONは行幅を拡張せずellipsisし、DOM/アクセシビリティ上の全文と行tooltipを保持する。5) 0件・全ルール無効・API失敗のempty rowは2段gridでも全幅に表示する。6) 右サイドバーとstatusbarの操作・表示は狭幅化によって失われない。
