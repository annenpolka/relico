# relico — Warframe亀裂通知 仕様

> **生成物 — 手編集禁止。** 正本は `specs/notifier.pkl`。変更は正本を編集して `just spec-gen`。
>
> 保証の勾配: このプロジェクトの機械保証の最上位は property-based test である。
> proven(証明) / model-checked(モデル検査) の条項は存在しない。勾配を平らに見せない。
>
> ルール内はAND、複数ルールは用途ごとにORする。一覧表示はenabled=trueのVIEWルール、
> 通知はnotify=trueのNOTIFYルールを使い、両者は独立する。
> enabled=false, notify=trueの非表示ルールも通知対象になる。
> VIEW選択、NOTIFY参加、UIのedit focusは互いに独立する。

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
| FLT-016 | `rule_pass_when_empty` | property-tested | ルールのfactionsが空のとき、陣営を理由に棄却しない(空=全陣営対象)。非空ならAPIのenemy値との完全一致で絞り込む |
| FLT-007 | `settings_reject_when` | property-tested | 残り時間がmin_remaining_secs未満の亀裂は、ルール構成に依らず合致しない(期限切れ含む) |
| FLT-015 | `settings_reject_when` | property-tested | expiryが現在時刻以下の亀裂は、min_remaining_secs=0でもルール構成に依らず合致しない(生存条件はexpiry > now) |
| FLT-008 | `single_rule_embedding` | property-tested | ルール1つの一覧表示判定では、全体合致 = (残り時間OK ∧ rule.enabled ∧ そのルールの条件が合致) |
| FLT-009 | `rule_additivity` | property-tested | 表示選択(enabled=true)ルールを追加しても、それまで一覧表示に合致していた亀裂は合致し続ける(表示ルールORの単調性) |
| FLT-013 | `enabled_rules_or` | property-tested | 一覧表示の全体合致は、残り時間条件を満たし、enabled=trueのルールの少なくとも1本が条件合致する場合に限る。表示選択なし、またはルールなしではフィルタ合致しない |
| FLT-014 | `notification_projection` | property-tested | notification projection(通知範囲の射影)はnotify=trueのルールをenabledに依らず元の順序で保持し、照合用にenabled=trueへ正規化して、notify=falseルールを除き、共通のmin_remaining_secsを保持する。表示選択(enabled)の変更やnotify=false draftの追加・削除・条件編集では変わらず、notify切替・通知参加ルールの条件・min_remaining_secsの変更は通知範囲へ反映される。ルール名は表示用メタデータであり射影に含まれない(名前変更は通知範囲を変えず、再seedを起こさない) |
| DED-001 | `at_most_once` | property-tested | 同一亀裂idは任意のポーリング列で高々1回しか通知されない |
| DED-002 | `prune_preserves_live` | property-tested | pruneは生存中idの通知済み状態を保持し、期限切れidを除去する |
| DED-003 | `overlapping_rules_at_most_once` | property-tested | 同じ亀裂へ複数の表示ルールまたは通知ルールが合致しても、一覧・通知候補では亀裂id単位の1件として扱い、同一亀裂は高々1回しか通知されない |
| PRS-001 | `parse_total` | property-tested | 惑星抽出は任意文字列でパニックせず、"Node (Planet)" 形式でPlanetを返す |
| POL-001 | `bounded` | property-tested | APIバックオフの遅延は失敗・成功がどう並んでも常に[60s, 600s]に収まる |
| POL-002 | `seed_silent` | property-tested | 起動直後の初回ポーリングはシードのみ: 既存の合致亀裂を通知済みとして記録するが、通知は1件も発火しない(起動時の通知洪水を防ぐ) |
| POL-003 | `notification_scope_change` | property-tested | 初回評価とnotification projectionが変わった設定変更だけを通知範囲変更とし、変更時点で現存する合致亀裂はsilent seedして一括通知しない。その後に現れた新規idは1回だけ通知候補となる。表示選択(enabled)だけの変更、notify=false draftだけの追加・削除・条件編集、配送設定・通知ミュート時間・表示言語だけの変更では再seedしない |
| MUT-001 | `daily_mute_window` | property-tested | 有効な日次通知ミュート区間はシステムローカル時刻の分単位で[start, end)として判定する。start<endは同日区間、start>endは日跨ぎ区間、start==endは誤って終日停止しない空区間であり、負数を含む無効設定と範囲外の分値もミュートしない。この真理値は1日の全1440分で成立する |
| MUT-002 | `muted_delivery` | property-tested | 起動直後のseed中または通知ミュート中に観測した合致亀裂は通知済みidとしてmarkするが配送対象を1件も返さない。通常配送へ戻しても同じidを滞留通知せず、その後に現れた新規idだけを1回返す。配送判定はHTTP取得開始時ではなく取得後の最新設定を使い、ミュート・一時停止・表示言語の変更を次の配送前へ反映する。ミュートは一覧・通知候補・next表示を変えず、明示操作のTEST DELIVERYには適用しない |
| ARB-001 | `arbitration_schedule` | property-tested | browse.wf仲裁scheduleは2件以上の非空nodeを持ち、先頭timestampがUTC時間境界に揃い、隣接行ごとに厳密な3600秒間隔で増加するときだけ受理する。空node、重複、逆順、1秒でも異なるgap、数値でないtimestampは全体を不正として扱う |
| ARB-002 | `arbitration_schedule` | property-tested | 仲裁schedule lookupはnowをUTC時間slotへ切り下げ、先頭timestamp以上かつ末尾timestamp+3600秒未満だけ対応する行を返す。先頭より前と末尾slot終了以後はOutOfRangeであり、剰余による循環・端値補間を行わない |
| SRC-001 | `timed_source_isolation` | property-tested | WFCD、DE公式worldstate、browse.wf Oracle Bounty、browse.wf location-bounties、browse.wf仲裁scheduleは独立sourceである。成功sourceはexpiry>nowのcardだけで自分のsliceを置換してfreshとし、失敗sourceはexpiry>nowのlast-known-goodだけを保持して生存cardがあればstale、なければunavailableとし、他sourceのcard・healthを変えない。schedule範囲外はcardを空にしてout-of-rangeとし、expiry欠落cardを時限cardとして保持しない。有効な動的payloadをstatic assetへjoinした失敗だけ該当Bounty/location cacheを、仲裁deriveのFailed/OutOfRangeは仲裁cacheだけを24時間待たず短期再取得する。動的payloadのHTTP・JSON・expiry・必須field失敗ではstatic cacheを再取得せず、再取得は対象cache用assetだけをfetch/applyして他sourceのcard・healthを変えない。join不整合が続く再取得間隔は1分、5分、30分、以後2時間を上限とし、join成功で先頭へresetする。static assetのfetch失敗中はjoin backoff段を消費せず、60秒のfetch retry成功後に続きから再開する |
| BNT-001 | `bounty_freshness` | property-tested | browse.wf Oracle bounty-cycleはexpiryが変換可能なミリ秒時刻で、同一の取得後nowより厳密に未来の場合だけfreshとする。expiry欠落・変換不能・now以下の期限切れpayloadは成功扱いせず、last-known-good Bountyを上書きしない |
| CNT-001 | `content_rule_match` | property-tested | コンテンツ監視ルールは時限cardへ合致する: kindsが空なら全kind、非空ならcard.kindの完全一致を要求する。missionTypesとminEnemyLevelの両方が未指定ならkind条件だけで合致し、どちらかを指定したルールは「キーワード条件とレベル条件を同時に満たすstageが1つ以上ある」場合だけ合致する。キーワード条件は正準化キーワードがstage titleまたはchoicesに大文字小文字を無視して部分一致すること(未指定なら常に真)、レベル条件はstageのenemy levelsが存在してその最小値がminEnemyLevel以上であること。enemy levelsを持たないstageへレベル条件は合致しない(レベルを捏造しない) |
| CNT-002 | `content_notify_once` | property-tested | コンテンツ通知の選択はexpiryを持つ合致cardだけを対象にし、seed評価・ミュート評価では通知済みとしてmarkするが配送対象を返さない。どんな評価列でも同一card idの配送は高々1回で、配送対象は常にその評価の合致集合の部分集合であり、非合致cardをmarkも配送もしない |
| CNT-003 | `content_scope_change` | property-tested | コンテンツ通知範囲のprojectionはnotify=trueのルールだけを元の順序で保持し、キーワードを正準化して比較する。ルール名の変更・notify=falseルールの追加削除編集ではprojectionは変わらず、notify切替・notify=trueルールのkinds/missionTypes/minEnemyLevel変更では変わる。初回評価とprojection変更後の評価はsilent seedとなり現存合致cardを一括通知しない |
| CNT-004 | `content_keyword_canonical` | example-tested | コンテンツ監視ルールのキーワードは前後空白を除去し、パレットのミッション語彙(label or alias、大文字小文字無視)へ一致すれば正準ミッション名(防衛→Defense、確保→Capture、md→Mobile Defense等)に解決し、一致しなければrawのまま使う |
| CPL-001 | `content_palette` | property-tested | 亀裂以外の各コンテンツタブのピッカーカタログは、ミッションキーワード候補(パレット語彙全件)、レベル下限プリセット(30/60/100/150/200)と解除候補、タブに表示されるcontentRules(kinds未指定を含む)のnotifyトグル候補(label=ルール名、未設定ならA{n})、NEW ALERT/DELETE ALERT、共有のGO TO/PAUSEだけを含み、亀裂専用候補(tier/planet/faction/mode/storm/SORT/亀裂rule/亀裂ルール操作)を含まない。クエリに数字があればその値のレベル下限候補を、語彙に解決しない非数字クエリはrawキーワード候補を動的に加える。未知タブのカタログは空 |
| CPL-002 | `content_palette` | property-tested | コンテンツ候補の適用はcontentRulesだけを変更する: キーワード候補は編集先ルールのmissionTypesを正準化キーワードの同値でトグルし(防衛とDefenseは同じ)、他のキーワード・kinds・name・レベル下限を保持する。レベル候補は編集先のminEnemyLevelを設定し、同値の再適用で解除へ往復する。レベル解除候補は編集先のminEnemyLevelだけを外し、編集先がなければ何も作らない。notifyトグル候補は対象ルールのnotifyだけを反転して再適用で元に戻る。DELETE ALERTは編集先ルールだけを除去し、編集先がなければ何も変更しない。どの適用も対象外のルールと並び順を変えない |
| CPL-003 | `content_palette` | property-tested | 条件編集の編集先はタブ専用(kinds非空かつタブkind群と交差)ルールの末尾で、kinds未指定の全タブ共通ルールは編集先にならない。編集先がない状態でキーワード/レベル候補を適用すると、既存ルールを変更せずkinds=タブkind群・notify=ONの新ルールを末尾へ1本作って適用する。NEW ALERTはnotify=OFF・条件なしの安全なdraftを末尾へ追加し、そのdraftへの最初のキーワード/レベル適用はnotify=ONへ確定する。条件を持つ既存ルールへの条件編集はnotifyを暗黙に変えない |
| CFG-006 | `content_rules_config` | example-tested | AppConfigのcontentRulesは後方互換の省略可能fieldで、持たない旧JSONは空リストとして読み込む。ルールのnotifyが欠落した場合はtrueで、設定したnotify/name/kinds/missionTypes/minEnemyLevelはserialize/deserializeを往復しても保持され、camelCaseでserializeされる |
| NTY-001 | `notify_candidates` | property-tested | 通知候補はnotify=trueのルールのORに合致する亀裂のみで、それらを1件も取りこぼさない。enabled=falseの非表示ルールも通知へ参加し、通知候補は一覧表示の部分集合に限定されない |
| VIS-001 | `filtered_view` | property-tested | 表示選択(enabled=true)ルールがあるとき、一覧に表示されるのはいずれかの表示ルールに合致する生存中(expiry > now)の亀裂のみで、合致する亀裂は1件も取りこぼさない。表示選択が1本もない(無指定)ときはmin_remaining_secsにかかわらず生存中の全亀裂を表示し、期限切れは表示しない。どちらの場合も通知参加はnotifyだけで独立に決まる |
| FZY-001 | `fuzzy_subsequence` | property-tested | パレットのファジーマッチが成立するのは、クエリ文字が候補文字列(またはalias)に順序どおり現れる場合に限る(健全性) |
| FZY-002 | `fuzzy_empty_query` | property-tested | 空クエリはパレット候補の全件を返す(完全性) |
| FZY-003 | `fuzzy_exact_first` | property-tested | クエリと完全一致する候補(label/alias)が存在すれば、先頭候補は完全一致である |
| FZY-004 | `fuzzy_deterministic` | property-tested | 同一クエリ・同一候補集合に対するパレットの結果順序は決定的 |
| SAT-001 | `satisfiable_after_ops` | property-tested | パレット操作列をどう並べても、適用後のすべてのルールはドメイン互換表(Requiem↔クバ要塞、Omnia↔ザリマン、VOID嵐↔Proxima星系等)に関して充足可能。ルール内で両立しない選択は新しい方を残して上書き解決される |
| EDT-001 | `editor_activation_independent` | property-tested | edit focus・一覧表示選択(enabled)・通知参加(notify)は独立する。enabled切替は条件・notify・edit indexを変えず、notify切替も条件・enabled・edit indexを変えず、edit index変更はrulesを変えない。別にVIEW選択ルールがある状態で非表示ルールへfilter候補を適用してもenabled/notifyを暗黙に変えない |
| EDT-002 | `new_rule_disabled` | property-tested | NEW RULEは既存ルールを一切変更せず、enabled=falseかつnotify=falseの安全な空draftを末尾へ追加し、そのdraftをedit対象にする。VIEW選択0本でその空draftへ最初のfilter候補を適用すると、名前が付いていても別ルールを増やさずdraftをenabled=true・notify=falseのVIEWルールとして確定する |
| EDT-004 | `unselected_apply_creates_rule` | property-tested | 表示選択が1本もない(無指定)状態でfilter候補を適用すると、既存ルールを変更せず末尾へenabled=true・notify=falseの新しいVIEWルールを1本作り、候補を適用してedit対象にする。以後のfilter候補は同じ新ルールへ適用して増殖させない。edit対象がNEW RULEで作った安全な空draftなら、そのdraftを再利用してVIEWルールへ確定する |
| EDT-003 | `rule_toggle_candidates` | property-tested | パレットの実行時カタログは各ルールをrule:{index}候補(label=ルール名、未設定ならR{n}、facet=RULE)として含み、適用は対象ルールのenabledだけを反転して条件・順序・notify・edit indexを変えず、再適用で元に戻る(トグル)。action:toggle-rule候補は編集中(active)ルールのenabledだけを、action:notify-rule候補は編集中ルールのnotifyだけを同様に反転する。action:deselect-all-rules(全ルール解除)は全ルールのenabledだけをfalseにしてnotify・条件・順序・edit indexを保持し、再適用しても同じ状態になる |
| CLR-001 | `clear_resets` | property-tested | クリア操作は1回でルール構成を既定(enabled=trueの全対象ルール1本、ストーム除外、両方モード)に戻す |
| CFG-001 | `legacy_storm_config` | property-tested | 旧設定のincludeStorms=false/trueは、読込時にstorms=除外/含むへそれぞれ無損失移行される |
| CFG-002 | `legacy_rule_enabled` | example-tested | enabledを持たない既存WatchRule JSONはenabled=true(一覧表示へ参加)として読み込み、明示したenabled=falseはserialize/deserialize後もfalseのまま保持する |
| CFG-003 | `rule_name_config` | example-tested | WatchRuleのnameは省略可能な表示用メタデータで、nameを持たない旧JSONは名前なしとして読み込み、設定したnameはserialize/deserializeを往復しても他のフィールドと共に保持される |
| CFG-004 | `rule_notify_config` | example-tested | WatchRuleのnotifyはenabledから独立した通知参加フラグで、notifyを持たない旧JSONは旧enabled値(それも欠落ならtrue)を引き継ぐ。明示したnotify=true/falseはenabledの値に関係なくserialize/deserializeを往復しても保持される |
| CFG-005 | `app_config_compat` | example-tested | AppConfigのlocaleが欠落した旧JSONは日本語(ja)として読み込み、ja/en/zh-Hansはwire値を変えずserialize/deserializeを往復する。通知ミュート設定が欠落した旧JSONはOFFとなり、有効なstartMinute/endMinuteは往復保持される。分値は0..1439だけを有効とし、範囲外値は通知を止めないfail-openとなる。locale・通知ミュートだけの変更はnotification projectionを変えない |
| TMD-001 | `timed_content_fixture` | example-tested | 時限content wireはcardごとにactive/upcomingの時間状態、official-live/community-live/community-scheduleのprovenance、物理contributor ID群を別fieldで持ち、WFCD/DE/Oracle Bounty/Oracle location-bounties/仲裁のsource freshnessをfresh/stale/out-of-range/unavailableとしてcamelCaseで安定してserializeする。Areaの環境・通常依頼・objective rotation・追加依頼・eventは別sliceであり、旧synthetic availabilityとbackend netracells fieldは持たない |
| TMD-002 | `timed_content_fixture` | example-tested | 有効な仲裁schedule行とPublic Exportのregion・faction・辞書fixtureを結合すると、対象1時間のnode、惑星、mission、faction、enemy level、Dark Sector bonusを持つcommunity-schedule cardになり、browse.wfをsourceとして保持する |
| TMD-003 | `timed_content_fixture` | example-tested | 期限内のbounty-cycleとPublic Export fixtureを結合すると、expiry/rot/vaultRot/zarimanFactionを保持し、Holdfasts/Cavia/Hexを別cardとしてnode、challenge、Hex allyを保持する。必須root・3 tag・node・challengeの欠落は空cardにせずsource errorとし、未知identifierは空欄化せずrawを残し、Oracleにないenemy level・standingを捏造しない |
| TMD-004 | `timed_content_fixture` | example-tested | DE公式EndlessXpSchedule fixtureはactiveなEXC_NORMALの3 frameとEXC_HARDの5 weaponをkind=circuit・variantなしの一つのCircuit cardへ正規化し、stage titleをNormal Circuit/Steel Path Circuitとしてactivation/expiryとofficial-live sourceを保持する。active scheduleは厳密に1件を要求し、空・active 0件・active複数はsource errorとしてlast-known-goodを空で上書きしない |
| TMD-005 | `timed_content_fixture` | example-tested | 既存sourceの詳細を落とさず、WFCD固定fixtureのSortieはkind/title、boss・faction・rewardのsubtitle、stage title/node、modifier名・説明を保持し、Archonはkind/title、boss・factionのsubtitle、stage title/nodeを保持する。Syndicate nodeをstageとして保持し、Area jobはjob固有expiryごとに期限を分離してreward drop(item/rarity/chance/count)を保持し、Archimedeaはcondition descriptionとstandard/elite区分を保持する。通常Sortieのmissions・Archonのvariantsのような当該cardで使わないfieldとArchon rewardPoolの欠落は許容するが、取得中entryの必須日時・interval・使用するstage/detail fieldが壊れたWFCD payloadは部分成功にせずsource errorとする。DE Descentsはexpired entryを除外し、payload内のactiveと全future entryをactivation順に保持してSpecs/Aurasを残し、futureをupcomingとして区別する。Descentsの空payload・全expired・逆転interval・空stage・重複Index・Specs/Auras欠落はsource errorとしてlast-known-goodを空で上書きせず、固定fixtureでは現在1週と将来5週の各21 stageを検査する |
| TMD-007 | `timed_content_fixture` | example-tested | ExportRegionsと英語辞書のfixtureから、亀裂表示用のnode表示名→enemy level範囲lookupを構築する。表示名は仲裁cardと同じ「Name (System)」でsystem欠落時はNameのみ、min/maxのlevelが欠落・逆転したentryはlookupへ含めずlevelを捏造しない。lookupはStatusSnapshotのnodeLevelsとしてcamelCaseでserializeされる |
| TMD-006 | `timed_content_fixture` | example-tested | AreaはWFCDのCetus/Vallis/Cambion/Zariman/Duviri各cycleを状態allowlistと有効期間で検証し、earthCycleとDuviri choicesを重複表示しない。通常依頼はOstrons/Solaris United/Entratiの既知variantを保持し、Oracle BountyのHoldfasts/Cavia/Hexと合わせて6勢力を欠落させない。WFCD eventはHeatFissure/GhoulEmergence/InfestedPlainsのtag完全一致だけをactive cardへ正規化し、未知tagと期限切れを無視する。location-bountiesはCetus/Solaris/Entratiの非空location配列を独立sourceとしてExportBountiesと英語辞書へjoinし、job名をobjective候補として保持し、未知identifierはraw leafへfallbackする。expiry欠落・期限切れ・必須勢力欠落・空location・重複path・不正pathは部分成功せずLKGを上書きせず、WFCD通常依頼へ波及しない |
| NTF-001 | `notification_example` | example-tested | 通知テストは全選択先の要求受付時だけ成功し、desktopを表示済み・配信済みとは扱わない。1件でも失敗すれば失敗先・理由・要求受付済みの部分成功先を保持して失敗し、通知先なしも失敗する |
| NTF-002 | `notification_example` | example-tested | desktop通知payloadは呼出側から渡した同一nowで残り時間を計算し、HARDとSTORMを独立にtitleへ含め、期限切れの残り時間を0分に丸める。ミッション種別と勢力は選択言語の訳語テーブル(term.mission/term.faction)で表示し、テーブルにない未知値は原文のまま使う |
| NTF-003 | `notification_example` | example-tested | 未バンドルのraw devでdesktop通知を利用できない場合は、失敗詳細を保持し、デバッグbundle .appを使う just notification-test を案内する |
| NTF-004 | `notification_example` | example-tested | Discord Webhook URLは既存queryを保持しながらwait=trueをちょうど1つに正規化し、レスポンスが非空Message IDを含むJSONのときだけ要求受付と判定する。ID欠落・空文字・不正JSONは失敗する |
| NTF-006 | `notification_example` | example-tested | コンテンツ通知payloadはcardのkindを選択言語のラベルへ解決し(未知kindはrawを保持)、先頭stageのtitle・node・enemy level範囲と、呼出側から渡した同一nowで計算した残り分数をdesktop本文へ含める。stage titleが既知ミッション種別なら訳語テーブルで選択言語化し、テーブルにないtitleとnodeは原文を保持する。Discord embedはdescriptionへnodeとDiscord動的タイムスタンプ(<t:unix:R>)を含める。ja/en/zh-Hansでmissing-key markerを含まない |
| NTF-005 | `notification_example` | example-tested | ja/en/zh-Hansの各localeで、デスクトップ通知title/body・通知テスト要求受付文・Storm Include/Onlyを含む単一ルールのtray監視行・候補ID/ルールindex検証エラーは同じ選択言語となり、missing-key markerを含まない。ミッション種別・勢力は訳語テーブルで選択言語化し(訳語のないlocale・未知値は原文のまま)、node・tierの固有名詞と通知先identifierは原文を保持する |
| STA-001 | `static_check` | example-tested | 配布版(relico / com.annenpolka.relico)・通知テスト版(RELICO Notification Test / com.annenpolka.relico.notification-test)・E2E版(RELICO E2E / com.annenpolka.relico.e2e)は設定ファイル上でproductName・identifierがそれぞれ規定値を持ち、互いに一致しない |
| STA-002 | `static_check` | example-tested | トレイは専用tray-icon.pngをテンプレート画像として登録する配線を持ち、PNGはモノクロ(+アルファ)形式である |
| STA-003 | `static_check` | example-tested | macOS AUTOSTARTは内部のUnix実行ファイルをLaunchAgent登録せず、アプリアイコンを保持するAppleScript Login Itemとして.app bundleを登録し、旧relico.plistを一度だけ移行する配線を持つ |
| STA-004 | `static_check` | example-tested | i18n専用の外部ライブラリを追加せず、TS/Rustの自前lookup・placeholder実装が同じsrc/locales.jsonを直接読む。TSのi18n moduleは相対importだけ、Rustは標準ライブラリ・crate内module・既存の汎用serde_json以外の外部crateを使わない |
| STA-005 | `static_check` | example-tested | Windows x86_64-pc-windows-msvc配布版はtauri-plugin-notificationをWindows targetだけで初期化し、macOS固有backendを置換せず、インストール済みcom.annenpolka.relicoのidentityから通知要求をshowする配線を持つ。Windows bundleはNSISだけを対象にし、per-user installとWebView2 downloadBootstrapperを明示する |
| TLG-001 | `tooling_scenario` | example-tested | Unixのjust e2eは単一のTAURI_WEBDRIVER_PORTとE2E専用lease fileを実行前とEXIT時に検査し、lease inodeを開いたtarget.noindex/debug/relicoのcanonical executable完全一致だけをTERM、期限後も同じPID・実行ファイル・lease identityならKILLして回収する。portのLISTEN前またはlistener終了後でもlease holderを回収し、leaseなしの同port listenerは拒否する。holder/listenerなしは成功し、別port・別leaseの同一実行ファイルと同portの別実行ファイルは終了しない。basenameによるpkill/killallは使わない |
| TLG-002 | `tooling_scenario` | example-tested | WindowsのPowerShell/CIからspec-check・renderer-test(Chromium)・WDIO/Tauri E2E(.exe、専用APPDATA identity)・NSIS buildをBashやPOSIX形式の環境変数代入なしで実行できる。E2E janitorはleaseに記録した生存PID・canonical relico.exe・TCP listenerをsignal前に照合し、foreign listenerを拒否する。Windows CIは生成物鮮度、Bun unit、cargo test、renderer、実IPC、NSIS生成とartifact保存を別の保証として実行する |
| AST-001 | `approved_asset` | example-tested | メニューバー用tray-icon.pngは目視承認済みの内容から変わっていない(変えたらMAN-005の手順で再承認しsha256を更新する) |
| AST-002 | `approved_asset` | example-tested | 配布用アプリアイコンicon.icnsは目視承認済みの内容から変わっていない(変えたらMAN-006の手順で再承認しsha256を更新する) |
| AST-003 | `approved_asset` | example-tested | Windows配布用icon.icoは目視承認済みの内容から変わっていない(変えたらMAN-014の手順で再承認しsha256を更新する) |
| ICN-001 | `renderer_glyphs` | example-tested | 既知のTier・惑星・ミッション・ファクション・難易度・VOID嵐・アクション値には汎用と区別できる専用SVGグリフが割り当てられ、未知値はカテゴリ別の汎用グリフへフォールバックし、グリフは装飾(aria-hidden)である |
| ICN-002 | `renderer_glyphs` | example-tested | 表示用惑星名はVOID嵐のときだけEarth/Venus/Saturn/Neptune/Pluto/VeilをProxima表記へ寄せ、通常亀裂・その他の惑星・欠損値はそのまま返す |
| RND-001 | `renderer_scenario` | example-tested | パレットはどこでも打鍵で開いて入力を引き継ぎ、Escで閉じ、一覧画面のEscは設定を変更しない(リセットはCLEARボタン/パレット候補のみ)。一覧画面のSpaceはパレットを開かずに編集中ルールの表示選択(enabled)をトグルし(action:toggle-rule)、一覧画面の↑/↓はedit focusを前後のルールへ巡回移動し、Ctrl+1..9は対応indexのルールへedit focusを移す(パレット表示中も有効。フォーカス移動は設定を変更しない)。Cmd+1..9は9個のコンテンツタブ専用でルールを変更しない。IME変換中のEnterは適用せず、確定後のEnterは候補を適用して開いたまま連続入力でき、DESELECT ALL RULES候補は全表示選択を解除して通知参加を変えない(renderer統合) |
| RND-002 | `renderer_scenario` | example-tested | Webhook URL入力直後のTEST DELIVERYは、遅延保存を先にflushしてから通知テストを実行する(renderer統合) |
| RND-003 | `renderer_scenario` | example-tested | ルール行のenabled切替は一覧表示だけを変えるset_rule_enabledを呼びedit focus・notifyを変えず、行のnotify切替はset_rule_notifyだけを呼びenabledもedit focusも変えず、行本体はedit focusをそのルールへ移すだけでパレットも切替も呼ばない。DEL/CLEARは2度押し確認で、1クリック目はSURE?表示になるだけで実行せず、2秒で自動復帰し、SURE?表示中のクリックだけが実行する。全ルールの表示選択を解除しても一覧は全亀裂を表示し、notify=trueのルールはWATCH表示と通知参加を維持する(renderer統合) |
| RND-004 | `renderer_scenario` | example-tested | 最小720x480でも右サイドバーは縦スクロールなしでルール一覧・NEW/DEL/CLEAR・6軸launcher(レリック/モード/VOID嵐/ミッション/惑星/勢力)・配送設定・TEST/PAUSE・時間設定へ到達でき、ルール一覧はrail高さの固定比率領域に全ルール行を保持して内側だけ縦スクロールし、launcherはパレットをその軸に絞って開く(renderer統合) |
| RND-006 | `renderer_scenario` | example-tested | FILTERSのNAME入力は編集中ルールの名前をdebounce保存し、ルール行は名前を要約より優先表示し、パレットは名前でRULE候補を検索でき、適用はenabledのトグルだけでedit focus表示を変えない。RENAME RULE候補の適用はパレット入力を改名モードへ切り替え、Enterで編集中ルールの名前を保存して通常モードへ戻り、Escは保存せず通常モードへ戻る(renderer統合) |
| RND-005 | `renderer_scenario` | example-tested | 亀裂表はviewport 950pxで7列1段、949px以下で2段gridへ切り替わり、720/800/949pxで横スクロールを生まず、MODEとSTORMは独立セル、長い値はellipsisしてもDOM全文と行tooltipを保持する一方でFACTIONのTHE MURMURと既知の最長ミッション種別INFESTED SALVAGEは950pxでも省略せず全文表示し、empty rowは全幅、ヘッダはsticky、th[scope=col]は7個(renderer統合) |
| RND-008 | `renderer_scenario` | example-tested | 一覧表示中の亀裂は次回pollを待たずexpiry到達後1秒以内にDOMとfrontend snapshotから除去され、他の生存中亀裂・設定・通知状態を変えない(renderer統合) |
| RND-007 | `renderer_scenario` | example-tested | 亀裂表のヘッダクリックで項目別ソートでき、同じ列の再クリックで昇順/降順をトグルし、ソート中の列にaria-sortが付く。既定はT-REMAIN昇順で、パレットのSORT BY {列}候補もヘッダクリックと同じソートを適用し、同じ列への再適用は降順へトグルし、適用後もパレットは開いたまま連続入力できる。ヘッダ・パレットのどちらのソートも表示のみ(設定・通知の変更を呼ばない)(renderer統合) |
| RND-009 | `renderer_scenario` | example-tested | VIEW選択0本からピッカーでfilter候補を適用すると既存ルールを変更せずVIEW ON・NOTIFY OFFの新ルールを作り、edit focusを新ルールへ移す。NEW RULE適用中に別のfilter候補を素早く確定しても操作を直列化し、旧edit対象を変更せず同じ新ルールへ適用する(renderer統合) |
| RND-010 | `renderer_scenario` | example-tested | コンテンツ領域はfissures/arbitration/sortie/archon/syndicates/area-missions/circuit/archimedea/descendiaの9タブをこの順で持ち、英語表示はFissures/Arbitration/Sortie/Archon Hunt/Syndicates/Area Missions/Circuit/Archimedea/Descendiaとなる。ネットセルのtabとtabpanelは持たない。時限cardは亀裂表と同じ時間文法に従い、仲裁cardはcommunity schedule・browse.wf出典で絶対日時のStarts表記ではなくdata-expiry駆動の残り時間カウントダウンを表示し、将来Descendiaはupcomingとしてdata-activation駆動の開始までカウントダウンを表示する。DescendiaのSpecs/Aurasは生のLotus pathを本文へ表示せず、path leafを人間可読ラベル(CoH接頭辞とSpec/Aura接尾辞を除去しcamelCaseを分かち書き)へ整形して表示し、整形前のraw識別子はtooltipへ保持する。Descendiaのactive cardはupcoming行と同じくpanel全幅の単一列で表示し、multi-card gridの分割幅で細長く積まない。Circuitタブは現在のデュヴィリのスパイラル(WFCD由来の環境サイクルcard。状態ラベルと残り時間カウントダウン付き)をCircuit cardの前へ併記し、WFCD sourceの障害はこのタブでも表示できる。スパイラルcardはArea環境サイクルの表示からも取り除かない。個人進捗の非公開を説明するprogress noteはどのタブにも表示しない。Areaは環境・通常依頼・objective rotation・追加依頼・eventの5 groupをこの順で分離し、WFCD・Oracle Bounty・Oracle location-bountiesのsource別errorを表示できる。active tabと可視tabpanelは常に各1つで、Cmd+1..9は対応タブへ切替、Ctrl+Tab/Ctrl+Shift+Tabは前後へ循環し、Ctrl+1..9は従来どおりrule edit focusだけを変更する。パレットのGO TO {タブ}候補は対応タブへ切り替えてパレットを閉じ、ルール・設定を変更しない。タブ列が横幅からあふれるときは、あふれている側だけにedge fadeヒント(scrolled-start/scrolled-end)を付けてスクロール可能性を示し、native scrollbarより控えめな細いテーマ色バーを使う。tablist/tab/tabpanelのARIA対応、aria-controls/labelledby、aria-selectedとtabindex=0の一意性、矢印/Home/Endによるroving focusを保持し、poll更新で仲裁card全体をlive regionとして再告知しない(renderer統合) |
| RND-015 | `renderer_scenario` | example-tested | 亀裂の検索条件を変更する操作が成功したとき、コンテンツタブが亀裂以外なら亀裂タブへ自動で切り替える。対象はfilter候補(tier/mission/planet/faction/mode/storm)の適用(亀裂以外のタブではfacet launcherが開く亀裂ピッカー経由)、RULE候補とルール行・SpaceによるVIEW選択トグル、DESELECT ALL RULES、DELETE RULE、CLEAR。パレット経由の適用では自動切替してもパレットを閉じず連続入力を妨げない。通知トグル・改名・NEW RULEの空draft追加・SORT/GO TOコマンド・contentRules編集(タブ別ピッカーのコンテンツ候補適用を含む)・配送設定では切り替えない(renderer統合) |
| RND-016 | `renderer_scenario` | example-tested | 亀裂以外のコンテンツタブで打鍵起動したパレットはそのタブのコンテンツ候補を出し、query_candidates/apply_candidateへtabを渡す。キーワード・レベル候補の適用はタブを切り替えずパレットを開いたまま連続入力でき、rail上部のタブ通知ルール行が適用結果へ追従する。クエリの数字はレベル下限候補として適用できる。コンテンツ候補の適用は亀裂WatchRule・VIEW/NOTIFY・edit focusを変更しない。facet launcherは亀裂以外のタブでも亀裂ピッカー(tab=fissures)を開き、その適用は従来どおり亀裂タブへ自動切替する(renderer統合) |
| RND-014 | `renderer_scenario` | example-tested | ルール管理はコンテンツタブごとに分かれる: 亀裂タブではrail上部のルール一覧が亀裂WatchRuleを表示し、それ以外のタブでは同じ位置がそのタブ対象のコンテンツ通知ルール管理UI(タブ名入りheading・行リスト・キーワード+LV下限の追加フォーム)へ切り替わる。行はkindsがタブのkind群(エリアはarea-mission/area-objective/bounty、シンジケートはsyndicate)と交差するルールに加えkinds未指定(すべて)のルールも含み、追加はそのタブのkind群へ展開して保存される。行の通知トグルは元のcontentRulesの該当ルールのnotifyだけを、削除ボタンは該当ルールの除去だけをset_config(contentRules)へ保存する。これらの操作は亀裂のWatchRule・VIEW/NOTIFY・edit focus・通知ミュート設定を変更しない(renderer統合) |
| RND-013 | `renderer_scenario` | example-tested | 亀裂表のNODE列はbackend snapshotのnodeLevels(ExportRegions由来)に表示名が一致するnodeへLV {min}-{max}を併記し、鋼(isHard)の亀裂は基底levelへ+100した範囲を表示する。行tooltipにも同じ値を含める。lookupにないnodeへはlevelを表示せず捏造しない。level表示は表示のみで設定・通知を変えない(renderer統合) |
| RND-011 | `renderer_scenario` | example-tested | DELIVERYの通知ミュートUIはON/OFFと開始・終了時刻をAppConfig.notificationMute(enabled/startMinute/endMinute)へ保存し、backend snapshotのnotificationsMuted=trueを独自判定せず状態表示する。設定操作はルール・VIEW・NOTIFYを変えず、TEST DELIVERYはミュート表示中でも実行経路へ進む(renderer統合) |
| RND-012 | `renderer_scenario` | example-tested | locale=ja/en/zh-Hansの各表示はcritical semantic DOM goldenと一致し、html lang、document.title、本文・aria-label・placeholderに加えて仲裁のcommunity schedule表示、Areaの5 group見出しと環境state、Circuitの通常/鋼候補見出しの言語が揃い、missing-key markerを残さない。720x480と950x620でページ全体・railに意図しないoverflowを生まず、各タブ自身のラベルは見切れない(renderer統合) |
| E2E-001 | `e2e_scenario` | example-tested | 実アプリでパレット打鍵→候補適用が本物のquery_candidates/apply_candidateを往復し、ルールsummaryとwatch行へ反映される(WDIO Tauri E2E、専用identity) |
| E2E-002 | `e2e_scenario` | example-tested | 実アプリで通知先を全て無効にしたTEST DELIVERYが、本物のset_config・test_notificationを通り、NTF-001の失敗理由(通知先なし)をrailへ表示する(WDIO Tauri E2E) |
| E2E-003 | `e2e_scenario` | example-tested | 実アプリの起動時ja、en変更後、zh-Hans変更後、再読込後でdocument.titleとmain native window titleが各localeのapp.titleへ同期し、表示言語は本物のset_config完了後にhtml langとcritical UIへ反映され、再読込後も実get_configからzh-Hansが復元される(WDIO Tauri E2E) |
| MAN-001 | `manual` | manual | 通知テスト専用bundleと配布bundleの各名義で、macOSの初回権限許可とバナー表示を人が知覚できる |
| MAN-002 | `manual` | manual | Discord Webhook通知がスマホのDiscordアプリでpush表示される |
| MAN-003 | `manual` | manual | ファジーパレットで、macOSの実IMEを使った日本語alias入力ができる |
| MAN-004 | `manual` | manual | SVGアイコンが小サイズでも判別でき、HARD+STORMの併記が読める |
| MAN-005 | `manual` | manual | メニューバーのRELICOテンプレートアイコンがライト/ダーク外観で判別できる |
| MAN-006 | `manual` | manual | 配布バンドルのRELICOアプリアイコンが通常・小サイズ表示で判別できる |
| MAN-007 | `manual` | manual | macOSではコンソール表示中だけ通常アプリとしてDockとウィンドウ切替ツールに現れ、閉じるとメニューバー常駐へ戻る |
| MAN-008 | `manual` | manual | ルール一覧の表示toggle・通知toggle・edit focusが視覚的に区別でき、実アプリで表示と通知が独立して機能する |
| MAN-009 | `manual` | manual | 配布版・通知テスト版・DMG一時mount・旧AUTOSTART実行ファイルがmacOSのアプリ登録で競合せず、配布版のcanonical appだけがcom.annenpolka.relicoとして残る |
| MAN-010 | `manual` | manual | 右サイドバーの要約が読みやすく、情報の優先順位が視覚的に自然である |
| MAN-011 | `manual` | manual | compact表示が実データで読みやすく、VoiceOverでtable semanticsが自然に読み上げられる |
| MAN-012 | `manual` | manual | 9つの時限コンテンツ表示はsourceの由来と時間状態を分離し、取得経路の部分障害や個人進捗の非公開性をもっともらしい推測値で埋めない |
| MAN-013 | `manual` | manual | just e2eを中断してもE2E専用アプリだけが終了し、配布版・通知テスト版・通常開発版は終了しない |
| MAN-014 | `manual` | manual | Windows 10 version 1803以降とWindows 11のx86_64インストール済み配布版で、RELICO名義・アイコン・title・本文を持つデスクトップ通知を人が知覚できる |
| MAN-015 | `manual` | manual | Windows配布版はタスクバーを常時占有せずトレイ常駐し、close後の再表示・終了と自動起動ON/OFFが機能する |
| MAN-016 | `manual` | manual | Windows per-user NSIS installerのclean install・同version再install・旧versionからのupgrade・uninstallが成立する |

