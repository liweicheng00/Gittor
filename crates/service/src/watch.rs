//! Watches a repository for changes made outside the app: files in the working tree, and refs, HEAD
//! and the index in the git directory. The front end polls the two counters and reloads what changed.
//!
//! On Linux, inotify needs one watch per directory, and the number of watches is limited. So the watcher
//! adds a watch for each directory that git does not ignore. Elsewhere it watches the root recursively.

use crate::history::{LocalHistory, MAX_BULK_FILES};
use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{channel, Receiver, RecvTimeoutError};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

/// Counters that go up when something changed.
#[derive(Default)]
pub struct WatchState {
    /// Commits, refs, HEAD or an operation in progress changed.
    pub repo: AtomicU64,
    /// Files in the working tree or the index changed.
    pub files: AtomicU64,
}

#[derive(Serialize, Clone, Copy)]
#[derive(ts_rs::TS)]
#[ts(export)]
pub struct WatchCounters {
    pub repo: u64,
    pub files: u64,
}

impl WatchState {
    pub fn counters(&self) -> WatchCounters {
        WatchCounters { repo: self.repo.load(Ordering::SeqCst), files: self.files.load(Ordering::SeqCst) }
    }
}

/// Gets the counters after a change.
pub type OnChange = Arc<dyn Fn(WatchCounters) + Send + Sync>;

pub struct RepoWatcher {
    pub state: Arc<WatchState>,
    // Dropping the watcher stops the events; the worker thread then ends.
    _watcher: Arc<Mutex<RecommendedWatcher>>,
}

/// A batch of events goes out after this time without a new event.
const QUIET: Duration = Duration::from_millis(300);
/// A batch goes out at most this long after its first event, also when events keep coming.
const MAX_WAIT: Duration = Duration::from_millis(1000);
/// The shortest time between two batches.
const MIN_GAP: Duration = Duration::from_millis(1000);

/// Decides when the events that wait go out as one batch. Many writes in a short time give one batch.
/// The first batch after a pause goes out after `quiet`. While events keep coming, one batch goes out
/// each `max_wait`, so the data of the front end is never older than that.
#[derive(Debug)]
pub(crate) struct Coalescer {
    quiet: Duration,
    max_wait: Duration,
    min_gap: Duration,
    first: Option<Instant>,
    last: Option<Instant>,
    flushed: Option<Instant>,
}

impl Coalescer {
    pub(crate) fn new(quiet: Duration, max_wait: Duration, min_gap: Duration) -> Coalescer {
        Coalescer { quiet, max_wait, min_gap, first: None, last: None, flushed: None }
    }

    /// An event came at `now`.
    pub(crate) fn push(&mut self, now: Instant) {
        self.first.get_or_insert(now);
        self.last = Some(now);
    }

    /// The time at which the batch goes out. None when no event waits.
    pub(crate) fn due_at(&self) -> Option<Instant> {
        let (first, last) = (self.first?, self.last?);
        let due = (last + self.quiet).min(first + self.max_wait);
        Some(self.flushed.map_or(due, |f| due.max(f + self.min_gap)))
    }

    /// How long to wait for the next event: until the batch is due, or `idle` when no event waits.
    pub(crate) fn wait(&self, now: Instant, idle: Duration) -> Duration {
        self.due_at().map_or(idle, |due| due.saturating_duration_since(now))
    }

    /// True when the batch is due at `now`. The batch is then empty again.
    pub(crate) fn take(&mut self, now: Instant) -> bool {
        if self.due_at().is_none_or(|due| now < due) {
            return false;
        }
        self.first = None;
        self.last = None;
        self.flushed = Some(now);
        true
    }
}

/// Files in the git dir that change what the log, the refs or the operation banner show.
fn is_repo_file(rel: &Path) -> bool {
    let first = rel.components().next().map(|c| c.as_os_str().to_string_lossy().into_owned()).unwrap_or_default();
    matches!(
        first.as_str(),
        "HEAD" | "refs" | "packed-refs" | "MERGE_HEAD" | "CHERRY_PICK_HEAD" | "REVERT_HEAD" | "REBASE_HEAD" | "rebase-merge" | "rebase-apply" | "logs" | "FETCH_HEAD" | "ORIG_HEAD"
    )
}

