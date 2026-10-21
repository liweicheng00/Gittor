//! Submodules and Git LFS.
//!
//! A submodule shows in a diff as the text "Subproject commit <oid>", as in IntelliJ. A Git LFS file
//! shows with its real content when the object is in the local LFS store. Otherwise the diff shows the
//! pointer and a note.

use crate::ops::{safe, OpResult};
use crate::remote::OutgoingCommit;
use crate::{parse_name_status, Change, FileContent, GitError, Repo, Result};
use serde::Serialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[derive(ts_rs::TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub enum SubmoduleState {
    /// `git submodule init` and `update` did not run yet.
    Uninitialized,
    /// The checked-out commit is the recorded commit.
    Clean,
    /// The checked-out commit is not the recorded commit.
    OtherCommit,
    /// The submodule has a merge conflict in the superproject.
    Conflict,
}

#[derive(Debug, Serialize)]
#[derive(ts_rs::TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct Submodule {
    /// The name in `.gitmodules`. It is often the same as the path.
    pub name: String,
    pub path: String,
    /// The commit that the superproject records in its index.
    pub recorded: String,
    /// The commit that is checked out in the submodule. None when it is not initialized.
    pub current: Option<String>,
    pub state: SubmoduleState,
    /// The branch that is checked out in the submodule. None when HEAD is detached or the submodule is
    /// not initialized.
    pub branch: Option<String>,
    /// The `branch` setting of `.gitmodules`, for `git submodule update --remote`.
    pub track_branch: Option<String>,
    /// The submodule has changes in tracked files.
    pub dirty: bool,
    /// The submodule has files that git does not track.
    pub untracked: bool,
    pub url: Option<String>,
}

/// The checked-out commit of a submodule compared with the recorded commit.
#[derive(Debug, Serialize)]
#[derive(ts_rs::TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct SubmoduleRange {
    pub path: String,
    pub recorded: String,
    pub current: Option<String>,
    /// The recorded commit is not in the submodule. A fetch in the submodule can get it.
    pub recorded_missing: bool,
    /// Commits of the recorded commit that the checked-out commit does not have, newest first.
    pub behind: Vec<OutgoingCommit>,
    /// Commits of the checked-out commit that the recorded commit does not have, newest first.
    pub ahead: Vec<OutgoingCommit>,
    /// The local changes of the submodule. Status `?` is a file that git does not track.
    pub changes: Vec<Change>,
}

#[derive(Default)]
struct ModuleConfig {
    name: String,
    url: Option<String>,
    track_branch: Option<String>,
}

/// The git dir of a submodule: the `.git` folder, or the folder that a `.git` file names.
fn sub_git_dir(dir: &Path) -> Option<PathBuf> {
    let dot_git = dir.join(".git");
    if dot_git.is_dir() {
        return Some(dot_git);
    }
    let text = std::fs::read_to_string(&dot_git).ok()?;
    let target = PathBuf::from(text.trim().strip_prefix("gitdir:")?.trim());
    Some(if target.is_absolute() { target } else { dir.join(target) })
}

const LFS_PREFIX: &[u8] = b"version https://git-lfs.github.com/spec/v1";

/// The oid and the size of a Git LFS pointer file.
pub fn lfs_pointer(bytes: &[u8]) -> Option<(String, u64)> {
    if !bytes.starts_with(LFS_PREFIX) || bytes.len() > 1024 {
        return None;
    }
    let text = std::str::from_utf8(bytes).ok()?;
    let oid = text.lines().find_map(|l| l.strip_prefix("oid sha256:"))?.trim();
    let size = text.lines().find_map(|l| l.strip_prefix("size "))?.trim().parse().ok()?;
    (oid.len() == 64 && oid.bytes().all(|b| b.is_ascii_hexdigit())).then(|| (oid.to_string(), size))
}

