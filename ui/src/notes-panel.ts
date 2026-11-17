// The list of the notes of one file under a diff: each note with its line, Copy All for the open notes,
// and a field for a note on the whole file (line 0). The Review window and the Compare window use it. A
// note on a line has its card in the diff too (note-layer.ts).

import { formatDate, h, icon } from "./dom";
import type { NoteHandlers, NoteItem } from "./note-layer";
import { formatNote, formatNotes, lineRange } from "./note-format";

export interface NotesPanelHandlers extends NoteHandlers {
  /** Shows the line of a note in the diff. */
  reveal: (line: number) => void;
}

export class NotesPanel {
  readonly el: HTMLElement;
  private readonly title = h("div", { class: "review-notes-title" });
  private readonly list = h("div", { class: "review-notes-list" });
  private readonly input = h("input", { class: "review-file-note-input", placeholder: "A note on the whole file (Enter adds it)", spellcheck: false });
  private readonly addBtn = h("button", { class: "tb-button" }, "Add");
  private handlers: NotesPanelHandlers | null = null;
  /** Writes the text of the clipboard; the window gives it. */
  constructor(private readonly copyText: (text: string) => void) {
    const form = h("div", { class: "review-file-note-form" }, icon("note"), this.input, this.addBtn);
    this.el = h("div", { class: "review-notes" }, this.title, this.list, form);
    this.addBtn.addEventListener("click", () => void this.addFileNote());
    this.input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        void this.addFileNote();
      } else if (e.key === "Escape") {
        e.preventDefault();
        this.input.value = "";
        this.input.blur();
      }
    });
    this.clear();
  }

  /** No file: an empty list and a field that is off. */
  clear(title = "Notes") {
    this.handlers = null;
    this.title.textContent = title;
    this.list.replaceChildren();
    this.input.disabled = this.addBtn.disabled = true;
  }

  /** Shows the notes of a file. `heading` is the text at the top of the list. */
  set(path: string, notes: NoteItem[], handlers: NotesPanelHandlers, heading = `Notes in ${path}`) {
    this.handlers = handlers;
    this.input.disabled = this.addBtn.disabled = false;
    // Copy All takes the open notes: a resolved note is done.
    const open = notes.filter((n) => !n.resolved);
    const copyAll = h("button", { class: "tb-button review-notes-copy", title: "Copy the open notes of the file, with the file and the lines", disabled: !open.length }, icon("copy"), "Copy All");
    copyAll.addEventListener("click", () => this.copyText(formatNotes(path, open)));
    this.title.replaceChildren(h("span", {}, heading), h("span", { class: "spacer" }), copyAll);
    const button = (iconName: "copy" | "close", title: string, run: () => void) => {
      const b = h("button", { class: `icon-button${iconName === "copy" ? " review-note-copy" : ""}`, title }, icon(iconName));
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        run();
      });
      return b;
    };
    this.list.replaceChildren(
      ...notes.map((n) => {
        const onFile = n.line === 0;
        const row = h(
          "div",
          {
            class: "review-note" + (n.outdated ? " outdated" : "") + (n.resolved ? " resolved" : ""),
            title: n.outdated ? "The file changed after this note. The line can be another line now." : onFile ? "A note on the whole file" : "Go to the line",
          },
          h("span", { class: "review-note-line-no" }, onFile ? "File" : `L${lineRange(n)}`),
          h("span", { class: "review-note-body" }, n.text),
          n.outdated ? h("span", { class: "muted-inline" }, "outdated") : "",
          n.resolved ? h("span", { class: "review-note-resolved", title: "Resolved" }, icon("resolved")) : "",
          h("span", { class: "muted-inline" }, formatDate(n.time)),
          button("copy", "Copy the file, the line and the note", () => this.copyText(formatNote(path, n))),
          button("close", "Delete the note", () => void handlers.remove(n.id)),
        );
        if (!onFile) row.addEventListener("click", () => handlers.reveal(n.line));
        return row;
      }),
    );
  }

  private async addFileNote() {
    const text = this.input.value.trim();
    if (!text || !this.handlers) return;
    this.input.value = "";
    await this.handlers.add(0, 0, text);
  }
}
