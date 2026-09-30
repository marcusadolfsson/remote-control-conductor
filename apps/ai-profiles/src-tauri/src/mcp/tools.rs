// SPDX-License-Identifier: MIT

//! The tools: each a thin call into what the app's own commands call, with
//! names in and compact JSON out.

use std::collections::HashMap;

use ai_profiles_core::api::{
    NewSessionRequest, RemoteSession, TransferMemoryFile, TransferRequest as RemoteTransferRequest,
    WindowKey,
};
use ai_profiles_core::memory::{Decision, MemoryAction, Side};
use rmcp::handler::server::router::tool::ToolRouter;
use rmcp::handler::server::wrapper::Parameters;
use rmcp::model::{CallToolResult, ContentBlock, Implementation, ServerCapabilities, ServerConfig};
use rmcp::{tool, tool_handler, tool_router, ErrorData as McpError, ServerHandler};
use schemars::JsonSchema;
use serde::Deserialize;
use serde_json::{json, Value};

use super::refs::{self, LocalProfile, SessionName, Target};
use crate::accounts::AccountStatus;
use crate::app_kind::AppKind;
use crate::error::{AppError, AppResult};
use crate::remote::hosts::{HostList, RemoteHost};
use crate::remote::{self, open_in_claude, secrets};
use crate::sessions;

/// What a tool hands back: JSON for Claude, or a sentence saying why not.
type Outcome = Result<Value, String>;

/// How long `list_profiles` waits on one host before calling it offline.
const HOST_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(8);

const INSTRUCTIONS: &str = "\
Remote Control Conductor manages Claude accounts on this Mac (profiles) and Claude Code accounts on paired \
Linux hosts, where sessions run in tmux with Remote Control on. Start with list_profiles. A \
profile on this Mac is named by its name (\"Marcus1\"); an account on a host is written \
host/account (\"xjopa1/marcus1\"). A session is named by its id, an id prefix of 8+ characters, \
or its exact title. To put a profile on another account (personal, work, a client's), \
switch_account (then finish_sign_in) signs the whole profile in as it: nothing moves, its sessions resume. \
Moves stay within this Mac or within one host. Before move_session, call plan_move: on a host, \
every memory note both sides changed needs a decision; on this Mac the destination keeps its own.";

#[derive(Clone)]
pub struct AiProfiles {
    tool_router: ToolRouter<Self>,
}

impl AiProfiles {
    pub fn new() -> Self {
        Self {
            tool_router: Self::tool_router(),
        }
    }
}

// ---- Parameters -----------------------------------------------------------

#[derive(Debug, Deserialize, JsonSchema)]
pub struct ProfileParams {
    /// A profile on this Mac ("Marcus1"), or an account on a host ("xjopa1/marcus1").
    pub profile: String,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct ListSessionsParams {
    /// A profile on this Mac ("Marcus1"), or an account on a host ("xjopa1/marcus1").
    pub profile: String,
    /// List archived sessions instead of the live ones.
    #[serde(default)]
    pub archived: bool,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct HostParams {
    /// A paired host, by its label or host name ("xjopa1").
    pub host: String,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct FoldersParams {
    /// A paired host, by its label or host name ("xjopa1").
    pub host: String,
    /// The folder to list; the account's home when left out.
    pub path: Option<String>,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct SessionParams {
    /// A profile on this Mac ("Marcus1"), or an account on a host ("xjopa1/marcus1").
    pub profile: String,
    /// The session's id, an id prefix of 8+ characters, or its exact title.
    pub session: String,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct NewSessionParams {
    /// An account on a host ("xjopa1/marcus1").
    pub profile: String,
    /// The folder on the host to start in, absolute or ~-relative.
    pub folder: String,
    /// The session's name, shown in Remote Control and tmux. The folder's name when left out.
    pub name: Option<String>,
    /// Answer Claude's "do you trust this folder?" for it. Remote Control can't connect until it's answered. Default true.
    pub trust_folder: Option<bool>,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct RenameParams {
    /// An account on a host ("xjopa1/marcus1").
    pub profile: String,
    /// The session's id, an id prefix of 8+ characters, or its exact title.
    pub session: String,
    /// The new name.
    pub name: String,
}

#[derive(Debug, Deserialize, JsonSchema)]
#[serde(untagged)]
pub enum KeyParam {
    /// A named key, as tmux knows it: Enter, Escape, Tab, Up, Down, Left, Right, BSpace, C-c.
    Key { key: String },
    /// Literal text, typed as is. Send {"key": "Enter"} after it to submit.
    Text { text: String },
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct SendKeysParams {
    /// An account on a host ("xjopa1/marcus1").
    pub profile: String,
    /// The session's id, an id prefix of 8+ characters, or its exact title. It must be running.
    pub session: String,
    /// What to send, in order.
    pub keys: Vec<KeyParam>,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct FinishSignInParams {
    /// The profile on a host that switch_account signed out ("xjopa1/marcus1").
    pub profile: String,
    /// The login_id switch_account returned.
    pub login_id: String,
    /// The code the sign-in page showed after signing in.
    pub code: String,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct PlanMoveParams {
    /// Where the session is now: a profile on this Mac, or an account on a host.
    pub profile: String,
    /// The session's id, an id prefix of 8+ characters, or its exact title.
    pub session: String,
    /// Where it goes: another profile on this Mac, or another account on the same host ("marcus2" or "xjopa1/marcus2").
    pub to: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum Pick {
    /// The note as the source has it.
    Source,
    /// The note as the destination has it.
    Destination,
    /// Whichever side changed it last.
    Newer,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, JsonSchema)]
#[serde(untagged)]
pub enum MemoryChoice {
    Pick(Pick),
    /// Your own merge of the two texts plan_move showed.
    Merged {
        merged: String,
    },
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Deserialize, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum Afterwards {
    /// Archive the copy left behind (compressed, can be restored). The default.
    #[default]
    Archive,
    /// Delete it, once the moved copy checks out identical. Can't be undone.
    Delete,
    /// Keep it: both profiles list the session.
    Keep,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct MoveParams {
    /// Where the session is now: a profile on this Mac, or an account on a host.
    pub profile: String,
    /// The session's id, an id prefix of 8+ characters, or its exact title.
    pub session: String,
    /// Where it goes: another profile on this Mac, or another account on the same host.
    pub to: String,
    /// On a host: one decision per memory note plan_move lists as a conflict, by its path: "source", "destination", "newer", or {"merged": "<text>"}.
    #[serde(default)]
    pub memory: HashMap<String, MemoryChoice>,
    /// What happens to the copy left behind. Default archive; on this Mac always archive.
    #[serde(default)]
    pub afterwards: Afterwards,
    /// On a host: resume the session under the destination account afterwards, with Remote Control on. Default true.
    pub resume: Option<bool>,
    /// On this Mac: quit the Claude apps the plan says hold the session. Default false.
    #[serde(default)]
    pub quit_apps: bool,
    /// Go ahead although the destination's copy is newer than the source's. Default false.
    #[serde(default)]
    pub replace_newer: bool,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct ArchiveParams {
    /// A profile on this Mac, or an account on a host.
    pub profile: String,
    /// The session's id, an id prefix of 8+ characters, or its exact title.
    pub session: String,
    /// On this Mac: quit the Claude app that holds the session first. Default false.
    #[serde(default)]
    pub quit_app: bool,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct RestoreParams {
    /// A profile on this Mac, or an account on a host.
    pub profile: String,
    /// The archived session's id, an id prefix of 8+ characters, or its title.
    pub session: String,
    /// On a host: which archive of it, as list_sessions with archived=true shows it. The latest when left out.
    pub archive: Option<String>,
    /// On this Mac: quit the Claude app that lists the session first. Default false.
    #[serde(default)]
    pub quit_app: bool,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct DeleteArchiveParams {
    /// A profile on this Mac, or an account on a host.
    pub profile: String,
    /// The archived session's id, an id prefix of 8+ characters, or its title.
    pub session: String,
    /// Which archive of it, as list_sessions with archived=true shows it.
    pub archive: String,
}

// ---- Tools ----------------------------------------------------------------

#[tool_router]
impl AiProfiles {
    #[tool(
        description = "Every profile: the Claude and ChatGPT profiles on this Mac, with the account each is signed in to, and each paired host's Claude Code accounts with their session counts.",
        annotations(read_only_hint = true, open_world_hint = false)
    )]
    async fn list_profiles(&self) -> Result<CallToolResult, McpError> {
        reply(list_profiles().await)
    }

    #[tool(
        description = "A profile's plan usage on this Mac: its 5-hour and weekly windows and when they reset.",
        annotations(read_only_hint = true)
    )]
    async fn get_usage(
        &self,
        Parameters(params): Parameters<ProfileParams>,
    ) -> Result<CallToolResult, McpError> {
        reply(get_usage(&params.profile).await)
    }

    #[tool(
        description = "A profile's Claude Code sessions: title, folder, when, whether it's running. On a host also its Remote Control link, whether it waits on input, and whether it waits on a restart to take an installed update (updatePending, with the installedVersion it would restart on).",
        annotations(read_only_hint = true)
    )]
    async fn list_sessions(
        &self,
        Parameters(params): Parameters<ListSessionsParams>,
    ) -> Result<CallToolResult, McpError> {
        reply(list_sessions(&params.profile, params.archived).await)
    }

    #[tool(
        description = "A host's machine: its name, Claude Code and tmux versions, and where its accounts live.",
        annotations(read_only_hint = true)
    )]
    async fn host_info(
        &self,
        Parameters(params): Parameters<HostParams>,
    ) -> Result<CallToolResult, McpError> {
        reply(host_info(&params.host).await)
    }

    #[tool(
        description = "The folders in a folder on a host, to pick where a new session starts.",
        annotations(read_only_hint = true)
    )]
    async fn list_folders(
        &self,
        Parameters(params): Parameters<FoldersParams>,
    ) -> Result<CallToolResult, McpError> {
        reply(list_folders(&params.host, params.path.as_deref()).await)
    }

    #[tool(
        description = "Start a Claude Code session on a host, in its own tmux window with Remote Control on, so it shows up in the Claude apps. Reports anything it stopped at (attention), and the Remote Control name.",
        annotations(read_only_hint = false, destructive_hint = false)
    )]
    async fn new_session(
        &self,
        Parameters(params): Parameters<NewSessionParams>,
    ) -> Result<CallToolResult, McpError> {
        reply(new_session(params).await)
    }

    #[tool(
        description = "Resume a session on a host, in tmux with Remote Control on. A running one is left as it is.",
        annotations(read_only_hint = false, destructive_hint = false)
    )]
    async fn resume_session(
        &self,
        Parameters(params): Parameters<SessionParams>,
    ) -> Result<CallToolResult, McpError> {
        reply(launch(&params.profile, &params.session, Launch::Resume).await)
    }

