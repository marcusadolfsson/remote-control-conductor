//! Remote Control servers on this Mac: `claude remote-control` in a folder,
//! run as one of the Mac's Claude profiles, so the Claude apps on other
//! devices can start sessions there. Unlike Claude Desktop's background
//! Remote Control, there's no limit on how many folders.
//!
//! Each runs in a window of the user's tmux (see [`tmux`]), so it keeps
//! running when the app quits, and its window can be shown and typed into
//! here or attached to in Terminal, as a host's are. Only servers the app
//! started are listed: those are the windows it tagged.

mod folders;
mod screen;
mod tmux;

use std::path::{Path, PathBuf};
use std::process::Command;
use std::thread;
use std::time::{Duration, Instant};

use ai_profiles_core::api::{
    RcServer, StartRcServerRequest, StartRcServerResult, WindowKey, WindowScreen,
};

use crate::app_kind::AppKind;
use crate::deps;
use crate::error::{AppError, AppResult};
use crate::paths;
use crate::profiles;

pub use folders::list as list_dirs;
use screen::Screen;
pub use tmux::SESSION as TMUX_SESSION;
use tmux::{Tmux, Window};

const SETTLE_TIMEOUT: Duration = Duration::from_secs(15);
const STOP_TIMEOUT: Duration = Duration::from_secs(8);
const POLL: Duration = Duration::from_millis(250);
const SPAWN_MODES: [&str; 2] = ["same-dir", "worktree"];

/// `profile`'s servers, by folder. None while tmux isn't installed or running.
pub fn list(profile: &str) -> Vec<RcServer> {
    let Some(tmux) = Tmux::installed() else {
        return Vec::new();
    };
    let processes = process_table();
    let mut servers: Vec<RcServer> = tmux
        .windows()
        .into_iter()
        .filter(|window| window.profile == profile)
        .map(|window| describe(&tmux, &processes, window))
        .collect();
    servers.sort_by(|a, b| a.folder.cmp(&b.folder));
    servers
}

/// The installed tmux's version (`tmux 3.5a`), or none without tmux.
pub fn tmux_version() -> Option<String> {
    let output = Command::new(Tmux::installed()?.binary())
        .arg("-V")
        .output()
        .ok()?;
    output
        .status
        .success()
        .then(|| String::from_utf8_lossy(&output.stdout).trim().to_owned())
}

/// Start a server in `request.folder` as `profile`, in a tmux window of its
/// own, answering its "Trust <folder>?" when asked to; or find the one
/// already running there.
pub fn start(profile: &str, request: &StartRcServerRequest) -> AppResult<StartRcServerResult> {
    let tmux = Tmux::find()?;
    let folder = checked_folder(&request.folder)?;
    let spawn = request.spawn.clone().unwrap_or_else(|| "same-dir".into());
    if !SPAWN_MODES.contains(&spawn.as_str()) {
        return Err(AppError::Validation(format!("unknown spawn mode {spawn}")));
    }
    if let Some(server) = list(profile)
        .into_iter()
        .find(|server| server.folder == folder)
    {
        return Ok(found(server));
    }
    let name = request
        .name
        .as_deref()
        .map(|name| name.trim().trim_start_matches(['-', ' ']))
        .filter(|name| !name.is_empty())
        .map(str::to_owned);
    let argv = server_argv(
        &claude()?,
        config_dir(profile)?.as_deref(),
        name.as_deref(),
        &spawn,
    );
    let window_name = name.clone().unwrap_or_else(|| folder_name(&folder));
    let tags = [
        (tmux::PROFILE_TAG, profile),
        (tmux::FOLDER_TAG, folder.as_str()),
        (tmux::NAME_TAG, name.as_deref().unwrap_or_default()),
        (tmux::SPAWN_TAG, spawn.as_str()),
    ];
    let attempt = || {
        launch(
            &tmux,
            &window_name,
            &folder,
            &argv,
            &tags,
            request.trust_folder,
        )
    };
    // `claude remote-control` doesn't renew a sign-in whose access token has
    // run out, as an interactive `claude` does: renew it the way the usage
    // card does, and try once more.
    let (window, pid) = match attempt() {
        Err(error) if needs_sign_in(&error.message()) => {
            renew_sign_in(profile);
            attempt()
        }
        other => other,
    }
    .map_err(signed_out)?;
    let opened = Window {
        window,
        pane_pid: pid,
        profile: profile.into(),
        folder,
        name,
        spawn,
    };
    let server = describe(&tmux, &process_table(), opened);
    Ok(StartRcServerResult {
        attach_command: Some(attach_command(&server)),
        server,
        already_running: false,
    })
}

