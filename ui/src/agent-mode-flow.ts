// Agent mode: the back side of the window. The agent button or its key turns the window around. The back
// side shows workflows in tabs. Each workflow is a folder: workflow.json (its projects and knowledge
// folders), layout.json, style.css and mods/<name>/main.js. An agent (ACP) edits these files, and the
// window loads them again within a second.

import "./agent-mode.css";
import { Canvas, checkCanvas, type CanvasSpec } from "./agent-canvas";
import { api, call, getRepoRoot, onBackendEvent, type ModeFiles, type WorkflowInfo } from "./api";
import { menuBelow } from "./context-menu";
import { formDialog } from "./dialogs";
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

/** The conversation with the agent of one workflow. */
type AgentSession = { log: LogEntry[]; state: AgentState; name: string | null; stderr: string[] };
const sessions = new Map<string, AgentSession>();
function sessionOf(workflow: string): AgentSession {
  let s = sessions.get(workflow);
  if (!s) sessions.set(workflow, (s = { log: [], state: "off", name: null, stderr: [] }));
  return s;
}

const listeners = { agent: new Set<() => void>(), repo: new Set<() => void>() };
const emit = (k: keyof typeof listeners) => listeners[k].forEach((fn) => fn());

/** Adds an entry, or replaces the entry at `i` with a new object, so that a mod sees what changed. */
function put(a: AgentSession, e: LogEntry, i = a.log.length) {
  a.log = a.log.slice();
  a.log[i] = e;
}

function appendText(a: AgentSession, kind: "agent" | "thought", text: string) {
  const last = a.log[a.log.length - 1];
  if (last && last.kind === kind) put(a, { kind, text: last.text + text }, a.log.length - 1);
  else put(a, { kind, text });
}

/** Turns an ACP message of the backend (see crates/service/src/agent.rs) into entries of the log. */
function onAgentMessage(workflow: string, d: Record<string, any>) {
  const a = sessionOf(workflow);
  switch (d.type) {
    case "status":
      a.state = d.state === "ready" ? "ready" : "starting";
      put(a, { kind: "info", text: d.state === "ready" ? `${d.info?.agent?.title ?? d.info?.agent?.name ?? a.name} is ready.` : `Starting ${a.name}…` });
      break;
    case "update": {
      const u = d.update ?? {};
      const text = u.content?.type === "text" ? String(u.content.text ?? "") : "";
      if (u.sessionUpdate === "agent_message_chunk") appendText(a, "agent", text);
      else if (u.sessionUpdate === "agent_thought_chunk") appendText(a, "thought", text);
      else if (u.sessionUpdate === "tool_call") put(a, { kind: "tool", id: u.toolCallId, title: u.title ?? "", status: u.status ?? "pending", toolKind: u.kind ?? "" });
      else if (u.sessionUpdate === "tool_call_update") {
        const i = a.log.findIndex((e) => e.kind === "tool" && e.id === u.toolCallId);
        if (i >= 0) {
          const old = a.log[i] as Extract<LogEntry, { kind: "tool" }>;
          put(a, { ...old, title: u.title ?? old.title, status: u.status ?? old.status }, i);
        }
      } else if (u.sessionUpdate === "plan") {
        const i = a.log.findIndex((e) => e.kind === "plan");
        put(a, { kind: "plan", entries: (u.entries ?? []).map((p: any) => ({ content: String(p.content ?? ""), status: String(p.status ?? "") })) }, i >= 0 ? i : undefined);
      } else return;
      break;
    }
    case "permission":
      put(a, { kind: "permission", token: d.token, title: d.toolCall?.title ?? "The agent asks for permission", options: d.options ?? [] });
      break;
    case "done":
      a.state = "ready";
      if (d.stopReason && d.stopReason !== "end_turn") put(a, { kind: "info", text: `Stopped: ${d.stopReason}` });
      break;
    case "error": {
      const tail = a.state === "starting" && a.stderr.length ? `\n${a.stderr.slice(-6).join("\n")}` : "";
      a.state = a.state === "starting" ? "error" : "ready";
      put(a, { kind: "error", text: String(d.message) + tail });
      break;
    }
    case "log":
      a.stderr.push(String(d.text));
      if (a.stderr.length > 200) a.stderr.splice(0, 100);
      return;
    case "exit":
      if (a.state !== "error") a.state = "off";
      put(a, { kind: "info", text: "The agent stopped." });
      break;
    default:
      return;
  }
  renderTabs();
  if (workflow === active) emit("agent");
}

