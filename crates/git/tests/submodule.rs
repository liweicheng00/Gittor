//! Submodules in the diff and the submodule list, Git LFS content, and clean filters in a partial commit.

use gittor_git::changelist::PartialFile;
use gittor_git::submodule::SubmoduleState;
use gittor_git::{Repo, Rev};
use std::path::Path;
use std::process::Command;

fn git(dir: &Path, args: &[&str]) -> String {
    // A local submodule URL needs the file protocol, which git blocks by default.
    let out = Command::new("git")
        .arg("-C")
        .arg(dir)
        .args(["-c", "protocol.file.allow=always"])
        .args(args)
        .output()
        .unwrap();
    assert!(out.status.success(), "git {args:?}: {}", String::from_utf8_lossy(&out.stderr));
    String::from_utf8_lossy(&out.stdout).trim().to_string()
}

fn init(dir: &Path) {
    std::fs::create_dir_all(dir).unwrap();
    git(dir, &["init", "-q", "-b", "main"]);
    git(dir, &["config", "user.name", "Test"]);
    git(dir, &["config", "user.email", "test@example.com"]);
    git(dir, &["config", "commit.gpgsign", "false"]);
}

fn temp(name: &str) -> std::path::PathBuf {
    let dir = std::env::temp_dir().join(format!("gittor-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    dir
}

#[test]
fn submodules() {
    // The clone of `submodule update` runs in a child process: allow the file protocol there too.
    std::env::set_var("GIT_CONFIG_COUNT", "1");
    std::env::set_var("GIT_CONFIG_KEY_0", "protocol.file.allow");
    std::env::set_var("GIT_CONFIG_VALUE_0", "always");
    let base = temp("submodule");
    let lib = base.join("lib");
    init(&lib);
    std::fs::write(lib.join("lib.rs"), "one\n").unwrap();
    git(&lib, &["add", "."]);
    git(&lib, &["commit", "-q", "-m", "One"]);
    let c1 = git(&lib, &["rev-parse", "HEAD"]);
    std::fs::write(lib.join("lib.rs"), "two\n").unwrap();
    git(&lib, &["commit", "-q", "-am", "Two"]);
    let c2 = git(&lib, &["rev-parse", "HEAD"]);

    let app = base.join("app");
    init(&app);
    git(&app, &["submodule", "add", "-q", lib.to_str().unwrap(), "vendor/lib"]);
    git(&app, &["commit", "-q", "-m", "Add lib"]);
    let head = git(&app, &["rev-parse", "HEAD"]);
    let repo = Repo::open(&app).unwrap();

    let subs = repo.submodules().unwrap();
    assert_eq!(subs.len(), 1);
    assert_eq!(subs[0].path, "vendor/lib");
    assert_eq!(subs[0].state, SubmoduleState::Clean);
    assert_eq!(subs[0].recorded, c2);
    assert_eq!(subs[0].url.as_deref(), lib.to_str());
    assert_eq!(subs[0].name, "vendor/lib");
    assert_eq!(subs[0].branch.as_deref(), Some("main"));
    assert!(!subs[0].dirty && !subs[0].untracked);

    // Another commit in the submodule: the diff shows the two commits.
    git(&app.join("vendor/lib"), &["checkout", "-q", &c1]);
    let subs = repo.submodules().unwrap();
    assert_eq!(subs[0].state, SubmoduleState::OtherCommit);
    assert_eq!(subs[0].recorded, c2);
    assert_eq!(subs[0].current.as_deref(), Some(c1.as_str()));
    let left = repo.file_content(&Rev::Commit(head.clone()), "vendor/lib").unwrap();
    let right = repo.file_content(&Rev::WorkTree, "vendor/lib").unwrap();
    assert_eq!(left.text.as_deref(), Some(format!("Subproject commit {c2}\n").as_str()));
    assert_eq!(right.text.as_deref(), Some(format!("Subproject commit {c1}\n").as_str()));
    assert_eq!(left.note.as_deref(), Some("Submodule"));

    // A local change in the submodule marks it dirty.
    std::fs::write(app.join("vendor/lib/lib.rs"), "local\n").unwrap();
    assert!(repo.submodules().unwrap()[0].dirty);
    assert!(repo.file_content(&Rev::WorkTree, "vendor/lib").unwrap().text.unwrap().ends_with("-dirty\n"));
    git(&app.join("vendor/lib"), &["checkout", "-q", "--", "."]);

    // Rollback checks out the recorded commit again.
    repo.rollback(&["vendor/lib".to_string()]).unwrap();
    assert_eq!(git(&app.join("vendor/lib"), &["rev-parse", "HEAD"]), c2);
    assert_eq!(repo.submodules().unwrap()[0].state, SubmoduleState::Clean);

    // An uninitialized submodule is initialized by Update.
    git(&app, &["submodule", "deinit", "-q", "-f", "vendor/lib"]);
    assert_eq!(repo.submodules().unwrap()[0].state, SubmoduleState::Uninitialized);
    let r = repo.update_submodules(&[]).unwrap();
    assert!(r.ok, "{}", r.message);
    assert_eq!(repo.submodules().unwrap()[0].state, SubmoduleState::Clean);
    assert!(app.join("vendor/lib/lib.rs").exists());

    // A repository without submodules has an empty list.
    assert!(Repo::open(&lib).unwrap().submodules().unwrap().is_empty());
}

#[test]
fn submodule_range() {
    std::env::set_var("GIT_CONFIG_COUNT", "1");
    std::env::set_var("GIT_CONFIG_KEY_0", "protocol.file.allow");
    std::env::set_var("GIT_CONFIG_VALUE_0", "always");
    let base = temp("subrange");
    let lib = base.join("lib");
    init(&lib);
    let mut commits = Vec::new();
    for n in ["One", "Two", "Three"] {
        std::fs::write(lib.join("lib.rs"), format!("{n}\n")).unwrap();
        git(&lib, &["add", "."]);
        git(&lib, &["commit", "-q", "-m", n]);
        commits.push(git(&lib, &["rev-parse", "HEAD"]));
    }
    let app = base.join("app");
    init(&app);
    git(&app, &["submodule", "add", "-q", "-b", "main", "--name", "lib", lib.to_str().unwrap(), "vendor/lib"]);
    git(&app, &["commit", "-q", "-m", "Add lib"]);
    let sub = app.join("vendor/lib");
    let repo = Repo::open(&app).unwrap();

    // The name and the branch setting come from .gitmodules.
    let s = &repo.submodules().unwrap()[0];
    assert_eq!((s.name.as_str(), s.track_branch.as_deref()), ("lib", Some("main")));
    let r = repo.submodule_range("vendor/lib").unwrap();
    assert!(r.behind.is_empty() && r.ahead.is_empty() && r.changes.is_empty() && !r.recorded_missing);

    // Behind: the checked-out commit is two commits older than the recorded commit. HEAD is detached.
    git(&sub, &["checkout", "-q", &commits[0]]);
    let s = &repo.submodules().unwrap()[0];
    assert_eq!(s.state, SubmoduleState::OtherCommit);
    assert_eq!(s.branch, None);
    let r = repo.submodule_range("vendor/lib").unwrap();
    assert_eq!(r.behind.iter().map(|c| c.subject.as_str()).collect::<Vec<_>>(), ["Three", "Two"]);
    assert!(r.ahead.is_empty());

    // Diverged: a new commit on top of the old commit.
    std::fs::write(sub.join("lib.rs"), "Local\n").unwrap();
    git(&sub, &["-c", "user.name=T", "-c", "user.email=t@e", "-c", "commit.gpgsign=false", "commit", "-q", "-am", "Local"]);
    let r = repo.submodule_range("vendor/lib").unwrap();
    assert_eq!(r.behind.len(), 2);
    assert_eq!(r.ahead.iter().map(|c| c.subject.as_str()).collect::<Vec<_>>(), ["Local"]);

    // Local changes: a changed file and a file that git does not track.
    std::fs::write(sub.join("lib.rs"), "Changed\n").unwrap();
    std::fs::write(sub.join("new.rs"), "new\n").unwrap();
    let s = &repo.submodules().unwrap()[0];
    assert!(s.dirty && s.untracked);
    let r = repo.submodule_range("vendor/lib").unwrap();
    let changes: Vec<(char, &str)> = r.changes.iter().map(|c| (c.status, c.path.as_str())).collect();
    assert_eq!(changes, [('M', "lib.rs"), ('?', "new.rs")]);

    // A recorded commit that the submodule does not have.
    let other = base.join("other");
    init(&other);
    std::fs::write(other.join("x"), "x\n").unwrap();
    git(&other, &["add", "."]);
    git(&other, &["commit", "-q", "-m", "X"]);
    let foreign = git(&other, &["rev-parse", "HEAD"]);
    git(&app, &["update-index", "--cacheinfo", &format!("160000,{foreign},vendor/lib")]);
    let r = repo.submodule_range("vendor/lib").unwrap();
    assert!(r.recorded_missing);
    assert_eq!(r.recorded, foreign);
    assert!(r.behind.is_empty() && r.ahead.is_empty());
    assert!(repo.submodule_range("lib.rs").is_err());
}

#[test]
fn lfs_content() {
    let dir = temp("lfs");
    init(&dir);
    let real = b"large binary-like content\n";
    let oid = "0f343b0931126a20f133d67c2b018a3b5c7d6e5d5b2b8b0b1d6bd8c6f7b3a1c2";
    let pointer = format!("version https://git-lfs.github.com/spec/v1\noid sha256:{oid}\nsize {}\n", real.len());
    std::fs::write(dir.join("big.bin"), &pointer).unwrap();
    git(&dir, &["add", "."]);
    git(&dir, &["commit", "-q", "-m", "LFS"]);
    let head = git(&dir, &["rev-parse", "HEAD"]);
    let repo = Repo::open(&dir).unwrap();

    // Not downloaded: the pointer and a note.
    let c = repo.file_content(&Rev::Commit(head.clone()), "big.bin").unwrap();
    assert_eq!(c.text.as_deref(), Some(pointer.as_str()));
    assert!(c.note.unwrap().contains("not downloaded"));

    // Downloaded: the real content.
    let store = dir.join(".git/lfs/objects").join(&oid[..2]).join(&oid[2..4]);
    std::fs::create_dir_all(&store).unwrap();
    std::fs::write(store.join(oid), real).unwrap();
    let c = repo.file_content(&Rev::Commit(head), "big.bin").unwrap();
    assert_eq!(c.text.as_deref().map(str::as_bytes), Some(&real[..]));
    assert!(c.note.is_none());
}

#[test]
fn partial_commit_runs_clean_filters() {
    let dir = temp("filter");
    init(&dir);
    // A clean filter like Git LFS: what goes into git differs from the working tree.
    git(&dir, &["config", "filter.upper.clean", "tr a-z A-Z"]);
    git(&dir, &["config", "filter.upper.smudge", "cat"]);
    std::fs::write(dir.join(".gitattributes"), "*.up filter=upper\n").unwrap();
    std::fs::write(dir.join("a.up"), "one\n").unwrap();
    git(&dir, &["add", "."]);
    git(&dir, &["commit", "-q", "-m", "A"]);
    std::fs::write(dir.join("a.up"), "one\ntwo\nthree\n").unwrap();
    let repo = Repo::open(&dir).unwrap();
    let partial = [PartialFile { path: "a.up".into(), content: "one\ntwo\n".into() }];
    let r = repo.commit_partial(&[], &[], &partial, "Part", false).unwrap();
    assert!(r.ok, "{}", r.message);
    assert_eq!(git(&dir, &["show", "HEAD:a.up"]), "ONE\nTWO");
}
