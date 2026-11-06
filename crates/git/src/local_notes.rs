//! Notes on the local changes of a file, for example on the work of an agent. The notes of a file belong
//! to its content when they were made: when the file changes, its notes go away. They are in the git dir
//! of the worktree (`gittor/local-notes.json`), not in the repository.

use crate::{GitError, Repo, Result};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::PathBuf;

/// A note on lines of the working-tree version of a file.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[derive(ts_rs::TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct LocalNote {
    pub id: String,
    pub path: String,
    /// The first line, 1-based.
    pub line: u32,
    /// The last line of a note on more than one line. 0 is a note on `line` only.
    #[serde(default)]
    pub end_line: u32,
    pub text: String,
    pub time: i64,
    /// The note is done: the diff shows only its icon.
    #[serde(default)]
    pub resolved: bool,
}

/// A change to the notes of a file.
#[derive(Deserialize)]
#[serde(tag = "action", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum LocalNoteEdit {
    Add {
        path: String,
        line: u32,
        #[serde(default)]
        end_line: u32,
        text: String,
    },
    Delete { path: String, id: String },
    Resolve { path: String, id: String, resolved: bool },
}

/// The notes of one file, with the hash of the content that they are about.
#[derive(Default, Serialize, Deserialize)]
struct FileNotes {
    hash: String,
    notes: Vec<LocalNote>,
}

type Store = BTreeMap<String, FileNotes>;

fn now() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0)
}

impl Repo {
    fn local_notes_file(&self) -> PathBuf {
        crate::app_dir(&self.git_dir()).join("local-notes.json")
    }

    fn load_local_notes(&self) -> Store {
        std::fs::read(self.local_notes_file()).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default()
    }

    fn save_local_notes(&self, store: &Store) -> Result<()> {
        let file = self.local_notes_file();
        if let Some(dir) = file.parent() {
            std::fs::create_dir_all(dir).map_err(|e| GitError(e.to_string()))?;
        }
        let json = serde_json::to_vec_pretty(store).map_err(|e| GitError(e.to_string()))?;
        // Write a new file, then rename it, so a crash never leaves half a file.
        let tmp = file.with_extension("json.tmp");
        std::fs::write(&tmp, json).map_err(|e| GitError(e.to_string()))?;
        std::fs::rename(&tmp, &file).map_err(|e| GitError(e.to_string()))
    }

    /// The hash of the working-tree file, as git would store it. None for a file that does not exist.
    fn content_hash(&self, path: &str) -> Option<String> {
        if !self.root.join(path).is_file() {
            return None;
        }
        self.git(&["hash-object", "--", path]).ok().map(|b| String::from_utf8_lossy(&b).trim().to_string())
    }

    /// The notes of a file, or of all files without `path`. The notes of a file that changed since they
    /// were made go away.
    pub fn local_notes(&self, path: Option<&str>) -> Result<Vec<LocalNote>> {
        let mut store = self.load_local_notes();
        let paths: Vec<String> = match path {
            Some(p) => store.contains_key(p).then(|| p.to_string()).into_iter().collect(),
            None => store.keys().cloned().collect(),
        };
        let mut changed = false;
        let mut out = Vec::new();
        for p in paths {
            let now = self.content_hash(&p);
            if now.as_deref() != Some(store[&p].hash.as_str()) {
                store.remove(&p);
                changed = true;
                continue;
            }
            out.extend(store[&p].notes.iter().cloned());
        }
        if changed {
            // A read-only git dir must not break the view.
            let _ = self.save_local_notes(&store);
        }
        out.sort_by(|a, b| (&a.path, a.line, a.time).cmp(&(&b.path, b.line, b.time)));
        Ok(out)
    }

    /// Adds, deletes or resolves a note.
    pub fn local_note_edit(&self, edit: LocalNoteEdit) -> Result<()> {
        let mut store = self.load_local_notes();
        match edit {
            LocalNoteEdit::Add { path, line, end_line, text } => {
                if text.trim().is_empty() {
                    return Err(GitError("The note is empty".into()));
                }
                let hash = self.content_hash(&path).ok_or_else(|| GitError(format!("{path} is not in the working tree")))?;
                let file = store.entry(path.clone()).or_default();
                // Notes on an older content of the file are gone.
                if file.hash != hash {
                    *file = FileNotes { hash, notes: Vec::new() };
                }
                let n = file.notes.iter().filter_map(|c| c.id.parse::<u64>().ok()).max().unwrap_or(0) + 1;
                let end_line = if line > 0 && end_line > line { end_line } else { 0 };
                file.notes.push(LocalNote { id: n.to_string(), path, line, end_line, text: text.trim().into(), time: now(), resolved: false });
            }
            LocalNoteEdit::Delete { path, id } => {
                if let Some(file) = store.get_mut(&path) {
                    file.notes.retain(|c| c.id != id);
                    if file.notes.is_empty() {
                        store.remove(&path);
                    }
                }
            }
            LocalNoteEdit::Resolve { path, id, resolved } => {
                let note = store.get_mut(&path).and_then(|f| f.notes.iter_mut().find(|c| c.id == id)).ok_or_else(|| GitError("The note does not exist".into()))?;
                note.resolved = resolved;
            }
        }
        self.save_local_notes(&store)
    }
}