保証ラベルの意味: **property-tested** = proptestオラクルで機械検証 / **example-tested** = 具体例テストで機械検証 / **manual** = 手動確認(残余)

オラクルの実行先: `rule_*` 等のRustパターンは `cargo test`(src-tauri/tests/oracles_generated.rs)、
`renderer_glyphs` / `tooling_scenario` は `bun test tests/unit`、`renderer_scenario` は `just renderer-test`
(Playwright/WebKit、Tauri IPCはmock — Rust commandやOS通知を通った証明にはしない。docs/E2E.md参照)、
`e2e_scenario` は `just e2e`(WDIO Tauri E2E。実IPC・実WKWebViewを通し、専用identity
com.annenpolka.relico.e2e で実行する)。

## 手動確認手順(manual条項)

### 毎リリース実施

#### MAN-003: ファジーパレットで、macOSの実IMEを使った日本語alias入力ができる

リリース前に実アプリで短く確認する: IME有効のまま打鍵しても即確定せず、「鋼」「耐久」「分裂」などの日本語aliasを変換して入力できる(実IMEはWebDriverやsynthetic eventで代替できない — docs/E2E.md)。打鍵起動・Esc・変換中Enterの無視・連続適用の結線はRND-001、実IPCでの候補適用はE2E-001、alias解決とローマ字揺れはRustのFZY条項とexampleテストで機械検証済み。

