//! Commit rewrites (squash, fixup, drop, reword, reorder, author) run in memory, like IntelliJ's in-memory
//! rebase: `git merge-tree --write-tree` replays each commit and `git commit-tree` writes it, so the working
//! tree is not touched. When the final tree differs from HEAD, `git reset --keep` moves the branch; it
//! refuses to run when a local change would be lost. A conflict stops the rewrite before any ref changes.
//! A plan with an Edit step runs a real `git rebase -i` instead.

use crate::ops::{CommitMeta, OpResult};
use crate::undo::{UndoAction, UndoMode};
use crate::{GitError, Repo, Result};
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[derive(ts_rs::TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub enum Action {
    Pick,
    Reword,
    /// Stop at this commit, so the user can change it. Only a real `git rebase -i` can stop.
    Edit,
    Squash,
    Fixup,
    Drop,
}

/// One line of a rewrite plan, oldest commit first.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[derive(ts_rs::TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct PlanEntry {
    pub oid: String,
    pub action: Action,
    /// New message for reword, or the combined message for the first commit of a squash group.
    #[serde(default)]
    #[ts(optional)]
    pub message: Option<String>,
    /// A new author, as "Name <email>". The author date stays.
    #[serde(default)]
    #[ts(optional)]
    pub author: Option<String>,
}

/// Splits "Name <email>" into the name and the email.
pub fn parse_author(s: &str) -> Result<(String, String)> {
    let s = s.trim();
    let (name, rest) = s.split_once('<').ok_or_else(|| GitError(format!("The author must be \"Name <email>\": {s}")))?;
    let email = rest.strip_suffix('>').ok_or_else(|| GitError(format!("The author must be \"Name <email>\": {s}")))?;
    let (name, email) = (name.trim(), email.trim());
    if name.is_empty() || email.is_empty() || email.contains(['<', '>']) {
        return Err(GitError(format!("The author must be \"Name <email>\": {s}")));
    }
    Ok((name.to_string(), email.to_string()))
}

/// The commits from `base` (exclusive) to HEAD, oldest first, ready for a rewrite.
#[derive(Debug, Serialize)]
#[derive(ts_rs::TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct RewriteRange {
    /// The commit before the range. Empty when the range starts at the root commit of the branch.
    pub base: String,
    pub entries: Vec<RangeCommit>,
    /// Some commits are on a remote branch already; a rewrite needs a force push.
    pub published: bool,
}

#[derive(Debug, Serialize)]
#[derive(ts_rs::TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct RangeCommit {
    pub oid: String,
    pub subject: String,
    pub message: String,
    pub author: String,
    pub author_email: String,
}


/// The result of one step of a checked plan.
#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[derive(ts_rs::TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub enum StepStatus {
    Ok,
    Conflict,
    /// The step gives the tree of the commit before it: the new commit has no changes.
    Empty,
    Dropped,
    /// No conflict, but an earlier step has one: the result is a guess.
    AfterConflict,
}

/// A file with a conflict, and the kind of the conflict ("contents", "modify/delete", "add/add", ...).
#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[derive(ts_rs::TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ConflictFile {
    pub path: String,
    pub kind: String,
}

#[derive(Clone, Debug, Serialize)]
#[derive(ts_rs::TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct StepCheck {
    pub oid: String,
    pub status: StepStatus,
    pub conflicts: Vec<ConflictFile>,
}

/// A remote branch that has commits that the plan rewrites, and how many.
#[derive(Clone, Debug, Serialize)]
#[derive(ts_rs::TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct RemoteHit {
    pub name: String,
    pub commits: u32,
}

/// The check of a plan before it runs. Nothing in the repository changes for it.
#[derive(Clone, Debug, Serialize)]
#[derive(ts_rs::TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct RewriteCheck {
    /// HEAD at the check. The run refuses when HEAD moved.
    pub head: String,
    /// One entry for each entry of the plan, in the same order.
    pub steps: Vec<StepCheck>,
    /// The first step that changes a commit. The commits before it keep their hashes. Null: nothing changes.
    pub first_changed: Option<u32>,
    /// The files that are different at the end than in HEAD.
    pub changed_files: Vec<String>,
    /// Remote branches with commits that the plan rewrites ("origin/main").
    pub remotes: Vec<RemoteHit>,
    /// Other local branches and tags with commits that the plan rewrites. They keep the old commits.
    pub other_refs: Vec<String>,
    /// Files with local changes that are different at the end: the run would stop.
    pub blocking_files: Vec<String>,
}