/// The submodule flags of `git status --porcelain=v2 -z` by path: (another commit, tracked changes,
/// untracked files).
fn submodule_flags(status: &[u8]) -> HashMap<String, (bool, bool, bool)> {
    let mut out = HashMap::new();
    for entry in status.split(|&b| b == 0) {
        let text = String::from_utf8_lossy(entry);
        let fields: Vec<&str> = text.splitn(11, ' ').collect();
        // "1 XY sub mH mI mW hH hI path" and "u XY sub m1 m2 m3 mW h1 h2 h3 path".
        let path = match fields.first() {
            Some(&"1") if fields.len() >= 9 => fields[8..].join(" "),
            Some(&"u") if fields.len() >= 11 => fields[10].to_string(),
            _ => continue,
        };
        let sub = fields[2].as_bytes();
        if sub.len() == 4 && sub[0] == b'S' {
            out.insert(path, (sub[1] == b'C', sub[2] == b'M', sub[3] == b'U'));
        }
    }
    out
}

fn text_of(s: &str) -> String {
    String::from_utf8_lossy(s.as_bytes()).trim().to_string()
}

impl Repo {
    /// The submodules of the working tree. Three git commands read all of them: `.gitmodules`, the
    /// index and `git status --porcelain=v2`. Only a submodule at another commit needs one more.
    pub fn submodules(&self) -> Result<Vec<Submodule>> {
        if !self.root.join(".gitmodules").exists() {
            return Ok(Vec::new());
        }
        let modules = self.module_config();
        if modules.is_empty() {
            return Ok(Vec::new());
        }
        let mut args = vec!["ls-files", "-s", "-z", "--"];
        args.extend(modules.keys().map(String::as_str));
        let index = self.git(&args)?;
        // The gitlinks of the index: stage 0, or stage 2 (ours) in a conflict.
        let mut gitlinks: Vec<(String, String, bool)> = Vec::new();
        for entry in index.split(|&b| b == 0).filter(|e| !e.is_empty()) {
            let text = String::from_utf8_lossy(entry);
            let Some((meta, path)) = text.split_once('\t') else { continue };
            let mut f = meta.split(' ');
            let (Some("160000"), Some(oid), Some(stage)) = (f.next(), f.next(), f.next()) else { continue };
            match gitlinks.iter_mut().find(|g| g.0 == path) {
                Some(g) => {
                    g.2 = true;
                    if stage == "2" {
                        g.1 = oid.to_string();
                    }
                }
                None => gitlinks.push((path.to_string(), oid.to_string(), stage != "0")),
            }
        }
        if gitlinks.is_empty() {
            return Ok(Vec::new());
        }
        args = vec!["status", "--porcelain=v2", "-z", "--ignore-submodules=none", "--untracked-files=no", "--"];
        args.extend(gitlinks.iter().map(|g| g.0.as_str()));
        let status = self.git(&args)?;
        let flags = submodule_flags(&status);
        let mut out = Vec::new();
        for (path, recorded, conflict) in gitlinks {
            let module = modules.get(&path).map(|m| (m.name.clone(), m.url.clone(), m.track_branch.clone())).unwrap_or((path.clone(), None, None));
            let dir = self.root.join(&path);
            let git_dir = sub_git_dir(&dir).filter(|d| d.join("HEAD").exists());
            let (moved, dirty, untracked) = flags.get(&path).copied().unwrap_or_default();
            let (state, current, branch) = match &git_dir {
                None => (SubmoduleState::Uninitialized, None, None),
                Some(gd) => {
                    let head = std::fs::read_to_string(gd.join("HEAD")).unwrap_or_default();
                    let branch = head.trim().strip_prefix("ref: refs/heads/").map(str::to_string);
                    let current = if moved { Repo { root: dir.clone() }.resolve("HEAD") } else { Some(recorded.clone()) };
                    let state = if conflict {
                        SubmoduleState::Conflict
                    } else if moved {
                        SubmoduleState::OtherCommit
                    } else {
                        SubmoduleState::Clean
                    };
                    (state, current, branch)
                }
            };
            out.push(Submodule { name: module.0, path, recorded, current, state, branch, track_branch: module.2, dirty, untracked, url: module.1 });
        }
        Ok(out)
    }

