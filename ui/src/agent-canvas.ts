// The canvas of Agent mode: cards at free places, edges with labels between them, a grid, pan and zoom.
// A card can hold a canvas of its own (`children`), or a detail view (`detail`). The user opens a card
// with a double click on its title, its open button, or a zoom past the largest size. The camera then
// flies into the card, and the inner level fades in. The trail at the top left and Esc go back up.

import { menuBelow, showMenu, type MenuItem } from "./context-menu";
import { confirmDialog, formDialog } from "./dialogs";
import { h } from "./dom";
import { icon } from "./icons";

export interface CanvasNode {
  id: string;
  /** The mod that draws the body of the card. A workflow card has none. */
  mod?: string;
  /** The id of another workflow: the card links to it, and opens it. */
  workflow?: string;
  /** The text of a note card. A note card has no mod. */
  note?: string;
  x: number;
  y: number;
  w?: number;
  h?: number;
  title?: string;
  class?: string;
  props?: Record<string, unknown>;
  /** The cards inside this card. */
  children?: CanvasNode[];
  /** The edges between the cards inside this card. */
  edges?: CanvasEdge[];
  /** The mod of the open card when it has no children; the default is `mod`. */
  detail?: string;
}
export interface CanvasEdge {
  from: string;
  to: string;
  label?: string;
}
export interface CanvasSpec {
  type: "canvas";
  title?: string;
  nodes: CanvasNode[];
  edges?: CanvasEdge[];
}

/** Returns why the cards or the edges of one level are wrong, or null. */
export function checkCanvas(c: { nodes?: CanvasNode[]; edges?: CanvasEdge[] }, at: string): string | null {
  if (!Array.isArray(c.nodes)) return `${at}.nodes is not a list`;
  const ids = new Set<string>();
  for (const [i, n] of c.nodes.entries()) {
    const p = `${at}.nodes[${i}]`;
    if (!n || typeof n !== "object") return `${p} is not an object`;
    if (typeof n.id !== "string" || !n.id) return `${p}.id is not a string`;
    if (ids.has(n.id)) return `${p}.id "${n.id}" is there two times`;
    ids.add(n.id);
    if (n.workflow !== undefined) {
      if (typeof n.workflow !== "string" || !n.workflow) return `${p}.workflow is not a string`;
    } else if (n.note !== undefined) {
      if (typeof n.note !== "string") return `${p}.note is not a string`;
    } else if (typeof n.mod !== "string") return `${p} needs "mod", "note", or "workflow" for a card of another workflow`;
    if (typeof n.x !== "number" || typeof n.y !== "number") return `${p} needs the numbers "x" and "y"`;
    if (n.detail !== undefined && typeof n.detail !== "string") return `${p}.detail is not a string`;
    if (n.children !== undefined) {
      const e = checkCanvas({ nodes: n.children, edges: n.edges }, p);
      if (e) return e.replace(`${p}.nodes`, `${p}.children`);
    }
  }
  if (c.edges !== undefined && !Array.isArray(c.edges)) return `${at}.edges is not a list`;
  for (const [i, e] of (c.edges ?? []).entries()) {
    if (!ids.has(e?.from) || !ids.has(e?.to)) return `${at}.edges[${i}] names a card that is not on its level`;
  }
  return null;
}

/** What the canvas needs from Agent mode: it draws the body of a card with a mod. */
export interface CanvasHost {
  /** Draws the mod `mod` in `body`. */
  mount(body: HTMLElement, mod: string, props: Record<string, unknown>): void;
  /** Stops the mod in `body`. */
  unmount(body: HTMLElement): void;
  /** A card moved: the layout is saved. */
  moved(): void;
  /** The width at the left that a window covers; Fit keeps the cards out of it. */
  insetLeft?(): number;
  /** Draws the body of a card of another workflow. */
  workflowCard(body: HTMLElement, id: string): void;
  workflowName(id: string): string;
  /** Shows another workflow. False when it cannot. */
  openWorkflow(id: string): Promise<boolean>;
  /** The names of the mods of the workflow, for a new card. */
  mods(): string[];
  /** The other workflows, for a workflow card. */
  workflows(): { id: string; name: string }[];
}

const SVG = "http://www.w3.org/2000/svg";
const svg = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string> = {}) => {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
};

type View = { x: number; y: number; z: number };
const VIEW_KEY = "gittor.agentCanvasView";
const MIN_Z = 0.25;
const MAX_Z = 2;
const still = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

