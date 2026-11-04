// Review notes in a diff: cards that float at the right of their lines, a note icon in the gutter of the
// line under the mouse, and a card with a text field for a new note. A note can be on more than one line:
// drag the icon over the lines, or select the lines with the mouse. The layer is off until a review gives
// it its notes and handlers.

import * as monaco from "./monaco";
import { formatDate, h, icon } from "./dom";
import { lineRange } from "./note-format";

export interface NoteItem {
  id: string;
  /** The line on the right side, 1-based. */
  line: number;
  /** The last line of a note on more than one line; 0 is a note on one line. */
  endLine: number;
  text: string;
  outdated: boolean;
  time: number;
}

export interface NoteHandlers {
  add: (line: number, endLine: number, text: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  /** Copies the note to the clipboard, with its file and line. */
  copy: (note: NoteItem) => void;
}

let layers = 0;

/** The space between two cards, and between a card and the right edge of the editor. */
const GAP = 4;

/** The layer of one editor: an overlay widget over the whole editor that holds the cards. */
class EditorLayer {
  private readonly el = h("div", { class: "note-layer" });
  private hoverDeco: string[] = [];
  private hoverLine = 0;
  /** The lines of the new note, and of a drag on the icon. The diff marks the lines of the notes. */
  private rangeDeco: string[] = [];
  private ranges: [number, number][] = [];
  private dragRange: [number, number] | null = null;

  constructor(
    private readonly ed: monaco.editor.ICodeEditor,
    private readonly owner: NoteLayer,
  ) {
    const id = `note-layer-${++layers}`;
    ed.addOverlayWidget({ getId: () => id, getDomNode: () => this.el, getPosition: () => ({ preference: null }) });
    const place = () => this.place();
    ed.onDidScrollChange(place);
    ed.onDidLayoutChange(place);
    ed.onDidChangeModel(() => {
      this.hoverLine = 0;
      this.hoverDeco = ed.deltaDecorations(this.hoverDeco, []);
    });
    ed.onMouseMove((e) => this.hover(e.target.position?.lineNumber ?? 0));
    ed.onMouseLeave(() => this.hover(0));
    ed.onMouseDown((e) => {
      if (!this.owner.handlers || !e.target.position) return;
      const line = e.target.position.lineNumber;
      const onIcon = e.target.type === monaco.editor.MouseTargetType.GUTTER_LINE_DECORATIONS && line === this.hoverLine;
      const twice = e.event.detail === 2 && (e.target.type === monaco.editor.MouseTargetType.CONTENT_TEXT || e.target.type === monaco.editor.MouseTargetType.CONTENT_EMPTY);
      if (onIcon) {
        e.event.preventDefault();
        // A click on the icon in a selection of more lines: a note on the selected lines.
        const sel = ed.getSelection();
        if (sel && sel.endLineNumber > sel.startLineNumber && line >= sel.startLineNumber && line <= sel.endLineNumber) {
          const end = sel.endColumn === 1 ? sel.endLineNumber - 1 : sel.endLineNumber;
          return this.owner.startNote(sel.startLineNumber, Math.max(end, sel.startLineNumber));
        }
        this.drag(line);
      } else if (twice) {
        e.event.preventDefault();
        this.owner.startNote(line);
      } else if (e.event.leftButton && (e.target.type === monaco.editor.MouseTargetType.CONTENT_TEXT || e.target.type === monaco.editor.MouseTargetType.CONTENT_EMPTY)) {
        this.watchSelection();
      }
    });
  }

  /** A mouse selection of more lines opens a new note on these lines when the mouse button goes up. */
  private watchSelection() {
    const up = () => {
      window.removeEventListener("mouseup", up, true);
      // Monaco sets the last selection in its own handler of the release.
      setTimeout(() => {
        const sel = this.ed.getSelection();
        if (!sel || sel.endLineNumber <= sel.startLineNumber) return;
        const end = sel.endColumn === 1 ? sel.endLineNumber - 1 : sel.endLineNumber;
        if (end > sel.startLineNumber) this.owner.offerNote(sel.startLineNumber, end);
      });
    };
    window.addEventListener("mouseup", up, true);
  }