/// The result of a replay.
struct Replayed {
    head: String,
    tree: String,
    steps: Vec<StepCheck>,
    first_changed: Option<usize>,
}

/// The result of one `git merge-tree`.
struct Merged {
    tree: String,
    conflicts: Vec<ConflictFile>,
}

/// Reads the output of `git merge-tree --write-tree -z --name-only` after a conflict: the tree, the
/// conflicting paths, an empty field, then messages of the form `<count> <paths...> <type> <text>`.
fn parse_merge_tree(out: &str) -> Merged {
    let (head, messages) = out.split_once("\0\0").unwrap_or((out, ""));
    let mut fields = head.split('\0');
    let tree = fields.next().unwrap_or("").trim().to_string();
    let mut conflicts: Vec<ConflictFile> = Vec::new();
    for p in fields.filter(|p| !p.is_empty()) {
        if !conflicts.iter().any(|c| c.path == p) {
            conflicts.push(ConflictFile { path: p.to_string(), kind: "contents".into() });
        }
    }
    let mut m = messages.split('\0');
    while let Some(count) = m.next() {
        let Ok(n) = count.trim().parse::<usize>() else { break };
        let paths: Vec<&str> = m.by_ref().take(n).collect();
        let kind = m.next().unwrap_or("");
        let _text = m.next();
        if let Some(k) = kind.strip_prefix("CONFLICT (").and_then(|k| k.strip_suffix(')')) {
            for c in conflicts.iter_mut().filter(|c| paths.contains(&c.path.as_str())) {
                c.kind = k.to_string();
            }
        }
    }
    Merged { tree, conflicts }
}

/// Quotes a string for the POSIX shell that git uses to run editors and exec lines.
fn shell_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', "'\\''"))
}

impl Repo {
    // ---- in-memory rewrite ----

    pub(crate) fn meta(&self, oid: &str) -> Result<CommitMeta> {
        let raw = self.git(&["show", "-s", "--format=%P%x00%T%x00%an%x00%ae%x00%ad%x00%B", "--date=raw", oid])?;
        let text = String::from_utf8_lossy(&raw);
        let f: Vec<&str> = text.splitn(6, '\0').collect();
        if f.len() < 6 {
            return Err(GitError(format!("cannot read commit {oid}")));
        }
        Ok(CommitMeta {
            parents: f[0].split_whitespace().map(String::from).collect(),
            tree: f[1].to_string(),
            author_name: f[2].to_string(),
            author_email: f[3].to_string(),
            author_date: f[4].to_string(),
            message: f[5].trim_end().to_string(),
        })
    }

    /// The commit before a range: `base` itself, or an empty string for `<root>^` and for an empty
    /// `base`. An empty base means that the range starts at the root commit of the branch.
    fn range_base(&self, base: &str) -> Result<String> {
        if base.is_empty() {
            return Ok(String::new());
        }
        if let Some(oid) = self.resolve(base) {
            return Ok(oid);
        }
        let root = base.strip_suffix('^').and_then(|c| self.resolve(c));
        match root {
            Some(r) if self.meta(&r)?.parents.is_empty() => Ok(String::new()),
            _ => Err(GitError(format!("unknown commit {base}"))),
        }
    }