    #[tool(
        description = "Restart a running session on a host: it exits and comes back in the same conversation, on the Claude Code version now installed.",
        annotations(read_only_hint = false, destructive_hint = false)
    )]
    async fn restart_session(
        &self,
        Parameters(params): Parameters<SessionParams>,
    ) -> Result<CallToolResult, McpError> {
        reply(launch(&params.profile, &params.session, Launch::Restart).await)
    }

    #[tool(
        description = "Restart every running session of an account on a host that waits on a restart to take an installed Claude Code update, one at a time.",
        annotations(read_only_hint = false, destructive_hint = false)
    )]
    async fn restart_outdated(
        &self,
        Parameters(params): Parameters<ProfileParams>,
    ) -> Result<CallToolResult, McpError> {
        reply(restart_outdated(&params.profile).await)
    }

    #[tool(
        description = "Stop a running session on a host: Claude exits and its tmux window closes. The conversation stays, and can be resumed.",
        annotations(read_only_hint = false, destructive_hint = true)
    )]
    async fn stop_session(
        &self,
        Parameters(params): Parameters<SessionParams>,
    ) -> Result<CallToolResult, McpError> {
        reply(stop_session(&params.profile, &params.session).await)
    }

    #[tool(
        description = "Rename a session on a host. The name follows it to Remote Control and tmux.",
        annotations(read_only_hint = false, destructive_hint = false)
    )]
    async fn rename_session(
        &self,
        Parameters(params): Parameters<RenameParams>,
    ) -> Result<CallToolResult, McpError> {
        reply(rename_session(params).await)
    }

    #[tool(
        description = "What a running session's tmux window shows right now, as text: to see why a session didn't start cleanly, or what it's asking.",
        annotations(read_only_hint = true)
    )]
    async fn read_window(
        &self,
        Parameters(params): Parameters<SessionParams>,
    ) -> Result<CallToolResult, McpError> {
        reply(read_window(&params.profile, &params.session).await)
    }

    #[tool(
        description = "Type into a running session's tmux window: named keys and literal text, in order. Returns what the window shows afterwards.",
        annotations(read_only_hint = false, destructive_hint = true)
    )]
    async fn send_to_window(
        &self,
        Parameters(params): Parameters<SendKeysParams>,
    ) -> Result<CallToolResult, McpError> {
        reply(send_to_window(params).await)
    }

    #[tool(
        description = "Open a host session's Remote Control conversation on this Mac: in the Claude app of the profile signed in to the same account, else on claude.ai. Also returns the link, for the phone.",
        annotations(read_only_hint = false, destructive_hint = false)
    )]
    async fn open_in_claude(
        &self,
        Parameters(params): Parameters<SessionParams>,
    ) -> Result<CallToolResult, McpError> {
        reply(open_session_in_claude(&params.profile, &params.session).await)
    }

    #[tool(
        description = "Open a profile's Claude or ChatGPT desktop app on this Mac, or bring it forward if it's running.",
        annotations(read_only_hint = false, destructive_hint = false)
    )]
    async fn open_profile(
        &self,
        Parameters(params): Parameters<ProfileParams>,
    ) -> Result<CallToolResult, McpError> {
        reply(open_profile(&params.profile).await)
    }

    #[tool(
        description = "Switch a profile on a host to another Claude account (personal, work, a client's): its running sessions stop, it signs out, and a sign-in page opens in this Mac's browser. Sign in there as the other account, then pass the code the page shows to finish_sign_in; the same sessions then resume under the new account, with Remote Control on. Nothing moves, and other profiles aren't touched.",
        annotations(read_only_hint = false, destructive_hint = true)
    )]
    async fn switch_account(
        &self,
        Parameters(params): Parameters<ProfileParams>,
    ) -> Result<CallToolResult, McpError> {
        reply(switch_account(&params.profile).await)
    }

    #[tool(
        description = "Finish a switch_account (or any sign-in on a host): hand over the code the sign-in page showed. Says which account the profile is now signed in to, and how many sessions are resuming.",
        annotations(read_only_hint = false, destructive_hint = false)
    )]
    async fn finish_sign_in(
        &self,
        Parameters(params): Parameters<FinishSignInParams>,
    ) -> Result<CallToolResult, McpError> {
        reply(finish_sign_in(params).await)
    }

    #[tool(
        description = "What moving a session to another profile would do: the files it copies or replaces, anything in the way, and apps to quit. On a host also the memory notes both sides changed (with both texts), each needing a decision in move_session; on this Mac the destination keeps its own copy of those.",
        annotations(read_only_hint = true)
    )]
    async fn plan_move(
        &self,
        Parameters(params): Parameters<PlanMoveParams>,
    ) -> Result<CallToolResult, McpError> {
        reply(plan_move(params).await)
    }

    #[tool(
        description = "Move a session to another profile on this Mac, or another account on the same host: transcript, subagents, file history and plans, with project memory merged. Anything replaced is backed up, and the copy left behind is archived. Call plan_move first.",
        annotations(read_only_hint = false, destructive_hint = true)
    )]
    async fn move_session(
        &self,
        Parameters(params): Parameters<MoveParams>,
    ) -> Result<CallToolResult, McpError> {
        reply(move_session(params).await)
    }

    #[tool(
        description = "Archive a session: take it out of the profile's list, compressed, so it can be restored later.",
        annotations(read_only_hint = false, destructive_hint = false)
    )]
    async fn archive_session(
        &self,
        Parameters(params): Parameters<ArchiveParams>,
    ) -> Result<CallToolResult, McpError> {
        reply(archive_session(params).await)
    }

    #[tool(
        description = "Restore an archived session, so the profile lists it again.",
        annotations(read_only_hint = false, destructive_hint = false)
    )]
    async fn restore_session(
        &self,
        Parameters(params): Parameters<RestoreParams>,
    ) -> Result<CallToolResult, McpError> {
        reply(restore_session(params).await)
    }

    #[tool(
        description = "Delete one archive of a session on a host for good, freeing its space. Can't be undone.",
        annotations(read_only_hint = false, destructive_hint = true)
    )]
    async fn delete_archive(
        &self,
        Parameters(params): Parameters<DeleteArchiveParams>,
    ) -> Result<CallToolResult, McpError> {
        reply(delete_archive(params).await)
    }
}