void onBackendEvent((e) => {
  if (e.kind === "agent") onAgentMessage(e.workflow, e.data);
});

/** The agent API of the mods of a workflow. */
function agentApiFor(workflow: string) {
  const a = sessionOf(workflow);
  const changed = () => {
    renderTabs();
    if (workflow === active) emit("agent");
  };
  return {
    list: () => api.agentList(),
    async start(index: number) {
      const list = await api.agentList();
      a.name = list[index]?.name ?? null;
      a.stderr = [];
      a.state = "starting";
      changed();
      try {
        await api.agentStart(workflow, index);
      } catch (e) {
        a.state = "error";
        put(a, { kind: "error", text: String(e).replace(/^Error: /, "") });
        changed();
        throw e;
      }
    },
    async send(text: string) {
      put(a, { kind: "user", text });
      a.state = "busy";
      changed();
      try {
        await api.agentPrompt(workflow, text);
      } catch (e) {
        a.state = "ready";
        put(a, { kind: "error", text: String(e).replace(/^Error: /, "") });
        changed();
      }
    },
    cancel: () => api.agentCancel(workflow).then(() => undefined),
    async stop() {
      await api.agentStop(workflow);
      a.state = "off";
      changed();
    },
    async answer(token: number, optionId: string | null) {
      const i = a.log.findIndex((e) => e.kind === "permission" && e.token === token);
      if (i >= 0) put(a, { ...(a.log[i] as Extract<LogEntry, { kind: "permission" }>), answer: optionId }, i);
      changed();
      await api.agentAnswer(workflow, token, optionId);
    },
    log: () => a.log,
    state: () => a.state,
    name: () => a.name,
  };
}

/** True while the agent of the workflow waits for an answer of the user. */
const asks = (a: AgentSession) => a.log.some((e) => e.kind === "permission" && e.answer === undefined);

// ---- Workflows: the tabs at the top of the back side ----

let workflows: WorkflowInfo[] = [];
/** The id of the workflow on the screen. */
let active = "";
/** The ids of the open tabs. */
let tabs: string[] = [];
/** The repository roots of the projects of the active workflow that opened. */
let projectRoots: string[] = [];
/** The open cards of the canvas of each workflow, for a switch back. */
const openIdsOf = new Map<string, string[]>();
const WF_KEY = "gittor.workflowTabs";
const wfTabs = h("div", { class: "am-wf-tabs" });
const addBtn = h("button", { class: "tb-button tb-icon am-wf-add", title: "Open or make a workflow", "aria-label": "Add workflow", onclick: () => addMenu() }, icon("add"));
const baseName = (p: string) => p.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? p;

function saveTabs() {
  try {
    localStorage.setItem(WF_KEY, JSON.stringify({ tabs, active }));
  } catch {
    // Without storage the first workflow opens at the next start.
  }
}

/** Reads the workflows. The first call opens the tabs of the last time. */
async function loadWorkflows() {
  workflows = await api.workflowList();
  if (!active) {
    let saved: { tabs?: string[]; active?: string } = {};
    try {
      saved = JSON.parse(localStorage.getItem(WF_KEY) ?? "{}") ?? {};
    } catch {
      // A damaged entry opens the first workflow.
    }
    const ids = new Set(workflows.map((w) => w.id));
    tabs = (saved.tabs ?? []).filter((id) => ids.has(id));
    if (!tabs.length && workflows.length) tabs = [workflows[0].id];
    active = saved.active && tabs.includes(saved.active) ? saved.active : (tabs[0] ?? "");
  }
  renderTabs();
}