#### MAN-007: macOSではコンソール表示中だけ通常アプリとしてDockとウィンドウ切替ツールに現れ、閉じるとメニューバー常駐へ戻る

just devと配布.appの両方で確認する。1) コンソール表示中はDockにRELICOアイコンが現れ、PaneruとRaycastのSwitch Windowsからウィンドウを選択・フォーカスできる。2) 閉じるとプロセスとメニューバー監視は継続したままコンソールとDockアイコンが消える。3) トレイのOPEN CONSOLE、またはアプリの再オープンでコンソールが再表示・フォーカスされ、Dockと各ウィンドウ切替ツールに再び現れる。

#### MAN-008: ルール一覧の表示toggle・通知toggle・edit focusが視覚的に区別でき、実アプリで表示と通知が独立して機能する

リリース前に実アプリで短く確認する。1) 表示toggle・通知toggle・edit本体が視覚的に区別できる(誤操作しない)。2) 実ワールドステートで複数のnotify=trueルールがORで通知対象になり、そのうちenabled=falseのルールだけに合致する亀裂も一覧からは隠れたまま通知される。3) DESELECT ALL RULESで全表示選択を解除してもnotifyは維持される。OR・dedup・edit独立の意味論はFLT-013/014・NTY-001・DED-003・EDT-001〜004で、UI結線はRND-001/003、実IPCの設定変更とTEST DELIVERYの実backend経路はE2E-001/002で機械検証済み(TEST DELIVERYがルールに依存しないことはtest_notificationの実装がルールを参照しないことによる)。

