// Agent mode: the back side of the window. The agent button or its key turns the window around. The back
// side is drawn from the files of the agent-mode folder: layout.json, style.css and mods/<name>/main.js.
// An agent (ACP) edits these files, and the window loads them again within a second.

import "./agent-mode.css";
import { Canvas, checkCanvas, type CanvasSpec } from "./agent-canvas";
import { api, call, getRepoRoot, onBackendEvent, type ModeFiles } from "./api";
import { h } from "./dom";
import { icon } from "./icons";
import { toast } from "./notify";
import { agentBtn, tabsInTitleBar } from "./shell";
import { onRepoChange } from "./windows";

// ---- The conversation with the agent ----

type Option = { optionId: string; name: string; kind: string };
type LogEntry =
  | { kind: "user" | "agent" | "thought" | "info" | "error"; text: string }
  | { kind: "tool"; id: string; title: string; status: string; toolKind: string }
  | { kind: "plan"; entries: { content: string; status: string }[] }
  | { kind: "permission"; token: number; title: string; options: Option[]; answer?: string | null };
type AgentState = "off" | "starting" | "ready" | "busy" | "error";

const agent = { log: [] as LogEntry[], state: "off" as AgentState, name: null as string | null, stderr: [] as string[] };

const listeners = { agent: new Set<() => void>(), repo: new Set<() => void>() };
const emit = (k: keyof typeof listeners) => listeners[k].forEach((fn) => fn());

/** Adds an entry, or replaces the entry at `i` with a new object, so that a mod sees what changed. */
function put(e: LogEntry, i = agent.log.length) {
  agent.log = agent.log.slice();
  agent.log[i] = e;
}

function appendText(kind: "agent" | "thought", text: string) {
  const last = agent.log[agent.log.length - 1];
  if (last && last.kind === kind) put({ kind, text: last.text + text }, agent.log.length - 1);
  else put({ kind, text });
}

/** Turns an ACP message of the backend (see crates/service/src/agent.rs) into entries of the log. */
function onAgentMessage(d: Record<string, any>) {
  switch (d.type) {
    case "status":
      agent.state = d.state === "ready" ? "ready" : "starting";
      put({ kind: "info", text: d.state === "ready" ? `${d.info?.agent?.title ?? d.info?.agent?.name ?? agent.name} is ready.` : `Starting ${agent.name}…` });
      break;
    case "update": {
      const u = d.update ?? {};
      const text = u.content?.type === "text" ? String(u.content.text ?? "") : "";
      if (u.sessionUpdate === "agent_message_chunk") appendText("agent", text);
      else if (u.sessionUpdate === "agent_thought_chunk") appendText("thought", text);
      else if (u.sessionUpdate === "tool_call") put({ kind: "tool", id: u.toolCallId, title: u.title ?? "", status: u.status ?? "pending", toolKind: u.kind ?? "" });
      else if (u.sessionUpdate === "tool_call_update") {
        const i = agent.log.findIndex((e) => e.kind === "tool" && e.id === u.toolCallId);
        if (i >= 0) {
          const old = agent.log[i] as Extract<LogEntry, { kind: "tool" }>;
          put({ ...old, title: u.title ?? old.title, status: u.status ?? old.status }, i);
        }
      } else if (u.sessionUpdate === "plan") {
        const i = agent.log.findIndex((e) => e.kind === "plan");
        put({ kind: "plan", entries: (u.entries ?? []).map((p: any) => ({ content: String(p.content ?? ""), status: String(p.status ?? "") })) }, i >= 0 ? i : undefined);
      } else return;
      break;
    }
    case "permission":
      put({ kind: "permission", token: d.token, title: d.toolCall?.title ?? "The agent asks for permission", options: d.options ?? [] });
      break;
    case "done":
      agent.state = "ready";
      if (d.stopReason && d.stopReason !== "end_turn") put({ kind: "info", text: `Stopped: ${d.stopReason}` });
      break;
    case "error": {
      const tail = agent.state === "starting" && agent.stderr.length ? `\n${agent.stderr.slice(-6).join("\n")}` : "";
      agent.state = agent.state === "starting" ? "error" : "ready";
      put({ kind: "error", text: String(d.message) + tail });
      break;
    }
    case "log":
      agent.stderr.push(String(d.text));
      if (agent.stderr.length > 200) agent.stderr.splice(0, 100);
      return;
    case "exit":
      if (agent.state !== "error") agent.state = "off";
      put({ kind: "info", text: "The agent stopped." });
      break;
    default:
      return;
  }
  emit("agent");
}

