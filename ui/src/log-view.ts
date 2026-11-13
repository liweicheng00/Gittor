// Virtualized commit log: a header, then one row per commit with the graph, refs, subject, author, date and hash.

import { api, type Row } from "./api";
import { dragResize, formatDate, h, icon } from "./dom";
import { ELEMENT_WIDTH, ROW_HEIGHT, foldAt, foldMarks, maxPosition, paintRow } from "./graph-paint";
import type { DropPlace } from "./rebase-plan";
import { refLabel } from "./ref-label";
import { save, settings } from "./settings";

const CHUNK = 200;
const OVERSCAN = 40;
const MAX_GRAPH_LANES = 40;
/** The graph column is never narrower than its two buttons. */
const MIN_GRAPH_WIDTH = 44;

export class LogView {
  /** user.email of the repository, in lower case, for the My Commits highlight. */
  myEmail = "";
  readonly el: HTMLElement;
  private header: HTMLElement;
  private scroller: HTMLElement;
  private spacer: HTMLElement;
  private body: HTMLElement;
  private empty: HTMLElement;
  private rowCount = 0;
  private chunks = new Map<number, Row[] | Promise<Row[]>>();
  private generation = 0;
  private graphLanes = 1;
  /** The width of all of the graph, and the width of its column. */
  private graphFull = 0;
  private graphCol = 0;
  private paintKey = "";
  private rendered = new Map<number, { div: HTMLElement; selected: boolean }>();
  /** Selected rows in click order. */
  selection: number[] = [];
  private anchor = -1;
  /** `auto` marks a selection that the app made, not the user. */
  onSelectionChange: (rows: Row[], auto: boolean) => void = () => {};
  /** A double click on a ref label of a row: the log shows only that ref, or all refs again. */
  onRefDoubleClick: (name: string, r: Row) => void | Promise<void> = () => {};
  /** A click on a ref label: it copies the name. The click also selects the row. */
  onRefClick: (name: string) => void = () => {};
  onContextMenu: (row: Row, e: MouseEvent) => void = () => {};
  onRowsLoaded: (rows: Row[]) => void = () => {};
  onExpandEdge: (up: number, down: number) => void = () => {};
  onCollapseAll: () => void = () => {};
  /** A drag of a commit node ended on another row: move the commit next to it, or join it into it. */
  onNodeDrop: (from: Row, target: Row, where: DropPlace, fixup: boolean) => void = () => {};
  onExpandAll: () => void = () => {};
  private collapsed = false;

  constructor() {
    this.header = h("div", { class: "log-header" });
    this.scroller = h("div", { class: "log-scroll", tabIndex: 0 });
    this.body = h("div", { class: "log-body" });
    this.spacer = h("div", { class: "log-spacer" }, this.body);
    this.empty = h("div", { class: "log-empty", hidden: true }, "No commits match the filter.");
    this.scroller.append(this.spacer);
    this.el = h("div", { class: "log" }, this.header, this.scroller, this.empty);
    this.scroller.addEventListener("scroll", () => this.render());
    new ResizeObserver(() => this.render()).observe(this.scroller);
    this.scroller.addEventListener("keydown", (e) => this.onKey(e));
    this.buildHeader();
  }

  focus() {
    this.scroller.focus();
  }