#### MAN-009: 配布版・通知テスト版・DMG一時mount・旧AUTOSTART実行ファイルがmacOSのアプリ登録で競合せず、配布版のcanonical appだけがcom.annenpolka.relicoとして残る

機械検査部分は just macos-smoke で実行する(ビルド済みInfo.plistのproductName/identifier、通知テスト版プロセスが複数起動していないこと、/Volumes/dmg.*の残留登録がないこと、canonical登録が実在する1件だけであること、旧~/Library/LaunchAgents/relico.plistが残っていないこと。設定ファイル上のidentity分離はSTA-001、bundle型AUTOSTART配線はSTA-003で常時検証)。人間に残るのは、~/Applications/relico.appのコンソール表示中ウィンドウをDock・Paneru・Raycast Switch Windowsから選択できることと、AUTOSTART有効時にシステム設定のログイン項目がUnix実行ファイルではなくRELICOのアプリアイコンで表示されることの確認。Accessibility等へ手動追加する場合も内部実行ファイルではなくrelico.app bundleを選ぶ。

#### MAN-010: 右サイドバーの要約が読みやすく、情報の優先順位が視覚的に自然である

リリース前に、Paneru等の外部ウィンドウマネージャがサイズを再適用しない状態で720x480と960x620を目視し、filter軸の要約1行(文字+アイコン併記)が判読でき、情報の優先順位が自然であることを確認する。縦スクロール不要・全編集入口への到達・launcherの軸絞り・empty表示はRND-004で機械検証済み(IPC mockのrenderer統合であり、実ウィンドウマネージャ環境の挙動はこの目視に残る)。

