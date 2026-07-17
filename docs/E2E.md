# E2E自動化の境界

`MAN-001`〜`MAN-011`をすべて同じ意味の「手動」と扱わず、自動化できる境界まで下ろすための設計メモ。調査時点は2026-07-17。

保証ラベルはプロジェクト規約どおり `property-tested` / `example-tested` / `manual` の3種だけを使う。E2Eは具体例を実行するテストなので、導入後の条項は `example-tested` とする。外部端末や人間の知覚まで必要な残余だけを `manual` に残す。

## 導入状況(2026-07-17)

実装済み:

- **STA-001/002**(静的検査)と **AST-001/002**(目視承認アセットのsha256固定)を `cargo test` へ。
- **ICN-001/002**(アイコン写像・フォールバック)を `bun test tests/unit` へ。
- **RND-001〜005**(パレット打鍵・delivery flush・toggle/edit分離・sidebar適合・compact table)を
  `just renderer-test`(Playwright/WebKit、IPC mockのrenderer統合)へ。ハーネスは `tests/renderer/harness.ts`。
- **MAN-009の機械検査部分**を `just macos-smoke`(tools/macos-smoke.sh)へ。
- MAN条項は真の残余だけに縮小し、`one-time`(一回限りの受入)と `per-release` を区別した。

- **E2E-001/002**(WDIO Tauri E2E)を `just e2e` へ。`e2e` cargo feature(tauri-plugin-wdio +
  tauri-plugin-wdio-webdriver)・専用identity `com.annenpolka.relico.e2e`・embedded providerで、
  実IPC・実WKWebViewを通る証明に絞った薄いスモーク。DOM結線の網羅はrenderer統合が担う。
  既知の注意: `@wdio/tauri-service@1.2.0` はdistが `@wdio/native-utils` 2.5.0のexportを使うのに
  依存を2.4.0へピンする公開バグがあり、package.jsonの `overrides` で2.5.0へ固定している。
  service更新時にoverridesの要否を見直すこと。

残り(任意): MAN-001の通知権限済みrunner(配信済み通知の照合)、MAN-002のnightly live送信、
visual regression。

## 現状の分類

| 条項 | 自動化できる範囲 | 残るmanual | 推奨実行場所 |
|:---|:---|:---|:---|
| MAN-001 macOS通知 | `just notification-test` の署名済み専用debug `.app`で送信要求の受理と既知payloadを検証し、将来はtest identifierの `UNUserNotificationCenter` から配信済みtitle/bodyを照合する。配布版は別identifierとして同じ検査を行う | 各identifierの初回通知許可と、各名義のバナーを人が知覚できること | 通知許可済みの専用macOS runner |
| MAN-002 Discord | ローカルHTTP stubでrequestを検査。専用Webhookへ `wait=true` で送って返却Messageを照合すれば、Discordサーバーへの保存まで確認できる | スマホへのpush表示。端末のオンライン状態、Discord設定、OS通知設定に依存する | PRではstub、secretを持つnightlyでlive送信 |
| MAN-003 パレットUX | Tauri/WKWebViewをキー操作し、open/連続適用/Esc/NEW/DELETE/CLEAR/IPC反映を確認する。compositionイベント中のEnter無視も自動検査する | macOSの実IMEでかな漢字変換できること。WebDriverの文字入力やsynthetic eventはOS IMEそのものではない | PRごとのmacOS E2E + リリース前の短い実IME確認 |
| MAN-008 ルール操作 | Tauri/WKWebViewでtoggleと行本体を別々に操作し、保存JSON・再起動後の状態・全無効表示・複数有効ルールOR・TEST DELIVERYのfilter bypassを検証する。OR・dedup・silent seed自体はRust PBTで保証する | toggleとedit focusが視覚的に区別できること | PRごとのmacOS E2E + リリース前の短い視認確認 |
| MAN-009 macOSアプリ識別 | test/releaseのInfo.plist、ビルド前後のLaunchServices dump、実在パス、同identifierの件数、起動プロセス数を検査する | Dock・Paneru・Raycast Switch Windowsでcanonical appの表示中ウィンドウを人が選択できること | ローカルmacOS smoke + リリース前の短い視認確認 |
| MAN-010 sidebar layout | Paneru等の外部ウィンドウマネージャを停止するか対象をfloating化した状態でWebViewを720x480へ縮め、`.rail`の`scrollHeight <= clientHeight`、5軸のlauncher表示、facet別palette、rule navigatorのedit focus、全操作のkeyboard到達性を検査する | 要約の読みやすさと、情報の優先順位が視覚的に自然であること | PRごとのmacOS E2E + 720x480/960x620のvisual regression |
| MAN-011 compact table | 長い値を持つfixtureを950/949/800/720px幅で描画し、境界前後の1段/2段切替、`.tablewrap`と全セルの矩形が横にはみ出さないこと、2段時のTIER/NODE/T-REMAIN・MISSION/FACTION/MODE/STORMの配置、MODEとSTORMの独立、ellipsis後も残る全文と行tooltip、empty rowの全幅表示、sticky header、7個の`th[scope=col]`を検査する | 実データでの情報密度と読みやすさ、WKWebView/VoiceOverでtable semanticsが自然に読み上げられること | PRごとのrenderer統合テスト + 720/800/960pxのvisual regression + リリース前の短いVoiceOver確認 |