    /// The submodules of `.gitmodules` by path, from one `git config` call.
    fn module_config(&self) -> HashMap<String, ModuleConfig> {
        let raw = self.git(&["config", "-f", ".gitmodules", "-z", "--list"]).unwrap_or_default();
        let mut by_name: HashMap<String, (Option<String>, ModuleConfig)> = HashMap::new();
        for entry in raw.split(|&b| b == 0).filter(|e| !e.is_empty()) {
            let text = String::from_utf8_lossy(entry);
            let Some((key, value)) = text.split_once('\n') else { continue };
            let Some(rest) = key.strip_prefix("submodule.") else { continue };
            let Some((name, field)) = rest.rsplit_once('.') else { continue };
            let e = by_name.entry(name.to_string()).or_insert_with(|| (None, ModuleConfig { name: name.to_string(), ..Default::default() }));
            let value = Some(value.trim().to_string()).filter(|v| !v.is_empty());
            match field {
                "path" => e.0 = value,
                "url" => e.1.url = value,
                "branch" => e.1.track_branch = value,
                _ => {}
            }
        }
        by_name.into_values().filter_map(|(path, m)| Some((path?, m))).collect()
    }

    /// The commits between the recorded commit and the checked-out commit of a submodule, and its local
    /// changes.
    pub fn submodule_range(&self, path: &str) -> Result<SubmoduleRange> {
        let sub = self.submodules()?.into_iter().find(|s| s.path == path).ok_or_else(|| GitError(format!("{path} is not a submodule")))?;
        let mut range = SubmoduleRange {
            path: sub.path,
            recorded: sub.recorded,
            current: sub.current,
            recorded_missing: false,
            behind: Vec::new(),
            ahead: Vec::new(),
            changes: Vec::new(),
        };
        let Some(current) = range.current.clone() else { return Ok(range) };
        let repo = Repo { root: self.root.join(path) };
        range.recorded_missing = repo.git(&["cat-file", "-e", &format!("{}^{{commit}}", range.recorded)]).is_err();
        if !range.recorded_missing && current != range.recorded {
            range.behind = repo.range_commits(&format!("{current}..{}", range.recorded))?;
            range.ahead = repo.range_commits(&format!("{}..{current}", range.recorded))?;
        }
        if sub.dirty {
            range.changes = parse_name_status(&repo.git(&["diff", "HEAD", "--name-status", "-z", "--no-renames", "--ignore-submodules=dirty"])?);
        }
        if sub.untracked {
            let others = repo.git(&["ls-files", "--others", "--exclude-standard", "-z"])?;
            range.changes.extend(
                others.split(|&b| b == 0).filter(|p| !p.is_empty()).map(|p| Change { status: '?', path: String::from_utf8_lossy(p).into_owned(), old_path: None }),
            );
        }
        Ok(range)
    }

    /// The commit of a submodule in a commit, or in the index when `commit` is None. None when the path
    /// is not a submodule there.
    pub fn gitlink(&self, commit: Option<&str>, path: &str) -> Option<String> {
        let raw = match commit {
            Some(c) => self.git(&["ls-tree", "-z", c, "--", path]).ok()?,
            None => self.git(&["ls-files", "-s", "-z", "--", path]).ok()?,
        };
        let entry = raw.split(|&b| b == 0).next()?;
        let text = String::from_utf8_lossy(entry);
        let mut f = text.split_whitespace();
        if f.next()? != "160000" {
            return None;
        }
        // ls-tree: "<mode> commit <oid>"; ls-files: "<mode> <oid> <stage>".
        let second = f.next()?;
        Some(if second == "commit" { f.next()?.to_string() } else { second.to_string() })
    }