  buildHeader() {
    const col = (cls: string, label: string, key?: "authorWidth" | "dateWidth") => {
      const c = h("div", { class: `hcol ${cls}` }, label);
      if (key) {
        c.style.flexBasis = `${settings[key]}px`;
        const grip = h("div", { class: "hgrip" });
        let start = 0;
        dragResize(grip, "x", () => (start = settings[key]), (d) => {
          settings[key] = Math.max(60, Math.min(400, start - d));
          this.applyColumnWidths();
        }, save);
        c.prepend(grip);
      }
      return c;
    };
    const collapse = h("button", { class: "icon-button", title: "Collapse all linear branches" }, icon("collapse"));
    const expand = h("button", { class: "icon-button", title: "Expand all linear branches", disabled: !this.collapsed }, icon("expand"));
    collapse.addEventListener("click", () => this.onCollapseAll());
    expand.addEventListener("click", () => this.onExpandAll());
    const subject = col("subject", "Subject");
    const grip = h("div", { class: "hgrip", title: "Drag to make the subject wider. Double-click to show all of the graph" });
    let start = 0;
    dragResize(grip, "x", () => (start = this.graphCol), (d) => {
      const w = Math.max(MIN_GRAPH_WIDTH, start + d);
      // Wider than the graph shows all of it, also when the graph grows later.
      settings.graphWidth = w >= this.graphFull ? 0 : w;
      this.render();
    }, save);
    grip.addEventListener("dblclick", () => {
      settings.graphWidth = 0;
      save();
      this.render();
    });
    subject.prepend(grip);
    this.header.replaceChildren(
      h("div", { class: "hcol graph-tools" }, collapse, expand),
      subject,
      settings.showAuthor ? col("author", "Author", "authorWidth") : "",
      settings.showDate ? col("date", "Date", "dateWidth") : "",
      settings.showHash ? col("hash", "Hash") : "",
    );
    this.applyColumnWidths();
    this.paintKey = "";
    this.render();
  }

  private applyColumnWidths() {
    this.el.style.setProperty("--author-w", `${settings.authorWidth}px`);
    this.el.style.setProperty("--date-w", `${settings.dateWidth}px`);
    this.header.querySelector<HTMLElement>(".author")?.style.setProperty("flex-basis", `${settings.authorWidth}px`);
    this.header.querySelector<HTMLElement>(".date")?.style.setProperty("flex-basis", `${settings.dateWidth}px`);
  }

  /** Draws the visible rows again, after a change of the highlight or the date options. */
  redraw() {
    this.paintKey = "";
    this.render();
  }

  setCollapsed(c: boolean) {
    if (this.collapsed === c) return;
    this.collapsed = c;
    this.buildHeader();
  }

  reset(rowCount: number, recommendedWidth: number, keepScroll = false) {
    this.generation++;
    this.rowCount = rowCount;
    this.chunks.clear();
    this.selection = [];
    this.anchor = -1;
    this.graphLanes = Math.max(1, Math.min(recommendedWidth, MAX_GRAPH_LANES));
    this.spacer.style.height = `${rowCount * ROW_HEIGHT}px`;
    this.empty.hidden = rowCount > 0;
    if (!keepScroll) this.scroller.scrollTop = 0;
    this.paintKey = "";
    this.render();
  }

  get count() {
    return this.rowCount;
  }

  private chunk(index: number): Row[] | null {
    const c = this.chunks.get(index);
    if (Array.isArray(c)) return c;
    if (!c) {
      const gen = this.generation;
      const p = api.rows(index * CHUNK, (index + 1) * CHUNK).then((rows) => {
        if (gen !== this.generation) return rows;
        this.chunks.set(index, rows);
        this.onRowsLoaded(rows);
        if (this.chunks.size > 60) this.evict(index);
        this.render();
        return rows;
      });
      this.chunks.set(index, p);
    }
    return null;
  }

  private evict(keep: number) {
    for (const k of [...this.chunks.keys()]) if (Math.abs(k - keep) > 20) this.chunks.delete(k);
  }

  row(index: number): Row | null {
    const c = this.chunk(Math.floor(index / CHUNK));
    return c ? (c[index % CHUNK] ?? null) : null;
  }

  /** Loads a row even when it is off screen. */
  async rowAsync(index: number): Promise<Row | null> {
    const i = Math.floor(index / CHUNK);
    this.chunk(i);
    const c = await this.chunks.get(i);
    return c ? (c[index % CHUNK] ?? null) : null;
  }

  private foreground(): string {
    return getComputedStyle(this.el).getPropertyValue("--fg").trim() || "#000";
  }