    /// The commits after `base` on the current branch. Merges in the range are not supported.
    pub fn rewrite_range(&self, base: &str) -> Result<RewriteRange> {
        let state = self.state()?;
        if state.operation != "none" {
            return Err(GitError(format!("Finish or abort the {} first", state.operation)));
        }
        if state.branch.is_none() {
            return Err(GitError("HEAD is detached. Checkout a branch first".into()));
        }
        let base = self.range_base(base)?;
        if !base.is_empty() && self.git(&["merge-base", "--is-ancestor", &base, "HEAD"]).is_err() {
            return Err(GitError("The commits are not on the current branch".into()));
        }
        let range = if base.is_empty() { "HEAD".to_string() } else { format!("{base}..HEAD") };
        let raw = self.git(&["rev-list", "--reverse", "--parents", &range])?;
        let mut entries = Vec::new();
        for line in String::from_utf8_lossy(&raw).lines() {
            let parts: Vec<&str> = line.split_whitespace().collect();
            // Without a base, the first commit is the root commit: it has no parent.
            let root = base.is_empty() && entries.is_empty() && parts.len() == 1;
            if parts.len() != 2 && !root {
                return Err(GitError("The range contains a merge commit. Rewriting merges is not supported".into()));
            }
            let m = self.meta(parts[0])?;
            entries.push(RangeCommit {
                oid: parts[0].to_string(),
                subject: m.message.lines().next().unwrap_or("").to_string(),
                message: m.message,
                author: m.author_name,
                author_email: m.author_email,
            });
        }
        let published = match entries.first() {
            Some(first) => self
                .git(&["branch", "-r", "--contains", &first.oid, "--format=%(refname)"])
                .map(|b| !String::from_utf8_lossy(&b).trim().is_empty())
                .unwrap_or(false),
            None => false,
        };
        Ok(RewriteRange { base, entries, published })
    }

    /// Checks that `plan` lists each commit of the range once, and that a squash has a commit before it.
    fn validate_plan(range: &RewriteRange, plan: &[PlanEntry]) -> Result<()> {
        let mut expected: Vec<&str> = range.entries.iter().map(|e| e.oid.as_str()).collect();
        let mut given: Vec<&str> = plan.iter().map(|e| e.oid.as_str()).collect();
        expected.sort_unstable();
        given.sort_unstable();
        if expected != given {
            return Err(GitError("The plan must list every commit of the range exactly once".into()));
        }
        if plan.iter().find(|e| e.action != Action::Drop).is_some_and(|e| matches!(e.action, Action::Squash | Action::Fixup)) {
            return Err(GitError("A squash or fixup needs a commit before it".into()));
        }
        Ok(())
    }

    /// Replays `plan` on `base` in memory and moves the current branch to the result.
    pub fn rewrite(&self, base: &str, plan: &[PlanEntry], what: &str) -> Result<OpResult> {
        self.rewrite_with(base, plan, what, None, false)
    }

    /// Replays `plan` on `base`. With `expected_head`, it refuses when HEAD is not that commit any more.
    /// With `stop_at_conflict`, or with an Edit step, a real `git rebase -i` runs; it stops at a conflict.
    pub fn rewrite_with(&self, base: &str, plan: &[PlanEntry], what: &str, expected_head: Option<&str>, stop_at_conflict: bool) -> Result<OpResult> {
        let range = self.rewrite_range(base)?;
        Self::validate_plan(&range, plan)?;
        let old_head = self.resolve("HEAD").ok_or_else(|| GitError("no HEAD".into()))?;
        if expected_head.is_some_and(|h| h != old_head) {
            return Err(GitError("The branch changed after the check. Check the plan again".into()));
        }
        if stop_at_conflict || plan.iter().any(|e| e.action == Action::Edit) {
            return self.rebase_interactive(&range.base, plan, what);
        }
        let branch = self.state()?.branch.unwrap_or_default();
        let done = self.replay(&range.base, plan, None)?;
        let (current, current_tree) = (done.head, done.tree);
        if current == old_head {
            return Ok(OpResult::ok("Nothing changed"));
        }
        let head_tree = self.meta(&old_head)?.tree;
        let reflog = format!("gittor: {what}");
        let moved = if head_tree == current_tree {
            self.git_write(&["update-ref", "-m", &reflog, &format!("refs/heads/{branch}"), &current, &old_head], &[])
        } else {
            self.git_write(&["reset", "--keep", &current], &[("GIT_REFLOG_ACTION", &reflog)])
        };
        if let Err((_, e)) = moved {
            return Err(GitError(format!("The branch was not changed: {e}")));
        }
        let undo = vec![UndoAction::Reset { to: old_head, expected_head: current, mode: UndoMode::Keep }];
        Ok(OpResult { ok: true, message: format!("{what} done"), conflicts: Vec::new(), undo })
    }