/// Open the server's window, tag it, and wait for it to connect or ask.
fn launch(
    tmux: &Tmux,
    name: &str,
    folder: &str,
    argv: &[String],
    tags: &[(&str, &str)],
    trust: bool,
) -> AppResult<(ai_profiles_core::api::TmuxWindow, i32)> {
    let (window, pid) = tmux.open_window(name, folder, argv)?;
    for (option, value) in tags {
        tmux.tag(&window.window_id, option, value)?;
    }
    settle(tmux, &window.pane_id, trust)?;
    Ok((window, pid))
}

/// Pure: whether a server exited because the profile's sign-in is missing or
/// has run out.
fn needs_sign_in(message: &str) -> bool {
    [
        "Authentication failed (401)",
        "access token has expired",
        "/login",
    ]
    .iter()
    .any(|sign| message.contains(sign))
}

/// Have Claude Code renew `profile`'s sign-in, as the usage card does.
/// Best-effort: starting again says whether it worked.
fn renew_sign_in(profile: &str) {
    let dir = match AppKind::from_default_id(profile) {
        Some(kind) => paths::stock_cli_config_dir(crate::app_kind::spec(kind)),
        None => paths::cli_config_dir(profile),
    };
    if let Ok(dir) = dir {
        tauri::async_runtime::block_on(async {
            use crate::usage::refresh::CliRefresher;
            crate::usage::refresh::ClaudeCliRefresher::new()
                .try_refresh(&dir)
                .await;
        });
    }
}

/// A failure to start because the profile isn't signed in, said so, with what to do.
fn signed_out(error: AppError) -> AppError {
    let message = error.message();
    if !needs_sign_in(&message) {
        return error;
    }
    AppError::Validation(format!(
        "This profile's Claude Code isn't signed in, or its sign-in has run out and couldn't be renewed. Sign it in again from its Usage card, then start the server.\n\n{message}"
    ))
}

/// Stop server `pid` of `profile`: Ctrl+C in its window, as someone at its
/// keyboard would, which leaves its sessions resumable for a few hours.
/// Answers whether it was running.
pub fn stop(profile: &str, pid: i32) -> AppResult<bool> {
    let tmux = Tmux::find()?;
    let Some(window) = tmux
        .windows()
        .into_iter()
        .find(|window| window.profile == profile && window.pane_pid == pid)
    else {
        return Ok(false);
    };
    tmux.press(&window.window.pane_id, "C-c")?;
    let deadline = Instant::now() + STOP_TIMEOUT;
    while Instant::now() < deadline && is_running(pid) {
        thread::sleep(POLL);
    }
    if is_running(pid) {
        let _ = Command::new("/bin/kill")
            .args(["-TERM", &pid.to_string()])
            .status();
        thread::sleep(Duration::from_secs(1));
    }
    if is_running(pid) {
        return Err(AppError::Validation(format!(
            "The Remote Control server (process {pid}) didn't stop."
        )));
    }
    let _ = tmux.kill_window(&window.window.window_id);
    Ok(true)
}

/// What a server's window shows now. Only a window the app opened.
pub fn window_screen(window_id: &str) -> AppResult<WindowScreen> {
    let tmux = Tmux::find()?;
    let window = ours(&tmux, window_id)?;
    let (text, width, height) = tmux
        .screen(&window.window.pane_id)
        .ok_or_else(window_gone)?;
    Ok(WindowScreen {
        remote_control: matches!(screen::read(&text), Screen::Connected { .. }),
        text,
        width,
        height,
        session_id: None,
    })
}