void onBackendEvent((e) => {
  if (e.kind === "agent") onAgentMessage(e.data);
});

const agentApi = {
  list: () => api.agentList(),
  async start(index: number, cwd?: string) {
    const list = await api.agentList();
    agent.name = list[index]?.name ?? null;
    agent.stderr = [];
    agent.state = "starting";
    emit("agent");
    try {
      await api.agentStart(index, cwd ?? "");
    } catch (e) {
      agent.state = "error";
      put({ kind: "error", text: String(e).replace(/^Error: /, "") });
      emit("agent");
      throw e;
    }
  },
  async send(text: string) {
    put({ kind: "user", text });
    agent.state = "busy";
    emit("agent");
    try {
      await api.agentPrompt(text);
    } catch (e) {
      agent.state = "ready";
      put({ kind: "error", text: String(e).replace(/^Error: /, "") });
      emit("agent");
    }
  },
  cancel: () => api.agentCancel().then(() => undefined),
  async stop() {
    await api.agentStop();
    agent.state = "off";
    emit("agent");
  },
  async answer(token: number, optionId: string | null) {
    const i = agent.log.findIndex((e) => e.kind === "permission" && e.token === token);
    if (i >= 0) put({ ...(agent.log[i] as Extract<LogEntry, { kind: "permission" }>), answer: optionId }, i);
    emit("agent");
    await api.agentAnswer(token, optionId);
  },
  log: () => agent.log,
  state: () => agent.state,
  name: () => agent.name,
};

// ---- The back side and the turn ----

const styleEl = h("style", { id: "agent-mode-style" });
const content = h("div", { class: "am-content" });
const errorBar = h("div", { class: "am-errors", hidden: true });
const dirLabel = h("span", { class: "am-dir" });
const bar = h(
  "div",
  { class: "am-bar", "data-tauri-drag-region": "" },
  h("span", { class: "am-title" }, icon("agent"), "Agent Mode"),
  dirLabel,
  h("span", { class: "spacer" }),
  h("button", { class: "tb-button", title: "Load the files of this side again", onclick: () => void reload(true) }, "Reload"),
  h("button", { class: "tb-button", title: "Move the folder to a backup and write the default files again", onclick: () => void resetFiles() }, "Reset"),
  h("button", { class: "tb-button tb-icon am-flip", title: "Turn back to the Git side", "aria-label": "Git side", "data-key-action": "agentMode", onclick: () => void toggleAgentMode(false) }, icon("flip")),
);
export const backSide = h("div", { class: "agent-mode", hidden: true, tabindex: "-1" }, bar, errorBar, content);
if (tabsInTitleBar) backSide.classList.add("am-titlebar");
document.head.append(styleEl);
document.body.append(backSide);
const front = document.getElementById("app")!;

let on = false;
let turning = false;
export const agentModeOn = () => on;

/** Turns the window around, as a card: the front side turns away to its edge, then the back side comes. */
export async function toggleAgentMode(show = !on) {
  if (turning || show === on) return;
  turning = true;
  const loading = show ? reload(false) : Promise.resolve();
  const [from, to] = show ? [front, backSide] : [backSide, front];
  const dir = show ? 1 : -1;
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
  document.body.classList.add("am-turning");
  try {
    if (!still) await turn(from, 0, 90 * dir, "cubic-bezier(0.55, 0, 0.8, 0.25)");
    await loading;
    on = show;
    front.inert = show;
    // Monaco sets `visibility: visible` on its own elements, so only opacity hides the whole side.
    front.style.opacity = show ? "0" : "";
    backSide.hidden = !show;
    if (show) canvas?.shown();
    if (!still) await turn(to, -90 * dir, 0, "cubic-bezier(0.15, 0.8, 0.3, 1)");
  } finally {
    document.body.classList.remove("am-turning");
    turning = false;
  }
  agentBtn.classList.toggle("active", on);
  if (on) {
    backSide.focus();
    startPolling();
  }
}

