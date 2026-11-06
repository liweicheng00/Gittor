//! Open in Editor: opens a file of the working tree at a line in the editor of the user.
//!
//! The settings keep the editor as a command, for example `code --goto {file}:{line}:{column}`. The
//! command runs without a shell, so a file name cannot add arguments or commands. An empty command opens
//! the file with the default app of the system, without a line.
//!
//! An app that starts from the Finder or the Dock on macOS gets a short PATH without Homebrew and the
//! command-line launchers of the editors. So the search for the program also uses the PATH of the login
//! shell of the user and the usual folders of these launchers.

use crate::{EditorArgs, Result, Service};
use std::path::{Component, Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::OnceLock;

/// Splits a command into words. Single and double quotes keep spaces in a word, and a backslash keeps
/// the next character.
pub fn split_command(s: &str) -> Result<Vec<String>> {
    let mut words = Vec::new();
    let mut cur = String::new();
    let mut in_word = false;
    let mut quote: Option<char> = None;
    let mut chars = s.chars();
    while let Some(c) = chars.next() {
        match (quote, c) {
            (Some(q), c) if c == q => quote = None,
            (Some('"'), '\\') | (None, '\\') => {
                cur.push(chars.next().unwrap_or('\\'));
                in_word = true;
            }
            (Some(_), c) => cur.push(c),
            (None, '"' | '\'') => {
                quote = Some(c);
                in_word = true;
            }
            (None, c) if c.is_whitespace() => {
                if in_word {
                    words.push(std::mem::take(&mut cur));
                    in_word = false;
                }
            }
            (None, c) => {
                cur.push(c);
                in_word = true;
            }
        }
    }
    if quote.is_some() {
        return Err("The editor command has a quote without its end".into());
    }
    if in_word {
        words.push(cur);
    }
    Ok(words)
}

/// The program and its arguments for a file and a line. `{file}`, `{line}` and `{column}` in the
/// command change to their values. A command without `{file}` gets the file as its last argument.
pub fn editor_command(template: &str, file: &Path, line: u32, column: u32) -> Result<(String, Vec<String>)> {
    let file = file.to_string_lossy();
    let words = split_command(template)?;
    let Some((program, rest)) = words.split_first() else {
        return Ok(system_open(&file));
    };
    let fill = |w: &str| w.replace("{file}", &file).replace("{line}", &line.to_string()).replace("{column}", &column.to_string());
    let mut args: Vec<String> = rest.iter().map(|w| fill(w)).collect();
    if !template.contains("{file}") {
        args.push(file.to_string());
    }
    Ok((fill(program), args))
}

/// The program and its arguments that open a folder in the editor. The command of a file at a line
/// loses its line and column: a word with `{line}` or `{column}` and no `{file}` goes, with the option
/// before it (`--line {line}`). The word with `{file}` changes to the folder. When that word also has
/// the line, the option before it goes too (`--goto {file}:{line}`). A command without `{file}` gets
/// the folder at its end.
pub fn project_command(template: &str, dir: &Path) -> Result<(String, Vec<String>)> {
    let words = split_command(template)?;
    if words.is_empty() {
        return Err("Choose an editor in Settings › Editor to open the repository in it".into());
    }
    let dir = dir.to_string_lossy().to_string();
    let has_place = |w: &str| w.contains("{line}") || w.contains("{column}");
    let is_option = |w: &str| w.starts_with('-') && !w.contains('=');
    let mut out: Vec<String> = Vec::new();
    for w in &words {
        if w.contains("{file}") {
            if has_place(w) && out.len() > 1 && is_option(out.last().unwrap()) {
                out.pop();
            }
            out.push(dir.clone());
        } else if has_place(w) {
            if out.len() > 1 && is_option(out.last().unwrap()) {
                out.pop();
            }
        } else {
            out.push(w.clone());
        }
    }
    if !template.contains("{file}") {
        out.push(dir);
    }
    let program = out.remove(0);
    Ok((program, out))
}

/// The project command, then the arguments of the command of a file at a line. Most editors take both
/// in one call: they open the folder as a project and show the file in it, for example
/// "code <folder> --goto <file>:<line>:<column>" or "idea <folder> --line <line> <file>".
pub fn project_file_command(template: &str, dir: &Path, file: Option<(&Path, u32, u32)>) -> Result<(String, Vec<String>)> {
    let (program, mut args) = project_command(template, dir)?;
    if let Some((file, line, column)) = file {
        args.extend(editor_command(template, file, line, column)?.1);
    }
    Ok((program, args))
}

/// A command as one line for the eyes: a word with a space gets quotes.
fn shown(program: &str, args: &[String]) -> String {
    std::iter::once(program).chain(args.iter().map(String::as_str)).map(|w| if w.contains(' ') { format!("\"{w}\"") } else { w.to_string() }).collect::<Vec<_>>().join(" ")
}

/// The commands that the settings make, for a sample file in `root`, as the Settings page shows them.
pub fn preview(editor: &str, terminal: &str, root: &Path) -> crate::CommandPreview {
    let file = root.join("src").join("main.rs");
    let line = |r: Result<(String, Vec<String>)>| r.map(|(p, a)| shown(&p, &a)).unwrap_or_else(|e| e);
    crate::CommandPreview {
        open_in_editor: line(editor_command(editor, &file, 12, 5)),
        open_in_ide: line(project_file_command(editor, root, Some((&file, 12, 5)))),
        open_terminal: match crate::terminal::terminal_command(terminal, root) {
            Ok(Some((p, a))) => shown(&p, &a),
            Ok(None) => line(crate::terminal::system_terminal(&root.to_string_lossy())),
            Err(e) => e,
        },
    }
}

/// The default app of the system for a file.
fn system_open(file: &str) -> (String, Vec<String>) {
    if cfg!(target_os = "macos") {
        ("open".into(), vec![file.into()])
    } else if cfg!(windows) {
        ("rundll32".into(), vec!["url.dll,FileProtocolHandler".into(), file.into()])
    } else {
        ("xdg-open".into(), vec![file.into()])
    }
}

/// A path of the working tree, relative to the root, without `..`.
pub fn working_tree_file(root: &Path, path: &str) -> Result<PathBuf> {
    let rel = Path::new(path);
    if path.is_empty() || !rel.components().all(|c| matches!(c, Component::Normal(_))) {
        return Err(format!("{path} is not a path in the repository"));
    }
    let full = root.join(rel);
    if !full.exists() {
        return Err(format!("{path} is not in the working tree"));
    }
    Ok(full)
}

/// The PATH of the login shell of the user, read once.
pub(crate) fn login_path() -> &'static Option<String> {
    static PATH: OnceLock<Option<String>> = OnceLock::new();
    PATH.get_or_init(|| {
        if cfg!(windows) {
            return None;
        }
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".into());
        let out = Command::new(shell).args(["-l", "-c", "printf %s \"$PATH\""]).stdin(Stdio::null()).stderr(Stdio::null()).output().ok()?;
        out.status.success().then(|| String::from_utf8_lossy(&out.stdout).trim().to_string())
    })
}

