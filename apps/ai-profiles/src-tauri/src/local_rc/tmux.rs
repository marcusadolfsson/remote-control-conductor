//! The user's own tmux, which the app runs this Mac's Remote Control
//! servers in: one window each in the tmux session `rc`, tagged with what
//! the app started there, so it only ever shows, types into or stops windows
//! it opened.

use std::path::PathBuf;
use std::process::Command;

use ai_profiles_core::api::TmuxWindow;

use crate::deps;
use crate::error::{AppError, AppResult};

/// The tmux session the servers' windows are in.
pub const SESSION: &str = "rc";

/// Window options naming what the app started in a window.
pub const PROFILE_TAG: &str = "@aip_rc_profile";
pub const FOLDER_TAG: &str = "@aip_rc_folder";
pub const NAME_TAG: &str = "@aip_rc_name";
pub const SPAWN_TAG: &str = "@aip_rc_spawn";

/// Between fields. tmux prints a tab as `_`, so it's a string of its own
/// no folder or name holds in practice.
const SEP: &str = "|:|";
const OPENED_FORMAT: &str = "#{session_name}|:|#{window_id}|:|#{pane_id}|:|#{pane_pid}";
const WINDOW_FORMAT: &str = "#{session_name}|:|#{window_id}|:|#{pane_id}|:|#{pane_pid}|:|#{@aip_rc_profile}|:|#{@aip_rc_folder}|:|#{@aip_rc_name}|:|#{@aip_rc_spawn}";

pub struct Tmux {
    binary: PathBuf,
}

/// A window the app opened, with what it started there.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Window {
    pub window: TmuxWindow,
    pub pane_pid: i32,
    pub profile: String,
    pub folder: String,
    pub name: Option<String>,
    pub spawn: String,
}

impl Tmux {
    /// tmux, where the login shell finds it (Homebrew's, usually).
    pub fn installed() -> Option<Tmux> {
        deps::resolve_cli_binary_path("tmux").map(|binary| Tmux { binary })
    }

    /// tmux, or what to do about it missing.
    pub fn find() -> AppResult<Tmux> {
        Tmux::installed().ok_or_else(|| {
            AppError::NotInstalled(
                "tmux, which runs this Mac's Remote Control servers. Install it with `brew install tmux`."
                    .into(),
            )
        })
    }

    pub fn binary(&self) -> &PathBuf {
        &self.binary
    }

    fn run(&self, args: &[&str]) -> AppResult<String> {
        let output = Command::new(&self.binary)
            .args(args)
            .output()
            .map_err(AppError::Io)?;
        if output.status.success() {
            Ok(String::from_utf8_lossy(&output.stdout).into_owned())
        } else {
            Err(AppError::Validation(format!(
                "tmux {}: {}",
                args.first().unwrap_or(&""),
                String::from_utf8_lossy(&output.stderr).trim()
            )))
        }
    }

    fn has_session(&self) -> bool {
        self.run(&["has-session", "-t", &format!("={SESSION}")])
            .is_ok()
    }

    /// Open a window running `argv` in `cwd`, in a session of its own if
    /// there's none yet. Nothing goes through a shell.
    pub fn open_window(
        &self,
        name: &str,
        cwd: &str,
        argv: &[String],
    ) -> AppResult<(TmuxWindow, i32)> {
        // tmux reads `-c` as a format, where `#(…)` runs a command: `##` keeps a `#`.
        let cwd = cwd.replace('#', "##");
        let target = format!("={SESSION}:");
        let mut args: Vec<&str> = if self.has_session() {
            vec!["new-window", "-d", "-t", &target]
        } else {
            vec!["new-session", "-d", "-s", SESSION]
        };
        args.extend(["-n", name, "-c", &cwd, "-P", "-F", OPENED_FORMAT, "--"]);
        let argv: Vec<String> = argv.iter().map(|arg| literal_semicolon(arg)).collect();
        args.extend(argv.iter().map(String::as_str));
        let output = self.run(&args)?;
        parse_opened(&output).ok_or_else(|| {
            AppError::Validation(format!("tmux said something unexpected: {output}"))
        })
    }

    pub fn tag(&self, window_id: &str, option: &str, value: &str) -> AppResult<()> {
        self.run(&["set-option", "-w", "-t", window_id, option, value])
            .map(|_| ())
    }

    /// Every window the app opened a server in. None while tmux isn't running.
    pub fn windows(&self) -> Vec<Window> {
        self.run(&["list-windows", "-a", "-F", WINDOW_FORMAT])
            .map(|output| output.lines().filter_map(parse_window).collect())
            .unwrap_or_default()
    }

