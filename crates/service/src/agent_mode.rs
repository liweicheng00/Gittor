//! Agent mode: the back side of the window. Its whole interface is files in `<config dir>/agent-mode`:
//! `layout.json` (the blocks of the window), `style.css`, `mods/<name>/main.js` (the code of each block)
//! and `agents.json` (the agent programs). An agent, or the user, edits the files, and the front end loads
//! them again. `AGENTS.md` and `gittor.d.ts` tell an agent how to do that.
//!
//! The commands here also start and drive one ACP agent (see `agent.rs`). Its messages go to the front
//! end as `Event::Agent`.

use crate::agent::{Agent, Launch, Sink};
use crate::{err, events, Result, Service};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

/// The files that Gittor writes again at each start: they describe this version of Gittor.
const DOCS: &[(&str, &str)] = &[("AGENTS.md", include_str!("agent-mode/AGENTS.md")), ("gittor.d.ts", include_str!("agent-mode/gittor.d.ts"))];

/// The files of a new folder. Reset writes them again.
const DEFAULTS: &[(&str, &str)] = &[
    ("layout.json", include_str!("agent-mode/layout.json")),
    ("style.css", include_str!("agent-mode/style.css")),
    ("agents.json", include_str!("agent-mode/agents.json")),
    ("mods/chat/main.js", include_str!("agent-mode/mods/chat/main.js")),
    ("mods/changes/main.js", include_str!("agent-mode/mods/changes/main.js")),
    ("mods/branches/main.js", include_str!("agent-mode/mods/branches/main.js")),
    ("mods/intro/main.js", include_str!("agent-mode/mods/intro/main.js")),
    ("mods/remotes/main.js", include_str!("agent-mode/mods/remotes/main.js")),
];

#[derive(Clone, Debug, Serialize, Deserialize)]
#[derive(ts_rs::TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct AgentConfig {
    pub name: String,
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
    /// Extra environment variables, for example an API key of the provider.
    #[serde(default)]
    #[ts(type = "Record<string, string>")]
    pub env: std::collections::BTreeMap<String, String>,
}

#[derive(Clone, Debug, Serialize)]
#[derive(ts_rs::TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ModFile {
    pub name: String,
    pub code: String,
}

#[derive(Clone, Debug, Serialize)]
#[derive(ts_rs::TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ModeFiles {
    pub dir: String,
    pub stamp: String,
    pub layout: String,
    pub style: String,
    pub mods: Vec<ModFile>,
}

#[derive(Deserialize)]
pub struct ModeLayoutArgs {
    pub text: String,
}

#[derive(Deserialize)]
pub struct ModeErrorArgs {
    /// "layout" or the name of a mod.
    pub name: String,
    /// None removes the error file.
    pub message: Option<String>,
}

#[derive(Deserialize)]
pub struct AgentStartArgs {
    pub index: usize,
    /// The folder of the session; empty means the agent-mode folder.
    #[serde(default)]
    pub cwd: String,
}

#[derive(Deserialize)]
pub struct AgentPromptArgs {
    pub text: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentAnswerArgs {
    pub token: u64,
    pub option_id: Option<String>,
}

impl Service {
    /// The agent-mode folder. The first call makes it with the default files; each start writes the docs again.
    fn mode_dir(&self) -> Result<PathBuf> {
        let dir = self.config_dir.as_ref().ok_or("no configuration folder")?.join("agent-mode");
        let mut ready = self.mode_ready.lock().unwrap();
        if !*ready {
            for (rel, text) in DEFAULTS {
                let p = dir.join(rel);
                if !p.exists() {
                    write_file(&p, text)?;
                }
            }
            for (rel, text) in DOCS {
                write_file(&dir.join(rel), text)?;
            }
            *ready = true;
        }
        Ok(dir)
    }

    pub fn mode_files(&self) -> Result<ModeFiles> {
        let dir = self.mode_dir()?;
        let read = |rel: &str| std::fs::read_to_string(dir.join(rel)).unwrap_or_default();
        let mut mods = Vec::new();
        if let Ok(entries) = std::fs::read_dir(dir.join("mods")) {
            for e in entries.flatten() {
                let main = e.path().join("main.js");
                if let Ok(code) = std::fs::read_to_string(&main) {
                    mods.push(ModFile { name: e.file_name().to_string_lossy().into_owned(), code });
                }
            }
        }
        mods.sort_by(|a, b| a.name.cmp(&b.name));
        Ok(ModeFiles { dir: dir.to_string_lossy().into_owned(), stamp: stamp(&dir), layout: read("layout.json"), style: read("style.css"), mods })
    }

    /// A value that changes when a file of the interface changes. The front end asks for it often.
    pub fn mode_stamp(&self) -> Result<String> {
        Ok(stamp(&self.mode_dir()?))
    }