alias (`耐久` / `分裂` / `taikyu` / `taikyuu` など) とフィルタ意味論はOS依存ではないため、E2Eを待たずRustのexample/PBTで検査する。

Webhook URLは通常300msの遅延保存だが、TEST操作は先に保存をflushする。E2EではURL入力直後に待機せずTESTを押し、最新URLへ送られることも回帰シナリオに含める。

## WDIO Tauri E2Eハーネス(導入済み — just e2e)

Tauri v2はWebdriverIOのTauri serviceを案内しており、`embedded` provider(アプリ内WebDriverサーバ)ならmacOSをネイティブに操作できる。旧来の `tauri-driver` 直結(external provider)はmacOS非対応なので使わない。構成要素(v1.2.0):

- npm: `@wdio/tauri-service`(service本体)+ `@wdio/tauri-plugin`(frontend側。VITE_E2E=1のときだけmain.tsが動的import)
- crates: `tauri-plugin-wdio`(execute/mock/log)+ `tauri-plugin-wdio-webdriver`(embedded provider用。**登録すると無条件でWebDriverサーバが起動する**ため`e2e` feature必須)

隔離の実装:

1. Rust plugin 2つは `e2e` cargo featureのoptional依存。通常のdebug/releaseビルドには入らない。
2. capabilitiesの `wdio:default` はfeature無効ビルドでACLエラーになるため、`tools/e2e-capability.json` を
   `just e2e` がビルド中だけ `capabilities/e2e.json` へコピーする(gitignore済み)。
3. 専用identity `com.annenpolka.relico.e2e`(tauri.e2e.conf.json)で、配布版の設定・通知権限・
   LaunchServices状態を汚さない。wdio.conf.tsのonPrepareが設定ディレクトリを毎回まっさらにする。
4. E2Eの対象は「実command・実WKWebViewを通る」証明のみ(E2E-001/002)。DOM結線の網羅は
   renderer統合(RND-001〜005)が担い、二重実装しない。

今後の拡張候補: MAN-001は通知権限済みrunnerで配信済み通知をidentifier/title/bodyで照合して後片付けする。MAN-002の受理判定はNTF-004で機械検証済みで、nightly live送信は任意。

## 偽のE2Eにしないための線引き

- Tauri IPCをmockしたブラウザテストはrenderer統合テストであり、Rust commandやOS通知を通った証明にはしない。
- 通知pluginの `show()` 呼び出し成功だけで「通知センターに表示」とは判定しない。Appleの配信済み通知一覧まで照会する。
- rawの `just dev` をmacOS通知の成功経路にしない。通知専用identityを持つdebug `.app`は `just notification-test` で作り、配布版の権限・設定・重複排除と混同しない。
- `target/**/bundle/macos` や `/Volumes/dmg.*` を正式版のinstall先にしない。`com.annenpolka.relico` のcanonical appは `~/Applications/relico.app` とし、LaunchServices dumpでは実在するcanonical path 1件までを成功条件にする。
- DiscordのHTTP 2xxだけでスマホpush到達とは判定しない。`wait=true` のMessage応答はサーバー保存の証拠、スマホ表示は別のmanual残余とする。
- synthetic `CompositionEvent` は変換中Enterの分岐テストには使えるが、実IME互換の証拠にはしない。

## 参考一次資料

- [Tauri: WebDriver](https://v2.tauri.app/develop/tests/webdriver/)
- [Tauri: Mock Tauri APIs](https://v2.tauri.app/develop/tests/mocking/)
- [WebdriverIO: Tauri](https://webdriver.io/docs/desktop-testing/tauri/)
- [W3C WebDriver](https://w3c.github.io/webdriver/)
- [Apple: UNUserNotificationCenter](https://developer.apple.com/documentation/usernotifications/unusernotificationcenter)
- [Discord: Execute Webhook](https://docs.discord.com/developers/resources/webhook#execute-webhook)