let tabsDrawn = "";
/** Draws the tabs, only when they changed: a new element under the mouse loses the click. */
function renderTabs() {
  const state = (id: string) => {
    const a = sessions.get(id);
    return a && a.state !== "off" ? (asks(a) ? "asks" : a.state) : "";
  };
  const key = JSON.stringify([tabs, active, tabs.map(state), workflows.map((w) => w.name)]);
  if (key === tabsDrawn) return;
  tabsDrawn = key;
  wfTabs.replaceChildren(
    ...tabs.map((id) => {
      const w = workflows.find((x) => x.id === id);
      const st = state(id);
      const close = tabs.length > 1 ? h("span", { class: "am-wf-close", title: "Close the tab", onclick: (e: MouseEvent) => (e.stopPropagation(), closeTab(id)) }, icon("close")) : null;
      return h(
        "button",
        { class: `am-wf-tab${id === active ? " active" : ""}`, "data-workflow": id, title: w?.dir ?? id, onclick: () => void openWorkflow(id) },
        icon("workflow"),
        h("span", { class: "am-wf-name" }, w?.name ?? id),
        st ? h("span", { class: "am-dock-state", "data-state": st }) : null,
        close,
      );
    }),
  );
}

/** Shows a workflow: opens its tab when it has none. */
export async function openWorkflow(id: string): Promise<boolean> {
  if (!workflows.some((w) => w.id === id)) workflows = await api.workflowList();
  if (!workflows.some((w) => w.id === id)) {
    toast(`There is no workflow "${id}".`, "error");
    return false;
  }
  if (!tabs.includes(id)) tabs.push(id);
  if (id === active && files) {
    renderTabs();
    return true;
  }
  if (canvas) openIdsOf.set(active, canvas.openIds());
  active = id;
  saveTabs();
  renderTabs();
  canvas?.dispose();
  canvas = null;
  blocks.splice(0).forEach(unmount);
  files = null;
  layoutText = "";
  layout = null;
  for (const name of [...errors.keys()]) errors.delete(name);
  errorBar.hidden = true;
  stamp = "";
  await reload(true);
  // reload() sets the files.
  stamp = (files as ModeFiles | null)?.stamp ?? "";
  return true;
}

function closeTab(id: string) {
  tabs = tabs.filter((t) => t !== id);
  saveTabs();
  if (id === active && tabs.length) void openWorkflow(tabs[0]);
  else renderTabs();
}

function addMenu() {
  const others = workflows.filter((w) => !tabs.includes(w.id));
  menuBelow(addBtn, [
    ...others.map((w) => ({ label: w.name, detail: w.projects.map(baseName).join(", "), icon: "workflow" as const, action: () => void openWorkflow(w.id) })),
    ...(others.length ? [{ separator: true as const }] : []),
    { label: "New Workflow…", action: () => void newWorkflow() },
  ]);
}

async function newWorkflow() {
  const r = await formDialog(
    "New Workflow",
    [
      { key: "name", label: "Name", placeholder: "Release" },
      { key: "projects", label: "Projects: the folders of the repositories, one on each line", type: "textarea", value: getRepoRoot() ?? "" },
    ],
    "Create",
    "A workflow is a folder with its own canvas, panels and agent. Gittor makes it in the folder of the workflows.",
  );
  if (!r || !String(r.name).trim()) return;
  try {
    const projects = String(r.projects).split("\n").map((p) => p.trim()).filter(Boolean);
    const w = await api.workflowCreate(String(r.name), projects);
    workflows = await api.workflowList();
    await openWorkflow(w.id);
  } catch (e) {
    toast(String(e).replace(/^Error: /, ""), "error");
  }
}

// ---- The back side and the turn ----