#[tool_handler(router = self.tool_router)]
impl ServerHandler for AiProfiles {
    fn get_info(&self) -> ServerConfig {
        ServerConfig::new(ServerCapabilities::builder().enable_tools().build())
            .with_server_info(Implementation::new(
                "remote-control-conductor",
                env!("CARGO_PKG_VERSION"),
            ))
            .with_instructions(INSTRUCTIONS)
    }
}

// ---- Plumbing -------------------------------------------------------------

fn reply(outcome: Outcome) -> Result<CallToolResult, McpError> {
    Ok(match outcome {
        Ok(value) => CallToolResult::success(vec![ContentBlock::text(
            serde_json::to_string_pretty(&without_nulls(value)).unwrap_or_default(),
        )]),
        Err(message) => CallToolResult::error(vec![ContentBlock::text(message)]),
    })
}

/// Pure: `value` without its null fields, which only cost Claude tokens.
fn without_nulls(value: Value) -> Value {
    match value {
        Value::Object(map) => Value::Object(
            map.into_iter()
                .filter(|(_, value)| !value.is_null())
                .map(|(key, value)| (key, without_nulls(value)))
                .collect(),
        ),
        Value::Array(items) => Value::Array(items.into_iter().map(without_nulls).collect()),
        other => other,
    }
}

/// A sentence for Claude, from the app's error.
fn why(error: AppError) -> String {
    match error {
        AppError::Remote { code, message } => format!("{message} ({code})"),
        other => other.message(),
    }
}

fn to_json(value: impl serde::Serialize) -> Outcome {
    serde_json::to_value(value).map_err(|err| err.to_string())
}

/// Run blocking work (the local session code reads and writes files, and
/// can wait on an app to quit) off the async threads.
async fn blocking<T: Send + 'static>(
    work: impl FnOnce() -> AppResult<T> + Send + 'static,
) -> Result<T, String> {
    tokio::task::spawn_blocking(work)
        .await
        .map_err(|err| format!("it stopped unexpectedly: {err}"))?
        .map_err(why)
}

fn hosts() -> Result<Vec<RemoteHost>, String> {
    HostList::default_list()
        .and_then(|list| list.load())
        .map_err(why)
}

fn host_list() -> Result<HostList, String> {
    HostList::default_list().map_err(why)
}

/// A profile on this Mac, with what `list_profiles` says about it.
pub(super) struct LocalEntry {
    pub(super) profile: LocalProfile,
    pub(super) app: AppKind,
    pub(super) desktop: bool,
    pub(super) cli: bool,
}

/// Every profile on this Mac: the stock installs first, as the sidebar
/// orders them, then the managed profiles.
pub(super) fn local_entries() -> AppResult<Vec<LocalEntry>> {
    let names = crate::app_state::load()
        .map(|state| state.default_profile_names)
        .unwrap_or_default();
    let mut entries = Vec::new();
    for kind in [AppKind::Claude, AppKind::Codex] {
        let Ok(install) = crate::commands::detect_existing_install(kind) else {
            continue;
        };
        let (desktop, cli) = (install.gui_path.is_some(), install.cli_path.is_some());
        if !desktop && !cli {
            continue;
        }
        let app_name = kind.spec().display_name;
        let name = names.get(&kind).cloned().unwrap_or_else(|| match kind {
            AppKind::Claude => "Default".to_owned(),
            AppKind::Codex => format!("Default ({app_name})"),
        });
        let mut aliases = vec![format!("Default {app_name}"), app_name.to_owned()];
        if kind == AppKind::Claude {
            aliases.push("Default".to_owned());
        }
        entries.push(LocalEntry {
            profile: LocalProfile {
                id: crate::app_kind::default_id(kind),
                name,
                aliases,
            },
            app: kind,
            desktop,
            cli,
        });
    }
    for profile in crate::profiles::load()? {
        entries.push(LocalEntry {
            profile: LocalProfile {
                id: profile.id.clone(),
                name: profile.name.clone(),
                aliases: vec![profile.slug.clone()],
            },
            app: profile.app,
            desktop: profile.surfaces.gui,
            cli: profile.surfaces.cli,
        });
    }
    Ok(entries)
}