#### MAN-011: compact表示が実データで読みやすく、VoiceOverでtable semanticsが自然に読み上げられる

リリース前に、実データ(実ワールドステート)で狭幅表示の情報密度と読みやすさを目視し、WKWebView/VoiceOverでtable semantics(7項目の見出しと値)が自然に読み上げられることを確認する。1段/2段の切替幅・横スクロール禁止・MODE/STORM独立・ellipsis時の全文とtooltip保持・empty row全幅・stickyヘッダ・th[scope=col]はRND-005で機械検証済み。

#### MAN-012: 9つの時限コンテンツ表示はsourceの由来と時間状態を分離し、取得経路の部分障害や個人進捗の非公開性をもっともらしい推測値で埋めない

リリース前に実データで確認する。1) DE公式、WFCD、browse.wf Oracle、browse.wf schedule/Public Exportへ実際に到達でき、cardのofficial/community/schedule badgeとbrowse.wf creditが文字として判読できる。2) 表示中の仲裁をbrowse.wf/liveとゲーム内から数件標本照合する。source別障害、期限切れ、schedule範囲外、個人進捗非推測はSRC-001・BNT-001・RND-010等で機械検証する。第三者scheduleの将来正確性とservice SLAは保証せず、この実データ確認でも将来の継続性を証明したとは扱わない。