/// Type `keys` into a server's window, then read it again.
pub fn window_keys(window_id: &str, keys: &[WindowKey]) -> AppResult<WindowScreen> {
    let tmux = Tmux::find()?;
    let pane = ours(&tmux, window_id)?.window.pane_id;
    for key in keys {
        match key {
            WindowKey::Key(name) => tmux.press(&pane, name)?,
            WindowKey::Text(text) => tmux.type_text(&pane, text)?,
        }
    }
    thread::sleep(Duration::from_millis(150));
    window_screen(window_id)
}

/// Open a Terminal window attached to a server's window.
pub fn open_in_terminal(window_id: &str) -> AppResult<()> {
    let tmux = Tmux::find()?;
    let window = ours(&tmux, window_id)?;
    let command = format!(
        "{} attach -t {} \\; select-window -t {}",
        shell_quote(&tmux.binary().display().to_string()),
        window.window.session,
        window.window.window_id
    );
    let script = terminal_applescript(&command);
    let status = Command::new("/usr/bin/osascript")
        .arg("-e")
        .arg(&script)
        .status()
        .map_err(AppError::Io)?;
    if status.success() {
        Ok(())
    } else {
        Err(AppError::Validation(format!(
            "osascript exited with status {status}"
        )))
    }
}

fn window_gone() -> AppError {
    AppError::Remote {
        code: "window_gone".into(),
        message: "The window has closed.".into(),
    }
}

/// The window `window_id`, if the app opened a server in it.
fn ours(tmux: &Tmux, window_id: &str) -> AppResult<Window> {
    tmux.windows()
        .into_iter()
        .find(|window| window.window.window_id == window_id)
        .ok_or_else(window_gone)
}

fn found(server: RcServer) -> StartRcServerResult {
    StartRcServerResult {
        attach_command: Some(attach_command(&server)),
        server,
        already_running: true,
    }
}

fn attach_command(server: &RcServer) -> String {
    server.window.as_ref().map_or_else(String::new, |window| {
        format!(
            "tmux attach -t {} \\; select-window -t {}",
            window.session, window.window_id
        )
    })
}

/// Wait for a new server to connect, or to ask something: answer its trust
/// question when `trust`, as long as it pre-approves nothing; leave anything
/// else for someone in its window.
fn settle(tmux: &Tmux, pane: &str, trust: bool) -> AppResult<()> {
    let deadline = Instant::now() + SETTLE_TIMEOUT;
    let mut last = String::new();
    let mut answered = false;
    while Instant::now() < deadline {
        let Some(text) = tmux.capture(pane) else {
            return Err(exited(&last));
        };
        // Acted on only once it has finished drawing: unchanged since the last look.
        let drawn = text == last;
        match screen::read(&text) {
            Screen::Connected { .. } => return Ok(()),
            Screen::TrustQuestion { preapproves: false } if trust && !answered && drawn => {
                tmux.type_text(pane, "y")?;
                tmux.press(pane, "Enter")?;
                answered = true;
            }
            Screen::TrustQuestion { .. } | Screen::EnableQuestion if drawn => return Ok(()),
            _ => {}
        }
        last = text;
        thread::sleep(POLL);
    }
    Ok(())
}

fn exited(last: &str) -> AppError {
    let shown = screen::last_lines(last, 6);
    AppError::Validation(if shown.is_empty() {
        "The Remote Control server exited as soon as it started. Try `claude remote-control` in a terminal to see why.".into()
    } else {
        format!("The Remote Control server exited as soon as it started. It last showed:\n{shown}")
    })
}