impl RepoWatcher {
    /// Starts to watch. When `history` is set, each changed file gets a version in Local History.
    /// `on_change` gets the counters after each change.
    pub fn start(
        root: &Path,
        git_dir: &Path,
        common_dir: &Path,
        history: Option<Arc<LocalHistory>>,
        on_change: Option<OnChange>,
    ) -> notify::Result<RepoWatcher> {
        let state = Arc::new(WatchState::default());
        let (tx, rx) = channel::<notify::Result<Event>>();
        let watcher = Arc::new(Mutex::new(notify::recommended_watcher(tx)?));
        {
            let mut w = watcher.lock().unwrap();
            for dir in [git_dir, common_dir] {
                // The git dir itself: HEAD, the index, MERGE_HEAD and the other state files.
                let _ = w.watch(dir, RecursiveMode::NonRecursive);
                let _ = w.watch(&dir.join("refs"), RecursiveMode::Recursive);
                let _ = w.watch(&dir.join("logs"), RecursiveMode::NonRecursive);
            }
            if cfg!(target_os = "linux") {
                for d in worktree_dirs(root) {
                    if w.watch(&d, RecursiveMode::NonRecursive).is_err() {
                        break; // Out of inotify watches: the focus refresh still works.
                    }
                }
            } else {
                w.watch(root, RecursiveMode::Recursive)?;
            }
        }
        let worker = Worker {
            root: root.to_path_buf(),
            git_dir: git_dir.to_path_buf(),
            common_dir: common_dir.to_path_buf(),
            state: state.clone(),
            watcher: Arc::downgrade(&watcher),
            history,
            on_change,
        };
        std::thread::spawn(move || worker.run(rx));
        Ok(RepoWatcher { state, _watcher: watcher })
    }
}

/// The directories of the working tree that git does not ignore, without the git dir and without
/// submodules. A submodule is a repository of its own; git status reports it as one entry.
fn worktree_dirs(root: &Path) -> Vec<PathBuf> {
    let top = root.to_path_buf();
    ignore::WalkBuilder::new(root)
        .hidden(false)
        .git_ignore(true)
        .git_exclude(true)
        .filter_entry(move |e| e.file_name() != ".git" && (e.path() == top || !e.path().join(".git").exists()))
        .build()
        .flatten()
        .filter(|e| e.file_type().is_some_and(|t| t.is_dir()))
        .map(|e| e.into_path())
        .collect()
}

struct Worker {
    root: PathBuf,
    git_dir: PathBuf,
    common_dir: PathBuf,
    state: Arc<WatchState>,
    watcher: std::sync::Weak<Mutex<RecommendedWatcher>>,
    history: Option<Arc<LocalHistory>>,
    on_change: Option<OnChange>,
}

impl Worker {
    fn run(self, rx: Receiver<notify::Result<Event>>) {
        let mut paths: Vec<PathBuf> = Vec::new();
        let mut batch = Coalescer::new(QUIET, MAX_WAIT, MIN_GAP);
        loop {
            match rx.recv_timeout(batch.wait(Instant::now(), QUIET)) {
                Ok(Ok(ev)) => {
                    if !matches!(ev.kind, EventKind::Access(_)) {
                        let created = matches!(ev.kind, EventKind::Create(_));
                        for p in ev.paths {
                            // A new directory gets its watches at once, not when the batch goes out:
                            // a file that comes into it in that time would give no event.
                            if created && cfg!(target_os = "linux") && !p.starts_with(&self.git_dir) && !p.starts_with(&self.common_dir) && p.is_dir() {
                                paths.extend(self.watch_new_dir(&p));
                            }
                            paths.push(p);
                        }
                        batch.push(Instant::now());
                    }
                }
                Ok(Err(_)) => {}
                Err(RecvTimeoutError::Timeout) => {
                    if self.watcher.strong_count() == 0 {
                        return;
                    }
                }
                Err(RecvTimeoutError::Disconnected) => return,
            }
            if batch.take(Instant::now()) {
                self.flush(std::mem::take(&mut paths));
            }
        }
    }

