//! The Mac's Claude profiles as a host's accounts. A host names an account
//! in its URLs, so each profile goes by a name that fits there: `default` for
//! the stock install, and its slug (or, failing that, its id) for the others.

use std::path::PathBuf;

use crate::app_kind::{default_id, AppKind};
use crate::error::AppResult;
use crate::paths;
use crate::profiles::{self, Profile};

/// A profile, under the name another Mac knows it by.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SharedProfile {
    pub name: String,
    /// What `local_rc` takes: the profile's id, or `default:claude`.
    pub profile_id: String,
    pub config_dir: PathBuf,
    pub is_default: bool,
}

/// The Mac's Claude profiles, the stock install first.
pub fn list() -> AppResult<Vec<SharedProfile>> {
    let stock = paths::stock_cli_config_dir(AppKind::Claude.spec())?;
    let profiles = profiles::load()?;
    let mut dirs = Vec::with_capacity(profiles.len());
    for profile in &profiles {
        dirs.push(paths::cli_config_dir(&profile.id)?);
    }
    Ok(shared(stock, &profiles, dirs))
}

/// The profile another Mac calls `name`.
pub fn find(name: &str) -> AppResult<Option<SharedProfile>> {
    Ok(list()?.into_iter().find(|shared| shared.name == name))
}

/// Pure: the stock install as `default`, then each Claude profile (whose
/// config folder is the matching one of `dirs`) by a name unique among them.
fn shared(stock: PathBuf, profiles: &[Profile], dirs: Vec<PathBuf>) -> Vec<SharedProfile> {
    let mut all = vec![SharedProfile {
        name: "default".into(),
        profile_id: default_id(AppKind::Claude),
        config_dir: stock,
        is_default: true,
    }];
    for (profile, dir) in profiles.iter().zip(dirs) {
        if profile.app != AppKind::Claude {
            continue;
        }
        let taken = |name: &str| all.iter().any(|shared| shared.name == name);
        let name = if plain(&profile.slug) && !taken(&profile.slug) {
            profile.slug.clone()
        } else {
            profile.id.clone()
        };
        all.push(SharedProfile {
            name,
            profile_id: profile.id.clone(),
            config_dir: dir,
            is_default: false,
        });
    }
    all
}

/// Pure: whether `name` can stand in a host's URL, as the client checks it.
fn plain(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 64
        && !name.starts_with('.')
        && name
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_' || b == b'.')
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::profiles::Surfaces;

    fn profile(id: &str, slug: &str, app: AppKind) -> Profile {
        Profile {
            id: id.into(),
            app,
            name: slug.to_uppercase(),
            slug: slug.into(),
            color: "#000000".into(),
            created_at: String::new(),
            surfaces: Surfaces {
                gui: false,
                cli: true,
            },
            distinct_dock_icon: false,
            last_used_at: None,
        }
    }

    #[test]
    fn names_the_stock_install_default_and_profiles_by_slug() {
        let profiles = [
            profile("a1", "marcus2", AppKind::Claude),
            profile("c1", "work", AppKind::Codex),
            profile("b1", "has space", AppKind::Claude),
            profile("d1", "default", AppKind::Claude),
        ];
        let dirs = profiles
            .iter()
            .map(|p| PathBuf::from(format!("/p/{}", p.id)))
            .collect();
        let shared = shared(PathBuf::from("/home/.claude"), &profiles, dirs);
        let names: Vec<(&str, &str)> = shared
            .iter()
            .map(|s| (s.name.as_str(), s.profile_id.as_str()))
            .collect();
        assert_eq!(
            names,
            [
                ("default", "default:claude"),
                ("marcus2", "a1"),
                ("b1", "b1"),
                ("d1", "d1"),
            ]
        );
        assert_eq!(shared[1].config_dir, PathBuf::from("/p/a1"));
        assert!(shared[0].is_default && !shared[1].is_default);
    }

    #[test]
    fn plain_names_are_what_a_url_takes() {
        assert!(plain("marcus-2_x.y"));
        assert!(!plain(""));
        assert!(!plain(".hidden"));
        assert!(!plain("a/b"));
        assert!(!plain(&"x".repeat(65)));
    }
}