fn describe(tmux: &Tmux, processes: &[(i32, String)], window: Window) -> RcServer {
    let text = tmux.capture(&window.window.pane_id).unwrap_or_default();
    let read = screen::read(&text);
    RcServer {
        pid: window.pane_pid,
        sessions: served(processes, window.pane_pid),
        environment_url: match &read {
            Screen::Connected { url } => url.clone(),
            _ => None,
        },
        attention: screen::attention(&read, &text),
        folder: window.folder,
        name: window.name,
        spawn: window.spawn,
        window: Some(window.window),
    }
}

/// Pure: how many of `server`'s children are sessions it serves (started
/// with `--sdk-url`).
fn served(processes: &[(i32, String)], server: i32) -> u32 {
    let count = processes
        .iter()
        .filter(|(parent, command)| *parent == server && command.contains("--sdk-url"))
        .count();
    u32::try_from(count).unwrap_or(u32::MAX)
}

/// Every process's parent and command line.
fn process_table() -> Vec<(i32, String)> {
    let Ok(output) = Command::new("/bin/ps")
        .args(["-ax", "-o", "ppid=,command="])
        .output()
    else {
        return Vec::new();
    };
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter_map(|line| {
            let line = line.trim_start();
            let (parent, command) = line.split_once(' ')?;
            Some((parent.parse().ok()?, command.to_owned()))
        })
        .collect()
}

/// Whether `pid` is still a `claude remote-control`.
fn is_running(pid: i32) -> bool {
    Command::new("/bin/ps")
        .args(["-p", &pid.to_string(), "-o", "command="])
        .output()
        .is_ok_and(|output| String::from_utf8_lossy(&output.stdout).contains("remote-control"))
}

fn claude() -> AppResult<PathBuf> {
    deps::resolve_cli_binary_path("claude")
        .ok_or_else(|| AppError::NotInstalled("Claude Code (`claude`).".into()))
}

/// The profile's `CLAUDE_CONFIG_DIR`, or none for the stock install. Exactly
/// the path its `claude-<slug>` wrapper sets: Claude keys the profile's
/// sign-in in the Keychain by it.
fn config_dir(profile: &str) -> AppResult<Option<PathBuf>> {
    if let Some(kind) = AppKind::from_default_id(profile) {
        return match kind {
            AppKind::Claude => Ok(None),
            AppKind::Codex => Err(AppError::Validation("Remote Control is Claude's.".into())),
        };
    }
    let found = profiles::load()?
        .into_iter()
        .find(|candidate| candidate.id == profile)
        .ok_or_else(|| AppError::NotFound(format!("profile {profile} not found")))?;
    if found.app != AppKind::Claude {
        return Err(AppError::Validation("Remote Control is Claude's.".into()));
    }
    paths::cli_config_dir(profile).map(Some)
}

/// Pure: what the window runs. `env` sets the profile's config dir (or
/// clears an inherited one for the stock install), then execs claude, so
/// the pane's pid is claude's.
fn server_argv(
    claude: &Path,
    config: Option<&Path>,
    name: Option<&str>,
    spawn: &str,
) -> Vec<String> {
    let mut argv = vec!["/usr/bin/env".to_owned()];
    match config {
        Some(dir) => argv.push(format!("CLAUDE_CONFIG_DIR={}", dir.display())),
        None => argv.extend(["-u".to_owned(), "CLAUDE_CONFIG_DIR".to_owned()]),
    }
    argv.extend([claude.display().to_string(), "remote-control".to_owned()]);
    if let Some(name) = name {
        argv.extend(["--name".to_owned(), name.to_owned()]);
    }
    argv.extend(["--spawn".to_owned(), spawn.to_owned()]);
    argv
}

/// The folder as an absolute path to a folder that exists.
fn checked_folder(folder: &str) -> AppResult<String> {
    let path = PathBuf::from(folder);
    if !path.is_absolute() || !path.is_dir() {
        return Err(AppError::Validation(format!(
            "{folder} isn't a folder on this Mac."
        )));
    }
    Ok(path.display().to_string())
}

/// Pure: the last part of a path.
fn folder_name(path: &str) -> String {
    path.rsplit('/')
        .find(|part| !part.is_empty())
        .unwrap_or(path)
        .to_owned()
}