const styleEl = h("style", { id: "agent-mode-style" });
const content = h("div", { class: "am-content" });
const errorBar = h("div", { class: "am-errors", hidden: true });
const dirLabel = h("span", { class: "am-dir" });
const bar = h(
  "div",
  { class: "am-bar", "data-tauri-drag-region": "" },
  h("span", { class: "am-title", title: "Agent Mode: the workflows" }, icon("agent")),
  wfTabs,
  addBtn,
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

/** A node of the layout: a row, a column, a canvas, or a block with a mod. A block with a title is a panel
 * with a title bar; `collapsible` lets the user fold it to its title bar. */
type LayoutNode = {
  type?: "row" | "column" | "canvas";
  children?: LayoutNode[];
  mod?: string;
  id?: string;
  title?: string;
  collapsible?: boolean;
  /** "agent" shows the state of the agent in the title bar. */
  badge?: string;
  size?: number;
  grow?: number;
  class?: string;
  props?: Record<string, unknown>;
};
/** A window at the bottom left of the back side, over the layout. It folds to a small button. */
type DockSpec = { mod: string; title?: string; width?: number; height?: number; props?: Record<string, unknown> };
type LayoutRoot = LayoutNode & { dock?: DockSpec };
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

/** Adds a block and draws its mod. */
function addBlock(el: HTMLElement, node: LayoutNode) {
  const b = { el, node, cleanup: null, offs: [] };
  blocks.push(b);
  void mount(b);
}

/** Stops the mod of a block and forgets the block. */
function removeBlock(el: HTMLElement) {
  const i = blocks.findIndex((b) => b.el === el);
  if (i < 0) return;
  unmount(blocks[i]);
  blocks.splice(i, 1);
}

const canvasHost = {
  workflowName: (id: string) => workflows.find((w) => w.id === id)?.name ?? id,
  openWorkflow: (id: string) => openWorkflow(id),
  /** The body of a card of another workflow: its projects, and a hint to open it. */
  workflowCard(body: HTMLElement, id: string) {
    const w = workflows.find((x) => x.id === id);
    if (!w) return void body.append(h("div", { class: "am-missing" }, `There is no workflow "${id}".`));
    body.append(
      h(
        "div",
        { class: "am-wf-card-body" },
        h("div", { class: "am-wf-card-projects" }, ...(w.projects.length ? w.projects.map((p) => h("span", { class: "am-wf-chip", title: p }, baseName(p))) : [h("span", { class: "am-wf-none" }, "No projects")])),
        w.knowledge.length ? h("div", { class: "am-wf-card-meta" }, `${w.knowledge.length} knowledge folder${w.knowledge.length > 1 ? "s" : ""}`) : null,
        h("div", { class: "am-wf-card-go" }, "Open the workflow →"),
      ),
    );
  },
  mount: (body: HTMLElement, mod: string, props: Record<string, unknown>) => addBlock(body, { mod, props }),
  unmount: removeBlock,
  moved: () => saveLayout(),
  insetLeft: () => (dock.hidden ? 0 : dock.offsetWidth + 12),
};
const errors = new Map<string, string>();

function setError(name: string, message: string | null) {
  if ((errors.get(name) ?? null) === message) return;
  if (message) errors.set(name, message);
  else errors.delete(name);
  void api.modeError(active, name, message).catch(() => {});
  errorBar.hidden = !errors.size;
  errorBar.replaceChildren(...[...errors].map(([n, m]) => h("div", {}, h("b", {}, n === "layout" ? "layout.json" : `mods/${n}/main.js`), ": ", m)));
}

function checkRoot(r: LayoutRoot): string | null {
  if (r && typeof r === "object" && r.dock !== undefined && (typeof r.dock !== "object" || typeof r.dock?.mod !== "string")) return "layout.dock needs a \"mod\"";
  return checkLayout(r, "layout");
}

function checkLayout(n: unknown, at: string): string | null {
  if (!n || typeof n !== "object") return `${at} is not an object`;
  const node = n as LayoutNode;
  if (node.type === "canvas") return checkCanvas(node as unknown as CanvasSpec, at);
  if (node.mod !== undefined) return typeof node.mod === "string" ? null : `${at}.mod is not a string`;
  if (node.type !== "row" && node.type !== "column") return `${at} needs "mod", or "type": "row", "column" or "canvas"`;
  if (!Array.isArray(node.children)) return `${at}.children is not a list`;
  for (let i = 0; i < node.children.length; i++) {
    const e = checkLayout(node.children[i], `${at}.children[${i}]`);
    if (e) return e;
  }
  return null;
}

async function loadModule(name: string): Promise<ModFn | null> {
  const file = files?.mods.find((m) => m.name === name);
  const key = `${active}/${name}`;
  const last = good.get(key);
  if (!file) {
    setError(name, "the file is missing");
    return last?.fn ?? null;
  }
  if (last && last.code === file.code) return last.fn;
  const url = URL.createObjectURL(new Blob([file.code], { type: "text/javascript" }));
  try {
    const m = await import(/* @vite-ignore */ url);
    if (typeof m.default !== "function") throw new Error("the module has no default function");
    good.set(key, { code: file.code, fn: m.default });
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
    workflow: files?.workflow ?? null,
    /** The repository roots of the projects of the workflow that opened. */
    projects: () => projectRoots.slice(),
    /** The first project of the workflow, else the repository of the active tab of the Git side. */
    repo: () => projectRoots[0] ?? getRepoRoot(),
    call: (cmd: string, args?: Record<string, unknown>) => call(cmd, projectRoots[0] ? { root: projectRoots[0], ...args } : args),
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
    agent: agentApiFor(active),
  };
  try {
    const r = fn(b.el, g);
    b.cleanup = typeof r === "function" ? r : null;
  } catch (e) {
    setError(name, `mount: ${e instanceof Error ? e.message : e}`);
    b.el.append(h("div", { class: "am-missing" }, `The mod "${name}" failed: ${e}`));
  }
}

const PANELS_KEY = "gittor.agentPanels";

function foldedPanels(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(PANELS_KEY) ?? "{}") ?? {};
  } catch {
    return {};
  }
}

