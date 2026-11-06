//! Agent mode: the back side of the window. Its unit is a workflow: a folder with the whole interface
//! of one work flow as files. A workflow can name several projects (repositories) and knowledge
//! folders. The folders of all workflows are in one root folder:
//!
//! ```text
//! <root>/agents.json            the agent programs, for all workflows
//! <root>/<id>/workflow.json     the name, the projects and the knowledge folders
//! <root>/<id>/layout.json       the panels, the canvas and its cards
//! <root>/<id>/style.css
//! <root>/<id>/mods/<name>/main.js
//! ```
//!
//! The root is `workflowsDir` of `settings.json`, else `<config dir>/workflows`. An agent, or the user,
//! edits the files, and the front end loads them again. `AGENTS.md` and `gittor.d.ts` in each workflow
//! tell an agent how to do that.
//!
//! Each workflow can run one ACP agent (see `agent.rs`). Its messages go to the front end as
//! `Event::Agent`, with the id of the workflow.

use crate::agent::{Agent, Launch, Sink};
use crate::{err, events, Result, Service};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

/// The files that Gittor writes again when it opens a workflow: they describe this version of Gittor.
const DOCS: &[(&str, &str)] = &[("AGENTS.md", include_str!("agent-mode/AGENTS.md")), ("gittor.d.ts", include_str!("agent-mode/gittor.d.ts"))];

/// The files of a new workflow. Reset writes them again.
const DEFAULTS: &[(&str, &str)] = &[
    ("layout.json", include_str!("agent-mode/layout.json")),
    ("style.css", include_str!("agent-mode/style.css")),
    ("mods/chat/main.js", include_str!("agent-mode/mods/chat/main.js")),
    ("mods/changes/main.js", include_str!("agent-mode/mods/changes/main.js")),
    ("mods/branches/main.js", include_str!("agent-mode/mods/branches/main.js")),
    ("mods/intro/main.js", include_str!("agent-mode/mods/intro/main.js")),
    ("mods/remotes/main.js", include_str!("agent-mode/mods/remotes/main.js")),
    ("mods/stashes/main.js", include_str!("agent-mode/mods/stashes/main.js")),
    ("mods/work/main.js", include_str!("agent-mode/mods/work/main.js")),
];

const AGENTS_JSON: &str = include_str!("agent-mode/agents.json");

/// The id of the workflow that Gittor makes when there is none.
const FIRST: &str = "main";

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

/// `workflow.json` of a workflow folder.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct WorkflowMeta {
    name: String,
    /// The repositories of the workflow.
    projects: Vec<String>,
    /// Folders with documents, notes or code that the workflow uses as knowledge.
    knowledge: Vec<String>,
}

#[derive(Clone, Debug, Serialize)]
#[derive(ts_rs::TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowInfo {
    /// The name of the folder.
    pub id: String,
    pub name: String,
    pub dir: String,
    pub projects: Vec<String>,
    pub knowledge: Vec<String>,
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
    pub workflow: WorkflowInfo,
    pub dir: String,
    pub stamp: String,
    pub layout: String,
    pub style: String,
    pub mods: Vec<ModFile>,
}

/// A project of a workflow, and whether Gittor could open it.
#[derive(Clone, Debug, Serialize)]
#[derive(ts_rs::TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ProjectState {
    pub path: String,
    /// The root of the repository, when it opened.
    pub root: Option<String>,
    pub error: Option<String>,
}

#[derive(Deserialize)]
pub struct WorkflowArgs {
    pub workflow: String,
}

#[derive(Deserialize)]
pub struct WorkflowCreateArgs {
    pub name: String,
    #[serde(default)]
    pub projects: Vec<String>,
}

#[derive(Deserialize)]
pub struct ModeLayoutArgs {
    pub workflow: String,
    pub text: String,
}

#[derive(Deserialize)]
pub struct ModeErrorArgs {
    pub workflow: String,
    /// "layout" or the name of a mod.
    pub name: String,
    /// None removes the error file.
    pub message: Option<String>,
}

#[derive(Deserialize)]
pub struct AgentStartArgs {
    pub workflow: String,
    pub index: usize,
}

#[derive(Deserialize)]
pub struct AgentPromptArgs {
    pub workflow: String,
    pub text: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentAnswerArgs {
    pub workflow: String,
    pub token: u64,
    pub option_id: Option<String>,
}

impl Service {
    /// The folder of all workflows. The first call makes `agents.json` and the first workflow.
    fn workflows_root(&self) -> Result<PathBuf> {
        let custom = self.settings.lock().unwrap().workflows_dir.clone();
        let root = if custom.trim().is_empty() { self.config_dir.as_ref().ok_or("no configuration folder")?.join("workflows") } else { PathBuf::from(custom.trim()) };
        if !root.join("agents.json").exists() {
            write_file(&root.join("agents.json"), AGENTS_JSON)?;
        }
        if workflow_ids(&root).is_empty() {
            make_workflow(&root.join(FIRST), "Main", &[])?;
        }
        Ok(root)
    }