async fn target(reference: &str) -> Result<Target, String> {
    let locals = blocking(local_entries)
        .await?
        .into_iter()
        .map(|entry| entry.profile)
        .collect::<Vec<_>>();
    refs::profile(reference, &locals, &hosts()?)
}

/// For tools that only work on a host.
async fn remote_target(reference: &str) -> Result<(String, String, String), String> {
    match target(reference).await? {
        Target::Remote {
            host_id,
            host_label,
            account,
        } => Ok((host_id, host_label, account)),
        Target::Local { name, .. } => Err(format!(
            "{name} is a profile on this Mac: this works on an account on a host (host/account)."
        )),
    }
}

async fn remote_sessions(host_id: &str, account: &str) -> Result<Vec<RemoteSession>, String> {
    remote::sessions(&host_list()?, secrets::store(), host_id, account)
        .await
        .map_err(why)
}

async fn remote_session(
    host_id: &str,
    account: &str,
    reference: &str,
) -> Result<RemoteSession, String> {
    let all = remote_sessions(host_id, account).await?;
    let names: Vec<SessionName> = all
        .iter()
        .map(|session| SessionName {
            id: &session.id,
            title: session.title.as_deref(),
        })
        .collect();
    let id = refs::session(reference, &names)?;
    Ok(all
        .into_iter()
        .find(|session| session.id == id)
        .expect("the session just resolved"))
}

/// The sessions of profile `profile_id` on this Mac, active and archived.
async fn local_sessions(profile_id: &str) -> Result<sessions::SessionList, String> {
    sessions::list_sessions(sessions::home_for(profile_id).map_err(why)?)
        .await
        .map_err(why)
}

/// The id of the session `reference` names among profile `profile_id`'s
/// archived sessions, or its active ones.
async fn local_session_id(
    profile_id: &str,
    reference: &str,
    archived: bool,
) -> Result<String, String> {
    let all = local_sessions(profile_id).await?.sessions;
    let names: Vec<SessionName> = all
        .iter()
        .filter(|session| session.archived == archived)
        .map(|session| SessionName {
            id: &session.id,
            title: session.title.as_deref(),
        })
        .collect();
    refs::session(reference, &names)
}

/// Pure: a host session, as the tools show it.
fn remote_session_json(session: &RemoteSession) -> Value {
    let link = session
        .bridge_session_id
        .as_deref()
        .and_then(|bridge| open_in_claude::links(bridge).ok())
        .map(|(_, web)| web);
    json!({
        "id": session.id,
        "title": session.title,
        "folder": session.cwd,
        "updated": session.updated_at,
        "running": session.running,
        "waitingForInput": session.running.then_some(session.waiting),
        "remoteControl": session.running.then_some(session.remote_control),
        "link": link,
        "claudeVersion": session.claude_version,
        "updatePending": session.update_pending.then_some(true),
        "installedVersion": session.installed_version,
        "window": session.window.as_ref().map(|window| &window.window_id),
        "empty": session.empty.then_some(true),
        "sizeBytes": session.size_bytes,
    })
}

// ---- Handlers -------------------------------------------------------------

async fn list_profiles() -> Outcome {
    let local = blocking(|| {
        let entries = local_entries()?;
        Ok(entries
            .into_iter()
            .map(|entry| {
                let account = (entry.app == AppKind::Claude)
                    .then(|| crate::accounts::read(&entry.profile.id).ok())
                    .flatten()
                    .and_then(|status| match status {
                        AccountStatus::SignedIn { account } => serde_json::to_value(account).ok(),
                        AccountStatus::SignedOut => Some(json!("signed out")),
                        AccountStatus::Unknown => None,
                    });
                json!({
                    "profile": entry.profile.name,
                    "id": entry.profile.id,
                    "app": entry.app,
                    "account": account,
                    "desktop": entry.desktop,
                    "cli": entry.cli,
                })
            })
            .collect::<Vec<_>>())
    })
    .await?;

    let mut tasks = tokio::task::JoinSet::new();
    for (index, host) in hosts()?.into_iter().enumerate() {
        tasks.spawn(async move {
            let accounts = async {
                let list = HostList::default_list()?;
                remote::accounts(&list, secrets::store(), &host.id).await
            };
            let answer = tokio::time::timeout(HOST_TIMEOUT, accounts).await;
            let value = match answer {
                Ok(Ok(accounts)) => json!({
                    "host": host.label,
                    "online": true,
                    "accounts": accounts.iter().map(|account| json!({
                        "profile": format!("{}/{}", host.label, account.name),
                        "account": account.account,
                        "signedIn": account.signed_in,
                        "sessions": account.sessions,
                        "running": account.running_sessions,
                    })).collect::<Vec<_>>(),
                }),
                Ok(Err(error)) => {
                    json!({ "host": host.label, "online": false, "error": why(error) })
                }
                Err(_) => json!({ "host": host.label, "online": false, "error": "no answer" }),
            };
            (index, value)
        });
    }
    let mut remote: Vec<(usize, Value)> = tasks.join_all().await;
    remote.sort_by_key(|(index, _)| *index);
    Ok(json!({
        "local": local,
        "hosts": remote.into_iter().map(|(_, value)| value).collect::<Vec<_>>(),
    }))
}

async fn get_usage(reference: &str) -> Outcome {
    match target(reference).await? {
        Target::Local { id, .. } => {
            to_json(crate::commands::get_profile_usage(id).await.map_err(why)?)
        }
        Target::Remote { .. } => Err("Usage is only known for profiles on this Mac.".to_owned()),
    }
}

async fn list_sessions(reference: &str, archived: bool) -> Outcome {
    match target(reference).await? {
        Target::Local { id, .. } => Ok(Value::Array(
            local_sessions(&id)
                .await?
                .sessions
                .into_iter()
                .filter(|session| session.archived == archived)
                .map(|session| {
                    json!({
                        "id": session.id,
                        "title": session.title,
                        "folder": session.cwd,
                        "updated": session.last_used_at,
                        "kind": session.kind,
                        "state": session.state,
                        "needsRepair": session.needs_repair.then_some(true),
                        "unmovable": session.unmovable_reason,
                    })
                })
                .collect(),
        )),
        Target::Remote {
            host_id, account, ..
        } => {
            if archived {
                return to_json(
                    remote::archived(&host_list()?, secrets::store(), &host_id, &account)
                        .await
                        .map_err(why)?,
                );
            }
            Ok(Value::Array(
                remote_sessions(&host_id, &account)
                    .await?
                    .iter()
                    .map(remote_session_json)
                    .collect(),
            ))
        }
    }
}

