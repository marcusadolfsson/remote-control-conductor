//! Accepting connections, as the server does: peers outside the allowed
//! networks are dropped before any TLS, the rest speak HTTP/1.1 over TLS 1.3,
//! and only so many connections are kept.

use std::sync::Arc;
use std::time::Duration;

use axum::{Extension, Router};
use conductor_server::config::Config;
use hyper_util::rt::{TokioIo, TokioTimer};
use hyper_util::service::TowerToHyperService;
use tokio::net::TcpListener;
use tokio::sync::{oneshot, Semaphore};
use tokio_rustls::TlsAcceptor;

use super::routes::PeerAddr;

const HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(10);
const HEADER_TIMEOUT: Duration = Duration::from_secs(60);
/// A paired Mac opens a handful.
const MAX_CONNECTIONS: usize = 64;
const ACCEPT_BACKOFF: Duration = Duration::from_millis(100);

/// Serve `app` until `shutdown` fires or is dropped.
pub async fn serve(
    app: Router,
    listener: TcpListener,
    tls: Arc<rustls::ServerConfig>,
    networks: Config,
    mut shutdown: oneshot::Receiver<()>,
) {
    let acceptor = TlsAcceptor::from(tls);
    let slots = Arc::new(Semaphore::new(MAX_CONNECTIONS));
    loop {
        let (stream, peer) = tokio::select! {
            accepted = listener.accept() => match accepted {
                Ok(accepted) => accepted,
                Err(error) => {
                    eprintln!("remote-control-conductor: sharing: accept failed: {error}");
                    tokio::time::sleep(ACCEPT_BACKOFF).await;
                    continue;
                }
            },
            _ = &mut shutdown => return,
        };
        if !networks.allows(peer.ip()) {
            continue;
        }
        let Ok(slot) = slots.clone().try_acquire_owned() else {
            continue;
        };
        let acceptor = acceptor.clone();
        let service = TowerToHyperService::new(app.clone().layer(Extension(PeerAddr(peer))));
        tokio::spawn(async move {
            let _slot = slot;
            let Ok(Ok(tls_stream)) =
                tokio::time::timeout(HANDSHAKE_TIMEOUT, acceptor.accept(stream)).await
            else {
                return;
            };
            let _ = hyper::server::conn::http1::Builder::new()
                .timer(TokioTimer::new())
                .header_read_timeout(HEADER_TIMEOUT)
                .serve_connection(TokioIo::new(tls_stream), service)
                .await;
        });
    }
}
