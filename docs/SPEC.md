# Warframe Fissure Notifier 仕様

> **生成物 — 手編集禁止。** 正本は `specs/notifier.pkl`。変更は正本を編集して `just spec-gen`。
>
> 保証の勾配: このプロジェクトの機械保証の最上位は property-based test である。
> proven(証明) / model-checked(モデル検査) の条項は存在しない。勾配を平らに見せない。

## 条項一覧

| ID | パターン | 保証 | 内容 |
|:---|:---|:---|:---|
| FLT-001 | `reject_when` | property-tested | mode=鋼のみ のとき、isHard=false の亀裂はどんな入力でも通知されない |
| FLT-002 | `reject_when` | property-tested | mode=通常のみ のとき、isHard=true の亀裂はどんな入力でも通知されない |
| FLT-003 | `reject_when` | property-tested | include_storms=false のとき、isStorm=true の亀裂(ボイドストーム)は通知されない |
| FLT-004 | `pass_when_empty` | property-tested | tiersが空のとき、tierを理由に棄却されない(空=全tier対象) |
| FLT-005 | `pass_when_empty` | property-tested | mission_typesが空のとき、ミッション種別を理由に棄却されない(空=全種別対象) |
| FLT-006 | `pass_when_empty` | property-tested | planetsが空のとき、惑星を理由に棄却されない(空=全惑星対象) |
| FLT-007 | `reject_when` | property-tested | 残り時間がmin_remaining_secs未満の亀裂は通知されない(期限切れ含む) |
| DED-001 | `at_most_once` | property-tested | 同一亀裂idは任意のポーリング列で高々1回しか通知されない |
| DED-002 | `prune_preserves_live` | property-tested | pruneは生存中idの通知済み状態を保持し、期限切れidを除去する |
| PRS-001 | `parse_total` | property-tested | 惑星抽出は任意文字列でパニックせず、"Node (Planet)" 形式でPlanetを返す |
| POL-001 | `bounded` | property-tested | APIバックオフの遅延は失敗・成功がどう並んでも常に[60s, 600s]に収まる |
| POL-002 | `seed_silent` | property-tested | 起動直後の初回ポーリングはシードのみ: 既存の合致亀裂を通知済みとして記録するが、通知は1件も発火しない(起動時の通知洪水を防ぐ) |
| MAN-001 | `manual` | manual | デスクトップ通知がmacOS通知センターに実際に表示される |
| MAN-002 | `manual` | manual | Discord Webhook通知がスマホのDiscordアプリに届く |

保証ラベルの意味: **property-tested** = proptestオラクルで機械検証 / **example-tested** = 手書きexampleテストで検証 / **manual** = 手動確認(残余)

## 手動確認手順(manual条項)

リリース前に以下を実施する。

### MAN-001: デスクトップ通知がmacOS通知センターに実際に表示される

設定画面の「テスト送信」でデスクトップ通知を発火し、通知センターに表示されることを目視確認する。初回はシステム設定で通知許可が必要。

### MAN-002: Discord Webhook通知がスマホのDiscordアプリに届く

Webhook URLを設定し「テスト送信」を押す。スマホのDiscordアプリでプッシュ通知とembedの内容(tier/node/鋼マーク/残り時間の相対表示)を確認する。
