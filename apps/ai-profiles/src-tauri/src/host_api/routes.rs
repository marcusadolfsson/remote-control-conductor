//! The part of the hosts' API this Mac answers: pairing, its info, its
//! profiles as accounts, and their Remote Control servers and windows.
//! Everything else a Linux host does (sessions, moves, sign-ins) is refused,
//! saying so.

use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::sync::Arc;
use std::time::Duration;

use ai_profiles_core::api::{
    ClaudeInfo, DirListing, HostInfo, PairRequest, PairResponse, Ping, RcServer, RemoteAccount,
    RemoteSession, StartRcServerRequest, StartRcServerResult, StopResult, TmuxInfo,
    WindowKeysRequest, WindowScreen, API_HEADER, API_VERSION,
};
use ai_profiles_server::error::ApiError;
use ai_profiles_server::limits::{Lockout, RateLimit};
use ai_profiles_server::store::{Client, Store};
use axum::extract::{Path as UrlPath, Query, Request, State};
use axum::http::{header, HeaderValue, StatusCode};
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Response};
use axum::routing::{delete, get, post};
use axum::{Extension, Json, Router};
use serde::Deserialize;

use super::accounts::{self, SharedProfile};
use crate::accounts::AccountStatus;
use crate::error::AppError;

/// What every request can reach.
pub struct HostApi {
    pub store: Store,
    pairing_overall: RateLimit<()>,
    pairing_per_peer: RateLimit<IpAddr>,
    bad_tokens: Lockout<IpAddr>,
}

impl HostApi {
    pub fn new(store: Store) -> HostApi {
        let minute = Duration::from_secs(60);
        HostApi {
            store,
            pairing_overall: RateLimit::new(5, minute),
            pairing_per_peer: RateLimit::new(3, minute),
            bad_tokens: Lockout::new(10, minute, Duration::from_secs(300)),
        }
    }
}

/// The address a request came from, put on it by the connection loop.
#[derive(Debug, Clone, Copy)]
pub struct PeerAddr(pub SocketAddr);

type Shared = Arc<HostApi>;

pub fn router(state: Shared) -> Router {
    let authenticated = Router::new()
        .route("/v1/info", get(info))
        .route("/v1/accounts", get(list_accounts))
        .route("/v1/accounts/{name}/sessions", get(list_sessions))
        .route(
            "/v1/accounts/{name}/rc-servers",
            get(list_rc_servers).post(start_rc_server),
        )
        .route(
            "/v1/accounts/{name}/rc-servers/{pid}/stop",
            post(stop_rc_server),
        )
        .route(
            "/v1/accounts/{name}/windows/{window}/screen",
            get(window_screen),
        )
        .route(
            "/v1/accounts/{name}/windows/{window}/keys",
            post(window_keys),
        )
        .route("/v1/fs/dirs", get(list_dirs))
        .route("/v1/clients/self", delete(unpair))
        .fallback(|| async { mac_only() })
        .route_layer(middleware::from_fn_with_state(state.clone(), require_token));
    Router::new()
        .route("/v1/ping", get(ping))
        .route("/v1/pair", post(pair))
        .merge(authenticated)
        .layer(middleware::from_fn(every_request))
        .layer(axum::extract::DefaultBodyLimit::max(16 * 1024))
        .with_state(state)
}

/// What a Linux host does that a Mac doesn't.
fn mac_only() -> ApiError {
    ApiError::not_found(
        "This Mac shares only its Remote Control servers: sessions, moves and sign-ins stay on the Mac.",
    )
}

/// Refuse browsers, and say which API version answered.
async fn every_request(request: Request, next: Next) -> Response {
    let mut response = if request.headers().contains_key(header::ORIGIN) {
        ApiError::forbidden("browser_refused", "This API doesn't answer web pages.").into_response()
    } else {
        next.run(request).await
    };
    response
        .headers_mut()
        .insert(API_HEADER, HeaderValue::from(API_VERSION));
    response
}

fn peer_ip(request: &Request) -> IpAddr {
    request
        .extensions()
        .get::<PeerAddr>()
        .map(|peer| peer.0.ip())
        .unwrap_or(IpAddr::V4(Ipv4Addr::LOCALHOST))
}