    /// The folder of a workflow. The first call in a run writes the docs again.
    fn workflow_dir(&self, id: &str) -> Result<PathBuf> {
        if !valid_name(id) {
            return Err(format!("bad workflow id {id}"));
        }
        let dir = self.workflows_root()?.join(id);
        if !dir.join("workflow.json").exists() {
            return Err(format!("no workflow {id}"));
        }
        let mut ready = self.mode_ready.lock().unwrap();
        if ready.insert(id.to_string()) {
            for (rel, text) in DEFAULTS {
                let p = dir.join(rel);
                if !p.exists() {
                    write_file(&p, text)?;
                }
            }
            for (rel, text) in DOCS {
                write_file(&dir.join(rel), text)?;
            }
        }
        Ok(dir)
    }

    fn workflow_info(&self, id: &str) -> Result<WorkflowInfo> {
        let dir = self.workflow_dir(id)?;
        let meta = read_meta(&dir);
        Ok(WorkflowInfo {
            id: id.to_string(),
            name: if meta.name.is_empty() { id.to_string() } else { meta.name },
            dir: dir.to_string_lossy().into_owned(),
            projects: meta.projects,
            knowledge: meta.knowledge,
        })
    }

    /// All workflows, by name.
    pub fn workflow_list(&self) -> Result<Vec<WorkflowInfo>> {
        let root = self.workflows_root()?;
        let mut list: Vec<WorkflowInfo> = workflow_ids(&root).iter().filter_map(|id| self.workflow_info(id).ok()).collect();
        list.sort_by_key(|w| w.name.to_lowercase());
        Ok(list)
    }

    /// Makes a workflow with the default files. Its id comes from the name.
    pub fn workflow_create(&self, args: WorkflowCreateArgs) -> Result<WorkflowInfo> {
        let name = args.name.trim();
        if name.is_empty() {
            return Err("the workflow needs a name".into());
        }
        let root = self.workflows_root()?;
        let base: String = name.to_lowercase().chars().map(|c| if c.is_ascii_alphanumeric() { c } else { '-' }).collect::<String>().trim_matches('-').to_string();
        let base = if base.is_empty() { "workflow".to_string() } else { base };
        let mut id = base.clone();
        let mut n = 2;
        while root.join(&id).exists() {
            id = format!("{base}-{n}");
            n += 1;
        }
        make_workflow(&root.join(&id), name, &args.projects)?;
        self.workflow_info(&id)
    }

    /// Opens the projects of a workflow in the backend, so that its mods can run commands on them. The
    /// active tab of the Git side does not change.
    pub fn workflow_open_projects(&self, args: WorkflowArgs) -> Result<Vec<ProjectState>> {
        let info = self.workflow_info(&args.workflow)?;
        Ok(info
            .projects
            .iter()
            .map(|p| match gittor_git::Repo::open(Path::new(p)) {
                Ok(repo) => {
                    let root = repo.root.clone();
                    let open = self.session.lock().unwrap().map.contains_key(&root);
                    let r = if open { Ok(()) } else { self.load(repo, Default::default(), true).map(|_| ()) };
                    match r {
                        Ok(()) => ProjectState { path: p.clone(), root: Some(root.to_string_lossy().into_owned()), error: None },
                        Err(e) => ProjectState { path: p.clone(), root: None, error: Some(e) },
                    }
                }
                Err(e) => ProjectState { path: p.clone(), root: None, error: Some(e.to_string()) },
            })
            .collect())
    }

    pub fn mode_files(&self, args: WorkflowArgs) -> Result<ModeFiles> {
        let workflow = self.workflow_info(&args.workflow)?;
        let dir = PathBuf::from(&workflow.dir);
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
        Ok(ModeFiles { dir: workflow.dir.clone(), stamp: stamp(&dir), layout: read("layout.json"), style: read("style.css"), mods, workflow })
    }

    /// A value that changes when a file of the interface changes. The front end asks for it often.
    pub fn mode_stamp(&self, args: WorkflowArgs) -> Result<String> {
        Ok(stamp(&self.workflow_dir(&args.workflow)?))
    }

