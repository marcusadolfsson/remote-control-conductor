//! What the ai-profiles app and remote-control-conductor-server share: reading Claude
//! Code's files (transcripts, the account a config directory is signed in
//! under, the registry of running sessions), running a program with a time
//! limit, the API between the two, the pairing code, and — with the `tls`
//! feature — trusting a server by its certificate's fingerprint. Moving,
//! archiving and merging memory on a host are the server's own. No platform
//! code, so the server can build it for Linux.

pub mod account;
pub mod api;
pub mod child;
pub mod pairing;
pub mod registry;
#[cfg(feature = "tls")]
pub mod tls;
pub mod transcript;
