//! A client of the Agent Client Protocol (ACP, <https://agentclientprotocol.com>). Gittor starts an
//! agent program, such as the ACP adapter of Claude Code, Codex or Gemini CLI, and talks JSON-RPC with it
//! over stdin and stdout. The agent does the model calls, the tools and the login. Gittor sends the
//! prompts, shows the updates, answers the permission requests and reads or writes files for the agent.
//!
//! Each message from the agent goes to the sink as a JSON object with a "type": `status`, `update` (a
//! `session/update` of ACP), `permission`, `done`, `error`, `log` (a line of stderr), `wrote` or `exit`.

use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::{mpsc, Arc, Mutex};
use std::time::Duration;

/// The version of ACP that this client speaks.
const PROTOCOL_VERSION: u64 = 1;

/// Receives the messages of the agent for the front end.
pub type Sink = Arc<dyn Fn(Value) + Send + Sync>;

type Reply = Box<dyn FnOnce(Result<Value, String>) + Send>;

struct Shared {
    stdin: Mutex<ChildStdin>,
    next_id: Mutex<u64>,
    /// The requests of the client that wait for a response, by id.
    pending: Mutex<HashMap<u64, Reply>>,
    /// The permission requests of the agent that wait for the user, by token. The value is the JSON-RPC id.
    permissions: Mutex<HashMap<u64, Value>>,
    session: Mutex<Option<String>>,
    sink: Sink,
}

impl Shared {
    fn send(&self, msg: &Value) -> Result<(), String> {
        let mut line = serde_json::to_string(msg).map_err(|e| e.to_string())?;
        line.push('\n');
        let mut stdin = self.stdin.lock().unwrap();
        stdin.write_all(line.as_bytes()).and_then(|_| stdin.flush()).map_err(|e| format!("the agent does not read: {e}"))
    }

    fn request(&self, method: &str, params: Value, reply: Reply) {
        let id = {
            let mut n = self.next_id.lock().unwrap();
            *n += 1;
            *n
        };
        self.pending.lock().unwrap().insert(id, reply);
        if let Err(e) = self.send(&json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params })) {
            if let Some(r) = self.pending.lock().unwrap().remove(&id) {
                r(Err(e));
            }
        }
    }

    /// Sends a request and waits for its response.
    fn call(&self, method: &str, params: Value, timeout: Duration) -> Result<Value, String> {
        let (tx, rx) = mpsc::channel();
        self.request(method, params, Box::new(move |r| drop(tx.send(r))));
        rx.recv_timeout(timeout).map_err(|_| format!("the agent did not answer {method}"))?
    }

    fn respond(&self, id: Value, result: Result<Value, String>) {
        let msg = match result {
            Ok(r) => json!({ "jsonrpc": "2.0", "id": id, "result": r }),
            Err(e) => json!({ "jsonrpc": "2.0", "id": id, "error": { "code": -32603, "message": e } }),
        };
        let _ = self.send(&msg);
    }

    fn emit(&self, v: Value) {
        (self.sink)(v)
    }
}

/// A running agent with one session.
pub struct Agent {
    shared: Arc<Shared>,
    child: Mutex<Child>,
    pub name: String,
}

/// How to start an agent program.
pub struct Launch<'a> {
    pub name: &'a str,
    pub program: &'a str,
    pub args: &'a [String],
    pub env: &'a [(String, String)],
    /// The folder of the session; the agent works there.
    pub cwd: &'a Path,
}

impl Agent {
    /// Starts the program. The handshake (`initialize`, `session/new`) runs in a thread: the first start of
    /// an `npx` command can download for a while. The sink gets `status` "ready" or an `error` then.
    pub fn start(launch: Launch, sink: Sink) -> Result<Agent, String> {
        let program = crate::editor::find_program(launch.program).ok_or_else(|| format!("{} is not found", launch.program))?;
        let mut cmd = Command::new(&program);
        cmd.args(launch.args).current_dir(launch.cwd).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
        // An app that starts from the Finder has a short PATH. The agent, and `npx` with its `node`, need the
        // PATH of the login shell.
        cmd.env("PATH", child_path(&program));
        for (k, v) in launch.env {
            cmd.env(k, v);
        }
        let mut child = cmd.spawn().map_err(|e| format!("cannot start {}: {e}", launch.program))?;
        let stdin = child.stdin.take().ok_or("no stdin")?;
        let stdout = child.stdout.take().ok_or("no stdout")?;
        let stderr = child.stderr.take().ok_or("no stderr")?;
        let shared = Arc::new(Shared {
            stdin: Mutex::new(stdin),
            next_id: Mutex::new(0),
            pending: Mutex::new(HashMap::new()),
            permissions: Mutex::new(HashMap::new()),
            session: Mutex::new(None),
            sink,
        });
        let reader = shared.clone();
        std::thread::spawn(move || read_loop(&reader, stdout));
        let log = shared.clone();
        std::thread::spawn(move || {
            for line in BufReader::new(stderr).lines().map_while(Result::ok) {
                log.emit(json!({ "type": "log", "text": line }));
            }
        });
        let hs = shared.clone();
        let cwd = launch.cwd.to_string_lossy().into_owned();
        hs.emit(json!({ "type": "status", "state": "starting" }));
        std::thread::spawn(move || match handshake(&hs, &cwd) {
            Ok(info) => hs.emit(json!({ "type": "status", "state": "ready", "info": info })),
            Err(e) => hs.emit(json!({ "type": "error", "message": e })),
        });
        Ok(Agent { shared, child: Mutex::new(child), name: launch.name.to_string() })
    }