function turn(el: HTMLElement, fromDeg: number, toDeg: number, easing: string) {
  const frame = (deg: number) => ({ transform: `perspective(1800px) rotateY(${deg}deg) scale(${1 - (Math.abs(deg) / 90) * 0.12})` });
  return el.animate([frame(fromDeg), frame(toDeg)], { duration: 360, easing, fill: "none" }).finished;
}

agentBtn.dataset.keyAction = "agentMode";
agentBtn.addEventListener("click", () => void toggleAgentMode());

// ---- The files of the back side ----

type LayoutNode = { type?: "row" | "column"; children?: LayoutNode[]; mod?: string; size?: number; grow?: number; class?: string; props?: Record<string, unknown> };
/** A window at the bottom left of the back side, over the layout. It folds to a small button. */
type DockSpec = { mod: string; title?: string; width?: number; height?: number; props?: Record<string, unknown> };
type LayoutRoot = (LayoutNode | CanvasSpec) & { dock?: DockSpec };
type ModFn = (root: HTMLElement, g: unknown) => void | (() => void);

let files: ModeFiles | null = null;
let layoutText = "";
/** The layout on the screen. The canvas changes the places of its nodes in it. */
let layout: LayoutRoot | null = null;
let canvas: Canvas | null = null;
/** The last module of each mod that loaded: a broken edit keeps it. */
const good = new Map<string, { code: string; fn: ModFn }>();
/** The blocks on the screen. */
const blocks: { el: HTMLElement; node: LayoutNode; cleanup: (() => void) | null; offs: (() => void)[] }[] = [];
const errors = new Map<string, string>();

function setError(name: string, message: string | null) {
  if ((errors.get(name) ?? null) === message) return;
  if (message) errors.set(name, message);
  else errors.delete(name);
  void api.modeError(name, message).catch(() => {});
  errorBar.hidden = !errors.size;
  errorBar.replaceChildren(...[...errors].map(([n, m]) => h("div", {}, h("b", {}, n === "layout" ? "layout.json" : `mods/${n}/main.js`), ": ", m)));
}

function checkRoot(r: LayoutRoot): string | null {
  if (r && typeof r === "object" && r.dock !== undefined && (typeof r.dock !== "object" || typeof r.dock?.mod !== "string")) return "layout.dock needs a \"mod\"";
  if (r && typeof r === "object" && r.type === "canvas") return checkCanvas(r as CanvasSpec, "layout");
  return checkLayout(r, "layout");
}

function checkLayout(n: unknown, at: string): string | null {
  if (!n || typeof n !== "object") return `${at} is not an object`;
  const node = n as LayoutNode;
  if (node.mod !== undefined) return typeof node.mod === "string" ? null : `${at}.mod is not a string`;
  if (node.type !== "row" && node.type !== "column") return `${at} needs "mod", or "type": "row" or "column"`;
  if (!Array.isArray(node.children)) return `${at}.children is not a list`;
  for (let i = 0; i < node.children.length; i++) {
    const e = checkLayout(node.children[i], `${at}.children[${i}]`);
    if (e) return e;
  }
  return null;
}

