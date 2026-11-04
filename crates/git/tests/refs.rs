//! The list of refs: each branch and tag names the author of its last commit.

use gittor_git::Repo;
use std::path::Path;
use std::process::Command;

fn git(dir: &Path, args: &[&str]) {
    let out = Command::new("git").arg("-C").arg(dir).args(args).output().unwrap();
    assert!(out.status.success(), "git {args:?}: {}", String::from_utf8_lossy(&out.stderr));
}

#[test]
fn refs_name_the_author_of_the_last_commit() {
    let dir = std::env::temp_dir().join(format!("gittor-refs-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    git(&dir, &["init", "-q", "-b", "main"]);
    git(&dir, &["config", "commit.gpgsign", "false"]);
    git(&dir, &["config", "tag.gpgsign", "false"]);
    git(&dir, &["config", "user.email", "a@example.com"]);
    git(&dir, &["-c", "user.name=Ada", "commit", "-q", "--allow-empty", "-m", "One"]);
    git(&dir, &["checkout", "-q", "-b", "feature"]);
    git(&dir, &["-c", "user.name=Grace", "commit", "-q", "--allow-empty", "-m", "Two"]);
    // An annotated tag: its tagger is not the author of its commit.
    git(&dir, &["-c", "user.name=Linus", "tag", "-a", "v1", "-m", "Version 1", "main"]);

    let refs = Repo::open(&dir).unwrap().list_refs().unwrap();
    let author = |name: &str| refs.iter().find(|r| r.name == name).unwrap().author.clone();
    assert_eq!(author("main"), "Ada");
    assert_eq!(author("feature"), "Grace");
    assert_eq!(author("v1"), "Ada", "a tag names the author of its commit, not the tagger");
    let _ = std::fs::remove_dir_all(&dir);
}