async fn host_info(name: &str) -> Outcome {
    let all = hosts()?;
    let host = refs::remote_host(name, &all)?;
    to_json(
        remote::info(&host_list()?, secrets::store(), &host.id)
            .await
            .map_err(why)?,
    )
}

async fn list_folders(name: &str, path: Option<&str>) -> Outcome {
    let all = hosts()?;
    let host = refs::remote_host(name, &all)?;
    to_json(
        remote::dirs(&host_list()?, secrets::store(), &host.id, path)
            .await
            .map_err(why)?,
    )
}

async fn new_session(params: NewSessionParams) -> Outcome {
    let (host_id, _, account) = remote_target(&params.profile).await?;
    let request = NewSessionRequest {
        cwd: params.folder,
        name: params.name.filter(|name| !name.trim().is_empty()),
        trust_folder: params.trust_folder.unwrap_or(true),
    };
    to_json(
        remote::new_session(
            &host_list()?,
            secrets::store(),
            &host_id,
            &account,
            &request,
        )
        .await
        .map_err(why)?,
    )
}

#[derive(Debug, Clone, Copy)]
enum Launch {
    Resume,
    Restart,
}

async fn launch(reference: &str, session: &str, how: Launch) -> Outcome {
    let (host_id, _, account) = remote_target(reference).await?;
    let found = remote_session(&host_id, &account, session).await?;
    let list = host_list()?;
    let result = match how {
        Launch::Resume => {
            remote::resume(&list, secrets::store(), &host_id, &account, &found.id, true).await
        }
        Launch::Restart => {
            if !found.running {
                return Err(format!(
                    "{} isn't running: resume it instead.",
                    found.title.as_deref().unwrap_or(&found.id)
                ));
            }
            remote::restart(&list, secrets::store(), &host_id, &account, &found.id, true).await
        }
    };
    to_json(result.map_err(why)?)
}

async fn restart_outdated(reference: &str) -> Outcome {
    let (host_id, _, account) = remote_target(reference).await?;
    let outdated: Vec<RemoteSession> = remote_sessions(&host_id, &account)
        .await?
        .into_iter()
        .filter(|session| session.running && session.update_pending)
        .collect();
    let list = host_list()?;
    let mut results = Vec::new();
    for session in outdated {
        let title = session.title.clone().unwrap_or_else(|| session.id.clone());
        let outcome = remote::restart(
            &list,
            secrets::store(),
            &host_id,
            &account,
            &session.id,
            true,
        )
        .await;
        results.push(match outcome {
            Ok(launch) => {
                json!({ "session": title, "restarted": true, "attention": launch.attention })
            }
            Err(error) => json!({ "session": title, "restarted": false, "error": why(error) }),
        });
    }
    Ok(
        json!({ "restarted": results.iter().filter(|result| result["restarted"] == true).count(), "sessions": results }),
    )
}

async fn stop_session(reference: &str, session: &str) -> Outcome {
    let (host_id, _, account) = remote_target(reference).await?;
    let found = remote_session(&host_id, &account, session).await?;
    to_json(
        remote::stop(
            &host_list()?,
            secrets::store(),
            &host_id,
            &account,
            &found.id,
        )
        .await
        .map_err(why)?,
    )
}

async fn rename_session(params: RenameParams) -> Outcome {
    let (host_id, _, account) = remote_target(&params.profile).await?;
    let found = remote_session(&host_id, &account, &params.session).await?;
    to_json(
        remote::rename_session(
            &host_list()?,
            secrets::store(),
            &host_id,
            &account,
            &found.id,
            &params.name,
        )
        .await
        .map_err(why)?,
    )
}

/// The tmux window of a running session, as `@N`.
fn window_of(session: &RemoteSession) -> Result<String, String> {
    session
        .window
        .as_ref()
        .filter(|_| session.running)
        .map(|window| window.window_id.clone())
        .ok_or_else(|| {
            format!(
                "{} isn't running in a tmux window.",
                session.title.as_deref().unwrap_or(&session.id)
            )
        })
}

async fn read_window(reference: &str, session: &str) -> Outcome {
    let (host_id, _, account) = remote_target(reference).await?;
    let found = remote_session(&host_id, &account, session).await?;
    let window = window_of(&found)?;
    let screen =
        remote::window_screen(&host_list()?, secrets::store(), &host_id, &account, &window)
            .await
            .map_err(why)?;
    Ok(json!({ "window": window, "screen": screen.text }))
}

async fn send_to_window(params: SendKeysParams) -> Outcome {
    if params.keys.is_empty() {
        return Err("Say what to send: keys, text, or both.".to_owned());
    }
    let (host_id, _, account) = remote_target(&params.profile).await?;
    let found = remote_session(&host_id, &account, &params.session).await?;
    let window = window_of(&found)?;
    let keys: Vec<WindowKey> = params
        .keys
        .into_iter()
        .map(|key| match key {
            KeyParam::Key { key } => WindowKey::Key(key),
            KeyParam::Text { text } => WindowKey::Text(text),
        })
        .collect();
    let screen = remote::window_keys(
        &host_list()?,
        secrets::store(),
        &host_id,
        &account,
        &window,
        keys,
    )
    .await
    .map_err(why)?;
    Ok(json!({ "window": window, "screen": screen.text }))
}

async fn open_session_in_claude(reference: &str, session: &str) -> Outcome {
    let (host_id, _, account) = remote_target(reference).await?;
    let found = remote_session(&host_id, &account, session).await?;
    let bridge = found.bridge_session_id.clone().ok_or_else(|| {
        format!(
            "{} has no Remote Control conversation: it isn't running, or it hasn't connected yet.",
            found.title.as_deref().unwrap_or(&found.id)
        )
    })?;
    let email = remote::accounts(&host_list()?, secrets::store(), &host_id)
        .await
        .map_err(why)?
        .into_iter()
        .find(|candidate| candidate.name == account)
        .and_then(|candidate| candidate.account)
        .and_then(|signed_in| signed_in.email);
    let (_, web) = open_in_claude::links(&bridge).map_err(why)?;
    let opened = blocking(move || {
        open_in_claude::open_in_claude(email.as_deref(), &bridge, env!("CARGO_PKG_VERSION"), None)
    })
    .await?;
    Ok(
        json!({ "openedIn": opened.app.unwrap_or_else(|| "claude.ai".to_owned()), "note": opened.note, "link": web }),
    )
}