    fn flush(&self, paths: Vec<PathBuf>) {
        let mut repo = false;
        let mut index = false;
        let mut files: Vec<PathBuf> = Vec::new();
        let mut submodule = false;
        // For each repository inside this one: is it a submodule of this one?
        let mut gitlinks: std::collections::HashMap<PathBuf, bool> = std::collections::HashMap::new();
        for p in paths {
            let in_git = [&self.git_dir, &self.common_dir].iter().find_map(|d| p.strip_prefix(d).ok().map(Path::to_path_buf));
            match in_git {
                Some(rel) if rel.as_os_str().is_empty() => {}
                Some(rel) => {
                    let name = rel.to_string_lossy();
                    if name.ends_with(".lock") || name.starts_with("objects") || name.starts_with("gittor") {
                        continue;
                    }
                    if name == "index" {
                        index = true;
                    } else if is_repo_file(&rel) {
                        repo = true;
                    }
                }
                None => {
                    if !p.starts_with(&self.root) || files.contains(&p) {
                        continue;
                    }
                    // A file in a submodule changes the submodule's status only. `git check-ignore`
                    // refuses such a path, and Local History keeps the files of this repository only.
                    // Another repository inside this one, for example a linked worktree, does not
                    // change this repository: its files are not counted.
                    if let Some(nested) = self.nested_root(&p) {
                        if *gitlinks.entry(nested.clone()).or_insert_with(|| is_gitlink(&self.root, &nested)) {
                            submodule = true;
                        }
                    } else {
                        files.push(p);
                    }
                }
            }
        }
        let files = self.not_ignored(files);
        if repo {
            self.state.repo.fetch_add(1, Ordering::SeqCst);
        }
        if index || submodule || !files.is_empty() {
            self.state.files.fetch_add(1, Ordering::SeqCst);
        }
        if repo || index || submodule || !files.is_empty() {
            if let Some(f) = &self.on_change {
                f(self.state.counters());
            }
        }
        if let Some(h) = &self.history {
            if !files.is_empty() && files.len() <= MAX_BULK_FILES {
                h.record(&files, "");
            }
        }
    }

    /// True when a directory between the path and the root has a `.git` entry.
    /// The root of the repository inside this one that holds `path`: the first folder above it with a
    /// `.git`. None for a file of this repository.
    fn nested_root(&self, path: &Path) -> Option<PathBuf> {
        path.ancestors().skip(1).take_while(|a| *a != self.root && a.starts_with(&self.root)).find(|a| a.join(".git").exists()).map(Path::to_path_buf)
    }

    /// Watches a new directory and the directories in it. Returns the files that are in them already:
    /// they came before the watch, so no event reports them.
    fn watch_new_dir(&self, dir: &Path) -> Vec<PathBuf> {
        let mut files = Vec::new();
        let Some(w) = self.watcher.upgrade() else { return files };
        let mut w = w.lock().unwrap();
        for d in worktree_dirs(dir) {
            if w.watch(&d, RecursiveMode::NonRecursive).is_err() {
                break;
            }
            let entries = std::fs::read_dir(&d).into_iter().flatten().flatten();
            files.extend(entries.map(|e| e.path()).filter(|p| p.is_file()));
        }
        files
    }

    /// Drops the paths that git ignores. A tracked file is never ignored.
    fn not_ignored(&self, files: Vec<PathBuf>) -> Vec<PathBuf> {
        if files.is_empty() {
            return files;
        }
        let rel: Vec<String> = files.iter().filter_map(|p| p.strip_prefix(&self.root).ok()).map(|p| p.to_string_lossy().into_owned()).collect();
        let Ok(mut child) = gittor_git::git_command()
            .arg("-C")
            .arg(&self.root)
            .args(["check-ignore", "-z", "--stdin"])
            .env("GIT_OPTIONAL_LOCKS", "0")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
        else {
            return files;
        };
        if let Some(mut stdin) = child.stdin.take() {
            use std::io::Write;
            let input: Vec<u8> = rel.iter().flat_map(|r| r.bytes().chain(std::iter::once(0))).collect();
            let _ = stdin.write_all(&input);
        }
        let out = child.wait_with_output().map(|o| o.stdout).unwrap_or_default();
        let ignored: std::collections::HashSet<&[u8]> = out.split(|&b| b == 0).filter(|s| !s.is_empty()).collect();
        files.into_iter().zip(rel.iter()).filter(|(_, r)| !ignored.contains(r.as_bytes())).map(|(p, _)| p).collect()
    }
}

/// True when the index of the repository at `root` has a submodule (a gitlink) at `dir`. A linked
/// worktree or another clone inside the folder has none.
fn is_gitlink(root: &Path, dir: &Path) -> bool {
    let Ok(rel) = dir.strip_prefix(root) else { return false };
    gittor_git::git_command()
        .arg("-C")
        .arg(root)
        .args(["ls-files", "--stage", "--"])
        .arg(rel)
        .env("GIT_OPTIONAL_LOCKS", "0")
        .stderr(Stdio::null())
        .output()
        .is_ok_and(|o| String::from_utf8_lossy(&o.stdout).starts_with("160000 "))
}

#[cfg(test)]
mod tests {
    use super::{is_gitlink, Coalescer, RepoWatcher, WatchCounters};
    use std::path::Path;
    use std::process::Command;
    use std::sync::{Arc, Mutex};
    use std::time::{Duration, Instant};

    const MS: Duration = Duration::from_millis(1);

    fn coalescer() -> Coalescer {
        Coalescer::new(300 * MS, 1000 * MS, 1000 * MS)
    }

