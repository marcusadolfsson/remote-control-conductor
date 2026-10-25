//! Which Claude Code a server runs, and whether a newer one is installed: a
//! native install keeps each version as `…/claude/versions/<version>`, and
//! `claude` links to the newest, so a server started before an update runs
//! the old one until it's restarted.

use std::path::{Path, PathBuf};

use conductor_core::api::RcServer;

/// The program process `pid` runs.
fn program(pid: i32) -> Option<PathBuf> {
    let mut buffer = vec![0u8; libc::PROC_PIDPATHINFO_MAXSIZE as usize];
    let size = u32::try_from(buffer.len()).ok()?;
    // SAFETY: the buffer is `size` bytes, and the call writes no more.
    let written = unsafe { libc::proc_pidpath(pid, buffer.as_mut_ptr().cast(), size) };
    let written = usize::try_from(written)
        .ok()
        .filter(|written| *written > 0)?;
    buffer.truncate(written);
    String::from_utf8(buffer).ok().map(PathBuf::from)
}

/// The Claude Code version process `pid` runs, when it's a native install's.
pub fn running(pid: i32) -> Option<String> {
    program(pid).as_deref().and_then(in_path)
}

/// The Claude Code version `claude` (a link into its versions) runs now.
pub fn installed(claude: &Path) -> Option<String> {
    claude.canonicalize().ok().as_deref().and_then(in_path)
}

/// Pure: the version a native install's program is, or none for another.
fn in_path(program: &Path) -> Option<String> {
    let parent = program.parent()?.file_name()?;
    let version = program.file_name()?.to_str()?;
    (parent == "versions" && version.starts_with(|c: char| c.is_ascii_digit()))
        .then(|| version.to_owned())
}

/// Pure: whether `installed` is a later version than `running`.
fn newer(installed: &str, running: &str) -> bool {
    fn numbers(version: &str) -> Option<Vec<u64>> {
        version
            .split(['.', '-'])
            .take_while(|part| !part.is_empty() && part.bytes().all(|b| b.is_ascii_digit()))
            .map(|part| part.parse().ok())
            .collect::<Option<Vec<u64>>>()
            .filter(|parts| !parts.is_empty())
    }
    matches!((numbers(installed), numbers(running)), (Some(a), Some(b)) if a > b)
}

/// Mark the servers running an older Claude Code than `installed`.
pub fn mark_updates(servers: &mut [RcServer], installed: &str) {
    for server in servers {
        server.update_pending = server
            .claude_version
            .as_deref()
            .is_some_and(|running| newer(installed, running));
        server.installed_version = server.update_pending.then(|| installed.to_owned());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_version_off_a_native_install_program() {
        let version = |path: &str| in_path(Path::new(path));
        assert_eq!(
            version("/Users/m/.local/share/claude/versions/2.1.293").as_deref(),
            Some("2.1.293")
        );
        assert_eq!(version("/opt/homebrew/bin/node"), None);
    }

    #[test]
    fn compares_versions_by_their_numbers() {
        assert!(newer("2.1.300", "2.1.293"));
        assert!(!newer("2.1.300", "2.1.300"));
        assert!(!newer("2.1.99", "2.1.100"));
        assert!(!newer("latest", "2.1.1"));
    }

    #[test]
    fn knows_the_program_this_process_runs() {
        let pid = i32::try_from(std::process::id()).unwrap();
        assert_eq!(
            program(pid).unwrap(),
            std::env::current_exe().unwrap().canonicalize().unwrap()
        );
    }
}
