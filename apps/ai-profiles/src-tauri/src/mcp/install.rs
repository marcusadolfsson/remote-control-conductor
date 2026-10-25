// SPDX-License-Identifier: MIT

//! Setting the server up in Claude: the command that starts it, and adding it
//! to every Claude profile on this Mac, desktop app and Claude Code both.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Duration;

use serde::Serialize;
use serde_json::{json, Value};

use super::tools::local_entries;
use crate::app_kind::AppKind;
use crate::error::{AppError, AppResult};

/// What the server is called in a client's configuration.
pub const SERVER_NAME: &str = "remote-control-conductor";

/// What it was called before the app was renamed. An entry under one of these
/// that starts this app (under either name) is replaced by [`SERVER_NAME`].
const LEGACY_NAMES: &[&str] = &["ai-profiles"];

/// Pure: whether `entry` starts this app's server, as it is or as it was
/// called before (`…/MacOS/ai-profiles mcp`).
fn starts_this_app(entry: &Value) -> bool {
    let binary = entry["command"]
        .as_str()
        .and_then(|command| Path::new(command).file_name())
        .and_then(|name| name.to_str());
    matches!(binary, Some("remote-control-conductor" | "ai-profiles"))
        && entry["args"] == json!([crate::cli::MCP_COMMAND])
}

/// Pure: the legacy entries in `servers` (an `mcpServers` object) that start
/// this app.
fn legacy_entries(servers: &serde_json::Map<String, Value>) -> Vec<String> {
    LEGACY_NAMES
        .iter()
        .filter(|name| servers.get(**name).is_some_and(starts_this_app))
        .map(|name| (*name).to_owned())
        .collect()
}

/// How long one `claude mcp` call gets.
const CLAUDE_TIMEOUT: Duration = Duration::from_secs(30);

/// How a client starts the server, three ways.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpCommand {
    /// This app's binary: the server is the app, started with `mcp`.
    pub path: String,
    /// `claude mcp add …`, for Claude Code.
    pub claude_code: String,
    /// The `mcpServers` entry, for `claude_desktop_config.json`.
    pub desktop_json: String,
}

pub fn command() -> AppResult<McpCommand> {
    let path = std::env::current_exe()?.display().to_string();
    Ok(McpCommand {
        claude_code: format!(
            "claude mcp add --scope user {SERVER_NAME} -- {} {}",
            shell_quoted(&path),
            crate::cli::MCP_COMMAND
        ),
        desktop_json: serde_json::to_string_pretty(&json!({
            "mcpServers": { SERVER_NAME: server_entry(&path) }
        }))?,
        path,
    })
}

/// Pure: the entry a client's configuration holds for the server.
fn server_entry(path: &str) -> Value {
    json!({ "command": path, "args": [crate::cli::MCP_COMMAND] })
}

/// Pure: `text` quoted for a POSIX shell when it needs to be.
fn shell_quoted(text: &str) -> String {
    let plain = text
        .bytes()
        .all(|b| b.is_ascii_alphanumeric() || b"/._-+:@".contains(&b));
    if plain {
        text.to_owned()
    } else {
        format!("'{}'", text.replace('\'', r"'\''"))
    }
}

/// How adding the server to one place went.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum Step {
    Added,
    AlreadyThere,
    Failed { reason: String },
}

/// How adding the server to one profile went, desktop app and Claude Code.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Installed {
    pub profile: String,
    /// `None` when the profile has no desktop app.
    pub desktop: Option<Step>,
    /// `None` when the profile has no Claude Code.
    pub cli: Option<Step>,
}

