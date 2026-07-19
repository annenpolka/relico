# Windowsビルド対応調査

- 調査日: 2026-07-19
- 状態: 静的調査完了、Windows上でのビルド・実機検証は未実施
- 対象: Windows 10/11向けTauri v2アプリ

## 結論

現状のコードベースには、Windows向けTauriアプリを組み立てるための基礎があります。しかし、Windows版を利用可能な品質で配布するには追加対応が必要です。

最も大きな未対応点は次の3つです。

1. Windowsのデスクトップ通知が未実装である
2. ビルド、テスト、E2Eの各スクリプトがmacOS/POSIX環境に依存している
3. Windows CI、インストーラー検証、コード署名の経路がない

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

現状は「ビルド可能」より前の段階です。TauriのWindows向け設定は一部存在しますが、ビルド経路と主要機能の検証がありません。

## すでに存在するWindows向けの土台

以下はそのまま活用できる可能性が高い部分です。

- `src-tauri/src/main.rs` にreleaseビルド時の `windows_subsystem = "windows"` がある
- `src-tauri/Cargo.toml` にWindowsでのライブラリ名衝突を避ける設定がある
- `src-tauri/tauri.conf.json` のbundle targetが有効で、`icons/icon.ico` が登録されている
- Tauri/Wry/WebView2のWindows向け依存関係がlockfileに含まれている
- ウィンドウ、メニュー、トレイ、設定ディレクトリ解決はTauriの共通APIを中心に実装されている
- `tauri-plugin-autostart` はWindowsをサポートする構成になっている

これらはWindows対応済みの証拠ではありません。Windows実機でのexample-testedまたはmanualな確認が必要です。

## P0: 最初のWindowsビルドに必須の作業

### 1. Windowsでの要求を仕様へ追加する

挙動を変更するため、最初に `specs/*.pkl` を更新します。`docs/SPEC.md` や生成テストは手編集しません。

最低限、次を仕様として明示する必要があります。

- Windows通知の要求と、OSに表示されたことの保証範囲
- 通知送信に失敗した場合の重複排除状態
- インストール済みアプリのidentityを使うこと
- トレイ、タスクバー表示、ウィンドウを閉じたときの挙動
- 自動起動の有効化、無効化、状態取得
- 通常版とE2E版のidentity分離
- Windows用アイコン等、目視承認するアセットのsha256

既存パターンで表現できない場合は `Manual` 条項として残します。新しい仕様パターンが必要な場合は、`specs/patterns.pkl` と `tools/spec-gen.ts` を同時に変更します。

### 2. Windowsのデスクトップ通知を実装する

現在の `src-tauri/src/notify.rs` はmacOS実装を持ちますが、macOS以外では「unsupported」を返すstubです。設定上はデスクトップ通知が既定で有効なため、このままWindows版を配布すると主要機能が動きません。

推奨構成は次のとおりです。

- macOS: 現在のUserNotifications実装を維持する
- Windows: `tauri-plugin-notification` を使うtarget別backendを追加する
- 共通層: 通知要求、成功・失敗、重複排除の契約をOS実装から分離する

このリポジトリでは初期実装時に `tauri-plugin-notification` を使っていましたが、macOS通知の厳密な挙動を実装した際に削除されています。Windows向けだけに再導入できるかを検討します。

Tauriの通知pluginは、Windowsで正しいアプリ名とアイコンを表示するためにインストール済みアプリとしてのidentityを必要とします。開発時の通知はPowerShell等のidentityとして見えることがあるため、「API呼び出し成功」と「製品として正しく表示された」を分けて検証します。

また、現在のpollerは通知送信より前に重複排除状態を保存します。送信失敗時に再通知するのか、失敗しても通知済みとして扱うのかを仕様で決めてから実装します。

### 3. Windowsで実行できるビルドコマンドを用意する

現在の `justfile` はBash、`trap`、LaunchServices、POSIXシグナル等に依存します。共通処理とOS別処理を分離し、少なくとも通常ビルドがPowerShellから実行できるようにします。

Windows runnerに必要なツールは次のとおりです。