async fn require_token(State(state): State<Shared>, mut request: Request, next: Next) -> Response {
    let ip = peer_ip(&request);
    if state.bad_tokens.is_locked(&ip) {
        return ApiError::rate_limited().into_response();
    }
    let token = request
        .headers()
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
        .map(str::trim)
        .filter(|token| !token.is_empty());
    let client = match token.map(|token| state.store.client_for_token(token)) {
        Some(Ok(Some(client))) => client,
        Some(Err(error)) => return ApiError::from(error).into_response(),
        _ => {
            state.bad_tokens.fail(&ip);
            return ApiError::unauthorized().into_response();
        }
    };
    request.extensions_mut().insert(client);
    next.run(request).await
}

/// An app error as the API reports it.
fn api_error(error: AppError) -> ApiError {
    match error {
        AppError::Validation(message) => ApiError::invalid(message),
        AppError::NotFound(message) => ApiError::not_found(message),
        AppError::NotInstalled(what) => {
            ApiError::unavailable("not_installed", format!("This Mac needs {what}"))
        }
        other => ApiError {
            status: StatusCode::INTERNAL_SERVER_ERROR,
            code: "internal",
            message: other.message(),
        },
    }
}

/// Run blocking work (tmux, files) off the async threads.
async fn blocking<T: Send + 'static>(
    work: impl FnOnce() -> Result<T, AppError> + Send + 'static,
) -> Result<T, ApiError> {
    tokio::task::spawn_blocking(work)
        .await
        .map_err(ApiError::internal)?
        .map_err(api_error)
}

fn profile_or_404(name: &str) -> Result<SharedProfile, AppError> {
    accounts::find(name)?.ok_or_else(|| {
        AppError::NotFound(format!("There is no profile called {name} on this Mac."))
    })
}

async fn ping() -> Json<Ping> {
    Json(Ping {
        api_version: API_VERSION,
    })
}

async fn pair(
    State(state): State<Shared>,
    request: Request,
) -> Result<Json<PairResponse>, ApiError> {
    let ip = peer_ip(&request);
    if !state.pairing_per_peer.allow(&ip) || !state.pairing_overall.allow(&()) {
        return Err(ApiError::rate_limited());
    }
    let body = axum::body::to_bytes(request.into_body(), 16 * 1024)
        .await
        .map_err(|_| ApiError::invalid("The request body is too large."))?;
    let pairing: PairRequest = serde_json::from_slice(&body)
        .map_err(|_| ApiError::invalid("Expected {secret, clientName}."))?;
    if pairing.client_name.chars().count() > 128 {
        return Err(ApiError::invalid("The client name is too long."));
    }
    let redeemed = tokio::task::spawn_blocking(move || {
        state
            .store
            .redeem(&pairing.secret, &pairing.client_name)
            .map(|redeemed| redeemed.map(|(client, token)| (client, token, host_info())))
    })
    .await
    .map_err(ApiError::internal)??;
    let Some((client, token, info)) = redeemed else {
        return Err(ApiError {
            status: StatusCode::UNAUTHORIZED,
            code: "pairing_invalid",
            message: "That pairing code isn't valid any more: it expired or was already used. Make a new one in Remote Control Conductor's Settings on the Mac you're adding.".into(),
        });
    };
    eprintln!(
        "remote-control-conductor: sharing: paired {} ({}) from {ip}",
        client.name, client.id
    );
    Ok(Json(PairResponse {
        client_id: client.id,
        token,
        info,
    }))
}

async fn unpair(
    State(state): State<Shared>,
    Extension(client): Extension<Client>,
) -> Result<StatusCode, ApiError> {
    tokio::task::spawn_blocking(move || state.store.revoke(&client.id))
        .await
        .map_err(ApiError::internal)??;
    Ok(StatusCode::NO_CONTENT)
}

async fn info() -> Result<Json<HostInfo>, ApiError> {
    blocking(|| Ok(Json(host_info()))).await
}