  render() {
    const top = this.scroller.scrollTop;
    const height = this.scroller.clientHeight;
    const start = Math.max(0, Math.floor(top / ROW_HEIGHT) - OVERSCAN);
    const end = Math.min(this.rowCount, Math.ceil((top + height) / ROW_HEIGHT) + OVERSCAN);
    const rows: Row[] = [];
    for (let i = start; i < end; i++) {
      const r = this.row(i);
      if (r) rows.push(r);
    }
    let lanes = this.graphLanes;
    for (const r of rows) lanes = Math.max(lanes, Math.min(maxPosition(r.elements) + 1, MAX_GRAPH_LANES));
    const fg = this.foreground();
    const dpr = window.devicePixelRatio || 1;
    this.graphFull = lanes * ELEMENT_WIDTH + 6;
    this.graphCol = settings.graphWidth ? Math.max(MIN_GRAPH_WIDTH, Math.min(settings.graphWidth, this.graphFull)) : Math.max(MIN_GRAPH_WIDTH, this.graphFull);
    this.header.querySelector<HTMLElement>(".graph-tools")?.style.setProperty("flex-basis", `${this.graphCol}px`);
    const key = `${lanes}|${this.graphCol}|${fg}|${dpr}|${this.generation}|${settings.showAuthor}${settings.showDate}${settings.showHash}`;
    if (key !== this.paintKey) {
      this.paintKey = key;
      this.graphLanes = lanes;
      this.rendered.clear();
      this.body.replaceChildren();
    }
    const selected = new Set(this.selection);
    const keep = new Set<number>();
    for (const r of rows) {
      keep.add(r.row);
      const isSel = selected.has(r.row);
      const existing = this.rendered.get(r.row);
      if (existing && existing.selected === isSel) continue;
      const div = this.buildRow(r, this.graphFull, this.graphCol, fg, dpr, isSel);
      if (existing) existing.div.replaceWith(div);
      else this.body.append(div);
      this.rendered.set(r.row, { div, selected: isSel });
    }
    for (const [row, v] of this.rendered) {
      if (!keep.has(row)) {
        v.div.remove();
        this.rendered.delete(row);
      }
    }
  }