    /// Replays `plan` on `base` in memory and gives the result of each step. No ref, index or working tree
    /// changes. With `check` (the environment of a temporary object directory), a conflict does not stop the
    /// replay: the later steps use the tree with the conflict markers. Without it, a conflict is an error.
    fn replay(&self, base: &str, plan: &[PlanEntry], check: Option<&[(&str, &str)]>) -> Result<Replayed> {
        let env = check.unwrap_or(&[]);
        let sign = check.is_none() && self.signs_commits();
        let mut current = base.to_string();
        let mut current_tree = if current.is_empty() { self.empty_tree()? } else { self.meta(&current)?.tree };
        let mut unchanged = true;
        let mut first_changed: Option<usize> = None;
        // The group of the last kept commit: its parent, the tree of that parent, its metadata, its message and
        // its index in the plan.
        let mut group: Option<(String, String, CommitMeta, String, usize)> = None;
        let mut after_conflict = false;
        let mut steps = Vec::with_capacity(plan.len());
        for (i, e) in plan.iter().enumerate() {
            if e.action == Action::Drop {
                if unchanged {
                    first_changed = Some(i);
                    unchanged = false;
                }
                steps.push(StepCheck { oid: e.oid.clone(), status: StepStatus::Dropped, conflicts: Vec::new() });
                continue;
            }
            let m = self.meta(&e.oid)?;
            let parent = m.parents.first().cloned().unwrap_or_default();
            let fast = parent == current && unchanged;
            let merged = if fast {
                Merged { tree: m.tree.clone(), conflicts: Vec::new() }
            } else if current.is_empty() {
                // No commit is before this one yet: apply its change to an empty commit.
                let empty = self.commit_tree_with(&current_tree, "", &m, "", sign, env)?;
                self.merge_tree_full(&parent, &empty, &e.oid, env)?
            } else {
                self.merge_tree_full(&parent, &current, &e.oid, env)?
            };
            if check.is_none() && !merged.conflicts.is_empty() {
                let files: Vec<&str> = merged.conflicts.iter().map(|c| c.path.as_str()).collect();
                return Err(GitError(format!("Commit {} conflicts with the new history ({}). Nothing was changed", &e.oid[..e.oid.len().min(8)], files.join(", "))));
            }
            let tree = merged.tree;
            let before_tree = match e.action {
                Action::Squash | Action::Fixup => {
                    let (grand, grand_tree, first, msg, start) = group.take().expect("checked by validate_plan");
                    let message = match (&e.message, e.action) {
                        (Some(custom), _) => custom.clone(),
                        (None, Action::Squash) => format!("{msg}\n\n{}", m.message),
                        _ => msg,
                    };
                    current = self.commit_tree_with(&tree, &grand, &first, &message, sign, env)?;
                    if first_changed.is_none_or(|f| f > start) {
                        first_changed = Some(start);
                    }
                    unchanged = false;
                    group = Some((grand, grand_tree.clone(), first, message, start));
                    grand_tree
                }
                _ => {
                    let message = e.message.clone().unwrap_or_else(|| m.message.clone());
                    let mut m = m;
                    let mut new_author = false;
                    if let Some(a) = &e.author {
                        let (name, email) = parse_author(a)?;
                        new_author = name != m.author_name || email != m.author_email;
                        m.author_name = name;
                        m.author_email = email;
                    }
                    let (parent_of_new, parent_tree) = (current.clone(), current_tree.clone());
                    if fast && message == m.message && !new_author {
                        current = e.oid.clone();
                    } else {
                        current = self.commit_tree_with(&tree, &current, &m, &message, sign, env)?;
                        if unchanged {
                            first_changed = Some(i);
                        }
                        unchanged = false;
                    }
                    group = Some((parent_of_new, parent_tree.clone(), m, message, i));
                    parent_tree
                }
            };
            let status = if !merged.conflicts.is_empty() {
                StepStatus::Conflict
            } else if tree == before_tree {
                StepStatus::Empty
            } else if after_conflict {
                StepStatus::AfterConflict
            } else {
                StepStatus::Ok
            };
            after_conflict |= !merged.conflicts.is_empty();
            steps.push(StepCheck { oid: e.oid.clone(), status, conflicts: merged.conflicts });
            current_tree = tree;
        }
        Ok(Replayed { head: current, tree: current_tree, steps, first_changed })
    }