export class Canvas {
  readonly el: HTMLElement;
  private readonly stage: HTMLElement;
  private readonly world: HTMLElement;
  private readonly lines: SVGSVGElement;
  private readonly detail = h("div", { class: "am-detail", hidden: true });
  private readonly detailBody = h("div", { class: "am-detail-body am-block" });
  private readonly crumbs = h("div", { class: "am-crumbs" });
  private readonly controls: HTMLElement;
  private readonly cards = new Map<string, { node: CanvasNode; el: HTMLElement; body: HTMLElement }>();
  /** The open cards, from the top level down. */
  private path: CanvasNode[] = [];
  private view: View = { x: 0, y: 0, z: 1 };
  private readonly zoomLabel = h("span", { class: "am-zoom-label" });
  private readonly resize = new ResizeObserver(() => this.drawEdges());
  private flying = false;

  constructor(
    private readonly spec: CanvasSpec,
    private readonly host: CanvasHost,
    /** The ids of the open cards, for example from the canvas before a reload. */
    openIds: string[] = [],
    /** The part of the storage key of the views, for example the id of the workflow. */
    private readonly scope = "",
  ) {
    this.lines = svg("svg", { class: "am-edges" });
    const defs = svg("defs");
    const marker = svg("marker", { id: "am-arrow", viewBox: "0 0 10 10", refX: "9", refY: "5", markerWidth: "7", markerHeight: "7", orient: "auto-start-reverse" });
    marker.append(svg("path", { d: "M0,0 L10,5 L0,10 z", class: "am-arrow" }));
    defs.append(marker);
    this.lines.append(defs);
    this.world = h("div", { class: "am-world" }, this.lines);
    this.stage = h("div", { class: "am-stage" }, this.world);
    this.detail.append(this.detailBody);
    this.controls = h(
      "div",
      { class: "am-canvas-controls" },
      h("button", { class: "tb-button", title: "Zoom out", onclick: () => this.zoomBy(1 / 1.2) }, "−"),
      this.zoomLabel,
      h("button", { class: "tb-button", title: "Zoom in", onclick: () => this.zoomBy(1.2) }, "+"),
      h("button", { class: "tb-button am-fit", title: "Show all cards", onclick: () => this.fit() }, "Fit"),
    );
    const addBtn = h("button", { class: "tb-button tb-icon am-add-card", title: "Add a card", "aria-label": "Add a card" }, icon("add"));
    addBtn.addEventListener("click", () => menuBelow(addBtn, this.addItems(this.freeSpot(this.centre()))));
    this.controls.prepend(addBtn);
    this.el = h("div", { class: "am-canvas", tabindex: "-1" }, this.stage, this.detail, this.crumbs, this.controls);
    this.el.addEventListener("mousedown", (e) => this.startPan(e));
    this.el.addEventListener("wheel", (e) => this.onWheel(e), { passive: false });
    this.el.addEventListener("contextmenu", (e) => this.onMenu(e));
    // A double click on the empty canvas writes a note there.
    this.el.addEventListener("dblclick", (e) => {
      if (this.isDetail() || (e.target as Element).closest(".am-card, .am-canvas-controls, .am-crumbs, .am-edge-hit")) return;
      void this.addNote(this.toWorld(e.clientX, e.clientY));
    });
    this.el.addEventListener("keydown", (e) => {
      const t = e.target as HTMLElement;
      if (e.key !== "Escape" || !this.path.length || t.matches("input, textarea, select") || t.closest(".monaco-editor")) return;
      e.preventDefault();
      void this.goTo(this.path.length - 1);
    });
    // Open the cards of the last time, as far as they still exist.
    let level = spec.nodes;
    for (const id of openIds) {
      const n = level.find((x) => x.id === id);
      if (!n) break;
      this.path.push(n);
      level = n.children ?? [];
    }
    this.renderLevel();
  }

  /** The ids of the open cards. */
  openIds(): string[] {
    return this.path.map((n) => n.id);
  }

  /** The number of open cards. */
  depth(): number {
    return this.path.length;
  }

  /** Call after the canvas is in the page: draws the edges, and fits the cards on the first visit of a level. */
  shown() {
    if (!readView(this.key()) && !this.isDetail()) this.fit();
    this.drawEdges();
  }

  dispose() {
    this.resize.disconnect();
    this.clearLevel();
  }

  // ---- Levels ----

  private level(): { nodes: CanvasNode[]; edges: CanvasEdge[] } {
    const top = this.path[this.path.length - 1];
    return top ? { nodes: top.children ?? [], edges: top.edges ?? [] } : { nodes: this.spec.nodes, edges: this.spec.edges ?? [] };
  }

  /** An open card without children shows its detail view. */
  private isDetail(): boolean {
    const top = this.path[this.path.length - 1];
    return !!top && !top.children?.length;
  }

  private key(): string {
    return [VIEW_KEY, this.scope, ...this.openIds()].join("/");
  }