  /** A drag from the icon over more lines. The release of the mouse opens the note on these lines. */
  private drag(from: number) {
    let to = from;
    const show = () => {
      this.dragRange = [Math.min(from, to), Math.max(from, to)];
      this.paintRanges();
    };
    const move = (ev: MouseEvent) => {
      const l = this.ed.getTargetAtClientPoint(ev.clientX, ev.clientY)?.position?.lineNumber;
      if (l && l !== to) {
        to = l;
        show();
      }
    };
    const up = () => {
      window.removeEventListener("mousemove", move, true);
      window.removeEventListener("mouseup", up, true);
      this.dragRange = null;
      this.owner.startNote(Math.min(from, to), Math.max(from, to));
    };
    window.addEventListener("mousemove", move, true);
    window.addEventListener("mouseup", up, true);
    show();
  }

  /** Marks the lines of the new note and of a drag. */
  private paintRanges() {
    const all = this.dragRange ? [...this.ranges, this.dragRange] : this.ranges;
    this.rangeDeco = this.ed.deltaDecorations(
      this.rangeDeco,
      all.map(([s, e]) => ({ range: new monaco.Range(s, 1, e, 1), options: { isWholeLine: true, className: "note-range" } })),
    );
  }

  /** The note icon in the gutter of the line under the mouse. */
  private hover(line: number) {
    const on = this.owner.handlers && this.owner.active() === this.ed ? line : 0;
    if (on === this.hoverLine) return;
    this.hoverLine = on;
    this.hoverDeco = this.ed.deltaDecorations(
      this.hoverDeco,
      on ? [{ range: new monaco.Range(on, 1, on, 1), options: { linesDecorationsClassName: "note-add-icon", linesDecorationsTooltip: "Add a note to this line (or double-click the line)" } }] : [],
    );
  }

  /** Draws the cards of the notes, and the card of a new note. */
  render(notes: NoteItem[], draftLine: number, draftEnd: number) {
    const on = this.owner.active() === this.ed;
    this.el.replaceChildren();
    this.ranges = on && draftLine && draftEnd > draftLine ? [[draftLine, draftEnd]] : [];
    this.paintRanges();
    if (!on) return;
    for (const n of notes) this.el.append(this.owner.card(n));
    if (draftLine) this.el.append(this.owner.draftCard(draftLine, draftEnd));
    this.place();
  }

  /** Puts each card at the top of its line, at the right edge. A card that would cover the card above
   * it moves down. A card out of the view hides. */
  place() {
    const layout = this.ed.getLayoutInfo();
    this.el.style.width = `${layout.width}px`;
    this.el.style.height = `${layout.height}px`;
    const scroll = this.ed.getScrollTop();
    const lines = this.ed.getModel()?.getLineCount() ?? 0;
    const cards = [...this.el.querySelectorAll<HTMLElement>(".note-card")].sort((a, b) => Number(a.dataset.line) - Number(b.dataset.line));
    let bottom = -Infinity;
    for (const c of cards) {
      const line = Math.min(Number(c.dataset.line), lines);
      let top = this.ed.getTopForLineNumber(line) - scroll;
      top = Math.max(top, bottom + GAP);
      c.style.top = `${top}px`;
      c.style.right = `${layout.verticalScrollbarWidth + GAP * 3}px`;
      c.hidden = line < 1 || top > layout.height || top + c.offsetHeight < 0;
      if (!c.hidden) bottom = top + c.offsetHeight;
    }
  }
}

/** The notes of the right side of a diff, on all editors that can show it. */
export class NoteLayer {
  handlers: NoteHandlers | null = null;
  private notes: NoteItem[] = [];
  private draftLine = 0;
  private draftEnd = 0;
  private draftText = "";
  private readonly layers = new Map<monaco.editor.ICodeEditor, EditorLayer>();

  /** `active` gives the editor that shows the right side now. */
  constructor(readonly active: () => monaco.editor.ICodeEditor) {}

