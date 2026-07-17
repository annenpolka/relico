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
| STA-001 | `static_check` | example-tested | 配布版(relico / com.annenpolka.relico)と通知テスト版(RELICO Notification Test / com.annenpolka.relico.notification-test)は設定ファイル上でproductName・identifierがそれぞれ規定値を持ち、互いに一致しない |
| STA-002 | `static_check` | example-tested | トレイは専用tray-icon.pngをテンプレート画像として登録する配線を持ち、PNGはモノクロ(+アルファ)形式である |
| AST-001 | `approved_asset` | example-tested | メニューバー用tray-icon.pngは目視承認済みの内容から変わっていない(変えたらMAN-005の手順で再承認しsha256を更新する) |
| AST-002 | `approved_asset` | example-tested | 配布用アプリアイコンicon.icnsは目視承認済みの内容から変わっていない(変えたらMAN-006の手順で再承認しsha256を更新する) |
| ICN-001 | `renderer_glyphs` | example-tested | 既知のTier・惑星・ミッション・ファクション・難易度・VOID嵐・アクション値には汎用と区別できる専用SVGグリフが割り当てられ、未知値はカテゴリ別の汎用グリフへフォールバックし、グリフは装飾(aria-hidden)である |
| ICN-002 | `renderer_glyphs` | example-tested | 表示用惑星名はVOID嵐のときだけEarth/Venus/Saturn/Neptune/Pluto/VeilをProxima表記へ寄せ、通常亀裂・その他の惑星・欠損値はそのまま返す |
| RND-001 | `renderer_scenario` | example-tested | パレットはどこでも打鍵で開いて入力を引き継ぎ、Escで閉じ、一覧画面のEscは条件クリアを呼び、IME変換中のEnterは適用せず、確定後のEnterは候補を適用して開いたまま連続入力できる(renderer統合) |
| RND-002 | `renderer_scenario` | example-tested | Webhook URL入力直後のTEST DELIVERYは、遅延保存を先にflushしてから通知テストを実行する(renderer統合) |
| RND-003 | `renderer_scenario` | example-tested | ルール行のenabled切替はset_rule_enabledだけを呼びedit focus表示を変えず、行本体はパレットを開くだけで切替を呼ばない。全ルール無効では一覧とステータスバーにNO ENABLED表示が出る(renderer統合) |
| RND-004 | `renderer_scenario` | example-tested | 最小720x480でも右サイドバーは縦スクロールなしでルールnavigator・NEW/DEL/CLEAR・5軸launcher・配送設定・TEST/PAUSE・時間設定へ到達でき、launcherはパレットをその軸に絞って開く(renderer統合) |
| RND-005 | `renderer_scenario` | example-tested | 亀裂表はviewport 950pxで7列1段、949px以下で2段gridへ切り替わり、720/800/949pxで横スクロールを生まず、MODEとSTORMは独立セル、長い値はellipsisしてもDOM全文と行tooltipを保持し、empty rowは全幅、ヘッダはsticky、th[scope=col]は7個(renderer統合) |
| MAN-001 | `manual` | manual | 通知テスト専用bundleと配布bundleの各名義で、macOSの初回権限許可とバナー表示を人が知覚できる |
| MAN-002 | `manual` | manual | Discord Webhook通知がスマホのDiscordアプリでpush表示される |
| MAN-003 | `manual` | manual | ファジーパレットで、macOSの実IMEを使った日本語alias入力と、実アプリでの一連の操作ができる |
| MAN-004 | `manual` | manual | SVGアイコンが小サイズでも判別でき、HARD+STORMの併記が読める |
| MAN-005 | `manual` | manual | メニューバーのRELICOテンプレートアイコンがライト/ダーク外観で判別できる |
| MAN-006 | `manual` | manual | 配布バンドルのRELICOアプリアイコンが通常・小サイズ表示で判別できる |
| MAN-007 | `manual` | manual | macOSではコンソール表示中だけ通常アプリとしてDockとウィンドウ切替ツールに現れ、閉じるとメニューバー常駐へ戻る |
| MAN-008 | `manual` | manual | ルール一覧のtoggleとedit focusが視覚的に区別でき、実アプリで複数有効ルールのOR監視とTEST DELIVERYのルールバイパスが機能する |
| MAN-009 | `manual` | manual | 配布版・通知テスト版・DMG一時mountがLaunchServicesで競合せず、配布版のcanonical appだけがcom.annenpolka.relicoとして残る |
| MAN-010 | `manual` | manual | 右サイドバーの要約が読みやすく、情報の優先順位が視覚的に自然である |
| MAN-011 | `manual` | manual | compact表示が実データで読みやすく、VoiceOverでtable semanticsが自然に読み上げられる |

