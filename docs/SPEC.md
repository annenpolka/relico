# relico — Warframe亀裂通知 仕様

> **生成物 — 手編集禁止。** 正本は `specs/notifier.pkl`。変更は正本を編集して `just spec-gen`。
>
> 保証の勾配: このプロジェクトの機械保証の最上位は property-based test である。
> proven(証明) / model-checked(モデル検査) の条項は存在しない。勾配を平らに見せない。
>
> フィルタの意味論はルールOR: 設定は監視ルール(WatchRule)のリストで、亀裂が
> どれか1つのルールに合致すれば通知・表示対象になる。ルール内はAND。

## 条項一覧

| ID | パターン | 保証 | 内容 |
|:---|:---|:---|:---|
| FLT-001 | `rule_reject_when` | property-tested | mode=鋼のみ のルールは、isHard=false の亀裂にどんな入力でも合致しない |
| FLT-002 | `rule_reject_when` | property-tested | mode=通常のみ のルールは、isHard=true の亀裂にどんな入力でも合致しない |
| FLT-003 | `rule_reject_when` | property-tested | include_storms=false のルールは、isStorm=true の亀裂(ボイドストーム)に合致しない |
| FLT-004 | `rule_pass_when_empty` | property-tested | ルールのtiersが空のとき、tierを理由に棄却しない(空=全tier対象) |
| FLT-005 | `rule_pass_when_empty` | property-tested | ルールのmission_typesが空のとき、ミッション種別を理由に棄却しない(空=全種別対象) |
| FLT-006 | `rule_pass_when_empty` | property-tested | ルールのplanetsが空のとき、惑星を理由に棄却しない(空=全惑星対象) |
| FLT-007 | `settings_reject_when` | property-tested | 残り時間がmin_remaining_secs未満の亀裂は、ルール構成に依らず合致しない(期限切れ含む) |
| FLT-008 | `single_rule_embedding` | property-tested | ルール1つの設定では、全体合致 = (残り時間OK ∧ そのルールが合致) |
| FLT-009 | `rule_additivity` | property-tested | ルールを追加しても、それまで合致していた亀裂は合致し続ける(OR単調性) |
| DED-001 | `at_most_once` | property-tested | 同一亀裂idは任意のポーリング列で高々1回しか通知されない |
| DED-002 | `prune_preserves_live` | property-tested | pruneは生存中idの通知済み状態を保持し、期限切れidを除去する |
| PRS-001 | `parse_total` | property-tested | 惑星抽出は任意文字列でパニックせず、"Node (Planet)" 形式でPlanetを返す |
| POL-001 | `bounded` | property-tested | APIバックオフの遅延は失敗・成功がどう並んでも常に[60s, 600s]に収まる |
| POL-002 | `seed_silent` | property-tested | 起動直後の初回ポーリングはシードのみ: 既存の合致亀裂を通知済みとして記録するが、通知は1件も発火しない(起動時の通知洪水を防ぐ) |
| VIS-001 | `filtered_view` | property-tested | 一覧に表示されるのはいずれかのルールに合致する亀裂のみ(対象外は非表示)。かつ合致する亀裂は1件も取りこぼさない |
| FZY-001 | `fuzzy_subsequence` | property-tested | パレットのファジーマッチが成立するのは、クエリ文字が候補文字列(またはalias)に順序どおり現れる場合に限る(健全性) |
| FZY-002 | `fuzzy_empty_query` | property-tested | 空クエリはパレット候補の全件を返す(完全性) |
| FZY-003 | `fuzzy_exact_first` | property-tested | クエリと完全一致する候補(label/alias)が存在すれば、先頭候補は完全一致である |
| FZY-004 | `fuzzy_deterministic` | property-tested | 同一クエリ・同一候補集合に対するパレットの結果順序は決定的 |
| SAT-001 | `satisfiable_after_ops` | property-tested | パレット操作列をどう並べても、適用後のすべてのルールはドメイン互換表(Requiem↔クバ要塞、Omnia↔ザリマン、ストーム↔Proxima、鋼ストーム不存在等)に関して充足可能。ルール内で両立しない選択は新しい方を残して上書き解決される |
| CLR-001 | `clear_resets` | property-tested | クリア操作は1回でルール構成を既定(全対象ルール1本、ストーム除外、両方モード)に戻す |
| MAN-001 | `manual` | manual | デスクトップ通知がmacOS通知センターに実際に表示される |
| MAN-002 | `manual` | manual | Discord Webhook通知がスマホのDiscordアプリに届く |
| MAN-003 | `manual` | manual | ファジーパレットのUX: どこでも打鍵で開き、連続トグルでき、日本語aliasが引ける |

保証ラベルの意味: **property-tested** = proptestオラクルで機械検証 / **example-tested** = 手書きexampleテストで検証 / **manual** = 手動確認(残余)

## 手動確認手順(manual条項)

リリース前に以下を実施する。

### MAN-001: デスクトップ通知がmacOS通知センターに実際に表示される

設定画面の「テスト送信」でデスクトップ通知を発火し、通知センターに表示されることを目視確認する。初回はシステム設定で通知許可が必要。

### MAN-002: Discord Webhook通知がスマホのDiscordアプリに届く

Webhook URLを設定し「テスト送信」を押す。スマホのDiscordアプリでプッシュ通知とembedの内容(tier/node/鋼マーク/残り時間の相対表示)を確認する。

### MAN-003: ファジーパレットのUX: どこでも打鍵で開き、連続トグルでき、日本語aliasが引ける

1) 入力欄以外にフォーカスがある状態で英数キーを打鍵→パレットが開き1文字目が引き継がれる。2) axi⏎ hagane⏎ のように連続トグルできeskで閉じる。3) IMEで「鋼」「生存」などの日本語aliasがヒットする。4) NEW RULE/DELETE RULE/CLEARが候補から実行できる。5) CLEARボタン1回でルールが既定1本に戻る。