/// Add the server to every Claude profile on this Mac. A profile the server
/// is already in is left as it is.
pub fn install_everywhere() -> AppResult<Vec<Installed>> {
    let path = std::env::current_exe()?.display().to_string();
    let entry = server_entry(&path);
    let claude = crate::deps::resolve_cli_binary_path("claude");
    let mut installed = Vec::new();
    for local in local_entries()? {
        if local.app != AppKind::Claude {
            continue;
        }
        let paths = crate::profiles::paths(&local.profile.id)?;
        let stock = AppKind::from_default_id(&local.profile.id).is_some();
        let desktop = local.desktop.then(|| {
            step(add_to_desktop_config(
                &Path::new(&paths.gui_data_dir).join("claude_desktop_config.json"),
                &entry,
            ))
        });
        let cli = local.cli.then(|| {
            let config_dir = PathBuf::from(&paths.cli_config_dir);
            // The stock install keeps `.claude.json` in the home folder.
            let claude_json = match (stock, dirs::home_dir()) {
                (true, Some(home)) => home.join(".claude.json"),
                _ => config_dir.join(".claude.json"),
            };
            step(add_to_claude_code(
                claude.as_deref(),
                (!stock).then_some(config_dir.as_path()),
                &claude_json,
                &entry,
            ))
        });
        installed.push(Installed {
            profile: local.profile.name,
            desktop,
            cli,
        });
    }
    Ok(installed)
}

fn step(outcome: Result<bool, String>) -> Step {
    match outcome {
        Ok(true) => Step::Added,
        Ok(false) => Step::AlreadyThere,
        Err(reason) => Step::Failed { reason },
    }
}

/// Pure: `config` (a `claude_desktop_config.json`, or nothing yet) with the
/// server in its `mcpServers`, or `None` when it's there already. Everything
/// else in the file is kept.
fn with_server(config: Option<&str>, entry: &Value) -> Result<Option<String>, String> {
    let mut config: Value = match config.map(str::trim) {
        None | Some("") => json!({}),
        Some(text) => serde_json::from_str(text)
            .map_err(|err| format!("its config isn't valid JSON ({err}), so it was left alone"))?,
    };
    let Some(root) = config.as_object_mut() else {
        return Err("its config isn't a JSON object, so it was left alone".into());
    };
    let servers = root.entry("mcpServers").or_insert_with(|| json!({}));
    let Some(servers) = servers.as_object_mut() else {
        return Err("its mcpServers isn't a JSON object, so it was left alone".into());
    };
    let legacy = legacy_entries(servers);
    if servers.get(SERVER_NAME) == Some(entry) && legacy.is_empty() {
        return Ok(None);
    }
    for name in legacy {
        servers.remove(&name);
    }
    servers.insert(SERVER_NAME.to_owned(), entry.clone());
    serde_json::to_string_pretty(&config)
        .map(Some)
        .map_err(|err| err.to_string())
}

/// Add the server to a desktop app's config. `Ok(true)` when it was added.
fn add_to_desktop_config(file: &Path, entry: &Value) -> Result<bool, String> {
    let existing = match fs::read_to_string(file) {
        Ok(text) => Some(text),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => None,
        Err(err) => return Err(format!("couldn't read its config: {err}")),
    };
    let Some(updated) = with_server(existing.as_deref(), entry)? else {
        return Ok(false);
    };
    write_atomically(file, &updated).map_err(|err| format!("couldn't write its config: {err}"))?;
    Ok(true)
}

fn write_atomically(file: &Path, text: &str) -> AppResult<()> {
    let parent = file
        .parent()
        .ok_or_else(|| AppError::Validation("the config has no folder".into()))?;
    fs::create_dir_all(parent)?;
    let temporary = parent.join(".claude_desktop_config.json.conductor.tmp");
    fs::write(&temporary, format!("{text}\n"))?;
    fs::rename(&temporary, file)?;
    Ok(())
}

/// What Claude Code's own `.claude.json` says about the server.
#[derive(Debug, Default, PartialEq, Eq)]
struct InClaudeCode {
    /// It has the server, as `entry` says to start it.
    current: bool,
    /// Entries under an old name that start this app, to remove.
    legacy: Vec<String>,
}

