//! Browsing this Mac's folders for the folder picker, in the shape a host
//! answers with, so the same picker serves both.

use std::fs;
use std::path::{Path, PathBuf};

use ai_profiles_core::api::{DirEntry, DirListing};

use crate::error::{AppError, AppResult};

const MAX_ENTRIES: usize = 500;

/// The subfolders of `requested` (the home folder when none), hidden ones
/// left out.
pub fn list(requested: Option<&str>) -> AppResult<DirListing> {
    let home = dirs::home_dir()
        .ok_or_else(|| AppError::NotFound("could not determine the home folder".into()))?;
    list_in(&home, requested)
}

fn list_in(home: &Path, requested: Option<&str>) -> AppResult<DirListing> {
    let path = requested.map_or_else(|| home.to_path_buf(), PathBuf::from);
    if !path.is_absolute() || !path.is_dir() {
        return Err(AppError::NotFound(format!(
            "{} isn't a folder",
            path.display()
        )));
    }
    let mut entries: Vec<DirEntry> = fs::read_dir(&path)?
        .flatten()
        .filter(|entry| entry.path().is_dir())
        .filter_map(|entry| {
            let name = entry.file_name().to_str()?.to_owned();
            (!name.starts_with('.')).then(|| DirEntry {
                path: path.join(&name).display().to_string(),
                name,
            })
        })
        .collect();
    entries.sort_by_key(|entry| entry.name.to_lowercase());
    let truncated = entries.len() > MAX_ENTRIES;
    entries.truncate(MAX_ENTRIES);
    Ok(DirListing {
        parent: path.parent().map(|parent| parent.display().to_string()),
        path: path.display().to_string(),
        home: home.display().to_string(),
        entries,
        truncated,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lists_visible_subfolders_by_name() {
        let dir = tempfile::tempdir().unwrap();
        let home = dir.path().join("home");
        for folder in ["code", "Docs", ".hidden", "code/api"] {
            fs::create_dir_all(home.join(folder)).unwrap();
        }
        fs::write(home.join("file.txt"), "").unwrap();
        let listing = list_in(&home, None).unwrap();
        let names: Vec<&str> = listing
            .entries
            .iter()
            .map(|entry| entry.name.as_str())
            .collect();
        assert_eq!(names, ["code", "Docs"]);
        assert_eq!(listing.path, home.display().to_string());
        assert_eq!(listing.parent, Some(dir.path().display().to_string()));

        let code = list_in(&home, Some(&home.join("code").display().to_string())).unwrap();
        assert_eq!(code.entries[0].name, "api");
        assert!(list_in(&home, Some("relative")).is_err());
    }
}