    /// Sends a prompt. The updates come to the sink; `done` comes at the end of the turn.
    pub fn prompt(&self, text: &str) -> Result<(), String> {
        let session = self.shared.session.lock().unwrap().clone().ok_or("the agent is not ready yet")?;
        let sink = self.shared.clone();
        let params = json!({ "sessionId": session, "prompt": [{ "type": "text", "text": text }] });
        self.shared.request(
            "session/prompt",
            params,
            Box::new(move |r| match r {
                Ok(v) => sink.emit(json!({ "type": "done", "stopReason": v.get("stopReason").cloned().unwrap_or(Value::Null) })),
                Err(e) => sink.emit(json!({ "type": "error", "message": e })),
            }),
        );
        Ok(())
    }

    /// Stops the current turn. The open permission requests get "cancelled", as ACP asks.
    pub fn cancel(&self) -> Result<(), String> {
        let open: Vec<Value> = self.shared.permissions.lock().unwrap().drain().map(|(_, id)| id).collect();
        for id in open {
            self.shared.respond(id, Ok(json!({ "outcome": { "outcome": "cancelled" } })));
        }
        let Some(session) = self.shared.session.lock().unwrap().clone() else { return Ok(()) };
        self.shared.send(&json!({ "jsonrpc": "2.0", "method": "session/cancel", "params": { "sessionId": session } }))
    }

    /// Answers a permission request: the id of the option that the user picked, or None to cancel.
    pub fn answer(&self, token: u64, option: Option<String>) -> Result<(), String> {
        let id = self.shared.permissions.lock().unwrap().remove(&token).ok_or("the request is not open")?;
        let outcome = match option {
            Some(o) => json!({ "outcome": "selected", "optionId": o }),
            None => json!({ "outcome": "cancelled" }),
        };
        self.shared.respond(id, Ok(json!({ "outcome": outcome })));
        Ok(())
    }
}

impl Drop for Agent {
    fn drop(&mut self) {
        let mut c = self.child.lock().unwrap();
        let _ = c.kill();
        let _ = c.wait();
    }
}

/// The PATH for the agent: the folder of the program, the PATH of the app and the PATH of the login shell.
fn child_path(program: &Path) -> std::ffi::OsString {
    let mut dirs: Vec<PathBuf> = program.parent().map(|p| vec![p.to_path_buf()]).unwrap_or_default();
    for p in [std::env::var("PATH").ok(), crate::editor::login_path().clone()].into_iter().flatten() {
        dirs.extend(std::env::split_paths(&p));
    }
    for d in ["/opt/homebrew/bin", "/usr/local/bin"] {
        dirs.push(PathBuf::from(d));
    }
    let mut seen = std::collections::HashSet::new();
    dirs.retain(|d| seen.insert(d.clone()));
    std::env::join_paths(dirs).unwrap_or_default()
}

fn handshake(s: &Shared, cwd: &str) -> Result<Value, String> {
    let init = s.call(
        "initialize",
        json!({
            "protocolVersion": PROTOCOL_VERSION,
            "clientCapabilities": { "fs": { "readTextFile": true, "writeTextFile": true }, "terminal": false },
            "clientInfo": { "name": "gittor", "version": env!("CARGO_PKG_VERSION") },
        }),
        Duration::from_secs(300),
    )?;
    let session = s.call("session/new", json!({ "cwd": cwd, "mcpServers": [] }), Duration::from_secs(120))?;
    let id = session.get("sessionId").and_then(|v| v.as_str()).ok_or("the agent gave no session id")?;
    *s.session.lock().unwrap() = Some(id.to_string());
    Ok(json!({ "agent": init.get("agentInfo").cloned().unwrap_or(Value::Null), "session": session }))
}