/// The folders where Gittor looks for the program of the editor.
fn search_dirs() -> Vec<PathBuf> {
    let mut dirs: Vec<PathBuf> = Vec::new();
    for p in [std::env::var("PATH").ok(), login_path().clone()].into_iter().flatten() {
        dirs.extend(std::env::split_paths(&p));
    }
    if let Some(home) = std::env::var_os("HOME").map(PathBuf::from) {
        dirs.push(home.join(".local/bin"));
        dirs.push(home.join("Library/Application Support/JetBrains/Toolbox/scripts"));
        dirs.push(home.join(".local/share/JetBrains/Toolbox/scripts"));
    }
    for d in ["/opt/homebrew/bin", "/usr/local/bin", "/Applications/Visual Studio Code.app/Contents/Resources/app/bin", "/Applications/Cursor.app/Contents/Resources/app/bin"] {
        dirs.push(PathBuf::from(d));
    }
    dirs
}

/// The full path of a program, or the name as it is when it has a folder in it.
pub(crate) fn find_program(name: &str) -> Option<PathBuf> {
    if name.contains('/') || name.contains('\\') {
        return Some(PathBuf::from(name));
    }
    let exts: &[&str] = if cfg!(windows) { &["exe", "cmd", "bat"] } else { &[""] };
    for d in search_dirs() {
        for ext in exts {
            let p = if ext.is_empty() { d.join(name) } else { d.join(format!("{name}.{ext}")) };
            if p.is_file() {
                return Some(p);
            }
        }
    }
    None
}