function setFolded(key: string, folded: boolean) {
  try {
    localStorage.setItem(PANELS_KEY, JSON.stringify({ ...foldedPanels(), [key]: folded }));
  } catch {
    // Without storage the panel opens at the next start.
  }
}

/** Builds the elements of a layout node. The mods of the blocks start later, in `addBlock`. */
function build(n: LayoutNode, later: [HTMLElement, LayoutNode][], openIds: string[]): HTMLElement {
  let el: HTMLElement;
  if (n.type === "canvas") {
    canvas = new Canvas(n as unknown as CanvasSpec, canvasHost, openIds, active);
    el = h("div", { class: "am-node am-canvas-node" }, canvas.el);
  } else if (n.mod === undefined) {
    el = h("div", { class: `am-node am-${n.type}` }, ...(n.children ?? []).map((c) => build(c, later, openIds)));
  } else if (n.title === undefined && !n.collapsible) {
    el = h("div", { class: "am-node am-block", "data-mod": n.mod });
    later.push([el, n]);
  } else {
    // A panel: a title bar over the block, as a tool window.
    const key = n.id ?? n.mod;
    const body = h("div", { class: "am-panel-body am-block", "data-mod": n.mod });
    const fold = n.collapsible ? h("button", { class: "tb-button tb-icon am-panel-fold", title: "Fold or open the panel", "aria-label": "Fold" }, icon("chevron-down")) : null;
    const head = h("div", { class: "am-panel-head" }, h("span", { class: "am-panel-title" }, n.title ?? n.mod), n.badge === "agent" ? h("span", { class: "am-dock-state am-agent-state" }) : null, h("span", { class: "spacer" }), fold);
    el = h("div", { class: "am-node am-panel", "data-panel": key }, head, body);
    const flex = typeof n.size === "number" ? `0 0 ${n.size}px` : `${typeof n.grow === "number" ? n.grow : 1} 1 0`;
    const show = (folded: boolean) => {
      el.classList.toggle("am-folded", folded);
      el.style.flex = folded ? "0 0 auto" : flex;
    };
    if (fold) {
      const toggle = () => {
        const folded = !el.classList.contains("am-folded");
        setFolded(key, folded);
        show(folded);
      };
      fold.addEventListener("click", toggle);
      head.addEventListener("dblclick", (e) => !(e.target as Element).closest("button") && toggle());
    }
    show(!!n.collapsible && !!foldedPanels()[key]);
    later.push([body, n]);
    if (n.class) el.classList.add(...n.class.split(/\s+/).filter(Boolean));
    return el;
  }
  if (n.class) el.classList.add(...n.class.split(/\s+/).filter(Boolean));
  el.style.flex = typeof n.size === "number" ? `0 0 ${n.size}px` : `${typeof n.grow === "number" ? n.grow : 1} 1 0`;
  return el;
}

