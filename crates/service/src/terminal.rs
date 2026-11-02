//! Open in Terminal: opens a terminal app in the working tree of the repository.
//!
//! The settings keep the terminal as a command, for example `open -a iTerm {dir}`. The command runs
//! without a shell, in the folder of the working tree. `{dir}` changes to that folder. An empty command
//! opens the terminal app of the system.

use crate::editor::{find_program, split_command};
use crate::{Result, Service};
use std::path::Path;
use std::process::{Command, Stdio};

/// The terminals that Gittor tries on Linux when the setting is empty, in this order. Each one starts in
/// the current folder of the process.
const LINUX_TERMINALS: &[&str] = &["x-terminal-emulator", "gnome-terminal", "konsole", "xfce4-terminal", "kitty", "alacritty", "wezterm", "foot", "xterm"];

/// The program and its arguments for a folder. `{dir}` in the command changes to the folder.
pub fn terminal_command(template: &str, dir: &Path) -> Result<Option<(String, Vec<String>)>> {
    let dir = dir.to_string_lossy();
    let words = split_command(template)?;
    let Some((program, rest)) = words.split_first() else { return Ok(None) };
    let fill = |w: &str| w.replace("{dir}", &dir);
    Ok(Some((fill(program), rest.iter().map(|w| fill(w)).collect())))
}

/// The terminal app of the system.
fn system_terminal(dir: &str) -> Result<(String, Vec<String>)> {
    if cfg!(target_os = "macos") {
        Ok(("open".into(), vec!["-a".into(), "Terminal".into(), dir.into()]))
    } else if cfg!(windows) {
        if find_program("wt").is_some() {
            return Ok(("wt".into(), vec!["-d".into(), dir.into()]));
        }
        // "start" opens a new console window in the current folder.
        Ok(("cmd".into(), vec!["/c".into(), "start".into(), "cmd".into()]))
    } else {
        LINUX_TERMINALS
            .iter()
            .find(|t| find_program(t).is_some())
            .map(|t| (t.to_string(), vec![]))
            .ok_or_else(|| "Cannot find a terminal app. Set its command in Settings › Terminal".to_string())
    }
}

impl Service {
    /// Opens a terminal in the working tree of the current repository.
    pub fn open_in_terminal(&self) -> Result<()> {
        let root = self.with_repo(|r| Ok(r.root.clone()))?;
        let template = self.settings.lock().unwrap().terminal.clone();
        let (program, args) = match terminal_command(&template, &root)? {
            Some(c) => c,
            None => system_terminal(&root.to_string_lossy())?,
        };
        let exe = find_program(&program).ok_or_else(|| format!("Cannot find the terminal program {program}. Set its full path in Settings › Terminal"))?;
        let mut child = Command::new(exe)
            .args(&args)
            .current_dir(&root)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| format!("Cannot start {program}: {e}"))?;
        // The wait frees the process entry when the terminal exits.
        std::thread::spawn(move || child.wait());
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fills_the_folder() {
        let d = Path::new("/r/my app");
        let (p, a) = terminal_command("open -a iTerm {dir}", d).unwrap().unwrap();
        assert_eq!((p.as_str(), a), ("open", vec!["-a".to_string(), "iTerm".into(), "/r/my app".into()]));
        let (_, a) = terminal_command("gnome-terminal --working-directory={dir}", d).unwrap().unwrap();
        assert_eq!(a, ["--working-directory=/r/my app"]);
        // A command without {dir} starts in the folder and gets no extra argument.
        let (p, a) = terminal_command("kitty", d).unwrap().unwrap();
        assert_eq!((p.as_str(), a.len()), ("kitty", 0));
        assert!(terminal_command("  ", d).unwrap().is_none());
        assert!(terminal_command("open \"x", d).is_err());
    }
}
