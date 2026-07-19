# Windowsビルド対応調査

- 調査日: 2026-07-19
- 状態: Windowsネイティブのbuild/test/E2E/NSIS生成まで実施済み。インストール後の目視・署名は未実施
- 対象: Windows 10/11向けTauri v2アプリ

## 結論

Windows x86_64-pc-windows-msvc向けの通知backend、portableな開発コマンド、Windows CI、Chromium renderer test、実IPC E2E、NSIS生成経路を実装しました。2026-07-19にWindows上でRust/Bun/renderer/E2E/NSIS buildを実行し、機械検証は通過しています。

配布可能レベルへ残る大きな作業は次の3つです。

1. インストール済みアプリからの通知表示、トレイ、自動起動を人が確認する
2. NSISのclean install、upgrade、uninstallをVMで確認する
3. Authenticodeコード署名とSmartScreenの確認経路を用意する

初期の対応対象は、次を推奨します。

- OS: Windows 10 version 1803以降、およびWindows 11
- CPU: x86_64
- Rust toolchain: MSVC
- インストーラー: NSIS
- ビルド環境: GitHub Actions等のネイティブWindows runner

macOSからのクロスコンパイルは補助的な経路としては使えますが、Windows通知、インストール、トレイ、自動起動、WebView2を実環境で確認できません。正式な成果物はWindows runnerで作る方針が安全です。

## 対応レベルの定義

Windows対応を次の3段階に分けます。

| レベル | 到達条件 |
|---|---|
| ビルド可能 | Windows runnerでコンパイルし、インストーラーを生成できる |
| 利用可能 | 通知、トレイ、自動起動、設定保存、E2EがWindows上で動作する |
| 配布可能 | 署名済みインストーラー、アップグレード、アンインストール、リリース手順が検証されている |

現状はローカルWindows検証で「ビルド可能」へ到達しています。GitHub Actions workflowは追加済みですが、リポジトリへpushして実runnerで通った結果はまだありません。「利用可能」「配布可能」はMAN-014〜016のmanual smokeと署名が終わるまで主張しません。

## すでに存在するWindows向けの土台

以下はそのまま活用できる可能性が高い部分です。

- `src-tauri/src/main.rs` にreleaseビルド時の `windows_subsystem = "windows"` がある
- `src-tauri/Cargo.toml` にWindowsでのライブラリ名衝突を避ける設定がある
- `src-tauri/tauri.conf.json` のbundle targetが有効で、`icons/icon.ico` が登録されている
- Tauri/Wry/WebView2のWindows向け依存関係がlockfileに含まれている
- ウィンドウ、メニュー、トレイ、設定ディレクトリ解決はTauriの共通APIを中心に実装されている
- `tauri-plugin-autostart` はWindowsをサポートする構成になっている

これらはWindows対応済みの証拠ではありません。Windows実機でのexample-testedまたはmanualな確認が必要です。

## 実装・検証結果(2026-07-19)

- `STA-005` / `TLG-002` / `AST-003`と`MAN-014`〜`MAN-016`を仕様正本へ追加し、生成オラクルと`docs/SPEC.md`を更新
- Windows targetだけへ`tauri-plugin-notification`を追加。macOS UserNotifications backendは維持
- `just spec-check` / `renderer-test` / `e2e` / `build`をPowerShellから実行可能にし、Playwright/WDIO workerはNode、package/buildはBunに分離
- rendererはWindowsでChromium、macOSでWebKitを使用
- E2EはWindowsの`.exe`、APPDATAの専用identity、PID leaseとcanonical executable照合へ対応
- `.github/workflows/windows.yml`で生成鮮度、unit、Rust、renderer、E2E、NSIS、artifact uploadを定義
- `src-tauri/tauri.windows.conf.json`でNSIS、`currentUser`、WebView2 `downloadBootstrapper`を明示
- `bun install --frozen-lockfile`: 成功
- Bun unit: 4件成功
- Rust test: 25 + 13 + 80件成功
- Chromium renderer: 22件成功
- WDIO/Tauri E2E: 3件成功
- NSIS: `relico_0.1.0_x64-setup.exe`生成成功