    /// Writes or removes `<name>.error`, so that an agent can read why its file did not load.
    pub fn mode_error(&self, args: ModeErrorArgs) -> Result<()> {
        let dir = self.workflow_dir(&args.workflow)?;
        let p = match args.name.as_str() {
            "layout" => dir.join("layout.error"),
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
        let p = self.workflow_dir(&args.workflow)?.join("layout.json");
        let tmp = p.with_extension("json.tmp");
        write_file(&tmp, &args.text)?;
        std::fs::rename(&tmp, &p).map_err(err)
    }

    /// Moves the interface files of the workflow to `<id>.bak-<seconds>` and writes the defaults again.
    /// `workflow.json` stays.
    pub fn mode_reset(&self, args: WorkflowArgs) -> Result<String> {
        let dir = self.workflow_dir(&args.workflow)?;
        let secs = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
        let backup = dir.with_file_name(format!("{}.bak-{secs}", args.workflow));
        let meta = std::fs::read_to_string(dir.join("workflow.json")).map_err(err)?;
        std::fs::rename(&dir, &backup).map_err(err)?;
        write_file(&dir.join("workflow.json"), &meta)?;
        self.mode_ready.lock().unwrap().remove(&args.workflow);
        self.workflow_dir(&args.workflow)?;
        Ok(backup.to_string_lossy().into_owned())
    }

    pub fn agent_list(&self) -> Result<Vec<AgentConfig>> {
        let text = std::fs::read_to_string(self.workflows_root()?.join("agents.json")).map_err(err)?;
        serde_json::from_str(&text).map_err(|e| format!("agents.json: {e}"))
    }

    /// Starts an agent of `agents.json` in the folder of the workflow. The agent of the workflow that runs
    /// stops first.
    pub fn agent_start(&self, args: AgentStartArgs) -> Result<String> {
        let list = self.agent_list()?;
        let a = list.get(args.index).ok_or("no such agent")?;
        let cwd = self.workflow_dir(&args.workflow)?;
        self.agents.lock().unwrap().remove(&args.workflow);
        let sink_events = self.events.clone();
        let workflow = args.workflow.clone();
        let sink: Sink = std::sync::Arc::new(move |data| sink_events.emit(events::Event::Agent { workflow: workflow.clone(), data }));
        let env: Vec<(String, String)> = a.env.iter().map(|(k, v)| (k.clone(), v.clone())).collect();
        let launch = Launch { name: &a.name, program: &a.command, args: &a.args, env: &env, cwd: &cwd };
        let agent = Agent::start(launch, sink)?;
        self.agents.lock().unwrap().insert(args.workflow, agent);
        Ok(cwd.to_string_lossy().into_owned())
    }

    fn with_agent<T>(&self, workflow: &str, f: impl FnOnce(&Agent) -> Result<T>) -> Result<T> {
        let guard = self.agents.lock().unwrap();
        f(guard.get(workflow).ok_or("no agent runs in this workflow")?)
    }

    pub fn agent_prompt(&self, args: AgentPromptArgs) -> Result<()> {
        self.with_agent(&args.workflow, |a| a.prompt(&args.text))
    }

    pub fn agent_cancel(&self, args: WorkflowArgs) -> Result<()> {
        self.with_agent(&args.workflow, |a| a.cancel())
    }

    pub fn agent_answer(&self, args: AgentAnswerArgs) -> Result<()> {
        self.with_agent(&args.workflow, |a| a.answer(args.token, args.option_id))
    }

    pub fn agent_stop(&self, args: WorkflowArgs) -> Result<()> {
        self.agents.lock().unwrap().remove(&args.workflow);
        Ok(())
    }
}

/// The ids of the workflow folders: the folders with a `workflow.json`.
fn workflow_ids(root: &Path) -> Vec<String> {
    let Ok(entries) = std::fs::read_dir(root) else { return Vec::new() };
    let mut ids: Vec<String> = entries
        .flatten()
        .filter(|e| e.path().join("workflow.json").is_file())
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .filter(|id| valid_name(id))
        .collect();
    ids.sort();
    ids
}

fn read_meta(dir: &Path) -> WorkflowMeta {
    std::fs::read(dir.join("workflow.json")).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default()
}

fn make_workflow(dir: &Path, name: &str, projects: &[String]) -> Result<()> {
    let meta = WorkflowMeta { name: name.to_string(), projects: projects.to_vec(), knowledge: Vec::new() };
    write_file(&dir.join("workflow.json"), &(serde_json::to_string_pretty(&meta).map_err(err)? + "\n"))?;
    for (rel, text) in DEFAULTS {
        write_file(&dir.join(rel), text)?;
    }
    Ok(())
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
    add(dir.join("workflow.json"));
    if let Ok(entries) = std::fs::read_dir(dir.join("mods")) {
        let mut paths: Vec<PathBuf> = entries.flatten().map(|e| e.path().join("main.js")).collect();
        paths.sort();
        paths.into_iter().for_each(&mut add);
    }
    format!("{:x}", h.finish())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn makes_and_lists_workflows() {
        let dir = std::env::temp_dir().join(format!("gittor-workflows-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let s = Service { config_dir: Some(dir.clone()), ..Service::default() };
        let first = s.workflow_list().unwrap();
        assert_eq!(first.iter().map(|w| w.id.as_str()).collect::<Vec<_>>(), ["main"]);
        let w = s.workflow_create(WorkflowCreateArgs { name: "Release Train".into(), projects: vec![] }).unwrap();
        assert_eq!(w.id, "release-train");
        let again = s.workflow_create(WorkflowCreateArgs { name: "Release Train".into(), projects: vec![] }).unwrap();
        assert_eq!(again.id, "release-train-2");
        assert_eq!(s.workflow_list().unwrap().len(), 3);
        let files = s.mode_files(WorkflowArgs { workflow: "release-train".into() }).unwrap();
        assert!(files.layout.contains("canvas"));
        assert!(Path::new(&files.dir).join("AGENTS.md").exists());
        assert!(s.mode_files(WorkflowArgs { workflow: "../x".into() }).is_err());
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