  private clearLevel() {
    for (const { el, body } of this.cards.values()) {
      this.host.unmount(body);
      this.resize.unobserve(el);
      el.remove();
    }
    this.cards.clear();
    if (!this.detail.hidden) this.host.unmount(this.detailBody);
    this.detail.hidden = true;
    for (const old of this.lines.querySelectorAll("g")) old.remove();
  }

  private renderLevel() {
    this.clearLevel();
    this.renderCrumbs();
    const top = this.path[this.path.length - 1];
    const detail = this.isDetail();
    this.stage.hidden = detail;
    this.controls.hidden = detail;
    if (detail) {
      this.detail.hidden = false;
      this.detail.dataset.node = top.id;
      this.host.mount(this.detailBody, top.detail ?? top.mod ?? "", { ...(top.props ?? {}), detail: true });
      return;
    }
    for (const n of this.level().nodes) this.addCard(n);
    this.view = readView(this.key()) ?? this.view;
    this.apply();
    this.drawEdges();
  }

  private renderCrumbs() {
    const names = [this.spec.title ?? "Canvas", ...this.path.map((n) => n.title ?? n.id)];
    this.crumbs.hidden = !this.path.length;
    this.crumbs.replaceChildren(
      ...names.flatMap((name, i) => {
        const last = i === names.length - 1;
        const item = last ? h("span", { class: "am-crumb am-crumb-here" }, name) : h("button", { class: "am-crumb", onclick: () => void this.goTo(i) }, name);
        return i ? [h("span", { class: "am-crumb-sep" }, "›"), item] : [item];
      }),
    );
  }

  /** Flies into a card: the camera zooms until the card fills the canvas, then the inner level fades in. */
  async open(n: CanvasNode) {
    const card = this.cards.get(n.id);
    if (this.flying || !card) return;
    if (n.workflow) return this.openWorkflow(n, card.el);
    this.flying = true;
    saveView(this.key(), this.view);
    try {
      card.el.classList.add("am-focus");
      this.el.classList.add("am-flying");
      await this.tween(this.viewOf(card.el, 0.98), 380);
      await this.fade(false);
      this.path.push(n);
      this.renderLevel();
      if (!this.isDetail() && !readView(this.key())) this.fit(false);
      await this.fade(true);
    } finally {
      this.el.classList.remove("am-flying");
      this.flying = false;
      this.el.focus({ preventScroll: true });
    }
  }

  /** Flies into the card of another workflow, then shows that workflow. The view of this level stays as
   * it was before the flight, for the way back. */
  private async openWorkflow(n: CanvasNode, el: HTMLElement) {
    this.flying = true;
    const back = { ...this.view };
    saveView(this.key(), back);
    try {
      el.classList.add("am-focus");
      this.el.classList.add("am-flying");
      await this.tween(this.viewOf(el, 0.98), 420);
      await this.fade(false);
    } finally {
      this.flying = false;
    }
    if (await this.host.openWorkflow(n.workflow!)) return;
    // The workflow did not open: this level comes back.
    this.view = back;
    this.apply();
    await this.fade(true);
    el.classList.remove("am-focus");
    this.el.classList.remove("am-flying");
  }

  /** Goes back to the level with `depth` open cards: the inner level fades out, and the camera flies out of
   * the card. */
  async goTo(depth: number) {
    if (this.flying || depth >= this.path.length) return;
    this.flying = true;
    if (!this.isDetail()) saveView(this.key(), this.view);
    try {
      const from = this.path[depth];
      await this.fade(false, true);
      this.path = this.path.slice(0, depth);
      this.renderLevel();
      const card = this.cards.get(from.id);
      const target = this.view;
      if (card) {
        this.view = this.viewOf(card.el, 0.98);
        this.apply();
        card.el.classList.add("am-focus");
        this.el.classList.add("am-flying");
      }
      await this.fade(true, true);
      await this.tween(target, 380);
      card?.el.classList.remove("am-focus");
    } finally {
      this.el.classList.remove("am-flying");
      this.flying = false;
      this.el.focus({ preventScroll: true });
    }
  }

  /** The view that shows the element as large as `part` of the canvas, in the middle. */
  private viewOf(el: HTMLElement, part: number): View {
    const w = el.offsetWidth, hh = el.offsetHeight;
    const z = Math.min((this.el.clientWidth * part) / w, (this.el.clientHeight * part) / hh);
    return { z, x: (this.el.clientWidth - w * z) / 2 - el.offsetLeft * z, y: (this.el.clientHeight - hh * z) / 2 - el.offsetTop * z };
  }

