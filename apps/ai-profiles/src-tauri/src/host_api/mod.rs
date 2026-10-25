//! This Mac as a host for another Mac: once shared from Settings, the app
//! answers the hosts' API for its Remote Control servers, so Remote Control
//! Conductor on another Mac pairs with it and lists, starts, stops and shows
//! them as it does a Linux host's. The pairing, token store, certificate and
//! limits are the server's own.
//!
//! It listens only while the app runs; the servers themselves are in tmux and
//! keep running without it. Only Tailscale addresses (and this Mac) may
//! connect, as on a host.

mod accounts;
mod routes;
mod serve;

use std::net::IpAddr;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, PoisonError};

use conductor_core::pairing::{self, display_fingerprint, PairingCode};
use conductor_server::certs::Identity;
use conductor_server::config::Config;
use conductor_server::store::{random_token, Store};
use serde::Serialize;
use tokio::sync::oneshot;

use crate::app_state;
use crate::error::{AppError, AppResult};
use crate::paths;

/// The port hosts listen on.
pub const PORT: u16 = 7443;

/// The listener while it runs: dropping the sender stops it.
static RUNNING: Mutex<Option<oneshot::Sender<()>>> = Mutex::new(None);
/// Why it last failed to start.
static LAST_ERROR: Mutex<Option<String>> = Mutex::new(None);

/// Whether this Mac is shared, and with whom.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SharingStatus {
    pub enabled: bool,
    pub listening: bool,
    pub error: Option<String>,
    pub port: u16,
    pub clients: Vec<PairedMac>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PairedMac {
    pub id: String,
    pub name: String,
    pub paired_at: String,
}

/// A code for another Mac's Settings → Remote hosts → Pair.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SharingCode {
    pub code: String,
    pub hosts: Vec<String>,
    pub fingerprint: String,
}

fn state_dir() -> AppResult<PathBuf> {
    let dir = paths::app_data_dir()?.join("host");
    std::fs::create_dir_all(&dir)?;
    Ok(dir)
}

fn lock<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

pub fn status() -> AppResult<SharingStatus> {
    let clients = Store::new(&state_dir()?)
        .clients()?
        .into_iter()
        .map(|client| PairedMac {
            id: client.id,
            name: client.name,
            paired_at: client.created_at.to_rfc3339(),
        })
        .collect();
    Ok(SharingStatus {
        enabled: app_state::load()?.share_rc_servers,
        listening: lock(&RUNNING).is_some(),
        error: lock(&LAST_ERROR).clone(),
        port: PORT,
        clients,
    })
}

/// Share this Mac or stop, and remember it for the next launch.
pub fn set_enabled(enabled: bool) -> AppResult<SharingStatus> {
    let mut state = app_state::load()?;
    state.share_rc_servers = enabled;
    app_state::save(&state)?;
    if enabled {
        start();
    } else {
        stop();
    }
    status()
}

/// At launch: listen if this Mac is shared.
pub fn start_if_shared() {
    if app_state::load().is_ok_and(|state| state.share_rc_servers) {
        start();
    }
}

fn start() {
    let mut running = lock(&RUNNING);
    if running.is_some() {
        return;
    }
    let started = listen();
    *lock(&LAST_ERROR) = started.as_ref().err().map(AppError::message);
    *running = started.ok();
}

fn stop() {
    lock(&RUNNING).take();
    lock(&LAST_ERROR).take();
}

/// Bind the port and serve on the app's runtime.
fn listen() -> AppResult<oneshot::Sender<()>> {
    let dir = state_dir()?;
    let identity = Identity::load_or_create(&dir)?;
    let tls = identity.server_config()?;
    let home = dirs::home_dir().unwrap_or_default();
    let networks = Config::from_toml(&format!("listen = \"0.0.0.0:{PORT}\""), &home)?;
    let listener = std::net::TcpListener::bind(("0.0.0.0", PORT)).map_err(|error| {
        AppError::Validation(format!(
            "Port {PORT} is taken ({error}). Is a Remote Control Conductor server running on this Mac?"
        ))
    })?;
    listener.set_nonblocking(true)?;
    let api = Arc::new(routes::HostApi::new(Store::new(&dir)));
    let (shutdown, stopped) = oneshot::channel();
    tauri::async_runtime::spawn(async move {
        match tokio::net::TcpListener::from_std(listener) {
            Ok(listener) => {
                serve::serve(routes::router(api), listener, tls, networks, stopped).await;
            }
            Err(error) => {
                *lock(&LAST_ERROR) = Some(error.to_string());
                lock(&RUNNING).take();
            }
        }
    });
    Ok(shutdown)
}

