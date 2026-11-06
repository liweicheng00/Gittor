//! The settings that the backend needs before the front end starts: the git program and the Local
//! History limits. They are in `settings.json` in the configuration directory of the user:
//! `$XDG_CONFIG_HOME/gittor` or `~/.config/gittor` on Linux,
//! `~/Library/Application Support/gittor` on macOS, and `%APPDATA%\gittor` on Windows.
//! `GITTOR_CONFIG_DIR` changes the directory, for tests.
//!
//! A test build (the app "Gittor Dev") uses the directory `gittor-dev` next to it, so that it can run
//! next to a release. At its first start it copies the files of `gittor` there.
//!
//! The directory also has `ui-settings.json`: a copy of the settings of the front end, which are in the
//! storage of the web view. Another app cannot read that storage, so Gittor Dev reads the copy.

use crate::history::Limits;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq, Eq)]
#[derive(ts_rs::TS)]
#[ts(export)]
#[serde(rename_all = "camelCase", default)]
pub struct BackendSettings {
    /// The git program; empty means git from PATH.
    pub git_path: String,
    pub history: Limits,
    /// The command that opens a file at a line, with `{file}`, `{line}` and `{column}`. Empty opens the
    /// file with the default app of the system.
    pub editor: String,
    /// The command that opens a terminal in a folder, with `{dir}`. Empty opens the terminal app of the
    /// system.
    pub terminal: String,
    /// The folder of the workflows of Agent mode. Empty means `workflows` in the configuration directory.
    pub workflows_dir: String,
    /// False until the settings were saved once. The front end then moves its old copy here.
    pub stored: bool,
}

/// The directory of the settings file, or None when the system gives no home directory.
pub fn config_dir() -> Option<PathBuf> {
    if let Some(d) = std::env::var_os("GITTOR_CONFIG_DIR") {
        return Some(PathBuf::from(d));
    }
    let home = std::env::var_os("HOME").map(PathBuf::from);
    let base = if cfg!(target_os = "macos") {
        home?.join("Library").join("Application Support")
    } else if cfg!(windows) {
        PathBuf::from(std::env::var_os("APPDATA")?)
    } else {
        std::env::var_os("XDG_CONFIG_HOME").map(PathBuf::from).or_else(|| home.map(|h| h.join(".config")))?
    };
    Some(base.join("gittor"))
}

/// The name of the settings directory of a test build.
pub const DEV_DIR_NAME: &str = "gittor-dev";

/// Makes a test build use its own settings directory: `GITTOR_CONFIG_DIR` points to `gittor-dev`. At
/// the first start the directory gets a copy of the files of the release directory. An existing
/// `GITTOR_CONFIG_DIR` stays.
pub fn use_dev_dir() {
    if std::env::var_os("GITTOR_CONFIG_DIR").is_some() {
        return;
    }
    let Some(release) = config_dir() else { return };
    let dev = release.with_file_name(DEV_DIR_NAME);
    let _ = copy_settings(&release, &dev);
    std::env::set_var("GITTOR_CONFIG_DIR", &dev);
}

/// Copies the files of the settings directory `from` to `to` when `to` does not exist. Folders in
/// `from` are not copied. True when it copied.
pub fn copy_settings(from: &Path, to: &Path) -> std::io::Result<bool> {
    if to.exists() || !from.is_dir() {
        return Ok(false);
    }
    std::fs::create_dir_all(to)?;
    for entry in std::fs::read_dir(from)? {
        let entry = entry?;
        if entry.file_type()?.is_file() {
            std::fs::copy(entry.path(), to.join(entry.file_name()))?;
        }
    }
    Ok(true)
}

/// The copy of the settings of the front end, or None when there is none.
pub fn load_ui(dir: &Option<PathBuf>) -> Option<String> {
    std::fs::read_to_string(dir.as_ref()?.join(UI_FILE)).ok()
}

/// Writes the copy of the settings of the front end.
pub fn save_ui(dir: &Option<PathBuf>, text: &str) -> Result<(), String> {
    let Some(dir) = dir else { return Ok(()) };
    serde_json::from_str::<serde_json::Value>(text).map_err(|e| format!("The settings are not JSON: {e}"))?;
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let tmp = dir.join("ui-settings.json.tmp");
    std::fs::write(&tmp, text).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, dir.join(UI_FILE)).map_err(|e| e.to_string())
}

const UI_FILE: &str = "ui-settings.json";

/// Reads the settings file. A missing or damaged file gives the defaults.
pub fn load(dir: &Option<PathBuf>) -> BackendSettings {
    let Some(dir) = dir else { return BackendSettings::default() };
    match std::fs::read(dir.join("settings.json")) {
        Ok(bytes) => {
            let mut s: BackendSettings = serde_json::from_slice(&bytes).unwrap_or_default();
            s.stored = true;
            s
        }
        Err(_) => BackendSettings::default(),
    }
}

/// Writes the settings file through a temporary file, so a crash never leaves half a file.
pub fn save(dir: &Option<PathBuf>, s: &BackendSettings) -> Result<(), String> {
    let Some(dir) = dir else { return Ok(()) };
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let tmp = dir.join("settings.json.tmp");
    std::fs::write(&tmp, serde_json::to_vec_pretty(s).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, dir.join("settings.json")).map_err(|e| e.to_string())
}

#[cfg(test)]
mod dev_dir_tests {
    use super::{copy_settings, load_ui, save_ui};

    #[test]
    fn copies_the_release_settings_once() {
        let base = std::env::temp_dir().join(format!("gittor-devdir-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        let (release, dev) = (base.join("gittor"), base.join("gittor-dev"));
        std::fs::create_dir_all(release.join("folder")).unwrap();
        std::fs::write(release.join("settings.json"), "{\"gitPath\":\"/usr/bin/git\"}").unwrap();
        save_ui(&Some(release.clone()), "{\"theme\":\"dark\"}").unwrap();
        assert!(copy_settings(&release, &dev).unwrap());
        assert_eq!(std::fs::read_to_string(dev.join("settings.json")).unwrap(), "{\"gitPath\":\"/usr/bin/git\"}");
        assert_eq!(load_ui(&Some(dev.clone())).as_deref(), Some("{\"theme\":\"dark\"}"));
        assert!(!dev.join("folder").exists());
        // The second start keeps the settings of the test build.
        save_ui(&Some(dev.clone()), "{\"theme\":\"light\"}").unwrap();
        assert!(!copy_settings(&release, &dev).unwrap());
        assert_eq!(load_ui(&Some(dev.clone())).as_deref(), Some("{\"theme\":\"light\"}"));
        assert!(save_ui(&Some(dev), "not json").is_err());
        // No release settings: nothing to copy.
        assert!(!copy_settings(&base.join("none"), &base.join("other")).unwrap());
    }
}
