/// tauri-plugin-autostartの旧LaunchAgent方式が生成したplistかを保守的に判定する。
/// 無関係な同名plistは削除しない。SPEC: STA-003
pub fn is_legacy_relico_launch_agent(contents: &str) -> bool {
    contents.contains("<key>Label</key>")
        && contents.contains("<string>relico</string>")
        && contents.contains("<key>ProgramArguments</key>")
        && contents.contains(".app/Contents/MacOS/relico</string>")
}

/// 旧LaunchAgentが存在する場合だけ、その有効意図を.app Login Itemへ一度移行する。
/// AppleScript側の登録に失敗したら旧plistを復元する。
#[cfg(target_os = "macos")]
pub fn migrate_legacy_launch_agent<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
) -> Result<bool, String> {
    use std::io::ErrorKind;
    use tauri::Manager;
    use tauri_plugin_autostart::ManagerExt;

    if app.config().identifier != "com.annenpolka.relico" {
        return Ok(false);
    }

    let path = app
        .path()
        .home_dir()
        .map_err(|error| error.to_string())?
        .join("Library/LaunchAgents/relico.plist");
    let contents = match std::fs::read_to_string(&path) {
        Ok(contents) => contents,
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok(false),
        Err(error) => return Err(format!("{}を読めない: {error}", path.display())),
    };
    if !is_legacy_relico_launch_agent(&contents) {
        return Err(format!(
            "{}はRELICO旧LaunchAgent形式でないため保持した",
            path.display()
        ));
    }

    let launcher = app.autolaunch();
    let already_enabled = launcher.is_enabled().map_err(|error| error.to_string())?;
    std::fs::remove_file(&path)
        .map_err(|error| format!("{}を削除できない: {error}", path.display()))?;
    if !already_enabled {
        if let Err(error) = launcher.enable() {
            let restore = std::fs::write(&path, &contents)
                .map_err(|restore| format!("旧plistの復元にも失敗した: {restore}"));
            return match restore {
                Ok(()) => Err(format!("Login Item登録に失敗し旧plistを復元した: {error}")),
                Err(restore) => Err(format!("Login Item登録に失敗した: {error}; {restore}")),
            };
        }
    }
    Ok(true)
}