async function loadModule(name: string): Promise<ModFn | null> {
  const file = files?.mods.find((m) => m.name === name);
  const last = good.get(name);
  if (!file) {
    setError(name, "the file is missing");
    return last?.fn ?? null;
  }
  if (last && last.code === file.code) return last.fn;
  const url = URL.createObjectURL(new Blob([file.code], { type: "text/javascript" }));
  try {
    const m = await import(/* @vite-ignore */ url);
    if (typeof m.default !== "function") throw new Error("the module has no default function");
    good.set(name, { code: file.code, fn: m.default });
    setError(name, null);
    return m.default;
  } catch (e) {
    setError(name, String(e instanceof Error ? e.message : e));
    return last?.fn ?? null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function unmount(b: (typeof blocks)[number]) {
  b.offs.forEach((off) => off());
  b.offs = [];
  try {
    b.cleanup?.();
  } catch {
    // A cleanup that fails must not stop the next mod.
  }
  b.cleanup = null;
}

async function mount(b: (typeof blocks)[number]) {
  unmount(b);
  const name = b.node.mod!;
  const fn = await loadModule(name);
  b.el.replaceChildren();
  if (!fn) return void b.el.append(h("div", { class: "am-missing" }, `The mod "${name}" did not load.`));
  const g = {
    h,
    props: b.node.props ?? {},
    dir: files?.dir ?? "",
    repo: getRepoRoot,
    call: (cmd: string, args?: Record<string, unknown>) => call(cmd, args),
    on(event: "repo" | "agent", fn: () => void) {
      const set = listeners[event];
      if (!set) throw new Error(`no event ${event}`);
      set.add(fn);
      const off = () => set.delete(fn);
      b.offs.push(off);
      return off;
    },
    toast: (m: string, kind?: "info" | "success" | "error") => toast(m, kind),
    flip: () => void toggleAgentMode(false),
    agent: agentApi,
  };
  try {
    const r = fn(b.el, g);
    b.cleanup = typeof r === "function" ? r : null;
  } catch (e) {
    setError(name, `mount: ${e instanceof Error ? e.message : e}`);
    b.el.append(h("div", { class: "am-missing" }, `The mod "${name}" failed: ${e}`));
  }
}

function build(n: LayoutNode): HTMLElement {
  const el = n.mod !== undefined ? h("div", { class: "am-node am-block", "data-mod": n.mod }) : h("div", { class: `am-node am-${n.type}` }, ...(n.children ?? []).map(build));
  if (n.class) el.classList.add(...n.class.split(/\s+/).filter(Boolean));
  el.style.flex = typeof n.size === "number" ? `0 0 ${n.size}px` : `${typeof n.grow === "number" ? n.grow : 1} 1 0`;
  if (n.mod !== undefined) blocks.push({ el, node: n, cleanup: null, offs: [] });
  return el;
}

// ---- The dock: the agent window at the bottom left ----

const DOCK_KEY = "gittor.agentDock";
const dockState = h("span", { class: "am-dock-state" });
const pillState = h("span", { class: "am-dock-state" });
const dockTitle = h("span", { class: "am-dock-title" });
const pillTitle = h("span", {});
const dockBody = h("div", { class: "am-dock-body am-block" });
const dock = h(
  "div",
  { class: "am-dock", hidden: true },
  h("div", { class: "am-dock-head" }, icon("agent"), dockTitle, dockState, h("span", { class: "spacer" }), h("button", { class: "tb-button tb-icon am-dock-fold", title: "Fold the window", "aria-label": "Fold", onclick: () => setDockOpen(false) }, icon("chevron-down"))),
  dockBody,
);
const pill = h("button", { class: "am-dock-pill", hidden: true, title: "Open the agent window", onclick: () => setDockOpen(true) }, icon("agent"), pillTitle, pillState);

function dockOpen(): boolean {
  try {
    return localStorage.getItem(DOCK_KEY) !== "closed";
  } catch {
    return true;
  }
}

function setDockOpen(open: boolean) {
  try {
    localStorage.setItem(DOCK_KEY, open ? "open" : "closed");
  } catch {
    // Without storage the window opens at the next start.
  }
  showDock();
}

function showDock() {
  const spec = layout?.dock;
  dock.hidden = !spec || !dockOpen();
  pill.hidden = !spec || dockOpen();
  if (!spec) return;
  dock.style.width = `${spec.width ?? 420}px`;
  dock.style.height = `${spec.height ?? 540}px`;
  dockTitle.textContent = pillTitle.textContent = spec.title ?? spec.mod;
}

/** The dot of the agent state, also on the folded button: a question of the agent is easy to see. */
function showAgentState() {
  const asks = agent.log.some((e) => e.kind === "permission" && e.answer === undefined);
  for (const el of [dockState, pillState]) {
    el.dataset.state = asks ? "asks" : agent.state;
    el.title = asks ? "The agent asks for permission" : agent.state;
  }
}
listeners.agent.add(showAgentState);
showAgentState();

function saveLayout() {
  if (!layout) return;
  const text = JSON.stringify(layout, null, 2) + "\n";
  // The poll then finds the same text and does not draw the canvas again.
  layoutText = text;
  void api.modeSaveLayout(text).catch((e) => toast(String(e).replace(/^Error: /, ""), "error"));
}

/** Loads the files, and draws again what changed: the whole layout, or only the blocks of changed mods. */
async function reload(force: boolean) {
  let next: ModeFiles;
  try {
    next = await api.modeFiles();
  } catch (e) {
    content.replaceChildren(h("div", { class: "am-missing" }, String(e)));
    return;
  }
  const changedMods = new Set(next.mods.filter((m) => force || files?.mods.find((o) => o.name === m.name)?.code !== m.code).map((m) => m.name));
  for (const old of files?.mods ?? []) if (!next.mods.some((m) => m.name === old.name)) changedMods.add(old.name);
  files = next;
  dirLabel.textContent = next.dir;
  dirLabel.title = next.dir;
  if (styleEl.textContent !== next.style) styleEl.textContent = next.style;
  let fresh: LayoutRoot | null = null;
  if (force || next.layout !== layoutText) {
    try {
      const parsed = JSON.parse(next.layout);
      const e = checkRoot(parsed);
      if (e) throw new Error(e);
      fresh = parsed;
      setError("layout", null);
    } catch (e) {
      setError("layout", e instanceof Error ? e.message : String(e));
    }
  }
  if (fresh) {
    layoutText = next.layout;
    layout = fresh;
    blocks.splice(0).forEach(unmount);
    canvas?.dispose();
    canvas = null;
    if (fresh.type === "canvas") {
      canvas = new Canvas(fresh as CanvasSpec, saveLayout, () => (dock.hidden ? 0 : dock.offsetWidth + 12));
      for (const { node, body } of canvas.bodies()) blocks.push({ el: body, node, cleanup: null, offs: [] });
      content.replaceChildren(canvas.el);
    } else {
      content.replaceChildren(build(fresh as LayoutNode));
    }
    content.append(dock, pill);
    if (fresh.dock) blocks.push({ el: dockBody, node: { mod: fresh.dock.mod, props: fresh.dock.props }, cleanup: null, offs: [] });
    showDock();
    await Promise.all(blocks.map(mount));
    if (!backSide.hidden) canvas?.shown();
  } else {
    await Promise.all(blocks.filter((b) => changedMods.has(b.node.mod!)).map(mount));
  }
}

async function resetFiles() {
  try {
    const backup = await api.modeReset();
    good.clear();
    await reload(true);
    toast(`The old files are in ${backup}`, "success");
  } catch (e) {
    toast(String(e).replace(/^Error: /, ""), "error");
  }
}

// While the back side shows, a small poll finds edits of the files and a switch of the project tab.
let timer = 0;
let stamp = "";
let root = getRepoRoot();
function startPolling() {
  if (timer) return;
  stamp = files?.stamp ?? "";
  timer = window.setInterval(async () => {
    if (!on) {
      clearInterval(timer);
      timer = 0;
      return;
    }
    if (getRepoRoot() !== root) {
      root = getRepoRoot();
      emit("repo");
    }
    try {
      const s = await api.modeStamp();
      if (s !== stamp && on) {
        stamp = s;
        await reload(false);
        stamp = files?.stamp ?? s;
      }
    } catch {
      // The next poll tries again.
    }
  }, 700);
}

onRepoChange(() => {
  if (on) emit("repo");
});