    /// Checks out the recorded commit of the submodules, and initializes them first. With no paths, all
    /// submodules. Nested submodules are updated too.
    pub fn update_submodules(&self, paths: &[String]) -> Result<OpResult> {
        let mut args = vec!["submodule", "update", "--init", "--recursive"];
        if !paths.is_empty() {
            args.push("--");
            for p in paths {
                args.push(safe(p)?);
            }
        }
        self.git_write(&args, &[]).map_err(|(out, e)| GitError(if out.is_empty() { e } else { format!("{e}\n{out}") }))?;
        Ok(OpResult::ok_msg(if paths.is_empty() {
            "Updated the submodules".to_string()
        } else {
            format!("Updated {} submodule{}", paths.len(), if paths.len() == 1 { "" } else { "s" })
        }))
    }

    /// The text that a diff shows for a submodule: the checked-out commit, as in `git diff`.
    pub(crate) fn submodule_content(&self, commit: Option<&str>, path: &str) -> Option<FileContent> {
        let text = match commit {
            Some(c) => format!("Subproject commit {}\n", self.gitlink(Some(c), path)?),
            None => {
                let dir = self.root.join(path);
                if !dir.join(".git").exists() {
                    // Not initialized: the recorded commit is all there is.
                    format!("Subproject commit {}\n", self.gitlink(None, path)?)
                } else {
                    let sub = Repo { root: dir };
                    let head = sub.resolve("HEAD")?;
                    let dirty = sub.git(&["status", "--porcelain"]).is_ok_and(|b| !b.is_empty());
                    format!("Subproject commit {head}{}\n", if dirty { "-dirty" } else { "" })
                }
            }
        };
        Some(FileContent { size: text.len(), text: Some(text), binary: false, missing: false, note: Some("Submodule".into()) })
    }

    /// The content of a Git LFS object from the local store, or None when it is not downloaded.
    pub(crate) fn lfs_object(&self, oid: &str) -> Option<Vec<u8>> {
        let custom = self.git(&["config", "--get", "lfs.storage"]).ok().map(|b| text_of(&String::from_utf8_lossy(&b))).filter(|s| !s.is_empty());
        let store = match custom {
            Some(s) if PathBuf::from(&s).is_absolute() => PathBuf::from(s).join("objects"),
            Some(s) => self.common_dir().join(s).join("objects"),
            None => self.common_dir().join("lfs").join("objects"),
        };
        std::fs::read(store.join(&oid[..2]).join(&oid[2..4]).join(oid)).ok()
    }
}

#[cfg(test)]
mod tests {
    use super::{lfs_pointer, submodule_flags};

    #[test]
    fn flags() {
        let z = "0".repeat(40);
        let status = format!(
            "1 .M SC.. 160000 160000 160000 {z} {z} vendor/a b\0u UU S.MU 160000 160000 160000 160000 {z} {z} {z} lib\01 M. N... 100644 100644 100644 {z} {z} file.txt\0"
        );
        let f = submodule_flags(status.as_bytes());
        assert_eq!(f.get("vendor/a b"), Some(&(true, false, false)));
        assert_eq!(f.get("lib"), Some(&(false, true, true)));
        assert_eq!(f.len(), 2);
    }

    #[test]
    fn pointers() {
        let oid = "4d7a214614ab2935c943f9e0ff69d22eadbb8f32b1258daaa5e2ca24d17e2393";
        let p = format!("version https://git-lfs.github.com/spec/v1\noid sha256:{oid}\nsize 12345\n");
        assert_eq!(lfs_pointer(p.as_bytes()), Some((oid.to_string(), 12345)));
        assert_eq!(lfs_pointer(b"fn main() {}\n"), None);
        assert_eq!(lfs_pointer(b"version https://git-lfs.github.com/spec/v1\noid sha256:xyz\nsize 1\n"), None);
    }
}