impl Service {
    /// Opens a file of the working tree at a line in the editor of the settings.
    pub fn open_in_editor(&self, args: EditorArgs) -> Result<()> {
        let root = self.with_repo(|r| Ok(r.root.clone()))?;
        let file = working_tree_file(&root, &args.path)?;
        let template = self.settings.lock().unwrap().editor.clone();
        let (program, list) = editor_command(&template, &file, args.line.max(1), args.column.max(1))?;
        start_editor(&program, &list, &root)
    }

    /// The commands of the Editor and Terminal settings, for the Settings page. They use the open
    /// repository, or a sample folder.
    pub fn command_preview(&self, args: crate::PreviewArgs) -> Result<crate::CommandPreview> {
        let root = self.with_repo(|r| Ok(r.root.clone())).unwrap_or_else(|_| PathBuf::from("/path/to/repository"));
        Ok(preview(&args.editor, &args.terminal, &root))
    }

    /// Opens the working tree of the current repository in the editor of the settings, as a project. With
    /// a path, the editor also shows that file at the line. A path that is not in the working tree (for
    /// example a file of another branch) opens the project only.
    pub fn open_project_in_editor(&self, args: EditorArgs) -> Result<()> {
        let root = self.with_repo(|r| Ok(r.root.clone()))?;
        let template = self.settings.lock().unwrap().editor.clone();
        let file = (!args.path.is_empty()).then(|| working_tree_file(&root, &args.path).ok()).flatten();
        let (program, list) = project_file_command(&template, &root, file.as_deref().map(|f| (f, args.line.max(1), args.column.max(1))))?;
        start_editor(&program, &list, &root)
    }
}

