// The canvas of Agent mode: cards at free places, edges with labels between them, a grid, pan and zoom.
// A mod draws the body of each card. The user drags a card by its title; the new place goes back to
// layout.json through `onMoved`.

import { h } from "./dom";

export interface CanvasNode {
  id: string;
  mod: string;
  x: number;
  y: number;
  w?: number;
  h?: number;
  title?: string;
  class?: string;
  props?: Record<string, unknown>;
}
export interface CanvasEdge {
  from: string;
  to: string;
  label?: string;
}
export interface CanvasSpec {
  type: "canvas";
  nodes: CanvasNode[];
  edges?: CanvasEdge[];
}

/** Returns why the spec is wrong, or null. */
export function checkCanvas(c: CanvasSpec, at: string): string | null {
  if (!Array.isArray(c.nodes)) return `${at}.nodes is not a list`;
  const ids = new Set<string>();
  for (const [i, n] of c.nodes.entries()) {
    const p = `${at}.nodes[${i}]`;
    if (!n || typeof n !== "object") return `${p} is not an object`;
    if (typeof n.id !== "string" || !n.id) return `${p}.id is not a string`;
    if (ids.has(n.id)) return `${p}.id "${n.id}" is there two times`;
    ids.add(n.id);
    if (typeof n.mod !== "string") return `${p}.mod is not a string`;
    if (typeof n.x !== "number" || typeof n.y !== "number") return `${p} needs the numbers "x" and "y"`;
  }
  if (c.edges !== undefined && !Array.isArray(c.edges)) return `${at}.edges is not a list`;
  for (const [i, e] of (c.edges ?? []).entries()) {
    if (!ids.has(e?.from) || !ids.has(e?.to)) return `${at}.edges[${i}] names a node that is not in "nodes"`;
  }
  return null;
}

const SVG = "http://www.w3.org/2000/svg";
const svg = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string> = {}) => {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
};

const VIEW_KEY = "gittor.agentCanvasView";

export class Canvas {
  readonly el: HTMLElement;
  private readonly world: HTMLElement;
  private readonly lines: SVGSVGElement;
  private readonly cards = new Map<string, { node: CanvasNode; el: HTMLElement; body: HTMLElement }>();
  private view = { x: 0, y: 0, z: 1 };
  private readonly zoomLabel = h("span", { class: "am-zoom-label" });
  private readonly resize = new ResizeObserver(() => this.drawEdges());

  constructor(
    private readonly spec: CanvasSpec,
    private readonly onMoved: () => void,
    /** The width at the left of the canvas that a window covers; Fit keeps the cards out of it. */
    private readonly insetLeft: () => number = () => 0,
  ) {
    this.lines = svg("svg", { class: "am-edges" });
    const defs = svg("defs");
    const marker = svg("marker", { id: "am-arrow", viewBox: "0 0 10 10", refX: "9", refY: "5", markerWidth: "7", markerHeight: "7", orient: "auto-start-reverse" });
    marker.append(svg("path", { d: "M0,0 L10,5 L0,10 z", class: "am-arrow" }));
    defs.append(marker);
    this.lines.append(defs);
    this.world = h("div", { class: "am-world" }, this.lines);
    for (const n of spec.nodes) this.addCard(n);
    const controls = h(
      "div",
      { class: "am-canvas-controls" },
      h("button", { class: "tb-button", title: "Zoom out", onclick: () => this.zoomBy(1 / 1.2) }, "−"),
      this.zoomLabel,
      h("button", { class: "tb-button", title: "Zoom in", onclick: () => this.zoomBy(1.2) }, "+"),
      h("button", { class: "tb-button am-fit", title: "Show all cards", onclick: () => this.fit() }, "Fit"),
    );
    this.el = h("div", { class: "am-canvas" }, this.world, controls);
    this.el.addEventListener("mousedown", (e) => this.startPan(e));
    this.el.addEventListener("wheel", (e) => this.onWheel(e), { passive: false });
    const saved = readView();
    if (saved) this.view = saved;
    this.apply();
  }

  /** The body of each card, for its mod. */
  bodies(): { node: CanvasNode; body: HTMLElement }[] {
    return [...this.cards.values()].map(({ node, body }) => ({ node, body }));
  }

