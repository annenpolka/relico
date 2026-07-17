#!/usr/bin/env bash
# MAN-009の機械検査部分: bundle identity / プロセス数 / LaunchServices残留。
# 実行: just macos-smoke (macOS専用。just build / just notification-test の後に使う)
# 人間に残るのはDock・Paneru・Raycastからウィンドウを選択できることの目視だけ(SPEC MAN-009)。
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "SKIP: macOS専用" >&2
  exit 0
fi

root="$(cd "$(dirname "$0")/.." && pwd)"
lsregister=/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister
release_app="$root/src-tauri/target.noindex/release/bundle/macos/relico.app"
test_app="$root/src-tauri/target.noindex/debug/bundle/macos/RELICO Notification Test.app"
canonical="$HOME/Applications/relico.app"
fail=0

ok() { echo "OK: $*"; }
ng() { echo "NG: $*" >&2; fail=1; }
skip() { echo "SKIP: $*"; }
plist_id() { /usr/libexec/PlistBuddy -c "Print CFBundleIdentifier" "$1/Contents/Info.plist" 2>/dev/null || true; }
plist_name() { /usr/libexec/PlistBuddy -c "Print CFBundleName" "$1/Contents/Info.plist" 2>/dev/null || true; }

# 1) ビルド済みInfo.plistのidentity(存在するbundleだけ検査。設定ファイル上の分離はSTA-001が常時検証)
if [[ -d "$release_app" ]]; then
  id=$(plist_id "$release_app")
  name=$(plist_name "$release_app")
  [[ "$id" == "com.annenpolka.relico" ]] && ok "release identifier: $id" || ng "release identifier: $id"
  [[ "$name" == "relico" ]] && ok "release name: $name" || ng "release name: $name"
else
  skip "release .app 未ビルド ($release_app)"
fi
if [[ -d "$test_app" ]]; then
  id=$(plist_id "$test_app")
  name=$(plist_name "$test_app")
  [[ "$id" == "com.annenpolka.relico.notification-test" ]] && ok "notification-test identifier: $id" || ng "notification-test identifier: $id"
  [[ "$name" == "RELICO Notification Test" ]] && ok "notification-test name: $name" || ng "notification-test name: $name"
else
  skip "notification-test .app 未ビルド ($test_app)"
fi

# 2) 通知テスト版のプロセスは高々1つ(just notification-testの連続実行で増殖しない)
count=$( (pgrep -f "RELICO Notification Test" || true) | wc -l | tr -d ' ')
if (( count <= 1 )); then
  ok "notification-testプロセス数: $count"
else
  ng "notification-testプロセスが${count}個起動している"
fi

# 3) 旧AUTOSTARTは内部Unix実行ファイルをLaunchAgent登録するため、移行後に残さない(STA-003)
legacy_autostart="$HOME/Library/LaunchAgents/relico.plist"
if [[ -e "$legacy_autostart" ]]; then
  ng "旧AUTOSTART LaunchAgentが残っている: $legacy_autostart"
else
  ok "旧AUTOSTART LaunchAgentなし"
fi

# 4) LaunchServices: DMG一時mountの残留登録がなく、relico.appの登録が実在パスだけであること
dump_paths=$("$lsregister" -dump | grep -Eo 'path: +/[^ ].*relico\.app' | sed -E 's/^path: +//' | sort -u || true)
if [[ -z "$dump_paths" ]]; then
  skip "LaunchServicesにrelico.app登録なし"
else
  while IFS= read -r path; do
    if [[ "$path" == /Volumes/dmg.* ]]; then
      ng "DMG一時mountの残留登録: $path"
    elif [[ ! -e "$path" ]]; then
      ng "実在しないパスの残留登録: $path"
    else
      ok "登録: $path"
    fi
  done <<<"$dump_paths"
  # 配布identifierのcanonical登録は1件だけ(通知テスト版とビルド元は別名義・別パス)
  release_count=$(grep -cv "RELICO Notification Test" <<<"$dump_paths" || true)
  if (( release_count > 1 )); then
    ng "relico.appの登録が${release_count}件ある(canonicalは ${canonical} の1件のみが期待値)"
  fi
fi

if (( fail )); then
  echo "---- 失敗あり。docs/SPEC.md の MAN-009 を参照 ----" >&2
  exit 1
fi
echo "---- 機械検査は通過。残余: Dock/Paneru/Raycastからのウィンドウ選択を目視確認 ----"