async fn open_profile(reference: &str) -> Outcome {
    let Target::Local { id, name } = target(reference).await? else {
        return Err(
            "An account on a host has no desktop app: open_in_claude opens one of its sessions."
                .to_owned(),
        );
    };
    let opened_id = id.clone();
    blocking(move || match AppKind::from_default_id(&opened_id) {
        Some(kind) => {
            let install = crate::commands::detect_existing_install(kind)?;
            let data_dir = install.gui_path.ok_or_else(|| {
                AppError::Validation("the stock install has no desktop app".into())
            })?;
            let app_spec = kind.spec();
            crate::launch::focus_or_launch(&data_dir, app_spec, crate::launch::focus_pid, || {
                crate::launch::open_new_instance(&data_dir, app_spec, None)?;
                crate::launch::wait_for_new_instance(&data_dir, app_spec);
                Ok(())
            })
        }
        None => crate::cli::open_profile(&opened_id).map_err(AppError::Validation),
    })
    .await?;
    Ok(json!({ "opened": name }))
}

/// Pure: the decisions a move is sent with, one per conflict in `memory`,
/// from what Claude chose. `newer` is settled here, the way the app's own
/// dialog settles it. Every conflict needs a choice.
fn decisions(
    memory: &[TransferMemoryFile],
    choices: &HashMap<String, MemoryChoice>,
) -> Result<HashMap<String, Decision>, String> {
    let conflicts: Vec<&TransferMemoryFile> = memory
        .iter()
        .filter(|file| file.action == MemoryAction::Conflict)
        .collect();
    let undecided: Vec<&str> = conflicts
        .iter()
        .filter(|file| !choices.contains_key(&file.path))
        .map(|file| file.path.as_str())
        .collect();
    if !undecided.is_empty() {
        return Err(format!(
            "Both sides changed these memory notes, and each needs a decision in `memory` (\"source\", \"destination\", \"newer\", or {{\"merged\": \"...\"}}): {}.",
            undecided.join(", ")
        ));
    }
    let unknown: Vec<&str> = choices
        .keys()
        .filter(|path| !conflicts.iter().any(|file| &file.path == *path))
        .map(String::as_str)
        .collect();
    if !unknown.is_empty() {
        return Err(format!(
            "These aren't memory conflicts in this move: {}. plan_move lists the ones that are.",
            unknown.join(", ")
        ));
    }
    Ok(conflicts
        .into_iter()
        .map(|file| {
            let decision = match &choices[&file.path] {
                MemoryChoice::Pick(Pick::Source) => Decision::Source,
                MemoryChoice::Pick(Pick::Destination) => Decision::Destination,
                MemoryChoice::Pick(Pick::Newer) => match file.newer {
                    Side::Source => Decision::Source,
                    Side::Destination => Decision::Destination,
                },
                MemoryChoice::Merged { merged } => Decision::Merged(merged.clone()),
            };
            (file.path.clone(), decision)
        })
        .collect())
}

/// Where a move goes, checked to be one the app can make.
enum MoveEnds {
    Local {
        from: String,
        to: String,
    },
    Remote {
        host_id: String,
        from: String,
        to: String,
    },
}

async fn move_ends(profile: &str, to: &str) -> Result<MoveEnds, String> {
    match target(profile).await? {
        Target::Local { id, .. } => match target(to).await? {
            Target::Local { id: destination, .. } => Ok(MoveEnds::Local {
                from: id,
                to: destination,
            }),
            Target::Remote { .. } => Err(
                "A session moves between profiles on this Mac, or between accounts on one host: not from this Mac to a host.".to_owned(),
            ),
        },
        Target::Remote {
            host_id,
            host_label,
            account,
        } => {
            let destination = match to.split_once('/') {
                None => to.trim().to_owned(),
                Some(_) => match target(to).await? {
                    Target::Remote {
                        host_id: to_host,
                        account: to_account,
                        ..
                    } if to_host == host_id => to_account,
                    _ => {
                        return Err(format!(
                            "A session on {host_label} moves to another account on {host_label}: sessions don't move between hosts, or to this Mac."
                        ))
                    }
                },
            };
            Ok(MoveEnds::Remote {
                host_id,
                from: account,
                to: destination,
            })
        }
    }
}

async fn switch_account(reference: &str) -> Outcome {
    let (host_id, host_label, account) = remote_target(reference).await?;
    let list = host_list()?;
    let before = remote::accounts(&list, secrets::store(), &host_id)
        .await
        .map_err(why)?
        .into_iter()
        .find(|found| found.name == account)
        .ok_or_else(|| format!("{host_label} has no profile called {account}."))?;
    let signed_out = remote::logout(&list, secrets::store(), &host_id, &account, true, true)
        .await
        .map_err(why)?;
    let started = remote::start_login(&list, secrets::store(), &host_id, &account, true)
        .await
        .map_err(why)?;
    Ok(json!({
        "profile": format!("{host_label}/{account}"),
        "wasSignedInAs": before.account.as_ref().and_then(|signed| signed.email.clone()),
        "stoppedSessions": signed_out.stopped_ids,
        "signIn": {
            "loginId": started.login_id,
            "url": started.url,
            "expiresAt": started.expires_at,
        },
        "next": "The sign-in page is open in this Mac's browser. Sign in there as the account to switch to (if claude.ai shows the old one, switch it first), then call finish_sign_in with the code the page shows.",
    }))
}

async fn finish_sign_in(params: FinishSignInParams) -> Outcome {
    let (host_id, host_label, account) = remote_target(&params.profile).await?;
    let signed = remote::submit_login(
        &host_list()?,
        secrets::store(),
        &host_id,
        &params.login_id,
        &params.code,
    )
    .await
    .map_err(why)?;
    Ok(json!({
        "profile": format!("{host_label}/{account}"),
        "signedInAs": signed.account.as_ref().and_then(|signed| signed.email.clone()),
        "plan": signed.account.as_ref().and_then(|signed| signed.plan.clone()),
        "resumingSessions": signed.pending_resume,
    }))
}

async fn plan_move(params: PlanMoveParams) -> Outcome {
    match move_ends(&params.profile, &params.to).await? {
        MoveEnds::Local { from, to } => {
            let session_id = local_session_id(&from, &params.session, false).await?;
            to_json(
                sessions::actions::plan_move(&from, &session_id, &to)
                    .await
                    .map_err(why)?,
            )
        }
        MoveEnds::Remote { host_id, from, to } => {
            let found = remote_session(&host_id, &from, &params.session).await?;
            to_json(
                remote::transfer_plan(
                    &host_list()?,
                    secrets::store(),
                    &host_id,
                    &from,
                    &found.id,
                    &to,
                )
                .await
                .map_err(why)?,
            )
        }
    }
}