    /// Checks a plan before it runs. The replay writes its objects to a temporary object directory, which
    /// goes away at the end, so the repository does not change at all.
    pub fn rewrite_check(&self, base: &str, plan: &[PlanEntry]) -> Result<RewriteCheck> {
        let range = self.rewrite_range(base)?;
        Self::validate_plan(&range, plan)?;
        let head = self.resolve("HEAD").ok_or_else(|| GitError("no HEAD".into()))?;
        let branch = self.state()?.branch.unwrap_or_default();
        let objects = String::from_utf8_lossy(&self.git(&["rev-parse", "--path-format=absolute", "--git-path", "objects"])?).trim().to_string();
        static NEXT: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);
        let n = NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let tmp = crate::app_dir(&self.git_dir()).join(format!("check-objects-{}-{n}", std::process::id()));
        std::fs::create_dir_all(&tmp).map_err(|e| GitError(e.to_string()))?;
        let tmp_s = tmp.to_string_lossy().into_owned();
        let env = [("GIT_OBJECT_DIRECTORY", tmp_s.as_str()), ("GIT_ALTERNATE_OBJECT_DIRECTORIES", objects.as_str())];
        let result = (|| {
            let done = self.replay(&range.base, plan, Some(&env))?;
            let head_tree = self.meta(&head)?.tree;
            let changed_files = if done.tree == head_tree {
                Vec::new()
            } else {
                let out = self.git_write(&["diff-tree", "-r", "--name-only", "-z", &head_tree, &done.tree], &env).map_err(|(_, e)| GitError(e))?;
                out.split('\0').filter(|s| !s.is_empty()).map(String::from).collect()
            };
            Ok::<_, GitError>((done, changed_files))
        })();
        let _ = std::fs::remove_dir_all(&tmp);
        let (done, changed_files) = result?;

        // Local changes that `reset --keep` would refuse to carry to the new tree.
        let mut blocking_files = Vec::new();
        if !changed_files.is_empty() {
            let list = |args: &[&str]| -> Vec<String> {
                self.git(args).map(|b| String::from_utf8_lossy(&b).split('\0').filter(|s| !s.is_empty()).map(String::from).collect()).unwrap_or_default()
            };
            let mut dirty = list(&["diff", "--name-only", "-z", "HEAD"]);
            dirty.extend(list(&["ls-files", "--others", "--exclude-standard", "-z"]));
            blocking_files = changed_files.iter().filter(|f| dirty.contains(f)).cloned().collect();
        }