/// Pure: what `claude_json` has of the server.
fn in_claude_code(claude_json: Option<&str>, entry: &Value) -> InClaudeCode {
    let config = claude_json.and_then(|text| serde_json::from_str::<Value>(text).ok());
    let Some(servers) = config
        .as_ref()
        .and_then(|config| config.get("mcpServers"))
        .and_then(Value::as_object)
    else {
        return InClaudeCode::default();
    };
    InClaudeCode {
        current: servers.get(SERVER_NAME).is_some_and(|found| {
            found.get("command") == entry.get("command") && found.get("args") == entry.get("args")
        }),
        legacy: legacy_entries(servers),
    }
}

/// Add the server to a profile's Claude Code, through `claude mcp add`, so
/// Claude Code writes its own config. `config_dir` is the profile's
/// `CLAUDE_CONFIG_DIR`; `None` for the stock install. `Ok(true)` when added.
fn add_to_claude_code(
    claude: Option<&Path>,
    config_dir: Option<&Path>,
    claude_json: &Path,
    entry: &Value,
) -> Result<bool, String> {
    let found = in_claude_code(fs::read_to_string(claude_json).ok().as_deref(), entry);
    if found.current && found.legacy.is_empty() {
        return Ok(false);
    }
    let claude = claude.ok_or("Claude Code isn't installed")?;
    let path = entry["command"].as_str().unwrap_or_default();
    // The server under the app's old name goes, so Claude doesn't see it twice.
    for name in &found.legacy {
        run_claude(
            claude,
            config_dir,
            &["mcp", "remove", "--scope", "user", name],
        )?;
    }
    if found.current {
        return Ok(true);
    }
    // An entry that starts an older copy of the app goes first; there's none
    // the first time, and then this fails harmlessly.
    let _ = run_claude(
        claude,
        config_dir,
        &["mcp", "remove", "--scope", "user", SERVER_NAME],
    );
    run_claude(
        claude,
        config_dir,
        &[
            "mcp",
            "add",
            "--scope",
            "user",
            SERVER_NAME,
            "--",
            path,
            crate::cli::MCP_COMMAND,
        ],
    )?;
    Ok(true)
}

