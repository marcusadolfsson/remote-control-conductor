//! The servers the app started, kept in `rc-servers.json`, so they can be
//! started again after a restart ends tmux and every window in it. One is
//! added when it starts and taken out only when it's stopped from here.

use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use crate::error::AppResult;
use crate::paths;

/// A server to keep running: as which profile, where, and how.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Remembered {
    pub profile: String,
    pub folder: String,
    pub name: Option<String>,
    pub spawn: String,
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct File {
    servers: Vec<Remembered>,
}

fn path() -> AppResult<PathBuf> {
    Ok(paths::app_data_dir()?.join("rc-servers.json"))
}

/// The servers to keep running. None when the file is missing or unreadable.
pub fn load() -> Vec<Remembered> {
    path()
        .ok()
        .and_then(|path| fs::read_to_string(path).ok())
        .and_then(|text| serde_json::from_str::<File>(&text).ok())
        .map(|file| file.servers)
        .unwrap_or_default()
}

fn save(servers: Vec<Remembered>) -> AppResult<()> {
    paths::ensure_app_dir()?;
    let path = path()?;
    let staged = path.with_extension("json.tmp");
    fs::write(&staged, serde_json::to_vec_pretty(&File { servers })?)?;
    fs::rename(staged, path)?;
    Ok(())
}

/// Remember `server`, in place of one of its profile's in the same folder.
pub fn add(server: Remembered) -> AppResult<()> {
    save(with(load(), server))
}

/// Forget `profile`'s server in `folder`.
pub fn remove(profile: &str, folder: &str) -> AppResult<()> {
    save(without(load(), profile, folder))
}

/// Pure: `servers` with `server` in place of its profile's one in its folder.
fn with(servers: Vec<Remembered>, server: Remembered) -> Vec<Remembered> {
    let mut kept = without(servers, &server.profile, &server.folder);
    kept.push(server);
    kept
}

/// Pure: `servers` without `profile`'s in `folder`.
fn without(servers: Vec<Remembered>, profile: &str, folder: &str) -> Vec<Remembered> {
    servers
        .into_iter()
        .filter(|server| !(server.profile == profile && server.folder == folder))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn server(profile: &str, folder: &str, name: &str) -> Remembered {
        Remembered {
            profile: profile.into(),
            folder: folder.into(),
            name: Some(name.into()),
            spawn: "same-dir".into(),
        }
    }

    #[test]
    fn one_per_profile_and_folder() {
        let servers = with(vec![server("p1", "/a", "old")], server("p1", "/a", "new"));
        assert_eq!(servers, [server("p1", "/a", "new")]);
        let servers = with(servers, server("p2", "/a", "other"));
        assert_eq!(servers.len(), 2);
        assert_eq!(without(servers, "p1", "/a"), [server("p2", "/a", "other")]);
    }
}