  private tween(to: View, ms: number): Promise<void> {
    const from = { ...this.view };
    if (still()) {
      this.view = to;
      this.apply();
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const t0 = performance.now();
      const step = (now: number) => {
        const t = Math.min(1, (now - t0) / ms);
        const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
        // The scale goes on a log curve, so the zoom looks even.
        const z = Math.exp(Math.log(from.z) + (Math.log(to.z) - Math.log(from.z)) * e);
        this.view = { x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e, z };
        this.apply();
        if (t < 1) requestAnimationFrame(step);
        else resolve();
      };
      requestAnimationFrame(step);
    });
  }

  /** Fades the level in or out. Going in, the new level grows from a bit small; going out, it shrinks. */
  private async fade(show: boolean, out = false) {
    if (still()) return;
    const layer = this.isDetail() ? this.detail : this.stage;
    const small = out ? "scale(1.06)" : "scale(0.94)";
    const big = out ? "scale(0.94)" : "scale(1.06)";
    const frames = show ? [{ opacity: 0, transform: small }, { opacity: 1, transform: "scale(1)" }] : [{ opacity: 1, transform: "scale(1)" }, { opacity: 0, transform: big }];
    await layer.animate(frames, { duration: show ? 220 : 140, easing: show ? "ease-out" : "ease-in", fill: show ? "none" : "forwards" }).finished;
    if (!show) layer.getAnimations().forEach((a) => a.cancel());
    if (!show) layer.style.opacity = "0";
    else {
      this.stage.style.opacity = "";
      this.detail.style.opacity = "";
    }
  }

  // ---- Cards ----

  private addCard(n: CanvasNode) {
    const inner = n.children?.length ?? 0;
    const wf = n.workflow;
    const note = n.note !== undefined && !inner;
    const openBtn = wf
      ? h("button", { class: "am-card-open", title: "Open the workflow", onclick: () => void this.open(n) }, icon("workflow"), h("span", {}, "Open"))
      : note
        ? null
        : h("button", { class: "am-card-open", title: inner ? `Open: ${inner} cards inside` : "Open the details", onclick: () => void this.open(n) }, icon("open-card"), inner ? h("span", {}, String(inner)) : null);
    const title = n.title ?? (wf ? this.host.workflowName(wf) : note ? "Note" : n.mod);
    const head = h("div", { class: "am-card-head", title: "Drag to move the card. Double-click to open it." }, wf ? icon("workflow") : null, h("span", { class: "am-card-title" }, title), openBtn);
    const body = h("div", { class: "am-card-body am-block", "data-mod": n.mod ?? "" });
    const el = h("div", { class: `am-card${inner ? " am-stack" : ""}${wf ? " am-wf-card" : ""}${note ? " am-note-card" : ""}`, "data-node": n.id }, head, body);
    // The ports: drag from one to another card to connect the two cards.
    for (const side of ["top", "right", "bottom", "left"]) {
      const port = h("span", { class: `am-port am-port-${side}`, title: "Drag to another card to connect" });
      port.addEventListener("mousedown", (e) => this.startConnect(e, n, port));
      el.append(port);
    }
    if (n.class) el.classList.add(...n.class.split(/\s+/).filter(Boolean));
    el.style.left = `${n.x}px`;
    el.style.top = `${n.y}px`;
    if (typeof n.w === "number") el.style.width = `${n.w}px`;
    if (typeof n.h === "number") el.style.height = `${n.h}px`;
    head.addEventListener("mousedown", (e) => {
      if (!(e.target as Element).closest(".am-card-open")) this.startDrag(e, n, el);
    });
    head.addEventListener("dblclick", () => void (note ? this.editNote(n) : this.open(n)));
    this.cards.set(n.id, { node: n, el, body });
    this.resize.observe(el);
    this.world.append(el);
    if (wf) {
      this.host.workflowCard(body, wf);
      body.addEventListener("dblclick", () => void this.open(n));
    } else if (note) {
      body.append(n.note ? h("div", { class: "am-note" }, n.note) : h("div", { class: "am-note am-note-empty" }, "Double-click to write."));
      body.addEventListener("dblclick", () => this.editNote(n));
    } else this.host.mount(body, n.mod ?? "", n.props ?? {});
  }

  // ---- Editing: add, change and delete cards and edges ----

  /** The cards and edges of this level, to change them. */
  private editLevel(): { nodes: CanvasNode[]; edges: CanvasEdge[] } {
    const top = this.path[this.path.length - 1];
    if (top) {
      top.children ??= [];
      top.edges ??= [];
      return { nodes: top.children, edges: top.edges };
    }
    this.spec.edges ??= [];
    return { nodes: this.spec.nodes, edges: this.spec.edges };
  }

  /** Saves the layout and draws the level again, at the same view. */
  private commit() {
    saveView(this.key(), this.view);
    this.host.moved();
    this.renderLevel();
  }

  /** An id that no card of this level has. */
  private newId(base: string): string {
    const ids = new Set(this.editLevel().nodes.map((n) => n.id));
    const clean = base.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "card";
    let id = clean;
    for (let i = 2; ids.has(id); i++) id = `${clean}-${i}`;
    return id;
  }

  /** The point of the canvas under a point of the screen. */
  private toWorld(cx: number, cy: number) {
    const r = this.el.getBoundingClientRect();
    return { x: Math.round((cx - r.left - this.view.x) / this.view.z), y: Math.round((cy - r.top - this.view.y) / this.view.z) };
  }

  /** The point of the canvas in the middle of the screen. */
  private centre() {
    const r = this.el.getBoundingClientRect();
    return this.toWorld(r.left + r.width / 2 - 120, r.top + r.height / 2 - 60);
  }

  /** The first place near `at`, to the right and then down, where a new card covers no card. */
  private freeSpot(at: { x: number; y: number }, w = 300, hh = 200) {
    const boxes = [...this.cards.values()].map(({ el }) => rect(el));
    const free = (x: number, y: number) => boxes.every((b) => x + w + 24 < b.x || x > b.r + 24 || y + hh + 24 < b.y || y > b.b + 24);
    for (let row = 0; row < 12; row++)
      for (let col = 0; col < 8; col++) {
        const x = at.x + col * 160, y = at.y + row * 120;
        if (free(x, y)) return { x, y };
      }
    return at;
  }

  private addItems(at: { x: number; y: number }): MenuItem[] {
    const others = this.host.workflows();
    return [
      { label: "New Note", icon: "edit", action: () => void this.addNote(at) },
      { label: "New Card from a Mod…", icon: "add", action: () => void this.addModCard(at) },
      { label: "New Workflow Card…", icon: "workflow", disabled: !others.length, action: () => void this.addWorkflowCard(at) },
    ];
  }

  private add(n: CanvasNode) {
    this.editLevel().nodes.push(n);
    this.commit();
  }

  /** Adds a note card at the point, and opens its text for typing. */
  async addNote(at: { x: number; y: number }) {
    if (this.isDetail()) return;
    const n: CanvasNode = { id: this.newId("note"), note: "", x: at.x, y: at.y, w: 240 };
    this.add(n);
    this.editNote(n);
  }

  private async addModCard(at: { x: number; y: number }) {
    const mods = this.host.mods();
    const r = await formDialog(
      "New Card",
      [
        { key: "mod", label: "Mod: the code that draws the card", type: "select", options: mods.map((m) => [m, m]), value: mods[0] },
        { key: "title", label: "Title", placeholder: "the name of the mod" },
      ],
      "Add",
      "A mod is a folder in mods/. Ask the agent to write a new mod for a card that does not exist yet.",
    );
    if (!r || !r.mod) return;
    const n: CanvasNode = { id: this.newId(String(r.mod)), mod: String(r.mod), x: at.x, y: at.y, w: 300 };
    if (String(r.title).trim()) n.title = String(r.title).trim();
    this.add(n);
  }

  private async addWorkflowCard(at: { x: number; y: number }) {
    const others = this.host.workflows();
    const r = await formDialog("New Workflow Card", [{ key: "workflow", label: "Workflow", type: "select", options: others.map((w) => [w.id, w.name]), value: others[0]?.id }], "Add");
    if (!r || !r.workflow) return;
    this.add({ id: this.newId(`to-${r.workflow}`), workflow: String(r.workflow), x: at.x, y: at.y, w: 260 });
  }

  /** Changes the title, the size and the content of a card in a dialog. */
  private async editCard(n: CanvasNode) {
    const fields: Parameters<typeof formDialog>[1] = [{ key: "title", label: "Title", value: n.title ?? "" }];
    if (n.note !== undefined && !n.children?.length) fields.push({ key: "note", label: "Text", type: "textarea", value: n.note });
    else if (n.workflow !== undefined) fields.push({ key: "workflow", label: "Workflow", type: "select", options: this.host.workflows().map((w) => [w.id, w.name]), value: n.workflow });
    else fields.push({ key: "mod", label: "Mod", type: "select", options: this.host.mods().map((m) => [m, m]), value: n.mod ?? "" });
    fields.push({ key: "w", label: "Width (pixels)", value: n.w !== undefined ? String(n.w) : "" }, { key: "h", label: "Height (pixels; empty fits the content)", value: n.h !== undefined ? String(n.h) : "" });
    const r = await formDialog("Edit Card", fields, "Save");
    if (!r) return;
    const title = String(r.title).trim();
    if (title) n.title = title;
    else delete n.title;
    if ("note" in r) n.note = String(r.note);
    if ("workflow" in r && r.workflow) n.workflow = String(r.workflow);
    if ("mod" in r && r.mod) n.mod = String(r.mod);
    for (const k of ["w", "h"] as const) {
      const v = Number.parseInt(String(r[k]), 10);
      if (Number.isFinite(v) && v >= 80) n[k] = v;
      else delete n[k];
    }
    this.commit();
  }

  private async deleteCard(n: CanvasNode) {
    const name = n.title ?? n.mod ?? n.workflow ?? "Note";
    const inner = n.children?.length ? ` The ${n.children.length} cards inside go too.` : "";
    if (!(await confirmDialog("Delete Card", `Delete the card "${name}" and its edges?${inner}`, "Delete", true))) return;
    const lv = this.editLevel();
    lv.nodes.splice(lv.nodes.indexOf(n), 1);
    for (let i = lv.edges.length - 1; i >= 0; i--) if (lv.edges[i].from === n.id || lv.edges[i].to === n.id) lv.edges.splice(i, 1);
    this.commit();
  }

  /** Types the text of a note in the card. Ctrl+Enter or a click outside saves it; Esc cancels. */
  private editNote(n: CanvasNode) {
    const card = this.cards.get(n.id);
    if (!card) return;
    const area = h("textarea", { class: "am-note-edit", placeholder: "Write a note…" });
    area.value = n.note ?? "";
    card.body.replaceChildren(area);
    card.el.classList.add("am-editing");
    let done = false;
    const finish = (save: boolean) => {
      if (done) return;
      done = true;
      if (save && area.value !== (n.note ?? "")) {
        n.note = area.value;
        this.commit();
      } else this.renderLevel();
    };
    area.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Escape") finish(false);
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) finish(true);
    });
    area.addEventListener("blur", () => finish(true));
    area.addEventListener("mousedown", (e) => e.stopPropagation());
    requestAnimationFrame(() => area.focus());
  }

  /** Draws a line from a port while the mouse moves; on a release over another card, it adds an edge. */
  private startConnect(e: MouseEvent, from: CanvasNode, port: HTMLElement) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const card = this.cards.get(from.id)!.el;
    const start = { x: card.offsetLeft + port.offsetLeft + port.offsetWidth / 2, y: card.offsetTop + port.offsetTop + port.offsetHeight / 2 };
    const draft = svg("path", { class: "am-edge am-edge-draft", fill: "none", "marker-end": "url(#am-arrow)" });
    this.lines.append(draft);
    this.el.classList.add("am-connecting");
    let target: HTMLElement | null = null;
    const move = (m: MouseEvent) => {
      const p = this.toWorld(m.clientX, m.clientY);
      draft.setAttribute("d", `M${start.x},${start.y} L${p.x},${p.y}`);
      const over = (document.elementFromPoint(m.clientX, m.clientY)?.closest(".am-card") as HTMLElement | null) ?? null;
      const next = over && over !== card ? over : null;
      if (next !== target) {
        target?.classList.remove("am-connect-target");
        next?.classList.add("am-connect-target");
        target = next;
      }
    };
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      draft.remove();
      this.el.classList.remove("am-connecting");
      target?.classList.remove("am-connect-target");
      const to = target?.dataset.node;
      if (!to) return;
      const lv = this.editLevel();
      if (lv.edges.some((x) => x.from === from.id && x.to === to)) return;
      lv.edges.push({ from: from.id, to });
      this.host.moved();
      this.drawEdges();
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  }

  private async editEdgeLabel(edge: CanvasEdge) {
    const r = await formDialog("Edge Label", [{ key: "label", label: "Label", value: edge.label ?? "", placeholder: "for example: review, deploy" }], "Save");
    if (!r) return;
    const label = String(r.label).trim();
    if (label) edge.label = label;
    else delete edge.label;
    this.host.moved();
    this.drawEdges();
  }

  private deleteEdge(edge: CanvasEdge) {
    const lv = this.editLevel();
    lv.edges.splice(lv.edges.indexOf(edge), 1);
    this.host.moved();
    this.drawEdges();
  }

  /** The context menu of an edge, a card or the empty canvas. A mod that shows its own menu cancels the event. */
  private onMenu(e: MouseEvent) {
    if (e.defaultPrevented || this.isDetail() || this.flying) return;
    const t = e.target as Element;
    if (t.closest(".am-canvas-controls, .am-crumbs") || t.closest("input, textarea")) return;
    const edgeEl = t.closest("[data-edge-index]");
    if (edgeEl) {
      e.preventDefault();
      const edge = this.level().edges[Number(edgeEl.getAttribute("data-edge-index"))];
      if (!edge) return;
      showMenu(e.clientX, e.clientY, [
        { label: edge.label ? "Change the Label…" : "Add a Label…", icon: "edit", action: () => void this.editEdgeLabel(edge) },
        { label: "Delete the Edge", icon: "close", action: () => this.deleteEdge(edge) },
      ]);
      return;
    }
    const cardEl = t.closest(".am-card") as HTMLElement | null;
    if (cardEl) {
      const n = this.cards.get(cardEl.dataset.node ?? "")?.node;
      if (!n) return;
      e.preventDefault();
      const note = n.note !== undefined && !n.children?.length;
      showMenu(e.clientX, e.clientY, [
        ...(note ? [] : [{ label: n.workflow ? "Open the Workflow" : "Open", icon: "open-card" as const, action: () => void this.open(n) }]),
        ...(note ? [{ label: "Write the Note", icon: "edit" as const, action: () => this.editNote(n) }] : []),
        { label: "Edit the Card…", icon: "edit", action: () => void this.editCard(n) },
        { separator: true },
        { label: "Delete the Card…", icon: "close", action: () => void this.deleteCard(n) },
      ]);
      return;
    }
    e.preventDefault();
    showMenu(e.clientX, e.clientY, [...this.addItems(this.toWorld(e.clientX, e.clientY)), { separator: true }, { label: "Show All Cards", action: () => this.fit() }]);
  }

  private startDrag(e: MouseEvent, n: CanvasNode, el: HTMLElement) {
    if (e.button !== 0) return;
    // WebKitGTK starts a text selection and a native drag without this.
    e.preventDefault();
    e.stopPropagation();
    const start = { mx: e.clientX, my: e.clientY, x: n.x, y: n.y };
    let moved = false;
    el.classList.add("am-dragging");
    const move = (m: MouseEvent) => {
      n.x = Math.round(start.x + (m.clientX - start.mx) / this.view.z);
      n.y = Math.round(start.y + (m.clientY - start.my) / this.view.z);
      moved = true;
      el.style.left = `${n.x}px`;
      el.style.top = `${n.y}px`;
      this.drawEdges();
    };
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      el.classList.remove("am-dragging");
      if (moved) this.host.moved();
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  }

  // ---- Pan and zoom ----

  private startPan(e: MouseEvent) {
    const t = e.target as Element;
    if (e.button !== 0 || this.isDetail() || t.closest(".am-card, .am-canvas-controls, .am-crumbs")) return;
    e.preventDefault();
    this.el.focus({ preventScroll: true });
    const start = { mx: e.clientX, my: e.clientY, x: this.view.x, y: this.view.y };
    this.el.classList.add("am-panning");
    const move = (m: MouseEvent) => {
      this.view.x = start.x + m.clientX - start.mx;
      this.view.y = start.y + m.clientY - start.my;
      this.apply();
    };
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      this.el.classList.remove("am-panning");
      saveView(this.key(), this.view);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  }

  private onWheel(e: WheelEvent) {
    const zoom = e.ctrlKey || e.metaKey;
    const target = e.target as Element;
    // Without Ctrl, the wheel scrolls a card or a detail view that can scroll.
    if (!zoom && target.closest(".am-card-body, .am-detail")) return;
    e.preventDefault();
    if (this.flying) return;
    if (!zoom) {
      this.view.x -= e.deltaX;
      this.view.y -= e.deltaY;
      this.apply();
      saveView(this.key(), this.view);
      return;
    }
    // A zoom past the largest size opens the card under the mouse; past the smallest, it goes up a level.
    const r = this.el.getBoundingClientRect();
    const f = Math.exp(-e.deltaY * 0.0025);
    const under = target.closest(".am-card") as HTMLElement | null;
    if (f > 1 && (this.isDetail() ? false : this.view.z >= MAX_Z) && under) {
      const n = this.cards.get(under.dataset.node ?? "")?.node;
      if (n) return void this.open(n);
    }
    if (f < 1 && this.path.length && (this.isDetail() || this.view.z <= MIN_Z)) return void this.goTo(this.path.length - 1);
    if (this.isDetail()) return;
    this.zoomAt(f, e.clientX - r.left, e.clientY - r.top);
    saveView(this.key(), this.view);
  }

  private zoomBy(f: number) {
    this.zoomAt(f, this.el.clientWidth / 2, this.el.clientHeight / 2);
    saveView(this.key(), this.view);
  }

  /** Zooms and keeps the point (px, py) of the canvas element at its place. */
  private zoomAt(f: number, px: number, py: number) {
    const z = Math.min(MAX_Z, Math.max(MIN_Z, this.view.z * f));
    const k = z / this.view.z;
    this.view = { x: px - (px - this.view.x) * k, y: py - (py - this.view.y) * k, z };
    this.apply();
  }

  /** Shows all cards of the level, at 100% or smaller. */
  fit(save = true) {
    const boxes = [...this.cards.values()].map(({ el }) => ({ x: el.offsetLeft, y: el.offsetTop, r: el.offsetLeft + el.offsetWidth, b: el.offsetTop + el.offsetHeight }));
    if (!boxes.length || !this.el.clientWidth) return;
    const x = Math.min(...boxes.map((b) => b.x)), y = Math.min(...boxes.map((b) => b.y));
    const w = Math.max(...boxes.map((b) => b.r)) - x, hgt = Math.max(...boxes.map((b) => b.b)) - y;
    const pad = 48;
    const left = Math.min(this.host.insetLeft?.() ?? 0, this.el.clientWidth / 2);
    const width = this.el.clientWidth - left;
    const z = Math.min(1, (width - 2 * pad) / w, (this.el.clientHeight - 2 * pad) / hgt);
    this.view = { z, x: left + (width - w * z) / 2 - x * z, y: Math.max(pad, (this.el.clientHeight - hgt * z) / 2) - y * z };
    this.apply();
    if (save) saveView(this.key(), this.view);
  }

  private apply() {
    const { x, y, z } = this.view;
    this.world.style.transform = `translate(${x}px, ${y}px) scale(${z})`;
    this.el.style.backgroundPosition = `${x}px ${y}px`;
    this.el.style.backgroundSize = `${22 * z}px ${22 * z}px`;
    this.zoomLabel.textContent = `${Math.round(z * 100)}%`;
  }

  /** Draws each edge as a curve between the nearest sides of its two cards. */
  drawEdges() {
    for (const old of this.lines.querySelectorAll("g")) old.remove();
    if (this.isDetail()) return;
    for (const [index, e] of this.level().edges.entries()) {
      const a = this.cards.get(e.from)?.el, b = this.cards.get(e.to)?.el;
      if (!a || !b) continue;
      const ra = rect(a), rb = rect(b);
      const dx = rb.cx - ra.cx, dy = rb.cy - ra.cy;
      let p1, p2, c1, c2;
      if (Math.abs(dx) >= Math.abs(dy)) {
        const s = Math.sign(dx) || 1;
        p1 = { x: s > 0 ? ra.r : ra.x, y: ra.cy };
        p2 = { x: s > 0 ? rb.x : rb.r, y: rb.cy };
        const k = Math.max(40, Math.abs(p2.x - p1.x) / 2);
        c1 = { x: p1.x + s * k, y: p1.y };
        c2 = { x: p2.x - s * k, y: p2.y };
      } else {
        const s = Math.sign(dy) || 1;
        p1 = { x: ra.cx, y: s > 0 ? ra.b : ra.y };
        p2 = { x: rb.cx, y: s > 0 ? rb.y : rb.b };
        const k = Math.max(40, Math.abs(p2.y - p1.y) / 2);
        c1 = { x: p1.x, y: p1.y + s * k };
        c2 = { x: p2.x, y: p2.y - s * k };
      }
      const g = svg("g", { "data-edge": `${e.from}>${e.to}`, "data-edge-index": String(index) });
      const d = `M${p1.x},${p1.y} C${c1.x},${c1.y} ${c2.x},${c2.y} ${p2.x},${p2.y}`;
      g.append(svg("path", { class: "am-edge", d, "marker-end": "url(#am-arrow)", fill: "none" }));
      // A wide line without color takes the mouse: a double click changes the label.
      const hit = svg("path", { class: "am-edge-hit", d, fill: "none" });
      hit.addEventListener("dblclick", (ev) => (ev.stopPropagation(), void this.editEdgeLabel(e)));
      g.append(hit);
      if (e.label) {
        // The middle of the cubic curve (t = 0.5).
        const mx = (p1.x + 3 * c1.x + 3 * c2.x + p2.x) / 8, my = (p1.y + 3 * c1.y + 3 * c2.y + p2.y) / 8;
        const t = svg("text", { class: "am-edge-label", x: String(mx), y: String(my - 6), "text-anchor": "middle" });
        t.textContent = e.label;
        g.append(t);
      }
      this.lines.append(g);
    }
  }
}

function rect(el: HTMLElement) {
  const x = el.offsetLeft, y = el.offsetTop, w = el.offsetWidth, hh = el.offsetHeight;
  return { x, y, r: x + w, b: y + hh, cx: x + w / 2, cy: y + hh / 2 };
}

function readView(key: string): View | null {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? "null");
    return v && typeof v.x === "number" && typeof v.y === "number" && typeof v.z === "number" ? v : null;
  } catch {
    return null;
  }
}

function saveView(key: string, v: View) {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    // The view is a convenience; without storage the canvas fits again at the next start.
  }
}