async fn move_session(params: MoveParams) -> Outcome {
    let archive_source = params.afterwards == Afterwards::Archive;
    let delete_source = params.afterwards == Afterwards::Delete;
    match move_ends(&params.profile, &params.to).await? {
        MoveEnds::Local { from, to } => {
            // A move on this Mac copies the session, then archives it at the
            // source, so Restore undoes it.
            if params.afterwards != Afterwards::Archive {
                return Err("On this Mac a move always archives the session it leaves behind, so it can be restored.".to_owned());
            }
            let session_id = local_session_id(&from, &params.session, false).await?;
            let plan = sessions::actions::plan_move(&from, &session_id, &to)
                .await
                .map_err(why)?;
            if !plan.blockers.is_empty() {
                return Err(plan.blockers.join(" "));
            }
            if plan.destination_newer && !params.replace_newer {
                return Err(format!(
                    "{to}'s copy of this session is newer than {from}'s: moving would roll it back there. Pass replace_newer to go ahead anyway."
                ));
            }
            to_json(
                sessions::actions::move_session(
                    &from,
                    &session_id,
                    &to,
                    params.replace_newer,
                    params.quit_apps,
                )
                .await
                .map_err(why)?,
            )
        }
        MoveEnds::Remote { host_id, from, to } => {
            let found = remote_session(&host_id, &from, &params.session).await?;
            let list = host_list()?;
            let plan =
                remote::transfer_plan(&list, secrets::store(), &host_id, &from, &found.id, &to)
                    .await
                    .map_err(why)?;
            if plan.destination_newer && !params.replace_newer {
                return Err(format!(
                    "{to}'s copy of this session is newer than {from}'s: moving would roll it back there. Pass replace_newer to go ahead anyway."
                ));
            }
            let request = RemoteTransferRequest {
                to: to.clone(),
                // Exited first, so the whole conversation goes, as the app's dialog does.
                stop_first: plan.running.iter().any(|running| running.exact),
                replace_newer: params.replace_newer,
                confirm_running: false,
                memory: decisions(&plan.memory, &params.memory)?,
                archive_source,
                delete_source,
                resume: params.resume.unwrap_or(true),
                trust_folder: true,
                progress_id: None,
            };
            to_json(
                remote::transfer(
                    &list,
                    secrets::store(),
                    &host_id,
                    &from,
                    &found.id,
                    &request,
                )
                .await
                .map_err(why)?,
            )
        }
    }
}

async fn archive_session(params: ArchiveParams) -> Outcome {
    match target(&params.profile).await? {
        Target::Local { id, .. } => {
            let session_id = local_session_id(&id, &params.session, false).await?;
            sessions::actions::archive(&id, &session_id, params.quit_app)
                .await
                .map_err(why)?;
            Ok(json!({ "archived": session_id }))
        }
        Target::Remote {
            host_id, account, ..
        } => {
            let found = remote_session(&host_id, &account, &params.session).await?;
            to_json(
                remote::archive(
                    &host_list()?,
                    secrets::store(),
                    &host_id,
                    &account,
                    &found.id,
                )
                .await
                .map_err(why)?,
            )
        }
    }
}

/// An archived session, as the tools resolve it: its id and which archive.
#[derive(Debug, Clone)]
struct Archived {
    id: String,
    title: Option<String>,
    archive: String,
}

/// Pure: the archive `reference` (and `archive`, if given) names, the latest
/// of that session's when `archive` isn't.
fn pick_archive(
    all: &[Archived],
    reference: &str,
    archive: Option<&str>,
) -> Result<(String, String), String> {
    let mut sessions: Vec<SessionName> = Vec::new();
    for found in all {
        if !sessions.iter().any(|seen| seen.id == found.id) {
            sessions.push(SessionName {
                id: &found.id,
                title: found.title.as_deref(),
            });
        }
    }
    let id = refs::session(reference, &sessions)?;
    let mut archives: Vec<&str> = all
        .iter()
        .filter(|found| found.id == id)
        .map(|found| found.archive.as_str())
        .collect();
    // `<time>-archived`: the name sorts by time.
    archives.sort_unstable();
    let chosen = match archive {
        Some(wanted) => archives
            .iter()
            .find(|name| **name == wanted)
            .copied()
            .ok_or_else(|| {
                format!(
                    "That session has no archive {wanted:?}. Its archives: {}.",
                    archives.join(", ")
                )
            })?,
        None => archives
            .last()
            .copied()
            .expect("a session found has an archive"),
    };
    Ok((id, chosen.to_owned()))
}

/// A host account's archived sessions, each archive of each.
async fn host_archives(host_id: &str, account: &str) -> Result<Vec<Archived>, String> {
    Ok(
        remote::archived(&host_list()?, secrets::store(), host_id, account)
            .await
            .map_err(why)?
            .into_iter()
            .map(|found| Archived {
                id: found.id,
                title: found.title,
                archive: found.archive,
            })
            .collect(),
    )
}

async fn restore_session(params: RestoreParams) -> Outcome {
    match target(&params.profile).await? {
        // A session on this Mac has one archive: the session itself.
        Target::Local { id, .. } => {
            let session_id = local_session_id(&id, &params.session, true).await?;
            sessions::actions::restore(&id, &session_id, params.quit_app)
                .await
                .map_err(why)?;
            Ok(json!({ "restored": session_id }))
        }
        Target::Remote {
            host_id, account, ..
        } => {
            let all = host_archives(&host_id, &account).await?;
            let (session_id, archive) =
                pick_archive(&all, &params.session, params.archive.as_deref())?;
            to_json(
                remote::restore(
                    &host_list()?,
                    secrets::store(),
                    &host_id,
                    &account,
                    &session_id,
                    &archive,
                )
                .await
                .map_err(why)?,
            )
        }
    }
}