/// A single-use code, good for ten minutes, for another Mac to pair with.
pub fn new_code() -> AppResult<SharingCode> {
    let dir = state_dir()?;
    let identity = Identity::load_or_create(&dir)?;
    let hosts: Vec<String> = reachable_hosts()
        .into_iter()
        .map(|host| conductor_server::hostinfo::with_port(&host, PORT))
        .collect();
    let secret = random_token(18);
    Store::new(&dir).add_pending(&secret, None)?;
    Ok(SharingCode {
        code: pairing::encode(&PairingCode {
            v: 1,
            hosts: hosts.clone(),
            secret,
            fp: identity.fingerprint.clone(),
        }),
        hosts,
        fingerprint: display_fingerprint(&identity.fingerprint),
    })
}

/// Unpair a Mac.
pub fn forget(id: &str) -> AppResult<SharingStatus> {
    Store::new(&state_dir()?).revoke(id)?;
    status()
}

/// Where another Mac reaches this one: its Tailscale addresses, then its
/// name. Read from the interfaces, since the Tailscale app's CLI is seldom
/// on the app's PATH.
fn reachable_hosts() -> Vec<String> {
    let addresses = if_addrs::get_if_addrs()
        .unwrap_or_default()
        .into_iter()
        .map(|interface| interface.ip())
        .collect::<Vec<_>>();
    let mut hosts = tailscale_addresses(&addresses);
    hosts.push(conductor_server::hostinfo::hostname());
    hosts
}

/// Pure: the IPv4 Tailscale addresses (100.64.0.0/10) among `addresses`.
fn tailscale_addresses(addresses: &[IpAddr]) -> Vec<String> {
    let mut found: Vec<String> = addresses
        .iter()
        .filter_map(|address| match address {
            IpAddr::V4(v4) if v4.octets()[0] == 100 && (v4.octets()[1] & 0xc0) == 64 => {
                Some(v4.to_string())
            }
            _ => None,
        })
        .collect();
    found.dedup();
    found
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_tailscale_addresses_only() {
        let addresses: Vec<IpAddr> = [
            "127.0.0.1",
            "192.168.1.20",
            "100.101.102.103",
            "100.128.0.1",
            "fd7a:115c:a1e0::1",
        ]
        .iter()
        .map(|a| a.parse().unwrap())
        .collect();
        assert_eq!(tailscale_addresses(&addresses), ["100.101.102.103"]);
    }

    /// The app's own host client pairs with this Mac and lists its profiles,
    /// and what only a Linux host does is refused.
    #[tokio::test]
    async fn another_mac_pairs_and_lists_profiles() {
        use crate::remote::hosts::HostList;
        use crate::remote::secrets::MemoryStore;

        let state = tempfile::tempdir().unwrap();
        let identity = Identity::load_or_create(state.path()).unwrap();
        let store = Store::new(state.path());
        store.add_pending("s1", None).unwrap();
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = format!("127.0.0.1:{}", listener.local_addr().unwrap().port());
        let networks = Config::from_toml("listen = \"127.0.0.1:0\"", state.path()).unwrap();
        let api = Arc::new(routes::HostApi::new(store));
        let (_stop, stopped) = oneshot::channel();
        tokio::spawn(serve::serve(
            routes::router(api),
            listener,
            identity.server_config().unwrap(),
            networks,
            stopped,
        ));
        let code = pairing::encode(&PairingCode {
            v: 1,
            hosts: vec![address],
            secret: "s1".into(),
            fp: identity.fingerprint.clone(),
        });

        let hosts = tempfile::tempdir().unwrap();
        let list = HostList::at(hosts.path().join("remote-hosts.json"));
        let secrets = MemoryStore::default();
        let host = crate::remote::pair(&list, &secrets, &code, None)
            .await
            .unwrap();
        let info = crate::remote::info(&list, &secrets, &host.id)
            .await
            .unwrap();
        assert!(info.server_version.ends_with("(Mac)"));
        let accounts = crate::remote::accounts(&list, &secrets, &host.id)
            .await
            .unwrap();
        assert_eq!(accounts[0].name, "default");
        let none = crate::remote::sessions(&list, &secrets, &host.id, "default")
            .await
            .unwrap();
        assert!(none.is_empty());
        let refused = crate::remote::archived(&list, &secrets, &host.id, "default")
            .await
            .unwrap_err();
        assert!(refused
            .message()
            .contains("only its Remote Control servers"));
    }
}