  /** Call after the canvas is in the page: draws the edges, and fits the cards on the first start. */
  shown() {
    if (!readView()) this.fit();
    this.drawEdges();
  }

  dispose() {
    this.resize.disconnect();
  }

  private addCard(n: CanvasNode) {
    const head = h("div", { class: "am-card-head", title: "Drag to move the card" }, n.title ?? n.mod);
    const body = h("div", { class: "am-card-body am-block", "data-mod": n.mod });
    const el = h("div", { class: "am-card", "data-node": n.id }, head, body);
    if (n.class) el.classList.add(...n.class.split(/\s+/).filter(Boolean));
    el.style.left = `${n.x}px`;
    el.style.top = `${n.y}px`;
    if (typeof n.w === "number") el.style.width = `${n.w}px`;
    if (typeof n.h === "number") el.style.height = `${n.h}px`;
    head.addEventListener("mousedown", (e) => this.startDrag(e, n, el));
    this.cards.set(n.id, { node: n, el, body });
    this.resize.observe(el);
    this.world.append(el);
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
      if (moved) this.onMoved();
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  }

  private startPan(e: MouseEvent) {
    const t = e.target as Element;
    if (e.button !== 0 || t.closest(".am-card, .am-canvas-controls")) return;
    e.preventDefault();
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
      saveView(this.view);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  }

  private onWheel(e: WheelEvent) {
    const zoom = e.ctrlKey || e.metaKey;
    // Without Ctrl, the wheel scrolls a card that can scroll.
    if (!zoom && (e.target as Element).closest(".am-card-body")) return;
    e.preventDefault();
    if (zoom) {
      const r = this.el.getBoundingClientRect();
      this.zoomAt(Math.exp(-e.deltaY * 0.0025), e.clientX - r.left, e.clientY - r.top);
    } else {
      this.view.x -= e.deltaX;
      this.view.y -= e.deltaY;
      this.apply();
    }
    saveView(this.view);
  }

  private zoomBy(f: number) {
    this.zoomAt(f, this.el.clientWidth / 2, this.el.clientHeight / 2);
    saveView(this.view);
  }

  /** Zooms and keeps the point (px, py) of the canvas element at its place. */
  private zoomAt(f: number, px: number, py: number) {
    const z = Math.min(2, Math.max(0.25, this.view.z * f));
    const k = z / this.view.z;
    this.view = { x: px - (px - this.view.x) * k, y: py - (py - this.view.y) * k, z };
    this.apply();
  }

  /** Shows all cards, at 100% or smaller. */
  fit() {
    const boxes = [...this.cards.values()].map(({ el }) => ({ x: el.offsetLeft, y: el.offsetTop, r: el.offsetLeft + el.offsetWidth, b: el.offsetTop + el.offsetHeight }));
    if (!boxes.length || !this.el.clientWidth) return;
    const x = Math.min(...boxes.map((b) => b.x)), y = Math.min(...boxes.map((b) => b.y));
    const w = Math.max(...boxes.map((b) => b.r)) - x, hgt = Math.max(...boxes.map((b) => b.b)) - y;
    const pad = 48;
    // The space at the left that the agent window covers.
    const left = Math.min(this.insetLeft(), this.el.clientWidth / 2);
    const width = this.el.clientWidth - left;
    const z = Math.min(1, (width - 2 * pad) / w, (this.el.clientHeight - 2 * pad) / hgt);
    this.view = { z, x: left + (width - w * z) / 2 - x * z, y: pad - y * z };
    this.apply();
    saveView(this.view);
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
    for (const e of this.spec.edges ?? []) {
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

function readView(): { x: number; y: number; z: number } | null {
  try {
    const v = JSON.parse(localStorage.getItem(VIEW_KEY) ?? "null");
    return v && typeof v.x === "number" && typeof v.y === "number" && typeof v.z === "number" ? v : null;
  } catch {
    return null;
  }
}

function saveView(v: { x: number; y: number; z: number }) {
  try {
    localStorage.setItem(VIEW_KEY, JSON.stringify(v));
  } catch {
    // The view is a convenience; without storage the canvas fits again at the next start.
  }
}