async fn delete_archive(params: DeleteArchiveParams) -> Outcome {
    let Target::Remote {
        host_id, account, ..
    } = target(&params.profile).await?
    else {
        return Err("Deleting an archive is only on hosts: on this Mac, an archived session stays until it's restored.".to_owned());
    };
    let all = host_archives(&host_id, &account).await?;
    let (session_id, archive) = pick_archive(&all, &params.session, Some(&params.archive))?;
    to_json(
        remote::delete_archive(
            &host_list()?,
            secrets::store(),
            &host_id,
            &account,
            &session_id,
            &archive,
        )
        .await
        .map_err(why)?,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn file(path: &str, action: MemoryAction, newer: Side) -> TransferMemoryFile {
        TransferMemoryFile {
            path: path.into(),
            action,
            newer,
            source_text: None,
            destination_text: None,
        }
    }

    #[test]
    fn every_conflict_needs_a_decision_and_newer_is_settled_here() {
        let memory = vec![
            file("MEMORY.md", MemoryAction::Index, Side::Source),
            file("a.md", MemoryAction::Conflict, Side::Destination),
            file("b.md", MemoryAction::Conflict, Side::Source),
            file("c.md", MemoryAction::Conflict, Side::Source),
        ];
        let mut choices = HashMap::from([
            ("a.md".to_owned(), MemoryChoice::Pick(Pick::Newer)),
            ("b.md".to_owned(), MemoryChoice::Pick(Pick::Destination)),
        ]);
        let error = decisions(&memory, &choices).unwrap_err();
        assert!(error.contains("c.md"), "{error}");
        assert!(!error.contains("a.md"), "{error}");

        choices.insert(
            "c.md".to_owned(),
            MemoryChoice::Merged {
                merged: "both".into(),
            },
        );
        assert_eq!(
            decisions(&memory, &choices),
            Ok(HashMap::from([
                ("a.md".to_owned(), Decision::Destination),
                ("b.md".to_owned(), Decision::Destination),
                ("c.md".to_owned(), Decision::Merged("both".into())),
            ]))
        );

        choices.insert("MEMORY.md".to_owned(), MemoryChoice::Pick(Pick::Source));
        let error = decisions(&memory, &choices).unwrap_err();
        assert!(error.contains("MEMORY.md"), "{error}");
    }

    #[test]
    fn memory_choices_read_as_claude_writes_them() {
        let choices: HashMap<String, MemoryChoice> = serde_json::from_value(json!({
            "a.md": "newer",
            "b.md": "source",
            "c.md": { "merged": "text" },
        }))
        .unwrap();
        assert_eq!(choices["a.md"], MemoryChoice::Pick(Pick::Newer));
        assert_eq!(choices["b.md"], MemoryChoice::Pick(Pick::Source));
        assert_eq!(
            choices["c.md"],
            MemoryChoice::Merged {
                merged: "text".into()
            }
        );
        assert!(serde_json::from_value::<MemoryChoice>(json!("both")).is_err());
    }

    #[test]
    fn keys_read_as_claude_writes_them() {
        let keys: Vec<KeyParam> = serde_json::from_value(
            json!([{ "key": "Down" }, { "text": "yes" }, { "key": "Enter" }]),
        )
        .unwrap();
        assert!(matches!(&keys[0], KeyParam::Key { key } if key == "Down"));
        assert!(matches!(&keys[1], KeyParam::Text { text } if text == "yes"));
    }

    #[test]
    fn the_latest_archive_unless_one_is_named() {
        let all = vec![
            Archived {
                id: "aaaaaaaa-0000-4000-8000-000000000001".into(),
                title: Some("Brain".into()),
                archive: "20260901-101010-archived".into(),
            },
            Archived {
                id: "aaaaaaaa-0000-4000-8000-000000000001".into(),
                title: Some("Brain".into()),
                archive: "20260922-080000-archived".into(),
            },
            Archived {
                id: "bbbbbbbb-0000-4000-8000-000000000002".into(),
                title: Some("vb4".into()),
                archive: "20260915-000000-archived".into(),
            },
        ];
        assert_eq!(
            pick_archive(&all, "brain", None),
            Ok((
                "aaaaaaaa-0000-4000-8000-000000000001".into(),
                "20260922-080000-archived".into()
            ))
        );
        assert_eq!(
            pick_archive(&all, "Brain", Some("20260901-101010-archived"))
                .map(|(_, archive)| archive),
            Ok("20260901-101010-archived".into())
        );
        let error = pick_archive(&all, "Brain", Some("nope")).unwrap_err();
        assert!(error.contains("20260922-080000-archived"), "{error}");
    }

    /// The tools against a real remote-control-conductor-server, paired into the app's
    /// own host list as the app would have it.
    #[tokio::test(flavor = "multi_thread")]
    #[expect(
        clippy::await_holding_lock,
        reason = "the lock keeps other tests from emptying the data dir for the whole test"
    )]
    async fn works_a_host_by_its_name_and_moves_between_its_accounts() {
        // The app's data dir is shared, and other tests empty it.
        let _serial = crate::test_support::APP_DIR_TEST_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        crate::paths::ensure_app_dir().unwrap();
        let server = crate::remote::tests::start_server().await;
        let list = HostList::default_list().unwrap();
        let host = remote::pair(
            &list,
            secrets::store(),
            &server.code("mcp"),
            Some("mcp-host".into()),
        )
        .await
        .unwrap();

        let profiles = list_profiles().await.unwrap();
        let shown = profiles["hosts"]
            .as_array()
            .unwrap()
            .iter()
            .find(|found| found["host"] == "mcp-host")
            .expect("the host is listed")
            .clone();
        assert_eq!(shown["online"], true, "{shown}");
        assert_eq!(shown["accounts"][0]["profile"], "mcp-host/work", "{shown}");

        let listed = list_sessions("MCP-HOST/work", false).await.unwrap();
        assert_eq!(listed[0]["title"], "Refactor", "{listed}");
        assert_eq!(listed[0]["running"], false, "{listed}");

        let error = read_window("mcp-host/work", "Refactor").await.unwrap_err();
        assert!(error.contains("isn't running"), "{error}");
        let error = open_profile("mcp-host/work").await.unwrap_err();
        assert!(error.contains("no desktop app"), "{error}");

        remote::create_account(&list, secrets::store(), &host.id, "other")
            .await
            .unwrap();
        let plan = plan_move(PlanMoveParams {
            profile: "mcp-host/work".into(),
            session: "refactor".into(),
            to: "other".into(),
        })
        .await
        .unwrap();
        assert_eq!(plan["destination"], "other", "{plan}");

        let moved = move_session(MoveParams {
            profile: "mcp-host/work".into(),
            session: "Refactor".into(),
            to: "mcp-host/other".into(),
            memory: HashMap::new(),
            afterwards: Afterwards::Keep,
            resume: Some(false),
            quit_apps: false,
            replace_newer: false,
        })
        .await
        .unwrap();
        assert_eq!(moved["changed"], true, "{moved}");
        let there = list_sessions("mcp-host/other", false).await.unwrap();
        assert_eq!(there[0]["title"], "Refactor", "{there}");
    }

    #[test]
    fn nulls_are_left_out_all_the_way_down() {
        assert_eq!(
            without_nulls(json!({ "a": null, "b": [{ "c": null, "d": 1 }], "e": false })),
            json!({ "b": [{ "d": 1 }], "e": false })
        );
    }

    #[test]
    fn a_host_session_shows_its_link_and_update() {
        let session: RemoteSession = serde_json::from_value(json!({
            "id": "aaaaaaaa-0000-4000-8000-000000000001",
            "cwd": "/home/marcus/brain",
            "title": "Brain",
            "named": true,
            "lastPrompt": null,
            "updatedAt": "2026-09-23T10:00:00Z",
            "sizeBytes": 10,
            "running": true,
            "window": { "session": "ai", "windowId": "@3", "paneId": "%3" },
            "remoteControl": true,
            "bridgeSessionId": "session_01ABC",
            "claudeVersion": "2.1.280",
            "updatePending": true,
        }))
        .unwrap();
        let shown = without_nulls(remote_session_json(&session));
        assert_eq!(shown["link"], "https://claude.ai/code/session_01ABC");
        assert_eq!(shown["updatePending"], true);
        assert_eq!(shown["window"], "@3");
        assert_eq!(shown["waitingForInput"], false);
    }
}