## P0: 最初のWindowsビルドに必須の作業(完了)

### 1. Windowsでの要求を仕様へ追加する

挙動を変更するため、最初に `specs/*.pkl` を更新します。`docs/SPEC.md` や生成テストは手編集しません。

次を仕様へ明示しました。

- Windows通知の要求と、OSに表示されたことの保証範囲
- 通知送信に失敗した場合の重複排除状態
- インストール済みアプリのidentityを使うこと
- トレイ、タスクバー表示、ウィンドウを閉じたときの挙動
- 自動起動の有効化、無効化、状態取得
- 通常版とE2E版のidentity分離
- Windows用アイコン等、目視承認するアセットのsha256

既存パターンで表現できない場合は `Manual` 条項として残します。新しい仕様パターンが必要な場合は、`specs/patterns.pkl` と `tools/spec-gen.ts` を同時に変更します。

### 2. Windowsのデスクトップ通知を実装する

`src-tauri/src/notify.rs`はmacOS実装を維持し、WindowsではTauri notification pluginへ実アプリの`AppHandle`を渡して通知要求を出します。Linux等の未対応OSだけが`unsupported`を返します。

推奨構成は次のとおりです。

- macOS: 現在のUserNotifications実装を維持する
- Windows: `tauri-plugin-notification` を使うtarget別backendを追加する
- 共通層: 通知要求、成功・失敗、重複排除の契約をOS実装から分離する

このリポジトリでは初期実装時に使っていた `tauri-plugin-notification` を、Windows target限定の依存関係として再導入しました。macOSでは従来のUserNotifications backendだけを初期化します。

Tauriの通知pluginは、Windowsで正しいアプリ名とアイコンを表示するためにインストール済みアプリとしてのidentityを必要とします。開発時の通知はPowerShell等のidentityとして見えることがあるため、「API呼び出し成功」と「製品として正しく表示された」を分けて検証します。

pollerは通知送信より前に重複排除状態を保存する現行契約を維持しました。送信失敗でも通知済みとして扱って自動再送せず、失敗をログへ残すことをMAN-014へ明記しています。

### 3. Windowsで実行できるビルドコマンドを用意する

共通処理を`tools/*.ts`へ分離し、`justfile`へPowerShellの`windows-shell`を設定しました。macOS固有のnotification testとsmokeだけは従来どおりOS専用です。

Windows runnerに必要なツールは次のとおりです。

- Microsoft C++ Build Toolsの「Desktop development with C++」
- WebView2 Runtime
- Rust stableの `x86_64-pc-windows-msvc` toolchain
- Bun
- Node.js LTS(Playwright/WDIO worker runtime)
- Just
- Pkl。仕様生成・鮮度検査をWindowsでも行う場合に必要

最初の成果物はNSISだけに絞りました。共通設定の `bundle.targets: "all"` は維持しつつ、Windows buildでは `tauri.windows.conf.json` を重ねてNSISだけを生成し、追加のWiX/VBSCRIPT要件を避けます。

想定する基本コマンドは次です。

```powershell
bun install --frozen-lockfile
bun tauri build --bundles nsis
```

`bun.lock`のworkspace名を`relico`へ正規化し、Windowsでfrozen installを確認済みです。macOS CIでの再確認は残ります。

### 4. テストとCIをWindows対応する

`.github/workflows/windows.yml`を追加し、ネイティブ`windows-latest` runnerを正規の検証環境として定義しました。workflow自体の実行結果はpush後に確認します。

移植前にWindowsを阻害していた箇所と、今回の対応は次のとおりです。

- `just spec-check`: Bashと`shasum`依存を`tools/spec-check.ts`へ置換
- `src-tauri/tauri.e2e.conf.json`: frontend build時の環境変数設定を`tools/build-frontend-e2e.ts`へ移動
- `wdio.conf.ts`: macOSの`.app`に加え、Windowsの`.exe`とAPPDATAを解決
- `tools/e2e-process.ts`: Unixの`lsof`/inode検証を維持し、WindowsにはPID lease/canonical executable/listener照合を追加
- `playwright.config.ts`: macOSではWebKit、WindowsではChromiumを選択
- Playwright/WDIO: WindowsでBun workerが停止する問題を避け、Node.jsでCLIとworkerを起動