- Microsoft C++ Build Toolsの「Desktop development with C++」
- WebView2 Runtime
- Rust stableの `x86_64-pc-windows-msvc` toolchain
- Bun
- Just
- Pkl。仕様生成・鮮度検査をWindowsでも行う場合に必要

最初の成果物はNSISだけに絞ることを推奨します。現在の `bundle.targets: "all"` はMSIも対象に含めるため、追加のWiX/VBSCRIPT要件が発生します。

想定する基本コマンドは次です。

```powershell
bun install --frozen-lockfile
bun tauri build --bundles nsis
```

ただし、現在は `package.json` のpackage名が `relico`、`bun.lock` 内のworkspace名が `warframe-fissure-notifier` です。Windows CIでfrozen installを有効にする前にlockfileを正規化し、macOSでも再現性を確認します。

### 4. テストとCIをWindows対応する

現在、`.github/workflows` はありません。Windows対応ではネイティブWindows runnerを正規の検証環境として追加します。

移植が必要な箇所は次のとおりです。

- `just spec-check`: Bashと `shasum` に依存している
- `tauri.e2e.conf.json`: POSIX形式の環境変数参照を含む
- `wdio.conf.ts`: macOSの `.app` とUnix実行ファイルを前提としている
- `tools/e2e-process.ts`: `lsof`、inode、POSIXシグナル、macOSのApplication Support pathを使う
- `playwright.config.ts`: rendererテストがWebKitだけを対象としている
- E2Eバイナリ名: Windowsでは `.exe` を扱う必要がある

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

1. サポートするWindows version、architecture、配布方式を決める
2. Windowsの通知、常駐、自動起動、失敗時挙動を `specs/*.pkl` に追加する
3. lockfileと共通ビルド処理をportableにする
4. Windows通知backendを実装する
5. Windows CIでunit、Rust、renderer、NSIS buildを通す
6. WDIO E2EとWindows固有の実行プロセス管理を実装する
7. 通知、トレイ、自動起動、installerのmanual smoke testを実施する
8. コード署名とrelease artifact公開を追加する

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

## 未決事項

- Windows 10の最低versionをどこに置くか
- ARM64を初回対象に含めるか
- NSISだけで始めるか、MSIも同時に提供するか
- WebView2をbootstrapper、offline installer、固定runtimeのどれで提供するか
- per-userとper-machineのどちらでinstallするか
- 通知失敗時に重複排除状態を巻き戻して再試行するか
- single-instanceを必須とするか
- アンインストール時に設定と通知履歴を保持するか
- `Meta+数字` shortcutをWindowsで変更するか
- 公開配布時のコード署名手段を何にするか

## macOSからのクロスコンパイルについて

Tauri v2では、macOS/LinuxからWindows NSISを作る経路として `cargo-xwin`、LLVM、NSISを使う方法があります。ただし制約があり、MSIはWindows上で作る必要があります。また、生成に成功してもWindows固有機能の実行検証にはなりません。

そのため本プロジェクトでは、クロスコンパイルを開発者の補助的な早期チェックに限定し、release artifactはネイティブWindows runnerで作る方針を推奨します。

## 調査時に確認した主なファイル

- `src-tauri/src/notify.rs`: macOS以外の通知backendがstub
- `src-tauri/src/poller.rs`: 通知送信前に重複排除状態を保存
- `src-tauri/src/lib.rs`: トレイ、close時の常駐、設定path
- `src-tauri/src/commands.rs`: 自動起動command
- `src-tauri/tauri.conf.json`: bundle targetとWindows icon
- `src-tauri/Cargo.toml`: Tauri pluginとWindows向けcrate設定
- `justfile`: build、spec-check、E2EのmacOS/POSIX依存
- `tauri.e2e.conf.json`: E2E用Tauri設定
- `wdio.conf.ts`: WDIOの実行対象
- `tools/e2e-process.ts`: E2Eプロセス管理
- `playwright.config.ts`: renderer testのbrowser設定
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

この文書はリポジトリの静的調査とTauri公式資料に基づく計画です。Windows runnerでのbuild、test、install、通知、トレイ、自動起動は未検証です。実装中に判明した差分は、この文書と仕様の正本を更新して記録します。