#### MAN-014: Windows 10 version 1803以降とWindows 11のx86_64インストール済み配布版で、RELICO名義・アイコン・title・本文を持つデスクトップ通知を人が知覚できる

NSISでper-user installしたcom.annenpolka.relicoをスタートメニューから起動し、TEST DELIVERYと実亀裂通知を送る。通知バナーと通知センターで送信元がPowerShell等ではなくRELICO、アイコンが承認済みicon.ico、title/bodyがNTF-002/006のpayloadであることを目視する。pluginのshow成功は要求受付だけで表示済みとは扱わない。通知要求に失敗しても現行のDED-001/POL-002契約どおりidは通知済みのまま再送せず、失敗はログへ残す。icon.icoを変更した場合は通知・トレイ・タスクバー・スタートメニューを100/125/150/200% DPIで再確認してAST-003のsha256を更新する。

#### MAN-015: Windows配布版はタスクバーを常時占有せずトレイ常駐し、close後の再表示・終了と自動起動ON/OFFが機能する

Windows 10 1803+とWindows 11でリリース前に確認する。1) closeでwindowだけが隠れpollerとtrayが継続する。2) tray左クリック/OPEN CONSOLEで再表示・focusし、QUITで終了する。3) Explorer再起動後にtray iconが復帰する。4) AUTOSTARTをON/OFFしてWindows再起動後の起動状態とget_autostartを照合する。5) 通常版com.annenpolka.relicoとE2E版com.annenpolka.relico.e2eの設定・履歴・自動起動が分離する。command/identityの配線はSTA-001/005とE2E-001〜003、OS shellの知覚はこのmanualに残る。

#### MAN-016: Windows per-user NSIS installerのclean install・同version再install・旧versionからのupgrade・uninstallが成立する

署名前の候補artifactをクリーンなWindows 10 1803+およびWindows 11 x86_64 VMで検査する。install先はper-user、WebView2はdownloadBootstrapper、shortcutは生成された既定値を記録する。clean install、同version再install、直前releaseからupgrade、uninstallを順に行い、起動・identity・設定/通知履歴の保持または削除結果を記録する。CIのNSIS bundle成功はinstaller実行の証明ではない。公開配布時は別途Authenticode署名とSmartScreen表示を確認する。

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

#### MAN-013: just e2eを中断してもE2E専用アプリだけが終了し、配布版・通知テスト版・通常開発版は終了しない

E2E cleanup配線を変更したときだけ確認する。別名義の配布版または通知テスト版を起動したままjust e2eをworker開始後にCtrl-Cで中断し、target.noindex/debug/relico・E2E lease holder・TCP 4445のlistenerが消え、一時capabilityが削除される一方、別名義のアプリとメニューバー監視は継続することを確認する。対象限定janitorのno-op・foreign listener拒否・port未bindのholder回収・identity変化時のKILL拒否・TERM/KILL・別port非干渉はTLG-001で機械検証する。