fn run_claude(claude: &Path, config_dir: Option<&Path>, args: &[&str]) -> Result<(), String> {
    let mut command = Command::new(claude);
    command.args(args).env("PATH", crate::deps::shell_path());
    match config_dir {
        Some(dir) => command.env("CLAUDE_CONFIG_DIR", dir),
        None => command.env_remove("CLAUDE_CONFIG_DIR"),
    };
    let finished = conductor_core::child::run_within(&mut command, Vec::new(), CLAUDE_TIMEOUT)
        .map_err(|err| format!("couldn't run claude: {err}"))?
        .ok_or("claude didn't finish in time")?;
    if finished.status.success() {
        Ok(())
    } else {
        let said = String::from_utf8_lossy(&finished.stderr);
        let said = said.trim();
        Err(if said.is_empty() {
            format!("claude mcp {} failed", args[1])
        } else {
            said.to_owned()
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry() -> Value {
        server_entry(
            "/Applications/Remote Control Conductor.app/Contents/MacOS/remote-control-conductor",
        )
    }

    #[test]
    fn the_desktop_config_gains_the_server_and_keeps_the_rest() {
        let config = r#"{"mcpServers":{"other":{"command":"x"}},"globalShortcut":"Cmd+Space"}"#;
        let updated: Value =
            serde_json::from_str(&with_server(Some(config), &entry()).unwrap().unwrap()).unwrap();
        assert_eq!(updated["globalShortcut"], "Cmd+Space");
        assert_eq!(updated["mcpServers"]["other"]["command"], "x");
        assert_eq!(
            updated["mcpServers"]["remote-control-conductor"]["args"],
            json!(["mcp"])
        );

        let again = serde_json::to_string(&updated).unwrap();
        assert_eq!(with_server(Some(&again), &entry()), Ok(None));
    }

    #[test]
    fn a_missing_or_empty_config_starts_fresh() {
        for config in [None, Some(""), Some("  \n")] {
            let updated: Value =
                serde_json::from_str(&with_server(config, &entry()).unwrap().unwrap()).unwrap();
            assert_eq!(
                updated,
                json!({ "mcpServers": { "remote-control-conductor": entry() } })
            );
        }
    }

    #[test]
    fn a_config_it_cant_read_is_left_alone() {
        assert!(with_server(Some("{not json"), &entry())
            .unwrap_err()
            .contains("left alone"));
        assert!(with_server(Some("[]"), &entry()).is_err());
        assert!(with_server(Some(r#"{"mcpServers":[]}"#), &entry()).is_err());
    }

    #[test]
    fn a_config_on_disk_is_rewritten_once() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("Claude/claude_desktop_config.json");
        assert_eq!(add_to_desktop_config(&file, &entry()), Ok(true));
        assert_eq!(add_to_desktop_config(&file, &entry()), Ok(false));
        let written: Value = serde_json::from_str(&fs::read_to_string(&file).unwrap()).unwrap();
        assert_eq!(written["mcpServers"]["remote-control-conductor"], entry());
    }

    #[test]
    fn the_entry_under_the_old_name_is_replaced_and_anothers_is_kept() {
        let config = json!({ "mcpServers": {
            "ai-profiles": { "command": "/Applications/ai-profiles-remote.app/Contents/MacOS/ai-profiles", "args": ["mcp"] },
            "other": { "command": "/usr/bin/other", "args": ["mcp"] },
        } })
        .to_string();
        let updated: Value =
            serde_json::from_str(&with_server(Some(&config), &entry()).unwrap().unwrap()).unwrap();
        let servers = updated["mcpServers"].as_object().unwrap();
        assert!(!servers.contains_key("ai-profiles"));
        assert_eq!(servers["remote-control-conductor"], entry());
        assert_eq!(servers["other"]["command"], "/usr/bin/other");

        // Someone else's server that happens to be called ai-profiles stays.
        let theirs = json!({ "mcpServers": { "ai-profiles": { "command": "npx", "args": ["ai-profiles-mcp"] } } })
            .to_string();
        let updated: Value =
            serde_json::from_str(&with_server(Some(&theirs), &entry()).unwrap().unwrap()).unwrap();
        assert_eq!(updated["mcpServers"]["ai-profiles"]["command"], "npx");
    }

    #[test]
    fn claude_code_has_it_only_when_it_starts_this_app() {
        let entry = entry();
        let with = |name: &str, command: &str| {
            json!({ "mcpServers": { name: { "type": "stdio", "command": command, "args": ["mcp"], "env": {} } } })
                .to_string()
        };
        let current = entry["command"].as_str().unwrap();
        assert_eq!(
            in_claude_code(Some(&with("remote-control-conductor", current)), &entry),
            InClaudeCode {
                current: true,
                legacy: vec![]
            }
        );
        assert_eq!(
            in_claude_code(
                Some(&with(
                    "remote-control-conductor",
                    "/old/remote-control-conductor"
                )),
                &entry
            ),
            InClaudeCode::default()
        );
        assert_eq!(
            in_claude_code(
                Some(&with(
                    "ai-profiles",
                    "/Applications/ai-profiles-remote.app/Contents/MacOS/ai-profiles"
                )),
                &entry
            ),
            InClaudeCode {
                current: false,
                legacy: vec!["ai-profiles".into()]
            }
        );
        assert_eq!(in_claude_code(Some("{}"), &entry), InClaudeCode::default());
        assert_eq!(in_claude_code(None, &entry), InClaudeCode::default());
    }

    #[test]
    fn claude_code_is_told_how_to_start_it() {
        assert_eq!(shell_quoted("/usr/bin/ai-profiles"), "/usr/bin/ai-profiles");
        assert_eq!(
            shell_quoted("/Applications/My App.app/x"),
            "'/Applications/My App.app/x'"
        );
        assert_eq!(shell_quoted("it's"), r"'it'\''s'");
    }
}