/// Pure: `text` as one word for a shell.
fn shell_quote(text: &str) -> String {
    format!("'{}'", text.replace('\'', "'\\''"))
}

/// Pure: AppleScript opening a Terminal window running `command`.
fn terminal_applescript(command: &str) -> String {
    let escaped = command.replace('\\', "\\\\").replace('"', "\\\"");
    format!("tell application \"Terminal\"\n    activate\n    do script \"{escaped}\"\nend tell")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn runs_a_profile_with_its_own_config_dir_and_the_stock_one_without() {
        let claude = PathBuf::from("/Users/m/.local/bin/claude");
        let dir = PathBuf::from(
            "/Users/m/Library/Application Support/ai-profiles/profiles/abc/cli-config",
        );
        assert_eq!(
            server_argv(&claude, Some(dir.as_path()), Some("Docs (x)"), "worktree"),
            [
                "/usr/bin/env",
                "CLAUDE_CONFIG_DIR=/Users/m/Library/Application Support/ai-profiles/profiles/abc/cli-config",
                "/Users/m/.local/bin/claude",
                "remote-control",
                "--name",
                "Docs (x)",
                "--spawn",
                "worktree",
            ]
        );
        assert_eq!(
            server_argv(&claude, None, None, "same-dir")[..3],
            ["/usr/bin/env", "-u", "CLAUDE_CONFIG_DIR"]
        );
    }

    #[test]
    fn counts_the_sessions_a_server_serves() {
        let table = vec![
            (
                812,
                "/Users/m/.local/bin/claude --sdk-url wss://x".to_owned(),
            ),
            (812, "/bin/zsh".to_owned()),
            (900, "claude --sdk-url wss://y".to_owned()),
        ];
        assert_eq!(served(&table, 812), 1);
        assert_eq!(served(&table, 1), 0);
    }

    #[test]
    fn knows_a_server_that_needs_the_profile_signed_in() {
        assert!(needs_sign_in(
            "It last showed:\nError: Registration: Authentication failed (401): OAuth access token has expired."
        ));
        assert!(needs_sign_in("Please use `/login` to sign in"));
        assert!(!needs_sign_in("It last showed:\nerror: unknown option"));
    }

    #[test]
    fn names_a_window_after_its_folder() {
        assert_eq!(folder_name("/Users/m/code/"), "code");
        assert_eq!(folder_name("/"), "/");
    }

    #[test]
    fn quotes_for_terminal() {
        assert_eq!(shell_quote("/opt/it's/tmux"), "'/opt/it'\\''s/tmux'");
        assert!(terminal_applescript("a \"b\"").contains("do script \"a \\\"b\\\"\""));
    }

    /// Starts a real Remote Control server as the stock profile in a scratch
    /// folder, lists it, reads its window and stops it. It shows briefly in
    /// the account's Claude apps, so only on request:
    /// `cargo test local_rc -- --ignored`.
    #[test]
    #[ignore = "starts a real Remote Control server on this Mac's default profile"]
    fn starts_lists_and_stops_a_real_server() {
        let folder = tempfile::tempdir().unwrap();
        let folder = folder.path().canonicalize().unwrap().join("rc-smoke-test");
        std::fs::create_dir_all(&folder).unwrap();
        let request = StartRcServerRequest {
            folder: folder.display().to_string(),
            name: Some("RC smoke test".into()),
            spawn: None,
            trust_folder: true,
        };
        let started = start("default:claude", &request).unwrap();
        eprintln!("started: {started:?}");
        let pid = started.server.pid;
        let listed = list("default:claude");
        assert!(listed.iter().any(|server| server.pid == pid), "{listed:?}");
        let window = started.server.window.clone().unwrap();
        let screen = window_screen(&window.window_id).unwrap();
        eprintln!("screen:\n{}", screen.text.trim_end());
        assert!(stop("default:claude", pid).unwrap());
        assert!(list("default:claude")
            .iter()
            .all(|server| server.pid != pid));
    }
}