/// What this Mac is, as a host.
fn host_info() -> HostInfo {
    let claude = crate::deps::resolve_cli_binary_path("claude").map(|path| ClaudeInfo {
        version: ai_profiles_server::hostinfo::claude_version(&path),
        path: path.display().to_string(),
    });
    let home = dirs::home_dir().unwrap_or_default();
    HostInfo {
        hostname: ai_profiles_server::hostinfo::hostname(),
        home: home.display().to_string(),
        server_version: format!("{} (Mac)", env!("CARGO_PKG_VERSION")),
        api_version: API_VERSION,
        tmux: crate::local_rc::tmux_version().map(|version| TmuxInfo {
            version,
            session: crate::local_rc::TMUX_SESSION.into(),
        }),
        claude,
        accounts_base: crate::paths::app_data_dir()
            .map(|dir| dir.join("profiles").display().to_string())
            .unwrap_or_default(),
        includes_default: true,
        settings: None,
    }
}

async fn list_accounts() -> Result<Json<Vec<RemoteAccount>>, ApiError> {
    blocking(|| {
        let all = accounts::list()?;
        Ok(Json(all.into_iter().map(remote_account).collect()))
    })
    .await
}

fn remote_account(profile: SharedProfile) -> RemoteAccount {
    let status = crate::accounts::read(&profile.profile_id).unwrap_or(AccountStatus::Unknown);
    let (account, signed_in) = match status {
        AccountStatus::SignedIn { account } => (Some(account), true),
        AccountStatus::SignedOut => (None, false),
        AccountStatus::Unknown => (None, true),
    };
    RemoteAccount {
        name: profile.name,
        is_default: profile.is_default,
        config_dir: profile.config_dir.display().to_string(),
        account,
        signed_in,
        signed_in_until: None,
        sessions: 0,
        running_sessions: 0,
        pending_resume: 0,
    }
}

/// None: the Mac's own sessions are its own, not a host's.
async fn list_sessions(
    UrlPath(name): UrlPath<String>,
) -> Result<Json<Vec<RemoteSession>>, ApiError> {
    blocking(move || profile_or_404(&name).map(|_| Json(Vec::new()))).await
}

async fn list_rc_servers(UrlPath(name): UrlPath<String>) -> Result<Json<Vec<RcServer>>, ApiError> {
    blocking(move || {
        let profile = profile_or_404(&name)?;
        Ok(Json(crate::local_rc::list(&profile.profile_id)))
    })
    .await
}

async fn start_rc_server(
    UrlPath(name): UrlPath<String>,
    Json(request): Json<StartRcServerRequest>,
) -> Result<Json<StartRcServerResult>, ApiError> {
    blocking(move || {
        let profile = profile_or_404(&name)?;
        let mut started = crate::local_rc::start(&profile.profile_id, &request)?;
        // Its attach command is for a Terminal on this Mac.
        started.attach_command = None;
        Ok(Json(started))
    })
    .await
}

async fn stop_rc_server(
    UrlPath((name, pid)): UrlPath<(String, i32)>,
) -> Result<Json<StopResult>, ApiError> {
    blocking(move || {
        let profile = profile_or_404(&name)?;
        let was_running = crate::local_rc::stop(&profile.profile_id, pid)?;
        Ok(Json(StopResult { was_running }))
    })
    .await
}

async fn window_screen(
    UrlPath((name, window)): UrlPath<(String, String)>,
) -> Result<Json<WindowScreen>, ApiError> {
    blocking(move || {
        profile_or_404(&name)?;
        crate::local_rc::window_screen(&window).map(Json)
    })
    .await
}

async fn window_keys(
    UrlPath((name, window)): UrlPath<(String, String)>,
    Json(request): Json<WindowKeysRequest>,
) -> Result<Json<WindowScreen>, ApiError> {
    blocking(move || {
        profile_or_404(&name)?;
        crate::local_rc::window_keys(&window, &request.keys).map(Json)
    })
    .await
}

#[derive(Deserialize)]
struct DirQuery {
    path: Option<String>,
}

async fn list_dirs(Query(query): Query<DirQuery>) -> Result<Json<DirListing>, ApiError> {
    blocking(move || crate::local_rc::list_dirs(query.path.as_deref()).map(Json)).await
}