    /// Writes or removes `<name>.error`, so that an agent can read why its file did not load.
    pub fn mode_error(&self, args: ModeErrorArgs) -> Result<()> {
        let dir = self.mode_dir()?;
        let p = match args.name.as_str() {
            "layout" => dir.join(format!("{}.error", args.name)),
            m if valid_name(m) => dir.join("mods").join(m).join("main.error"),
            _ => return Err("bad name".into()),
        };
        match args.message {
            Some(m) => write_file(&p, &m),
            None => {
                let _ = std::fs::remove_file(p);
                Ok(())
            }
        }
    }

    /// Writes `layout.json`, for example after the user moved a card of the canvas. The text must be JSON.
    pub fn mode_save_layout(&self, args: ModeLayoutArgs) -> Result<()> {
        serde_json::from_str::<serde_json::Value>(&args.text).map_err(|e| format!("layout.json: {e}"))?;
        let p = self.mode_dir()?.join("layout.json");
        let tmp = p.with_extension("json.tmp");
        write_file(&tmp, &args.text)?;
        std::fs::rename(&tmp, &p).map_err(err)
    }

    /// Moves the folder to `agent-mode.bak-<seconds>` and makes it again with the default files.
    pub fn mode_reset(&self) -> Result<String> {
        let dir = self.mode_dir()?;
        let secs = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
        let backup = dir.with_file_name(format!("agent-mode.bak-{secs}"));
        std::fs::rename(&dir, &backup).map_err(err)?;
        *self.mode_ready.lock().unwrap() = false;
        self.mode_dir()?;
        Ok(backup.to_string_lossy().into_owned())
    }

    pub fn agent_list(&self) -> Result<Vec<AgentConfig>> {
        let text = std::fs::read_to_string(self.mode_dir()?.join("agents.json")).map_err(err)?;
        serde_json::from_str(&text).map_err(|e| format!("agents.json: {e}"))
    }

    /// Starts an agent of `agents.json`. An agent that runs stops first.
    pub fn agent_start(&self, args: AgentStartArgs) -> Result<String> {
        let list = self.agent_list()?;
        let a = list.get(args.index).ok_or("no such agent")?;
        let cwd = if args.cwd.is_empty() { self.mode_dir()? } else { PathBuf::from(&args.cwd) };
        *self.agent.lock().unwrap() = None;
        let sink_events = self.events.clone();
        let sink: Sink = std::sync::Arc::new(move |data| sink_events.emit(events::Event::Agent { data }));
        let env: Vec<(String, String)> = a.env.iter().map(|(k, v)| (k.clone(), v.clone())).collect();
        let launch = Launch { name: &a.name, program: &a.command, args: &a.args, env: &env, cwd: &cwd };
        let agent = Agent::start(launch, sink)?;
        *self.agent.lock().unwrap() = Some(agent);
        Ok(cwd.to_string_lossy().into_owned())
    }

    fn with_agent<T>(&self, f: impl FnOnce(&Agent) -> Result<T>) -> Result<T> {
        let guard = self.agent.lock().unwrap();
        f(guard.as_ref().ok_or("no agent runs")?)
    }

    pub fn agent_prompt(&self, args: AgentPromptArgs) -> Result<()> {
        self.with_agent(|a| a.prompt(&args.text))
    }

    pub fn agent_cancel(&self) -> Result<()> {
        self.with_agent(|a| a.cancel())
    }

    pub fn agent_answer(&self, args: AgentAnswerArgs) -> Result<()> {
        self.with_agent(|a| a.answer(args.token, args.option_id))
    }

    pub fn agent_stop(&self) -> Result<()> {
        *self.agent.lock().unwrap() = None;
        Ok(())
    }
}

fn valid_name(n: &str) -> bool {
    !n.is_empty() && n.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

fn write_file(p: &Path, text: &str) -> Result<()> {
    if let Some(d) = p.parent() {
        std::fs::create_dir_all(d).map_err(err)?;
    }
    std::fs::write(p, text).map_err(err)
}

/// The sizes and times of the interface files.
fn stamp(dir: &Path) -> String {
    use std::hash::{Hash, Hasher};
    let mut h = std::collections::hash_map::DefaultHasher::new();
    let mut add = |p: PathBuf| {
        if let Ok(m) = std::fs::metadata(&p) {
            p.hash(&mut h);
            m.len().hash(&mut h);
            m.modified().ok().hash(&mut h);
        }
    };
    add(dir.join("layout.json"));
    add(dir.join("style.css"));
    if let Ok(entries) = std::fs::read_dir(dir.join("mods")) {
        let mut paths: Vec<PathBuf> = entries.flatten().map(|e| e.path().join("main.js")).collect();
        paths.sort();
        paths.into_iter().for_each(&mut add);
    }
    format!("{:x}", h.finish())
}