// ---- The dock: the agent window at the bottom left ----

const DOCK_KEY = "gittor.agentDock";
const dockState = h("span", { class: "am-dock-state am-agent-state" });
const pillState = h("span", { class: "am-dock-state am-agent-state" });
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
  const a = sessionOf(active);
  const asking = asks(a);
  for (const el of [dockState, pillState, ...document.querySelectorAll<HTMLElement>(".agent-mode .am-agent-state")]) {
    el.dataset.state = asking ? "asks" : a.state;
    el.title = asking ? "The agent asks for permission" : a.state;
  }
}
listeners.agent.add(showAgentState);
showAgentState();

function saveLayout() {
  if (!layout) return;
  const text = JSON.stringify(layout, null, 2) + "\n";
  // The poll then finds the same text and does not draw the canvas again.
  layoutText = text;
  void api.modeSaveLayout(active, text).catch((e) => toast(String(e).replace(/^Error: /, ""), "error"));
}

/** Loads the files, and draws again what changed: the whole layout, or only the blocks of changed mods. */
async function reload(force: boolean) {
  let next: ModeFiles;
  try {
    if (!active) await loadWorkflows();
    if (!active) throw new Error("There is no workflow.");
    next = await api.modeFiles(active);
  } catch (e) {
    content.replaceChildren(h("div", { class: "am-missing" }, String(e)));
    return;
  }
  const changedMods = new Set(next.mods.filter((m) => force || files?.mods.find((o) => o.name === m.name)?.code !== m.code).map((m) => m.name));
  for (const old of files?.mods ?? []) if (!next.mods.some((m) => m.name === old.name)) changedMods.add(old.name);
  const switched = files?.workflow.id !== next.workflow.id;
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
    // The open cards of the canvas stay open after a reload.
    const openIds = canvas?.openIds() ?? openIdsOf.get(active) ?? [];
    // The mods of a workflow work on its projects: open them in the backend first.
    if (switched || force) {
      const states = await api.workflowOpenProjects(active).catch(() => []);
      projectRoots = states.flatMap((p) => (p.root ? [p.root] : []));
      for (const p of states) if (p.error) toast(`The project ${p.path} did not open: ${p.error}`, "error");
    }
    canvas?.dispose();
    canvas = null;
    blocks.splice(0).forEach(unmount);
    const later: [HTMLElement, LayoutNode][] = [];
    content.replaceChildren(build(fresh, later, openIds), dock, pill);
    if (fresh.dock) later.push([dockBody, { mod: fresh.dock.mod, props: fresh.dock.props }]);
    showDock();
    later.forEach(([el, n]) => addBlock(el, n));
    showAgentState();
    // build() sets the canvas.
    if (!backSide.hidden) (canvas as Canvas | null)?.shown();
  } else {
    await Promise.all(blocks.filter((b) => changedMods.has(b.node.mod!)).map(mount));
  }
}

async function resetFiles() {
  try {
    const backup = await api.modeReset(active);
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
      const s = await api.modeStamp(active);
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