Windows CIには、最低限次のjobまたはstepを置きます。

1. 仕様生成物の鮮度検査
2. Bun unit test
3. `cargo test`
4. Chromiumでのrenderer test
5. WDIO/Tauri E2E
6. NSISインストーラー生成
7. 成果物のupload

renderer testはDOM結線とレイアウトのexample-testedな証拠です。Rust command、実IPC、OS通知を通った証明とは扱いません。WDIO/Tauri E2Eと、通知のmanual smoke testを別に残します。

## P1: 利用可能なWindows版に必要な作業

### インストーラー設定

次を明示的に決定し、インストール・更新・アンインストールを検証します。

- WebView2のinstall mode
- per-userまたはper-machine install
- 同一versionの再インストール
- 旧versionからのupgrade
- アンインストール時に設定と重複排除履歴を残すか
- スタートメニューおよびデスクトップshortcutの有無
- 通常版とE2E版のbundle identifier、product name、保存先の分離

### トレイと自動起動

Windows上で次をmanual smoke testします。

- タスクバーに通常のウィンドウボタンを常時出さないこと
- トレイ左クリックでウィンドウを表示できること
- トレイメニューから終了できること
- ウィンドウを閉じても常駐し続けること
- 自動起動のON/OFFがOS再起動後も反映されること
- Explorer再起動後にトレイアイコンが復帰すること

二重起動によるpoller、通知、設定書き込みの競合を避けるため、single-instance対応も強く推奨します。

### Windows用アセット

`icons/icon.ico` は登録されていますが、Windowsの通知、トレイ、タスクバー、スタートメニュー、高DPI表示で目視確認が必要です。承認したアセットは `ApprovedAsset` としてsha256を固定します。

### コード署名

ローカル利用だけなら未署名でも実行できますが、一般配布ではSmartScreen警告と発行元表示が問題になります。配布可能レベルでは次を用意します。

- Authenticodeコード署名証明書またはクラウド署名サービス
- CI secret管理
- NSIS成果物への署名
- 署名済み成果物の検証コマンド
- 証明書更新手順

Microsoft Storeで配布する場合は、NSIS配布とは別のpackage、identity、署名、更新経路を設計します。

## P2: Windows固有のUXとアクセシビリティ

次は初回ビルドを阻害しませんが、正式対応前に確認します。

- 現在の `Meta+数字` shortcutがWindowsの `Win+数字` と競合するため、`Ctrl+数字` 等へ変更するか
- Windows日本語IMEで入力、確定、compositionが壊れないか
- Narratorでタブ、フォーム、通知設定を操作できるか
- High Contrast modeで状態とフォーカスが識別できるか
- 100%、125%、150%、200% DPIでレイアウトとアイコンが崩れないか
- Windows固有のエラーメッセージやセットアップ手順をlocalizationへ追加するか

## 推奨する実装順

1. [完了] Windows 10 version 1803+ / Windows 11、x86_64 MSVC、NSISを初期対象に決定
2. [完了] Windowsの通知、常駐、自動起動、失敗時挙動を`specs/*.pkl`へ追加
3. [完了] lockfileと共通ビルド処理をportable化
4. [完了] Windows通知backendを実装
5. [実装済み] Windows CIへunit、Rust、renderer、NSIS buildを追加。実runner結果はpush後に確認
6. [完了] WDIO E2EとWindows固有の実行プロセス管理を実装・ローカル実行
7. [未実施] 通知、トレイ、自動起動、installerのmanual smoke test
8. [未実施] コード署名とrelease artifact公開

## 受け入れ基準