fn start_editor(program: &str, list: &[String], root: &Path) -> Result<()> {
    let exe = find_program(program).ok_or_else(|| format!("Cannot find the editor program {program}. Set its full path in Settings › Editor"))?;
    let mut child = Command::new(exe)
        .args(list)
        .current_dir(root)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("Cannot start {program}: {e}"))?;
    // The launcher of most editors exits soon. The wait frees its process entry.
    std::thread::spawn(move || child.wait());
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn split_keeps_quoted_words() {
        assert_eq!(split_command(r#"code --goto "{file}:{line}""#).unwrap(), ["code", "--goto", "{file}:{line}"]);
        assert_eq!(split_command(r"'/Applications/My Editor' -n \{x\}").unwrap(), ["/Applications/My Editor", "-n", "{x}"]);
        assert_eq!(split_command("  a   b ").unwrap(), ["a", "b"]);
        assert!(split_command("code \"x").is_err());
    }

    #[test]
    fn fills_the_file_and_the_line() {
        let f = Path::new("/r/a b.rs");
        let (p, a) = editor_command("code --goto {file}:{line}:{column}", f, 12, 3).unwrap();
        assert_eq!((p.as_str(), a), ("code", vec!["--goto".to_string(), "/r/a b.rs:12:3".into()]));
        let (p, a) = editor_command("idea --line {line}", f, 7, 1).unwrap();
        assert_eq!((p.as_str(), a), ("idea", vec!["--line".to_string(), "7".into(), "/r/a b.rs".into()]));
        // A file name with a semicolon stays one argument: no shell runs the command.
        let (_, a) = editor_command("subl {file}:{line}", Path::new("/r/x;rm -rf y"), 1, 1).unwrap();
        assert_eq!(a, ["/r/x;rm -rf y:1"]);
        let (p, a) = editor_command("", f, 1, 1).unwrap();
        assert!(!p.is_empty() && a.last().unwrap() == "/r/a b.rs");
    }

    #[test]
    fn preview_shows_the_commands() {
        let p = preview("code --goto {file}:{line}:{column}", "", Path::new("/r/my app"));
        assert_eq!(p.open_in_editor, "code --goto \"/r/my app/src/main.rs:12:5\"");
        assert_eq!(p.open_in_ide, "code \"/r/my app\" --goto \"/r/my app/src/main.rs:12:5\"");
        assert!(!p.open_terminal.is_empty(), "the terminal of the system, or why there is none");
        let p = preview("", "open -a iTerm {dir}", Path::new("/r/app"));
        assert!(p.open_in_ide.contains("Settings › Editor"), "without an editor, the IDE asks for one");
        assert_eq!(p.open_terminal, "open -a iTerm /r/app");
    }

    #[test]
    fn opens_the_folder_and_the_file() {
        let d = Path::new("/r/app");
        let f = Path::new("/r/app/src/a.rs");
        let run = |t: &str| {
            let (p, a) = project_file_command(t, d, Some((f, 12, 3))).unwrap();
            std::iter::once(p).chain(a).collect::<Vec<_>>().join("|")
        };
        assert_eq!(run("code --goto {file}:{line}:{column}"), "code|/r/app|--goto|/r/app/src/a.rs:12:3");
        assert_eq!(run("idea --line {line} --column {column} {file}"), "idea|/r/app|--line|12|--column|3|/r/app/src/a.rs");
        assert_eq!(run("zed {file}:{line}:{column}"), "zed|/r/app|/r/app/src/a.rs:12:3");
        let (_, a) = project_file_command("code --goto {file}:{line}:{column}", d, None).unwrap();
        assert_eq!(a, ["/r/app"], "without a file, the folder only");
    }

    #[test]
    fn opens_the_folder_without_the_line() {
        let d = Path::new("/r/my app");
        let run = |t: &str| {
            let (p, a) = project_command(t, d).unwrap();
            std::iter::once(p).chain(a).collect::<Vec<_>>().join("|")
        };
        assert_eq!(run("code --goto {file}:{line}:{column}"), "code|/r/my app");
        assert_eq!(run("zed {file}:{line}:{column}"), "zed|/r/my app");
        assert_eq!(run("idea --line {line} --column {column} {file}"), "idea|/r/my app");
        assert_eq!(run("xed --line {line} {file}"), "xed|/r/my app");
        assert_eq!(run("open -a 'Sublime Text' {file}"), "open|-a|Sublime Text|/r/my app");
        assert_eq!(run("mate -l {line}"), "mate|/r/my app");
        assert_eq!(run("code -n"), "code|-n|/r/my app");
        assert!(project_command("", d).unwrap_err().contains("Settings › Editor"));
    }

    #[test]
    fn the_path_stays_in_the_repository() {
        let root = std::env::temp_dir().join(format!("gittor-editor-{}", std::process::id()));
        std::fs::create_dir_all(root.join("src")).unwrap();
        std::fs::write(root.join("src/a.rs"), "").unwrap();
        assert_eq!(working_tree_file(&root, "src/a.rs").unwrap(), root.join("src/a.rs"));
        for bad in ["../etc/passwd", "/etc/passwd", "src/../../x", ""] {
            assert!(working_tree_file(&root, bad).is_err(), "{bad}");
        }
        assert!(working_tree_file(&root, "src/gone.rs").unwrap_err().contains("not in the working tree"));
        let _ = std::fs::remove_dir_all(&root);
    }
}