保証ラベルの意味: **property-tested** = proptestオラクルで機械検証 / **example-tested** = 具体例テストで機械検証 / **manual** = 手動確認(残余)

オラクルの実行先: `rule_*` 等のRustパターンは `cargo test`(src-tauri/tests/oracles_generated.rs)、
`renderer_glyphs` は `bun test tests/unit`、`renderer_scenario` は `just renderer-test`
(Playwright/WebKit、Tauri IPCはmock — Rust commandやOS通知を通った証明にはしない。docs/E2E.md参照)。

## 手動確認手順(manual条項)

### 毎リリース実施

#### MAN-003: ファジーパレットで、macOSの実IMEを使った日本語alias入力と、実アプリでの一連の操作ができる

リリース前に実アプリで短く確認する。1) IME有効のまま打鍵しても即確定せず、「鋼」「耐久」「分裂」などの日本語aliasを変換して入力できる(実IMEはWebDriverやsynthetic eventで代替できない — docs/E2E.md)。2) 実IPC経由でaxi⏎ hagane⏎の連続トグルとNEW RULE/DELETE RULE/CLEARの実行ができる。打鍵起動・Esc・変換中Enterの無視・連続適用の結線はRND-001で、alias解決とローマ字揺れはRustのFZY条項とexampleテストで機械検証済み。

#### MAN-007: macOSではコンソール表示中だけ通常アプリとしてDockとウィンドウ切替ツールに現れ、閉じるとメニューバー常駐へ戻る

just devと配布.appの両方で確認する。1) コンソール表示中はDockにRELICOアイコンが現れ、PaneruとRaycastのSwitch Windowsからウィンドウを選択・フォーカスできる。2) 閉じるとプロセスとメニューバー監視は継続したままコンソールとDockアイコンが消える。3) トレイのOPEN CONSOLE、またはアプリの再オープンでコンソールが再表示・フォーカスされ、Dockと各ウィンドウ切替ツールに再び現れる。

#### MAN-008: ルール一覧のtoggleとedit focusが視覚的に区別でき、実アプリで複数有効ルールのOR監視とTEST DELIVERYのルールバイパスが機能する

リリース前に実アプリで短く確認する。1) toggleとedit本体が視覚的に区別できる(誤操作しない)。2) 実IPC経由で複数ルールをenabledにするとそのORが一覧・通知対象になる。3) 全ルールdisabledでもTEST DELIVERYはルールをバイパスし、選択した配送経路のテストだけを実行する。OR・dedup・edit独立の意味論はFLT-013/014・DED-003・EDT-001/002で、UI結線(toggle/edit分離・NO ENABLED表示)はRND-003で機械検証済み。

#### MAN-009: 配布版・通知テスト版・DMG一時mountがLaunchServicesで競合せず、配布版のcanonical appだけがcom.annenpolka.relicoとして残る