    pub fn capture(&self, pane_id: &str) -> Option<String> {
        self.run(&["capture-pane", "-p", "-J", "-S", "-200", "-t", pane_id])
            .ok()
    }

    /// The visible screen as it is, row by row, with the pane's size.
    pub fn screen(&self, pane_id: &str) -> Option<(String, u16, u16)> {
        let text = self.run(&["capture-pane", "-p", "-t", pane_id]).ok()?;
        let size = self
            .run(&[
                "display-message",
                "-p",
                "-t",
                pane_id,
                "#{pane_width}:#{pane_height}",
            ])
            .ok()?;
        let (width, height) = size.trim().split_once(':')?;
        Some((text, width.parse().ok()?, height.parse().ok()?))
    }

    /// Type `text` as it is.
    pub fn type_text(&self, pane_id: &str, text: &str) -> AppResult<()> {
        self.run(&["send-keys", "-l", "-t", pane_id, "--", text])
            .map(|_| ())
    }

    /// Press one named key (`Enter`, `Down`, `C-c`).
    pub fn press(&self, pane_id: &str, key: &str) -> AppResult<()> {
        self.run(&["send-keys", "-t", pane_id, key]).map(|_| ())
    }

    pub fn kill_window(&self, window_id: &str) -> AppResult<()> {
        self.run(&["kill-window", "-t", window_id]).map(|_| ())
    }
}

/// `arg`, with a `;` at its end escaped: tmux takes an argument ending in
/// `;` for the end of its command.
fn literal_semicolon(arg: &str) -> String {
    match arg.strip_suffix(';') {
        Some(rest) => format!("{rest}\\;"),
        None => arg.to_owned(),
    }
}

/// Pure: what `-P -F OPENED_FORMAT` printed.
fn parse_opened(output: &str) -> Option<(TmuxWindow, i32)> {
    let mut fields = output.trim().split(SEP);
    let window = TmuxWindow {
        session: fields.next()?.to_owned(),
        window_id: fields.next()?.to_owned(),
        pane_id: fields.next()?.to_owned(),
    };
    Some((window, fields.next()?.parse().ok()?))
}

/// Pure: one line of `list-windows -F WINDOW_FORMAT`, when the app opened it.
fn parse_window(line: &str) -> Option<Window> {
    let fields: Vec<&str> = line.split(SEP).collect();
    let [session, window_id, pane_id, pid, profile, folder, name, spawn] = fields[..] else {
        return None;
    };
    if profile.is_empty() {
        return None;
    }
    Some(Window {
        window: TmuxWindow {
            session: session.into(),
            window_id: window_id.into(),
            pane_id: pane_id.into(),
        },
        pane_pid: pid.parse().ok()?,
        profile: profile.into(),
        folder: folder.into(),
        name: (!name.is_empty()).then(|| name.into()),
        spawn: if spawn.is_empty() {
            "same-dir".into()
        } else {
            spawn.into()
        },
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_window_it_opened() {
        let (window, pid) = parse_opened("rc|:|@4|:|%7|:|812\n").unwrap();
        assert_eq!(window.session, "rc");
        assert_eq!(window.window_id, "@4");
        assert_eq!(window.pane_id, "%7");
        assert_eq!(pid, 812);
        assert!(parse_opened("rc|:|@4\n").is_none());
    }

    #[test]
    fn lists_only_windows_the_app_tagged() {
        let ours = parse_window(
            "rc|:|@4|:|%7|:|812|:|default:claude|:|/Users/m/code|:|Docs (x)|:|worktree",
        )
        .unwrap();
        assert_eq!(ours.profile, "default:claude");
        assert_eq!(ours.folder, "/Users/m/code");
        assert_eq!(ours.name.as_deref(), Some("Docs (x)"));
        assert_eq!(ours.spawn, "worktree");
        assert!(
            parse_window("main|:|@1|:|%1|:|90|:||:||:||:|").is_none(),
            "someone else's window"
        );
        let unnamed = parse_window("rc|:|@5|:|%8|:|813|:|abc|:|/x|:||:|").unwrap();
        assert_eq!(unnamed.name, None);
        assert_eq!(unnamed.spawn, "same-dir");
    }

    #[test]
    fn escapes_only_a_trailing_semicolon() {
        assert_eq!(literal_semicolon("a;b;"), "a;b\\;");
        assert_eq!(literal_semicolon("plain"), "plain");
    }
}