  attach(ed: monaco.editor.ICodeEditor) {
    if (!this.layers.has(ed)) this.layers.set(ed, new EditorLayer(ed, this));
  }

  /** Shows the notes. Without handlers, the layer is off: no cards, no icon. */
  set(notes: NoteItem[], handlers: NoteHandlers | null) {
    this.notes = handlers ? notes.filter((n) => n.line >= 1) : [];
    if (handlers !== this.handlers) this.draftLine = 0;
    this.handlers = handlers;
    for (const ed of this.layers.keys()) ed.updateOptions({ lineDecorationsWidth: handlers ? 18 : 10 });
    this.render();
  }

  clear() {
    this.set([], null);
  }

  /** Opens the card of a new note after a selection of lines. A new note that has text stays as it is. */
  offerNote(line: number, end: number) {
    if (this.draftLine && this.draftText.trim()) return;
    this.startNote(line, end);
  }

  /** Opens the card of a new note on the lines `line` to `end`. */
  startNote(line: number, end = line) {
    if (!this.handlers) return;
    if (this.draftLine !== line || this.draftEnd !== end) this.draftText = "";
    this.draftLine = line;
    this.draftEnd = end;
    this.render();
    queueMicrotask(() => document.querySelector<HTMLTextAreaElement>(".note-card.draft textarea")?.focus());
  }

  private render() {
    for (const layer of this.layers.values()) layer.render(this.notes, this.draftLine, this.draftEnd);
  }

  card(n: NoteItem): HTMLElement {
    const del = h("button", { class: "icon-button note-card-delete", title: "Delete the note" }, icon("close"));
    del.addEventListener("click", () => void this.handlers?.remove(n.id));
    const copy = h("button", { class: "icon-button note-card-copy", title: "Copy the file, the line and the note" }, icon("copy"));
    copy.addEventListener("click", () => this.handlers?.copy(n));
    return h(
      "div",
      {
        class: "note-card" + (n.outdated ? " outdated" : ""),
        "data-line": n.line,
        title: n.outdated ? "The file changed after this note. The line can be another line now." : "",
      },
      h("div", { class: "note-card-head" }, icon("note"), h("span", {}, `L${lineRange(n)}`), n.outdated ? h("span", { class: "note-card-tag" }, "outdated") : "", h("span", { class: "spacer" }), h("span", {}, formatDate(n.time)), copy, del),
      h("div", { class: "note-card-text" }, n.text),
    );
  }

  draftCard(line: number, end: number): HTMLElement {
    const lines = end > line ? `lines ${line}-${end}` : `line ${line}`;
    const text = h("textarea", { class: "note-card-input", rows: 3, placeholder: `A note on ${lines}`, spellcheck: false });
    text.value = this.draftText;
    text.addEventListener("input", () => (this.draftText = text.value));
    const cancel = () => {
      this.draftLine = 0;
      this.draftEnd = 0;
      this.draftText = "";
      this.render();
    };
    const save = async () => {
      const value = text.value.trim();
      if (!value || !this.handlers) return;
      add.disabled = true;
      await this.handlers.add(line, end > line ? end : 0, value);
      this.draftLine = 0;
      this.draftEnd = 0;
      this.draftText = "";
      this.render();
    };
    text.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        void save();
      } else if (e.key === "Escape") {
        e.preventDefault();
        cancel();
      }
    });
    const add = h("button", { class: "tb-button primary" }, "Add Note");
    add.addEventListener("click", () => void save());
    const no = h("button", { class: "tb-button" }, "Cancel");
    no.addEventListener("click", cancel);
    return h(
      "div",
      { class: "note-card draft", "data-line": line },
      h("div", { class: "note-card-head" }, icon("note"), h("span", {}, `New note on L${lineRange({ line, endLine: end })}`)),
      text,
      h("div", { class: "note-card-buttons" }, h("span", { class: "muted-inline" }, "Ctrl+Enter"), h("span", { class: "spacer" }), no, add),
    );
  }
}