    #[test]
    fn a_batch_goes_out_after_the_quiet_time() {
        let t = Instant::now();
        let mut c = coalescer();
        assert_eq!(c.due_at(), None);
        assert!(!c.take(t));
        c.push(t);
        c.push(t + 100 * MS);
        assert_eq!(c.due_at(), Some(t + 400 * MS));
        assert_eq!(c.wait(t + 150 * MS, 300 * MS), 250 * MS);
        assert!(!c.take(t + 399 * MS));
        assert!(c.take(t + 400 * MS));
        assert_eq!(c.due_at(), None, "the batch is empty after it went out");
    }

    #[test]
    fn events_that_keep_coming_do_not_hold_a_batch_back() {
        let t = Instant::now();
        let mut c = coalescer();
        // One event each 100 ms: the quiet time never comes.
        let mut out = Vec::new();
        for i in 0..50u32 {
            let now = t + i * 100 * MS;
            c.push(now);
            if c.take(now) {
                out.push(i * 100);
            }
        }
        assert_eq!(out, [1000, 2100, 3200, 4300], "about one batch each second");
    }

    #[test]
    fn two_batches_keep_a_gap() {
        let t = Instant::now();
        let mut c = coalescer();
        c.push(t);
        assert!(c.take(t + 300 * MS));
        // A write 100 ms after the first batch waits for the gap, not only for the quiet time.
        c.push(t + 400 * MS);
        assert_eq!(c.due_at(), Some(t + 1300 * MS));
        assert!(!c.take(t + 700 * MS));
        assert!(c.take(t + 1300 * MS));
        // After a long pause the next batch needs the quiet time only.
        c.push(t + 5000 * MS);
        assert_eq!(c.due_at(), Some(t + 5300 * MS));
    }

    #[test]
    fn a_burst_of_writes_gives_few_batches_and_the_last_write_shows() {
        let base = std::env::temp_dir().join(format!("gittor-watch-burst-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        std::fs::create_dir_all(&base).unwrap();
        git(&base, &["init", "-q", "-b", "main"]);
        let seen: Arc<Mutex<Vec<(Instant, WatchCounters)>>> = Arc::default();
        let log = seen.clone();
        let git_dir = base.join(".git");
        let watcher = RepoWatcher::start(&base, &git_dir, &git_dir, None, Some(Arc::new(move |c| log.lock().unwrap().push((Instant::now(), c))))).unwrap();
        std::thread::sleep(200 * MS);
        // 40 writes in 2 s. Without a limit, the quiet time of 300 ms never comes in this time.
        let start = Instant::now();
        let mut last_write = start;
        for i in 0..40 {
            last_write = Instant::now();
            std::fs::write(base.join(format!("f{}.txt", i % 5)), format!("{i}\n")).unwrap();
            std::thread::sleep(50 * MS);
        }
        std::thread::sleep(1600 * MS);
        let seen = seen.lock().unwrap().clone();
        assert!(seen.len() >= 2 && seen.len() <= 4, "2 to 4 batches for 40 writes, got {}", seen.len());
        assert!(seen[0].0 - start < 1500 * MS, "the first batch comes during the burst");
        assert!(seen.last().unwrap().0 >= last_write, "a batch comes after the last write");
        assert_eq!(watcher.state.counters().files as usize, seen.len());
        assert_eq!(watcher.state.counters().repo, 0, "no ref changed");
        let _ = std::fs::remove_dir_all(&base);
    }

    fn git(dir: &Path, args: &[&str]) {
        let out = Command::new("git").arg("-C").arg(dir).args(args).output().unwrap();
        assert!(out.status.success(), "git {args:?}: {}", String::from_utf8_lossy(&out.stderr));
    }

    #[test]
    fn a_worktree_inside_the_repository_is_not_a_submodule() {
        let base = std::env::temp_dir().join(format!("gittor-watch-nested-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        let (main, lib) = (base.join("main"), base.join("lib"));
        for d in [&main, &lib] {
            std::fs::create_dir_all(d).unwrap();
            git(d, &["init", "-q", "-b", "main"]);
            git(d, &["-c", "user.name=T", "-c", "user.email=t@e", "commit", "-q", "--allow-empty", "-m", "Start"]);
        }
        git(&main, &["-c", "protocol.file.allow=always", "submodule", "add", "-q", lib.to_str().unwrap(), "sub"]);
        git(&main, &["worktree", "add", "-q", ".claude/worktrees/x", "-b", "x"]);
        assert!(is_gitlink(&main, &main.join("sub")), "a submodule");
        assert!(!is_gitlink(&main, &main.join(".claude/worktrees/x")), "a linked worktree inside the folder");
        let _ = std::fs::remove_dir_all(&base);
    }
}