機械検査部分は just macos-smoke で実行する(ビルド済みInfo.plistのproductName/identifier、通知テスト版プロセスが複数起動していないこと、/Volumes/dmg.*の残留登録がないこと、canonical登録が実在する1件だけであること。設定ファイル上のidentity分離はSTA-001で常時検証)。人間に残るのは、~/Applications/relico.appのコンソール表示中ウィンドウをDock・Paneru・Raycast Switch Windowsから選択できることの確認だけ。

#### MAN-010: 右サイドバーの要約が読みやすく、情報の優先順位が視覚的に自然である

リリース前に、Paneru等の外部ウィンドウマネージャがサイズを再適用しない状態で720x480と960x620を目視し、filter軸の要約1行(文字+アイコン併記)が判読でき、情報の優先順位が自然であることを確認する。縦スクロール不要・全編集入口への到達・launcherの軸絞り・empty表示はRND-004で機械検証済み(IPC mockのrenderer統合であり、実ウィンドウマネージャ環境の挙動はこの目視に残る)。

#### MAN-011: compact表示が実データで読みやすく、VoiceOverでtable semanticsが自然に読み上げられる

リリース前に、実データ(実ワールドステート)で狭幅表示の情報密度と読みやすさを目視し、WKWebView/VoiceOverでtable semantics(7項目の見出しと値)が自然に読み上げられることを確認する。1段/2段の切替幅・横スクロール禁止・MODE/STORM独立・ellipsis時の全文とtooltip保持・empty row全幅・stickyヘッダ・th[scope=col]はRND-005で機械検証済み。

### 一回限りの受入(対象が変わったときだけ再実施)

#### MAN-001: 通知テスト専用bundleと配布bundleの各名義で、macOSの初回権限許可とバナー表示を人が知覚できる

各名義の初回セットアップ時に1回だけ実施する。just notification-testでRELICO Notification Test bundleを起動し、同名義に対するmacOS初回通知許可を承認してバナーを目視確認する。配布bundle .appではRELICO名義の権限とバナーを別途確認する。両bundleは権限・設定・重複排除状態を共有しない。payload生成・結果表示・identity分離はNTF-001〜003とSTA-001で機械検証済みのため、この条項に残るのは各名義の初回権限UIと人間によるバナー知覚だけであり、identifierを変えたときだけ再実施する。

#### MAN-002: Discord Webhook通知がスマホのDiscordアプリでpush表示される

Webhook設定の初回セットアップ時に1回だけ、専用Webhookへテスト通知を送り、スマホのDiscordアプリでpush通知が表示されることを目視確認する。HTTP要求の構築とサーバー受理判定はNTF-004で機械検証済み。受理以降のpush配達はDiscord基盤の責務であり、本アプリの保証範囲はサーバー受理で終端する(リリースごとの再確認は不要)。

#### MAN-004: SVGアイコンが小サイズでも判別でき、HARD+STORMの併記が読める

icons.tsのグリフ形状を追加・変更したときだけ、一覧・フィルタレール・パレットで該当アイコンが文字ラベルと並んで判別できること、HARDかつSTORMのような組合せが独立に読めることを目視確認する。既知値→専用グリフの写像・未知値のフォールバック・装飾扱い(aria-hidden)はICN-001/002で、MODE/STORM列の独立はRND-005で機械検証済み。

#### MAN-005: メニューバーのRELICOテンプレートアイコンがライト/ダーク外観で判別できる

tray-icon.pngを変更したときだけ、メニューバーでライト/ダーク外観を切り替えて自動反転と輪郭を目視確認し、承認としてAST-001のsha256を更新する。テンプレート形式(モノクロ+アルファ)と配線はSTA-002で、内容の凍結はAST-001で機械検証済み。

#### MAN-006: 配布バンドルのRELICOアプリアイコンが通常・小サイズ表示で判別できる

icon.icnsを変更したときだけ、just buildで生成した.appをFinderの通常表示と小サイズ表示で目視確認し、承認としてAST-002のsha256を更新する。内容の凍結はAST-002で機械検証済み。