| 対象 | 最低限の検証 | 保証ラベル |
|---|---|---|
| 通知選択・重複排除・バックオフ | 生成オラクルを含むPBT | property-tested |
| Windows向けRustコード | Windows runnerで `cargo test` | example-tested |
| renderer結線 | Windows ChromiumでPlaywright | example-tested |
| 実IPC | Windows上のWDIO/Tauri E2E | example-tested |
| NSIS生成 | Windows runnerでbundle成功、成果物を保存 | example-tested |
| 通知表示 | インストール済みアプリから通知し、名前・アイコン・本文を目視 | manual |
| トレイ常駐 | close、再表示、終了、Explorer再起動を目視 | manual |
| 自動起動 | ON/OFF後にWindowsを再起動して確認 | manual |
| インストール更新 | clean install、upgrade、uninstallをVMで確認 | manual |
| 署名 | Windowsの署名検証とSmartScreen表示を確認 | manual |

CIが通っただけで、Windows通知がユーザーへ表示されたとは判断しません。各検証の保証ラベルを維持します。

## 決定済み事項と残る未決事項

初期リリースでは、Windows 10 version 1803+ / Windows 11、x86_64 MSVC、NSIS、WebView2 `downloadBootstrapper`、per-user installを採用します。ARM64とMSIは初回対象に含めません。通知要求に失敗しても重複排除状態を巻き戻さず、自動再送しません。

残る未決事項は次のとおりです。

- single-instanceを必須とするか
- アンインストール時に設定と通知履歴を保持するか
- `Meta+数字` shortcutをWindowsで変更するか
- 公開配布時のコード署名手段を何にするか

## macOSからのクロスコンパイルについて

Tauri v2では、macOS/LinuxからWindows NSISを作る経路として `cargo-xwin`、LLVM、NSISを使う方法があります。ただし制約があり、MSIはWindows上で作る必要があります。また、生成に成功してもWindows固有機能の実行検証にはなりません。

そのため本プロジェクトでは、クロスコンパイルを開発者の補助的な早期チェックに限定し、release artifactはネイティブWindows runnerで作る方針を推奨します。

## 調査時に確認した主なファイル

- `src-tauri/src/notify.rs`: macOS UserNotifications + Windows Tauri notification backend
- `src-tauri/src/poller.rs`: 通知送信前に重複排除状態を保存
- `src-tauri/src/lib.rs`: トレイ、close時の常駐、設定path
- `src-tauri/src/commands.rs`: 自動起動command
- `src-tauri/tauri.conf.json`: bundle targetとWindows icon
- `src-tauri/Cargo.toml`: Tauri pluginとWindows向けcrate設定
- `justfile` / `tools/spec-check.ts` / `tools/run-e2e.ts` / `tools/build.ts`: portableな公開コマンド
- `src-tauri/tauri.e2e.conf.json`: portableなE2E frontend build設定
- `wdio.conf.ts`: `.exe`とAPPDATAを含むOS別実行対象
- `tools/e2e-process.ts`: Unix inode / Windows PID leaseのE2Eプロセス管理
- `playwright.config.ts`: macOS WebKit / Windows Chromium設定
- `.github/workflows/windows.yml`: Windows CIとNSIS artifact
- `specs/notifier.pkl`: 通知、アセット、Manual条項
- `package.json` / `bun.lock`: workspace名の不一致

## 公式資料

- [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)
- [Windows Installer](https://v2.tauri.app/distribute/windows-installer/)
- [Notification plugin](https://v2.tauri.app/plugin/notification/)
- [Autostart plugin](https://v2.tauri.app/plugin/autostart/)
- [WebDriver testing](https://v2.tauri.app/develop/tests/webdriver/)
- [Windows code signing](https://v2.tauri.app/distribute/sign/windows/)
- [tauri-action](https://github.com/tauri-apps/tauri-action)

## 調査の限界

この文書は静的調査に加えてWindows 11 x86_64上のlocal build/test/E2E/NSIS生成結果を反映しています。インストール済みNSISの実行、通知の人間による知覚、トレイ、自動起動、upgrade/uninstall、署名は未検証であり、MAN-014〜016の保証範囲に残します。
