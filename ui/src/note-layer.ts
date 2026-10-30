// Review notes in a diff: cards that float at the right of their lines, a note icon in the gutter of the
// line under the mouse, and a card with a text field for a new note. The layer is off until a review
// gives it its notes and handlers.

import * as monaco from "./monaco";
import { formatDate, h, icon } from "./dom";

export interface NoteItem {
  id: string;
  /** The line on the right side, 1-based. */
  line: number;
  text: string;
  outdated: boolean;
  time: number;
}

export interface NoteHandlers {
  add: (line: number, text: string) => Promise<void>;
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
      if (onIcon || twice) {
        e.event.preventDefault();
        this.owner.startNote(line);
      }
    });
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
  render(notes: NoteItem[], draftLine: number) {
    const on = this.owner.active() === this.ed;
    this.el.replaceChildren();
    if (!on) return;
    for (const n of notes) this.el.append(this.owner.card(n));
    if (draftLine) this.el.append(this.owner.draftCard(draftLine));
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

  /** Opens the card of a new note at a line. */
  startNote(line: number) {
    if (!this.handlers) return;
    if (this.draftLine !== line) this.draftText = "";
    this.draftLine = line;
    this.render();
    queueMicrotask(() => document.querySelector<HTMLTextAreaElement>(".note-card.draft textarea")?.focus());
  }

  private render() {
    for (const layer of this.layers.values()) layer.render(this.notes, this.draftLine);
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
      h("div", { class: "note-card-head" }, icon("note"), h("span", {}, `L${n.line}`), n.outdated ? h("span", { class: "note-card-tag" }, "outdated") : "", h("span", { class: "spacer" }), h("span", {}, formatDate(n.time)), copy, del),
      h("div", { class: "note-card-text" }, n.text),
    );
  }

  draftCard(line: number): HTMLElement {
    const text = h("textarea", { class: "note-card-input", rows: 3, placeholder: `A note on line ${line}`, spellcheck: false });
    text.value = this.draftText;
    text.addEventListener("input", () => (this.draftText = text.value));
    const cancel = () => {
      this.draftLine = 0;
      this.draftText = "";
      this.render();
    };
    const save = async () => {
      const value = text.value.trim();
      if (!value || !this.handlers) return;
      add.disabled = true;
      await this.handlers.add(line, value);
      this.draftLine = 0;
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
      h("div", { class: "note-card-head" }, icon("note"), h("span", {}, `New note on L${line}`)),
      text,
      h("div", { class: "note-card-buttons" }, h("span", { class: "muted-inline" }, "Ctrl+Enter"), h("span", { class: "spacer" }), no, add),
    );
  }
}
