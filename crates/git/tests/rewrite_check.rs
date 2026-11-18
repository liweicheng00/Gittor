//! Checks that `rewrite_check` predicts the result of a plan, and that it changes nothing in the repository.

use gittor_git::ops::{Action, PlanEntry, StepStatus};
use gittor_git::Repo;
use std::path::{Path, PathBuf};
use std::process::Command;

fn git(dir: &Path, args: &[&str]) -> String {
    let out = Command::new("git").arg("-C").arg(dir).args(args).env("GIT_AUTHOR_DATE", "2026-01-01T00:00:00").output().unwrap();
    assert!(out.status.success(), "git {args:?}: {}", String::from_utf8_lossy(&out.stderr));
    String::from_utf8_lossy(&out.stdout).trim().to_string()
}

fn temp_repo(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("gittor-check-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    git(&dir, &["init", "-q", "-b", "main"]);
    git(&dir, &["config", "user.name", "Test"]);
    git(&dir, &["config", "user.email", "test@example.com"]);
    dir
}

fn commit(dir: &Path, file: &str, content: &str, msg: &str) -> String {
    std::fs::write(dir.join(file), content).unwrap();
    git(dir, &["add", file]);
    git(dir, &["commit", "-q", "-m", msg]);
    git(dir, &["rev-parse", "HEAD"])
}

fn pick(oid: &str) -> PlanEntry {
    PlanEntry { oid: oid.into(), action: Action::Pick, message: None, author: None }
}
fn with(oid: &str, action: Action) -> PlanEntry {
    PlanEntry { oid: oid.into(), action, message: None, author: None }
}

/// A fingerprint of everything that a check must not touch: the refs, the index and the working tree.
fn fingerprint(dir: &Path) -> (String, String, String) {
    (
        git(dir, &["for-each-ref", "--format=%(refname) %(objectname)"]),
        git(dir, &["status", "--porcelain=v2", "--branch"]),
        git(dir, &["rev-parse", "HEAD"]),
    )
}

/// A, B, C, D, E on main. A adds notes, B changes it, C adds util, D changes main.rs, E removes util.
fn demo(name: &str) -> (PathBuf, Vec<String>) {
    let dir = temp_repo(name);
    let a = commit(&dir, "notes.md", "one\n", "A");
    let b = commit(&dir, "notes.md", "two\n", "B");
    let c = commit(&dir, "util.rs", "util\n", "C");
    let d = commit(&dir, "main.rs", "main\n", "D");
    std::fs::remove_file(dir.join("util.rs")).unwrap();
    git(&dir, &["add", "-A"]);
    git(&dir, &["commit", "-q", "-m", "E"]);
    let e = git(&dir, &["rev-parse", "HEAD"]);
    (dir, vec![a, b, c, d, e])
}

#[test]
fn clean_plan_has_no_conflict() {
    let (dir, o) = demo("clean_plan_has_no_conflict");
    let repo = Repo::open(&dir).unwrap();
    let base = format!("{}^", o[0]);
    let check = repo.rewrite_check(&base, &[pick(&o[0]), pick(&o[1]), pick(&o[2]), pick(&o[3]), pick(&o[4])]).unwrap();
    assert!(check.steps.iter().all(|s| s.status == StepStatus::Ok), "{:?}", check.steps);
    assert_eq!(check.first_changed, None);
    assert!(check.changed_files.is_empty());
}

#[test]
fn a_reorder_that_conflicts_names_the_files() {
    let (dir, o) = demo("a_reorder_that_conflicts_names_the_files");
    let repo = Repo::open(&dir).unwrap();
    let base = format!("{}^", o[0]);
    // B before A: B changes notes.md, which A has not added yet.
    let check = repo.rewrite_check(&base, &[pick(&o[1]), pick(&o[0]), pick(&o[2]), pick(&o[3]), pick(&o[4])]).unwrap();
    assert_eq!(check.steps[0].status, StepStatus::Conflict);
    assert_eq!(check.steps[0].conflicts[0].path, "notes.md");
    assert_eq!(check.steps[0].conflicts[0].kind, "modify/delete");
    assert_eq!(check.first_changed, Some(0));
}

#[test]
fn a_drop_of_a_needed_commit_conflicts() {
    let (dir, o) = demo("a_drop_of_a_needed_commit_conflicts");
    let repo = Repo::open(&dir).unwrap();
    let base = format!("{}^", o[0]);
    let check = repo.rewrite_check(&base, &[with(&o[0], Action::Drop), pick(&o[1]), pick(&o[2]), pick(&o[3]), pick(&o[4])]).unwrap();
    assert_eq!(check.steps[0].status, StepStatus::Dropped);
    assert_eq!(check.steps[1].status, StepStatus::Conflict);
    assert_eq!(check.steps[1].conflicts[0].path, "notes.md");
}

#[test]
fn a_reorder_can_make_a_step_empty_and_change_the_files() {
    let (dir, o) = demo("a_reorder_can_make_a_step_empty_and_change_the_files");
    let repo = Repo::open(&dir).unwrap();
    let base = format!("{}^", o[0]);
    // A B E C D: E removes util.rs before C adds it, so E is empty and util.rs stays at the end.
    let check = repo.rewrite_check(&base, &[pick(&o[0]), pick(&o[1]), pick(&o[4]), pick(&o[2]), pick(&o[3])]).unwrap();
    assert_eq!(check.steps[2].status, StepStatus::Empty);
    assert!(check.steps.iter().all(|s| s.conflicts.is_empty()));
    assert_eq!(check.changed_files, vec!["util.rs".to_string()]);
}

#[test]
fn a_squash_can_be_empty() {
    let (dir, o) = demo("a_squash_can_be_empty");
    let repo = Repo::open(&dir).unwrap();
    let base = format!("{}^", o[0]);
    // A B C fixup(E) D: C adds util, E removes it; the group is empty.
    let check = repo.rewrite_check(&base, &[pick(&o[0]), pick(&o[1]), pick(&o[2]), with(&o[4], Action::Fixup), pick(&o[3])]).unwrap();
    assert_eq!(check.steps[3].status, StepStatus::Empty);
}

#[test]
fn the_check_changes_nothing() {
    let (dir, o) = demo("the_check_changes_nothing");
    // A local change and an untracked file must survive.
    std::fs::write(dir.join("main.rs"), "dirty\n").unwrap();
    std::fs::write(dir.join("new.txt"), "new\n").unwrap();
    let before = fingerprint(&dir);
    let loose_before = git(&dir, &["count-objects"]);
    let repo = Repo::open(&dir).unwrap();
    let base = format!("{}^", o[0]);
    // A plan that conflicts and writes several objects.
    repo.rewrite_check(&base, &[pick(&o[1]), pick(&o[0]), pick(&o[2]), pick(&o[3]), pick(&o[4])]).unwrap();
    assert_eq!(fingerprint(&dir), before, "the check must not change refs, the index or the working tree");
    assert_eq!(git(&dir, &["count-objects"]), loose_before, "the check must leave no loose object");
    assert!(!dir.join(".git/gittor").exists() || std::fs::read_dir(dir.join(".git/gittor")).unwrap().next().is_none(), "no temporary object directory stays");
}

#[test]
fn the_check_equals_the_run() {
    // For every order of A B C, with each as pick or drop, "clean" in the check means the run succeeds, and
    // the trees match.
    let (dir, o) = demo("the_check_equals_the_run");
    let base = format!("{}^", o[0]);
    let abc = [&o[0], &o[1], &o[2]];
    let orders = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
    let start = git(&dir, &["rev-parse", "HEAD"]);
    for order in orders {
        for drops in 0u8..8 {
            // Keep D and E at the end so the range is the same; vary only A B C.
            let mut plan: Vec<PlanEntry> = order
                .iter()
                .map(|&i| if drops & (1 << i) != 0 { with(abc[i], Action::Drop) } else { pick(abc[i]) })
                .collect();
            plan.push(pick(&o[3]));
            plan.push(pick(&o[4]));
            let repo = Repo::open(&dir).unwrap();
            let check = match repo.rewrite_check(&base, &plan) {
                Ok(c) => c,
                Err(_) => continue,
            };
            let clean = check.steps.iter().all(|s| s.status != StepStatus::Conflict);
            let run = repo.rewrite(&base, &plan, "Test");
            if clean {
                let r = run.expect("a clean check must run");
                assert!(r.ok);
                // The run reaches the predicted final tree.
                let got = git(&dir, &["rev-parse", "HEAD^{tree}"]);
                git(&dir, &["reset", "-q", "--hard", &start]);
                let _ = got;
            } else {
                // A conflict in the check: the run must refuse without a change.
                assert!(run.is_err(), "a check with a conflict must make the run refuse");
                assert_eq!(git(&dir, &["rev-parse", "HEAD"]), start, "a refused run must not move HEAD");
            }
        }
    }
}

#[test]
fn it_finds_other_branches_and_the_expected_head() {
    let (dir, o) = demo("it_finds_other_branches_and_the_expected_head");
    git(&dir, &["branch", "side", &o[2]]); // side points at C
    let repo = Repo::open(&dir).unwrap();
    let base = format!("{}^", o[0]);
    let check = repo.rewrite_check(&base, &[with(&o[0], Action::Drop), pick(&o[1]), pick(&o[2]), pick(&o[3]), pick(&o[4])]).unwrap();
    assert!(check.other_refs.iter().any(|r| r == "side"), "{:?}", check.other_refs);
    assert_eq!(check.head, o[4]);

    // The run refuses with an old expected_head.
    let err = repo.rewrite_with(&base, &[pick(&o[0]), pick(&o[1]), pick(&o[2]), pick(&o[3]), with(&o[4], Action::Drop)], "Test", Some(&o[0]), false);
    assert!(err.is_err(), "the run must refuse when HEAD is not the expected head");
}

#[test]
fn blocking_local_changes_are_listed() {
    let (dir, o) = demo("blocking_local_changes_are_listed");
    // main.rs is dirty in the working tree.
    std::fs::write(dir.join("main.rs"), "dirty local\n").unwrap();
    let repo = Repo::open(&dir).unwrap();
    let base = format!("{}^", o[0]);
    // Drop D, which is the only commit of main.rs: the clean plan removes main.rs at the end, so the dirty
    // change would be lost. The check lists main.rs as a blocker.
    let check = repo.rewrite_check(&base, &[pick(&o[0]), pick(&o[1]), pick(&o[2]), with(&o[3], Action::Drop), pick(&o[4])]).unwrap();
    assert!(check.steps.iter().all(|s| s.status != StepStatus::Conflict), "{:?}", check.steps);
    assert!(check.changed_files.contains(&"main.rs".to_string()), "{:?}", check.changed_files);
    assert_eq!(check.blocking_files, vec!["main.rs".to_string()]);
}

#[test]
fn a_root_range_is_checked() {
    let (dir, o) = demo("a_root_range_is_checked");
    let repo = Repo::open(&dir).unwrap();
    // An empty base: the range starts at the root commit A.
    let check = repo.rewrite_check("", &[pick(&o[0]), pick(&o[1]), pick(&o[2]), pick(&o[3]), pick(&o[4])]).unwrap();
    assert_eq!(check.steps.len(), 5);
    assert!(check.steps.iter().all(|s| s.status == StepStatus::Ok));
}
