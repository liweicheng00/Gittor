// The canvas of Agent mode: cards at free places, edges with labels between them, a grid, pan and zoom.
// A card can hold a canvas of its own (`children`), or a detail view (`detail`). The user opens a card
// with a double click on its title, its open button, or a zoom past the largest size. The camera then
// flies into the card, and the inner level fades in. The trail at the top left and Esc go back up.

import { h } from "./dom";
import { icon } from "./icons";

export interface CanvasNode {
  id: string;
  /** The mod that draws the body of the card. A workflow card has none. */
  mod?: string;
  /** The id of another workflow: the card links to it, and opens it. */
  workflow?: string;
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
    } else if (typeof n.mod !== "string") return `${p} needs "mod", or "workflow" for a card of another workflow`;
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
    this.el = h("div", { class: "am-canvas", tabindex: "-1" }, this.stage, this.detail, this.crumbs, this.controls);
    this.el.addEventListener("mousedown", (e) => this.startPan(e));
    this.el.addEventListener("wheel", (e) => this.onWheel(e), { passive: false });
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
    const openBtn = wf
      ? h("button", { class: "am-card-open", title: "Open the workflow", onclick: () => void this.open(n) }, icon("workflow"), h("span", {}, "Open"))
      : h("button", { class: "am-card-open", title: inner ? `Open: ${inner} cards inside` : "Open the details", onclick: () => void this.open(n) }, icon("open-card"), inner ? h("span", {}, String(inner)) : null);
    const title = n.title ?? (wf ? this.host.workflowName(wf) : n.mod);
    const head = h("div", { class: "am-card-head", title: "Drag to move the card. Double-click to open it." }, wf ? icon("workflow") : null, h("span", { class: "am-card-title" }, title), openBtn);
    const body = h("div", { class: "am-card-body am-block", "data-mod": n.mod ?? "" });
    const el = h("div", { class: `am-card${inner ? " am-stack" : ""}${wf ? " am-wf-card" : ""}`, "data-node": n.id }, head, body);
    if (n.class) el.classList.add(...n.class.split(/\s+/).filter(Boolean));
    el.style.left = `${n.x}px`;
    el.style.top = `${n.y}px`;
    if (typeof n.w === "number") el.style.width = `${n.w}px`;
    if (typeof n.h === "number") el.style.height = `${n.h}px`;
    head.addEventListener("mousedown", (e) => {
      if (!(e.target as Element).closest(".am-card-open")) this.startDrag(e, n, el);
    });
    head.addEventListener("dblclick", () => void this.open(n));
    this.cards.set(n.id, { node: n, el, body });
    this.resize.observe(el);
    this.world.append(el);
    if (wf) {
      this.host.workflowCard(body, wf);
      body.addEventListener("dblclick", () => void this.open(n));
    } else this.host.mount(body, n.mod ?? "", n.props ?? {});
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
    for (const e of this.level().edges) {
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
      const g = svg("g", { "data-edge": `${e.from}>${e.to}` });
      g.append(svg("path", { class: "am-edge", d: `M${p1.x},${p1.y} C${c1.x},${c1.y} ${c2.x},${c2.y} ${p2.x},${p2.y}`, "marker-end": "url(#am-arrow)", fill: "none" }));
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