  private buildRow(r: Row, graphWidth: number, colWidth: number, fg: string, dpr: number, selected: boolean): HTMLElement {
    const canvas = h("canvas", { width: graphWidth * dpr, height: ROW_HEIGHT * dpr });
    canvas.style.width = `${graphWidth}px`;
    canvas.style.height = `${ROW_HEIGHT}px`;
    const g = canvas.getContext("2d")!;
    g.scale(dpr, dpr);
    const folds = foldMarks(r.row, r.elements);
    paintRow(g, r.elements, fg, selected, folds, r.isHead);
    // The node of HEAD has an "H" in a ring. The lane is for the UI tests.
    if (r.isHead) {
      const node = r.elements.find((e) => e.k === "n");
      if (node) canvas.dataset.head = String(node.p);
    }
    // A commit of the current branch can be dragged by its node: the rebase editor opens with the move.
    const node = r.elements.find((e) => e.k === "n");
    if (node && r.onHead && !r.merge) {
      const onNode = (x: number) => Math.abs(x - (node.p * ELEMENT_WIDTH + ELEMENT_WIDTH / 2)) <= ELEMENT_WIDTH / 2;
      canvas.addEventListener("mousedown", (e) => {
        if (e.button === 0 && !e.shiftKey && !e.metaKey && !e.ctrlKey && onNode(e.offsetX)) this.dragNode(r, e);
      });
      canvas.addEventListener("mousemove", (e) => {
        if (canvas.style.cursor !== "pointer") canvas.style.cursor = onNode(e.offsetX) ? "grab" : "";
      });
      canvas.dataset.node = String(node.p);
    }
    const arrows = r.elements.filter((e) => e.j !== undefined);
    if (arrows.length || folds.length) {
      canvas.addEventListener("mousedown", (e) => {
        // Only the fold mark expands a collapsed branch: a click on a commit selects it.
        const fold = foldAt(folds, e.offsetX, e.offsetY);
        if (fold && e.button === 0) {
          e.stopPropagation();
          this.onExpandEdge(fold.fold[0], fold.fold[1]);
          return;
        }
        const lane = Math.floor(e.offsetX / ELEMENT_WIDTH);
        const hit = arrows.find((a) => a.p === lane || a.o === lane);
        if (hit && hit.j !== undefined && e.button === 0) {
          e.stopPropagation();
          this.jumpTo(hit.j, true);
        }
      });
      if (folds.length) {
        // The places of the marks, for the UI tests.
        canvas.dataset.folds = JSON.stringify(folds.map((m) => [m.x, m.y]));
        canvas.addEventListener("mousemove", (e) => {
          const on = !!foldAt(folds, e.offsetX, e.offsetY);
          canvas.style.cursor = on ? "pointer" : "";
          canvas.title = on ? "Hidden commits of a linear branch. Click to show them." : arrows.length ? "Click an arrow to go to the other end of the edge" : "";
        });
      } else {
        canvas.title = "Click an arrow to go to the other end of the edge";
      }
    }
    const subject = h("span", { class: "subject", title: r.subject });
    for (const ref of r.refs) {
      const what = ref.kind === "head" ? "Detached HEAD: no branch is checked out" : ref.name;
      subject.append(h("span", { class: `ref ref-${ref.kind}`, title: `${what}\nClick to copy the name. Double-click to show only ${ref.name} in the log`, "data-ref": ref.name }, refLabel(ref)));
    }
    subject.append(h("span", { class: "subject-text" }, r.subject));
    const div = h(
      "div",
      {
        class:
          "log-row" +
          (selected ? " selected" : "") +
          (r.isHead ? " head" : "") +
          (settings.highlightMine && this.myEmail && r.authorEmail.toLowerCase() === this.myEmail ? " hl-mine" : "") +
          (settings.highlightMerges && r.merge ? " hl-merge" : "") +
          (settings.highlightCurrent && !r.onHead ? " hl-other" : ""),
        "data-row": r.row,
      },
      h("span", { class: "graph-cell", style: { width: `${colWidth}px` } }, canvas),
      subject,
      settings.showAuthor ? h("span", { class: "author", title: `${r.author} <${r.authorEmail}>` }, r.author) : "",
      settings.showDate ? h("span", { class: "date", title: settings.commitTimestamp ? "The commit time" : "The author time" }, formatDate(settings.commitTimestamp ? r.commitTime : r.authorTime)) : "",
      settings.showHash ? h("span", { class: "hash" }, r.oid.slice(0, 8)) : "",
    );
    div.style.top = `${r.row * ROW_HEIGHT}px`;
    div.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      // The first click draws the rows again, so no dblclick event comes. The click count still counts.
      const ref = (e.target as HTMLElement).closest<HTMLElement>(".ref")?.dataset.ref;
      if (ref && e.detail === 2) {
        e.preventDefault();
        void this.onRefDoubleClick(ref, r);
        return;
      }
      if (ref && e.detail === 1) this.onRefClick(ref);
      // The click draws the rows again, so this row goes away. The default action of the mousedown
      // then has no row to focus and moves the focus to the body, and the arrow keys stop. onClick
      // focuses the list itself.
      e.preventDefault();
      this.onClick(r.row, e);
    });
    div.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      if (!this.selection.includes(r.row)) this.select([r.row]);
      this.onContextMenu(r, e);
    });
    return div;
  }

  /** Where the view is: the first selected row on the screen, else the top row, and its distance from the
   * top of the view. A reload puts that commit back at the same height. */
  viewAnchor(): { oid: string; offset: number } | null {
    const top = this.scroller.scrollTop;
    const first = Math.floor(top / ROW_HEIGHT);
    const last = Math.floor((top + this.scroller.clientHeight) / ROW_HEIGHT);
    const index = [...this.selection].sort((a, b) => a - b).find((i) => i >= first && i <= last) ?? first;
    const oid = this.row(index)?.oid;
    return oid ? { oid, offset: index * ROW_HEIGHT - top } : null;
  }

  /** Scrolls so that a row is at this distance from the top of the view. */
  scrollToRow(row: number, offset: number) {
    this.scroller.scrollTop = Math.max(0, row * ROW_HEIGHT - offset);
    this.render();
  }

  /** Selects rows again after a reload, without the work of a new selection: the commits are the same. */
  restoreSelection(rows: number[]) {
    this.selection = rows;
    this.anchor = rows[0] ?? -1;
    this.render();
  }

  select(rows: number[], anchor = rows[0] ?? -1, auto = false) {
    this.selection = rows;
    this.anchor = anchor;
    this.changed(auto);
  }

  /** Takes the selection away, for example when the app selected a row that the user did not want. */
  dropSelection() {
    this.selection = [];
    this.anchor = -1;
    this.render();
  }

  /** Scrolls to a row; with `select`, the row becomes the selection. `auto` marks a selection of the
   * app, not of the user. */
  jumpTo(row: number, select: boolean, auto = false) {
    if (row < 0 || row >= this.rowCount) return;
    const y = row * ROW_HEIGHT;
    const view = this.scroller.clientHeight;
    if (y < this.scroller.scrollTop || y + ROW_HEIGHT > this.scroller.scrollTop + view) {
      this.scroller.scrollTop = Math.max(0, y - view / 3);
    }
    if (select) this.select([row], row, auto);
    this.focus();
  }

  /** Drags the node of a commit. A drop between two rows moves the commit there; a drop on the middle of a
   * row joins it into that commit (Alt: fixup). Only commits of the current branch that are not merges are
   * targets. Nothing changes here: `onNodeDrop` opens the rebase editor. */
  private dragNode(from: Row, down: MouseEvent) {
    const startX = down.clientX;
    const startY = down.clientY;
    let dragging = false;
    let lastY = startY;
    let fixup = false;
    let decision: { target: Row; where: DropPlace } | null = null;
    const line = h("div", { class: "log-drop-line", hidden: true });
    const box = h("div", { class: "log-drop-target", hidden: true });
    const dot = h("div", { class: "log-drag-dot" });
    const tip = h("div", { class: "log-drag-tip" });
    const short = (r: Row) => (r.subject.length > 40 ? `${r.subject.slice(0, 40)}…` : r.subject);
    const mark = (on: boolean) => this.rendered.get(from.row)?.div.classList.toggle("drag-source", on);

    const update = () => {
      if (!line.isConnected) this.body.append(line, box);
      mark(true);
      const rect = this.scroller.getBoundingClientRect();
      const y = lastY - rect.top + this.scroller.scrollTop;
      const index = Math.max(0, Math.min(this.rowCount - 1, Math.floor(y / ROW_HEIGHT)));
      const target = this.row(index);
      const inRow = y - index * ROW_HEIGHT;
      line.hidden = box.hidden = true;
      decision = null;
      if (!target || target.oid === from.oid) {
        tip.textContent = "Drop next to another commit of the branch";
      } else if (!target.onHead || target.merge) {
        tip.textContent = target.merge ? "A merge commit cannot be a target" : "Only commits of the current branch";
      } else if (inRow > ROW_HEIGHT / 3 && inRow < (ROW_HEIGHT * 2) / 3) {
        decision = { target, where: "onto" };
        box.hidden = false;
        box.style.top = `${index * ROW_HEIGHT}px`;
        tip.textContent = `${fixup ? "Fixup" : "Squash"} "${short(from)}" into "${short(target)}"${fixup ? "" : " · Alt: fixup"}`;
      } else {
        const where: DropPlace = inRow < ROW_HEIGHT / 2 ? "above" : "below";
        decision = { target, where };
        line.hidden = false;
        line.style.top = `${(where === "above" ? index : index + 1) * ROW_HEIGHT - 1}px`;
        tip.textContent = `Move "${short(from)}" ${where} "${short(target)}"`;
      }
      tip.classList.toggle("blocked", !decision);
    };

    // Near the top or bottom edge, the log scrolls while the mouse holds still.
    const scroll = window.setInterval(() => {
      if (!dragging) return;
      const rect = this.scroller.getBoundingClientRect();
      const step = lastY < rect.top + 30 ? -ROW_HEIGHT : lastY > rect.bottom - 30 ? ROW_HEIGHT : 0;
      if (!step) return;
      this.scroller.scrollTop += step;
      update();
    }, 60);

    const move = (e: MouseEvent) => {
      if (!dragging && Math.hypot(e.clientX - startX, e.clientY - startY) < 6) return;
      if (!dragging) {
        dragging = true;
        document.body.append(dot, tip);
        this.el.classList.add("node-dragging");
      }
      lastY = e.clientY;
      fixup = e.altKey;
      dot.style.left = `${e.clientX - 7}px`;
      dot.style.top = `${e.clientY - 7}px`;
      tip.style.left = `${e.clientX + 16}px`;
      tip.style.top = `${e.clientY + 10}px`;
      update();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        decision = null;
        end();
      } else if (e.key === "Alt" && dragging) {
        fixup = e.type === "keydown";
        update();
      }
    };
    const end = () => {
      window.clearInterval(scroll);
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", up);
      document.removeEventListener("keydown", key, true);
      document.removeEventListener("keyup", key, true);
      for (const el of [line, box, dot, tip]) el.remove();
      this.el.classList.remove("node-dragging");
      mark(false);
    };
    const up = () => {
      const d = decision;
      end();
      if (dragging && d) this.onNodeDrop(from, d.target, d.where, fixup);
    };
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", up);
    document.addEventListener("keydown", key, true);
    document.addEventListener("keyup", key, true);
  }

  private onClick(row: number, e: MouseEvent) {
    if (e.metaKey || e.ctrlKey) {
      const i = this.selection.indexOf(row);
      if (i >= 0) this.selection.splice(i, 1);
      else this.selection.push(row);
      this.anchor = row;
    } else if (e.shiftKey && this.anchor >= 0) {
      const [a, b] = [Math.min(this.anchor, row), Math.max(this.anchor, row)];
      this.selection = Array.from({ length: b - a + 1 }, (_, i) => a + i);
    } else {
      this.selection = [row];
      this.anchor = row;
    }
    this.focus();
    this.changed();
  }

  private onKey(e: KeyboardEvent) {
    const page = Math.max(1, Math.floor(this.scroller.clientHeight / ROW_HEIGHT) - 1);
    const cur = this.selection[this.selection.length - 1] ?? -1;
    const moves: Record<string, number> = {
      ArrowDown: cur + 1,
      ArrowUp: cur - 1,
      PageDown: cur + page,
      PageUp: cur - page,
      Home: 0,
      End: this.rowCount - 1,
    };
    if (!(e.key in moves) || this.rowCount === 0) return;
    e.preventDefault();
    const next = Math.max(0, Math.min(this.rowCount - 1, moves[e.key]));
    if (e.shiftKey && this.anchor >= 0) {
      const [a, b] = [Math.min(this.anchor, next), Math.max(this.anchor, next)];
      this.selection = Array.from({ length: b - a + 1 }, (_, i) => a + i);
      if (this.selection[this.selection.length - 1] !== next) this.selection.reverse();
      this.changed();
    } else {
      this.anchor = next;
      this.selection = [next];
      this.changed();
    }
    const y = next * ROW_HEIGHT;
    if (y < this.scroller.scrollTop) this.scroller.scrollTop = y;
    else if (y + ROW_HEIGHT > this.scroller.scrollTop + this.scroller.clientHeight) {
      this.scroller.scrollTop = y + ROW_HEIGHT - this.scroller.clientHeight;
    }
  }

  private selectionTimer = 0;

  /** True when rows are selected. It does not wait for the selection debounce. */
  hasSelection(): boolean {
    return this.selection.length > 0;
  }

  /** The selected rows now, sorted top to bottom. It does not wait for the selection debounce. */
  async selectedRows(): Promise<Row[]> {
    const rows = await Promise.all([...this.selection].sort((a, b) => a - b).map((i) => this.rowAsync(i)));
    return rows.filter((r): r is Row => r !== null);
  }

  private changed(auto = false) {
    this.render();
    // Wait a moment so fast keyboard navigation does not start a compare for every row.
    clearTimeout(this.selectionTimer);
    this.selectionTimer = window.setTimeout(async () => {
      const rows = await Promise.all([...this.selection].sort((a, b) => a - b).map((i) => this.rowAsync(i)));
      this.onSelectionChange(rows.filter((r): r is Row => r !== null), auto);
    }, 60);
  }
}