        // The branches that have the commits that the plan rewrites.
        let mut remotes = Vec::new();
        let mut other_refs = Vec::new();
        if let Some(fc) = done.first_changed {
            let oldest = &range.entries[fc].oid;
            let refs = |pattern: &[&str]| -> Vec<String> {
                let mut args = vec!["for-each-ref", "--contains", oldest.as_str(), "--format=%(refname)"];
                args.extend_from_slice(pattern);
                self.git(&args).map(|b| String::from_utf8_lossy(&b).lines().map(String::from).collect()).unwrap_or_default()
            };
            let has_parent = !self.meta(oldest)?.parents.is_empty();
            for r in refs(&["refs/remotes"]) {
                let name = r.trim_start_matches("refs/remotes/").to_string();
                if name.ends_with("/HEAD") {
                    continue;
                }
                let Ok(mb) = self.git(&["merge-base", &name, "HEAD"]) else { continue };
                let mb = String::from_utf8_lossy(&mb).trim().to_string();
                let exclude = format!("^{oldest}^");
                let mut args = vec!["rev-list", "--count", mb.as_str()];
                if has_parent {
                    args.push(&exclude);
                }
                let commits = self.git(&args).ok().and_then(|b| String::from_utf8_lossy(&b).trim().parse().ok()).unwrap_or(0);
                remotes.push(RemoteHit { name, commits });
            }
            let own = format!("refs/heads/{branch}");
            for r in refs(&["refs/heads", "refs/tags"]) {
                if r != own {
                    other_refs.push(r.trim_start_matches("refs/heads/").trim_start_matches("refs/").to_string());
                }
            }
        }
        Ok(RewriteCheck {
            head,
            steps: done.steps,
            first_changed: done.first_changed.map(|i| i as u32),
            changed_files,
            remotes,
            other_refs,
            blocking_files,
        })
    }

    /// Takes the changes of `paths` out of the commit `oid` of the current branch, in memory. Without
    /// `extract`, the changes go away (Drop Selected Changes). With `extract`, they go into a new commit
    /// right after it, with that message (Extract Selected Changes to Separate Commit). The later commits
    /// are replayed on top. A conflict stops the rewrite before any ref changes.
    pub fn rewrite_files(&self, oid: &str, paths: &[String], extract: Option<&str>) -> Result<OpResult> {
        if paths.is_empty() {
            return Err(GitError("Choose the files first".into()));
        }
        let m = self.meta(oid)?;
        if m.parents.len() != 1 {
            return Err(GitError("Only a commit with one parent can lose or give away changes".into()));
        }
        if extract.is_some_and(|msg| msg.trim().is_empty()) {
            return Err(GitError("The message of the new commit is empty".into()));
        }
        let parent = m.parents[0].clone();
        let range = self.rewrite_range(&parent)?;
        let Some((first, later)) = range.entries.split_first() else {
            return Err(GitError("The commit is not on the current branch".into()));
        };
        if first.oid != self.resolve(oid).unwrap_or_default() {
            return Err(GitError("The commit is not on the current branch".into()));
        }
        // The tree of the commit with the files as in its parent.
        let tmp = crate::app_dir(&self.git_dir()).join("index.rewrite");
        std::fs::create_dir_all(tmp.parent().unwrap()).map_err(|e| GitError(e.to_string()))?;
        let _ = std::fs::remove_file(&tmp);
        let tmp_s = tmp.to_string_lossy().into_owned();
        let env = [("GIT_INDEX_FILE", tmp_s.as_str())];
        let run = |args: &[&str]| self.git_write(args, &env).map_err(|(_, e)| GitError(e));
        let without = (|| {
            run(&["read-tree", &first.oid])?;
            for p in paths {
                let p = crate::ops::safe(p)?;
                let entry = self.git(&["ls-tree", &parent, "--", p]).map(|b| String::from_utf8_lossy(&b).trim().to_string()).unwrap_or_default();
                match entry.split_once('\t').map(|(info, _)| info.split_whitespace().collect::<Vec<_>>()) {
                    Some(f) if f.len() == 3 => run(&["update-index", "--add", "--cacheinfo", &format!("{},{},{p}", f[0], f[2])])?,
                    _ => run(&["update-index", "--force-remove", "--", p])?,
                };
            }
            run(&["write-tree"]).map(|t| t.trim().to_string())
        })();
        let _ = std::fs::remove_file(&tmp);
        let without = without?;
        if without == m.tree {
            return Err(GitError("The commit does not change these files".into()));
        }
        let old_head = self.resolve("HEAD").ok_or_else(|| GitError("no HEAD".into()))?;
        let branch = self.state()?.branch.unwrap_or_default();
        let mut current = self.commit_tree(&without, &parent, &m, &m.message)?;
        let mut current_tree = without;
        if let Some(msg) = extract {
            current = self.commit_tree(&m.tree, &current, &m, msg.trim())?;
            current_tree = m.tree.clone();
        }
        for e in later {
            let em = self.meta(&e.oid)?;
            let tree = self.merge_tree(&em.parents[0], &current, &e.oid, &e.oid)?;
            current = self.commit_tree(&tree, &current, &em, &em.message)?;
            current_tree = tree;
        }
        let what = if extract.is_some() { "Extract the changes to a new commit" } else { "Drop the changes" };
        let reflog = format!("gittor: {what}");
        let head_tree = self.meta(&old_head)?.tree;
        let moved = if head_tree == current_tree {
            self.git_write(&["update-ref", "-m", &reflog, &format!("refs/heads/{branch}"), &current, &old_head], &[])
        } else {
            self.git_write(&["reset", "--keep", &current], &[("GIT_REFLOG_ACTION", &reflog)])
        };
        if let Err((_, e)) = moved {
            return Err(GitError(format!("The branch was not changed: {e}")));
        }
        let n = paths.len();
        let files = if n == 1 { "1 file".to_string() } else { format!("{n} files") };
        let message = match extract {
            Some(_) => format!("Moved the changes of {files} to a new commit after {}", &first.oid[..8]),
            None => format!("Dropped the changes of {files} from {}", &first.oid[..8]),
        };
        let undo = vec![UndoAction::Reset { to: old_head, expected_head: current, mode: UndoMode::Keep }];
        Ok(OpResult { ok: true, message, conflicts: Vec::new(), undo })
    }

    /// Runs a real `git rebase -i` with the plan as its todo list, for a plan that stops to edit a commit.
    /// New messages are set with `exec git commit --amend` lines. Local changes are stashed and restored.
    fn rebase_interactive(&self, base: &str, plan: &[PlanEntry], what: &str) -> Result<OpResult> {
        let old_head = self.resolve("HEAD").ok_or_else(|| GitError("no HEAD".into()))?;
        let dir = crate::app_dir(&self.git_dir());
        std::fs::create_dir_all(&dir).map_err(|e| GitError(e.to_string()))?;
        let mut todo = String::new();
        let mut group_message: Option<&str> = None;
        for (i, e) in plan.iter().enumerate() {
            let word = match e.action {
                Action::Pick | Action::Reword => "pick",
                Action::Edit => "edit",
                Action::Squash => "squash",
                Action::Fixup => "fixup",
                Action::Drop => "drop",
            };
            todo.push_str(&format!("{word} {}\n", e.oid));
            if e.action == Action::Drop {
                continue;
            }
            if let Some(m) = e.message.as_deref() {
                group_message = Some(m);
            }
            // At the end of a squash group, set the chosen message.
            let group_ends = !plan[i + 1..].iter().find(|n| n.action != Action::Drop).is_some_and(|n| matches!(n.action, Action::Squash | Action::Fixup));
            if group_ends {
                if let Some(m) = group_message.take() {
                    let file = dir.join(format!("message-{i}.txt"));
                    std::fs::write(&file, m).map_err(|e| GitError(e.to_string()))?;
                    todo.push_str(&format!("exec git commit --amend --allow-empty -q -F {}\n", shell_quote(&file.to_string_lossy())));
                }
            }
        }
        let todo_file = dir.join("rebase-todo.txt");
        std::fs::write(&todo_file, todo).map_err(|e| GitError(e.to_string()))?;
        let editor = format!("cp {}", shell_quote(&todo_file.to_string_lossy()));
        let reflog = format!("gittor: {what}");
        let env = [("GIT_SEQUENCE_EDITOR", editor.as_str()), ("GIT_REFLOG_ACTION", reflog.as_str())];
        let start = if base.is_empty() { "--root" } else { base };
        let result = self.git_write(&["rebase", "-i", "--autostash", "--empty=keep", start], &env);
        let state = self.state()?;
        match result {
            Ok(_) if state.operation == "rebase" => {
                let at = state.editing.clone().or(state.head.clone()).unwrap_or_default();
                Ok(OpResult {
                    ok: true,
                    message: format!(
                        "The rebase stopped at {} for editing. Change the files, amend the commit in the Changes tab, then continue.",
                        &at[..at.len().min(8)]
                    ),
                    conflicts: Vec::new(),
                    undo: Vec::new(),
                })
            }
            Ok(_) => {
                let head = state.head.clone().unwrap_or_default();
                let undo = vec![UndoAction::Reset { to: old_head, expected_head: head, mode: UndoMode::Keep }];
                Ok(OpResult { ok: true, message: format!("{what} done"), conflicts: Vec::new(), undo })
            }
            Err((_, e)) => Ok(self.stopped("The rebase", e)),
        }
    }

    /// Applies the change `base -> commit` on top of `onto` without touching the working tree.
    pub(crate) fn merge_tree(&self, base: &str, onto: &str, commit: &str, label: &str) -> Result<String> {
        let args = if base.is_empty() {
            vec!["merge-tree".to_string(), "--write-tree".into(), "--allow-unrelated-histories".into(), onto.into(), commit.into()]
        } else {
            vec!["merge-tree".to_string(), "--write-tree".into(), format!("--merge-base={base}"), onto.into(), commit.into()]
        };
        let argv: Vec<&str> = args.iter().map(String::as_str).collect();
        match self.git_write(&argv, &[]) {
            Ok(out) => Ok(out.lines().next().unwrap_or("").to_string()),
            Err((out, _)) => {
                let files: Vec<&str> = out.lines().skip(1).filter_map(|l| l.split('\t').nth(1)).collect();
                let mut files = files;
                files.dedup();
                Err(GitError(format!(
                    "Commit {} conflicts with the new history ({}). Nothing was changed",
                    &label[..label.len().min(8)],
                    if files.is_empty() { "unknown files".into() } else { files.join(", ") }
                )))
            }
        }
    }

    /// Applies the change `base -> commit` on top of `onto`, and gives the tree with the conflicting files.
    /// A conflict is not an error: the tree then has conflict markers.
    fn merge_tree_full(&self, base: &str, onto: &str, commit: &str, env: &[(&str, &str)]) -> Result<Merged> {
        let mut args = vec!["merge-tree", "--write-tree", "-z", "--name-only"];
        let merge_base = format!("--merge-base={base}");
        if base.is_empty() {
            args.push("--allow-unrelated-histories");
        } else {
            args.push(&merge_base);
        }
        args.extend([onto, commit]);
        let out = match self.git_write(&args, env) {
            Ok(out) => return Ok(Merged { tree: out.split('\0').next().unwrap_or("").trim().to_string(), conflicts: Vec::new() }),
            Err((out, e)) if out.is_empty() => return Err(GitError(e)),
            Err((out, _)) => out,
        };
        Ok(parse_merge_tree(&out))
    }

    pub(crate) fn commit_tree(&self, tree: &str, parent: &str, author: &CommitMeta, message: &str) -> Result<String> {
        self.commit_tree_with(tree, parent, author, message, self.signs_commits(), &[])
    }

    /// `commit_tree` with a choice of signing and extra environment (a temporary object directory).
    fn commit_tree_with(&self, tree: &str, parent: &str, author: &CommitMeta, message: &str, sign: bool, extra: &[(&str, &str)]) -> Result<String> {
        let mut env = vec![
            ("GIT_AUTHOR_NAME", author.author_name.as_str()),
            ("GIT_AUTHOR_EMAIL", author.author_email.as_str()),
            ("GIT_AUTHOR_DATE", author.author_date.as_str()),
        ];
        let mut args = vec!["commit-tree", tree, "-m", message];
        if !parent.is_empty() {
            args.extend(["-p", parent]);
        }
        if sign {
            args.push("-S");
        }
        env.extend_from_slice(extra);
        self.git_write(&args, &env).map_err(|(_, e)| GitError(e))
    }

    /// `commit.gpgsign` is on. git commit signs by itself, but git commit-tree signs only with `-S`; it then
    /// uses `user.signingkey` and `gpg.format` like git commit.
    pub(crate) fn signs_commits(&self) -> bool {
        self.git(&["config", "--type=bool", "commit.gpgsign"]).is_ok_and(|b| String::from_utf8_lossy(&b).trim() == "true")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_conflicts_of_merge_tree() {
        let out = "t1\0a.txt\0b.txt\0\0\x31\0a.txt\0Auto-merging\0Auto-merging a.txt\n\0\x31\0a.txt\0CONFLICT (contents)\0Merge conflict in a.txt\n\0\x31\0b.txt\0CONFLICT (modify/delete)\0b.txt deleted\n\0";
        let m = parse_merge_tree(out);
        assert_eq!(m.tree, "t1");
        assert_eq!(m.conflicts, vec![
            ConflictFile { path: "a.txt".into(), kind: "contents".into() },
            ConflictFile { path: "b.txt".into(), kind: "modify/delete".into() },
        ]);
    }
}
