//! Images of the repository for the Markdown preview: data URLs, and paths outside the repository.

use gittor_git::{Repo, Rev};
use std::path::Path;
use std::process::Command;

fn git(dir: &Path, args: &[&str]) -> String {
    let out = Command::new("git").arg("-C").arg(dir).args(args).output().unwrap();
    assert!(out.status.success(), "git {args:?}: {}", String::from_utf8_lossy(&out.stderr));
    String::from_utf8_lossy(&out.stdout).trim().to_string()
}

#[test]
fn image_data() {
    let dir = std::env::temp_dir().join(format!("gittor-image-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(dir.join("docs")).unwrap();
    git(&dir, &["init", "-q", "-b", "main"]);
    git(&dir, &["config", "user.name", "T"]);
    git(&dir, &["config", "user.email", "t@e"]);
    git(&dir, &["config", "commit.gpgsign", "false"]);
    std::fs::write(dir.join("docs/a.png"), b"foo").unwrap();
    std::fs::write(dir.join("notes.txt"), b"text").unwrap();
    git(&dir, &["add", "."]);
    git(&dir, &["commit", "-q", "-m", "Add"]);
    let head = git(&dir, &["rev-parse", "HEAD"]);
    std::fs::write(dir.join("docs/a.png"), b"foobar").unwrap();
    let repo = Repo::open(&dir).unwrap();

    // The working tree and a commit have their own version of the file.
    assert_eq!(repo.image_data(&Rev::WorkTree, "docs/a.png").unwrap().as_deref(), Some("data:image/png;base64,Zm9vYmFy"));
    assert_eq!(repo.image_data(&Rev::Commit(head), "docs/a.png").unwrap().as_deref(), Some("data:image/png;base64,Zm9v"));
    // Not an image, or not there.
    assert_eq!(repo.image_data(&Rev::WorkTree, "notes.txt").unwrap(), None);
    assert_eq!(repo.image_data(&Rev::WorkTree, "docs/none.png").unwrap(), None);
    // No path outside the repository.
    for bad in ["../x.png", "docs/../../x.png", "/etc/x.png", ""] {
        assert!(repo.image_data(&Rev::WorkTree, bad).is_err(), "{bad} must be refused");
    }
}