fn read_loop(s: &Arc<Shared>, stdout: std::process::ChildStdout) {
    for line in BufReader::new(stdout).lines().map_while(Result::ok) {
        let Ok(msg) = serde_json::from_str::<Value>(&line) else {
            s.emit(json!({ "type": "log", "text": line }));
            continue;
        };
        let id = msg.get("id").cloned();
        match (msg.get("method").and_then(|m| m.as_str()), id) {
            (Some(method), Some(id)) => handle_request(s, method, msg.get("params").cloned().unwrap_or(Value::Null), id),
            (Some("session/update"), None) => {
                s.emit(json!({ "type": "update", "update": msg.pointer("/params/update").cloned().unwrap_or(Value::Null) }))
            }
            (Some(_), None) => {}
            (None, Some(id)) => {
                let Some(reply) = id.as_u64().and_then(|n| s.pending.lock().unwrap().remove(&n)) else { continue };
                match msg.get("error") {
                    Some(e) => reply(Err(e.get("message").and_then(|m| m.as_str()).unwrap_or("the agent failed").to_string())),
                    None => reply(Ok(msg.get("result").cloned().unwrap_or(Value::Null))),
                }
            }
            (None, None) => {}
        }
    }
    let open: Vec<Reply> = s.pending.lock().unwrap().drain().map(|(_, r)| r).collect();
    for r in open {
        r(Err("the agent stopped".into()));
    }
    s.emit(json!({ "type": "exit" }));
}

fn handle_request(s: &Arc<Shared>, method: &str, params: Value, id: Value) {
    match method {
        "session/request_permission" => {
            static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);
            let token = NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
            s.permissions.lock().unwrap().insert(token, id);
            s.emit(json!({
                "type": "permission",
                "token": token,
                "toolCall": params.get("toolCall").cloned().unwrap_or(Value::Null),
                "options": params.get("options").cloned().unwrap_or(json!([])),
            }));
        }
        "fs/read_text_file" => s.respond(id, read_text(&params).map(|content| json!({ "content": content }))),
        "fs/write_text_file" => {
            let r = write_text(&params);
            if r.is_ok() {
                s.emit(json!({ "type": "wrote", "path": params.get("path").cloned().unwrap_or(Value::Null) }));
            }
            s.respond(id, r.map(|_| Value::Null));
        }
        _ => {
            let _ = s.send(&json!({ "jsonrpc": "2.0", "id": id, "error": { "code": -32601, "message": format!("{method} is not supported") } }));
        }
    }
}

/// Reads a file for the agent. `line` (from 1) and `limit` give a part of the file, as ACP defines.
fn read_text(params: &Value) -> Result<String, String> {
    let path = params.get("path").and_then(|p| p.as_str()).ok_or("no path")?;
    let text = std::fs::read_to_string(path).map_err(|e| format!("{path}: {e}"))?;
    let line = params.get("line").and_then(|v| v.as_u64()).unwrap_or(1).max(1) as usize;
    let limit = params.get("limit").and_then(|v| v.as_u64()).map(|n| n as usize);
    if line == 1 && limit.is_none() {
        return Ok(text);
    }
    let lines = text.split_inclusive('\n').skip(line - 1);
    Ok(match limit {
        Some(n) => lines.take(n).collect(),
        None => lines.collect(),
    })
}

fn write_text(params: &Value) -> Result<(), String> {
    let path = PathBuf::from(params.get("path").and_then(|p| p.as_str()).ok_or("no path")?);
    let content = params.get("content").and_then(|c| c.as_str()).ok_or("no content")?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    std::fs::write(&path, content).map_err(|e| format!("{}: {e}", path.display()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_a_part_of_a_file() {
        let dir = std::env::temp_dir().join(format!("gittor-acp-read-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let f = dir.join("a.txt");
        std::fs::write(&f, "one\ntwo\nthree\n").unwrap();
        let p = f.to_string_lossy();
        assert_eq!(read_text(&json!({ "path": p })).unwrap(), "one\ntwo\nthree\n");
        assert_eq!(read_text(&json!({ "path": p, "line": 2, "limit": 1 })).unwrap(), "two\n");
        assert_eq!(read_text(&json!({ "path": p, "line": 2 })).unwrap(), "two\nthree\n");
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
