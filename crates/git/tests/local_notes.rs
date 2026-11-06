//! Notes on local changes: they stay while the file stays the same, and go away when it changes.

use gittor_git::local_notes::LocalNoteEdit;
use gittor_git::Repo;
use std::path::Path;
use std::process::Command;

fn git(dir: &Path, args: &[&str]) {
    let out = Command::new("git").arg("-C").arg(dir).args(args).output().unwrap();
    assert!(out.status.success(), "git {args:?}: {}", String::from_utf8_lossy(&out.stderr));
}

#[test]
fn notes_go_away_when_the_file_changes() {
    let dir = std::env::temp_dir().join(format!("gittor-local-notes-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    git(&dir, &["init", "-q", "-b", "main"]);
    std::fs::write(dir.join("a.rs"), "fn a() {}\n").unwrap();
    std::fs::write(dir.join("b.rs"), "fn b() {}\n").unwrap();
    let repo = Repo::open(&dir).unwrap();
    let add = |path: &str, line: u32, end_line: u32, text: &str| {
        repo.local_note_edit(LocalNoteEdit::Add { path: path.into(), line, end_line, text: text.into() }).unwrap()
    };
    add("a.rs", 1, 0, "Rename a");
    add("a.rs", 1, 3, "Three lines");
    add("b.rs", 1, 0, "Fine");
    let a = repo.local_notes(Some("a.rs")).unwrap();
    assert_eq!(a.iter().map(|n| (n.line, n.end_line, n.text.as_str())).collect::<Vec<_>>(), [(1, 0, "Rename a"), (1, 3, "Three lines")]);
    assert_eq!(repo.local_notes(None).unwrap().len(), 3);

    // Resolve, then open again; delete.
    repo.local_note_edit(LocalNoteEdit::Resolve { path: "a.rs".into(), id: a[0].id.clone(), resolved: true }).unwrap();
    assert!(repo.local_notes(Some("a.rs")).unwrap()[0].resolved);
    repo.local_note_edit(LocalNoteEdit::Delete { path: "a.rs".into(), id: a[1].id.clone() }).unwrap();
    assert_eq!(repo.local_notes(Some("a.rs")).unwrap().len(), 1);

    // A change of a.rs clears its notes; the notes of b.rs stay.
    std::fs::write(dir.join("a.rs"), "fn renamed() {}\n").unwrap();
    assert!(repo.local_notes(Some("a.rs")).unwrap().is_empty());
    assert_eq!(repo.local_notes(None).unwrap().iter().map(|n| n.path.as_str()).collect::<Vec<_>>(), ["b.rs"]);
    // The same text again does not bring them back: they are gone.
    std::fs::write(dir.join("a.rs"), "fn a() {}\n").unwrap();
    assert!(repo.local_notes(Some("a.rs")).unwrap().is_empty());
    // A deleted file loses its notes too.
    std::fs::remove_file(dir.join("b.rs")).unwrap();
    assert!(repo.local_notes(None).unwrap().is_empty());
    assert!(repo.local_note_edit(LocalNoteEdit::Add { path: "b.rs".into(), line: 1, end_line: 0, text: "x".into() }).is_err());
    let _ = std::fs::remove_dir_all(&dir);
}
