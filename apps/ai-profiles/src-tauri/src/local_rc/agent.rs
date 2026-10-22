//! A login agent that starts the remembered servers again when this Mac's
//! user logs in, without the app open: launchd runs
//! `remote-control-conductor revive-rc-servers` once at load. It's there
//! while any server is remembered, and gone when none is.

use std::fs;
use std::path::{Path, PathBuf};

use crate::error::{AppError, AppResult};

const LABEL: &str = "com.marcusadolfsson.remote-control-conductor.rc-servers";

/// The argument that revives the servers and exits.
pub const REVIVE_COMMAND: &str = "revive-rc-servers";

#[cfg_attr(test, allow(dead_code))]
fn plist_path() -> AppResult<PathBuf> {
    let home = dirs::home_dir()
        .ok_or_else(|| AppError::NotFound("could not determine the home folder".into()))?;
    Ok(home
        .join("Library/LaunchAgents")
        .join(format!("{LABEL}.plist")))
}

/// Install the agent when `wanted`, for the app at `program`, or remove it.
/// Writes only when the plist would change.
// Not called from tests: see `keep_agent`.
#[cfg_attr(test, allow(dead_code))]
pub fn sync(wanted: bool, program: &Path) -> AppResult<()> {
    let path = plist_path()?;
    if !wanted {
        if path.exists() {
            fs::remove_file(&path)?;
        }
        return Ok(());
    }
    let home = dirs::home_dir().unwrap_or_default();
    let log = home.join("Library/Logs/remote-control-conductor-rc-servers.log");
    let body = plist(program, &log);
    if fs::read_to_string(&path).ok().as_deref() == Some(body.as_str()) {
        return Ok(());
    }
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(&path, body)?;
    Ok(())
}

/// Pure: the agent's plist, running `program` once at load.
fn plist(program: &Path, log: &Path) -> String {
    let escape = |text: String| {
        text.replace('&', "&amp;")
            .replace('<', "&lt;")
            .replace('>', "&gt;")
    };
    let program = escape(program.display().to_string());
    let log = escape(log.display().to_string());
    format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>{LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>{program}</string>
    <string>{REVIVE_COMMAND}</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>StandardOutPath</key>
  <string>{log}</string>
  <key>StandardErrorPath</key>
  <string>{log}</string>
</dict>
</plist>
"#
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn runs_the_app_once_at_login() {
        let text = plist(
            Path::new("/Applications/Remote Control Conductor.app/Contents/MacOS/remote-control-conductor"),
            Path::new("/Users/m/Library/Logs/x.log"),
        );
        assert!(text.contains("<string>/Applications/Remote Control Conductor.app/Contents/MacOS/remote-control-conductor</string>"));
        assert!(text.contains("<string>revive-rc-servers</string>"));
        assert!(text.contains("<key>RunAtLoad</key>\n  <true/>"));
        assert!(!text.contains("KeepAlive"));
    }
}
