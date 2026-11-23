// The field that edits the text of a note in place: on a card in the diff, and in the list of notes.
// Mod+Enter or Save keeps the new text, Escape or Cancel keeps the old one.

import { h } from "./dom";
import { isMac } from "./keymap";

export interface NoteEditor {
  el: HTMLElement;
  input: HTMLTextAreaElement;
}

/** `text` is the text to start with; `onInput` keeps it when the card draws again. */
export function noteEditor(text: string, onSave: (text: string) => void, onCancel: () => void, onInput: (text: string) => void = () => {}): NoteEditor {
  const input = h("textarea", { class: "note-card-input note-edit-input", rows: 3, spellcheck: false });
  input.value = text;
  const save = h("button", { class: "tb-button primary note-edit-save" }, "Save");
  const cancel = h("button", { class: "tb-button note-edit-cancel" }, "Cancel");
  const keep = () => input.value.trim() && onSave(input.value.trim());
  save.addEventListener("click", keep);
  cancel.addEventListener("click", onCancel);
  input.addEventListener("input", () => onInput(input.value));
  input.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Enter" && (isMac ? e.metaKey : e.ctrlKey)) {
      e.preventDefault();
      keep();
    } else if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
    }
  });
  const el = h("div", { class: "note-edit" }, input, h("div", { class: "note-edit-buttons" }, h("span", { class: "muted-inline note-edit-hint" }, `${isMac ? "⌘" : "Ctrl+"}Enter saves`), h("span", { class: "spacer" }), cancel, save));
  // The editor is not a part of the row: a click in it does not go to the line, and a double click
  // does not add a note.
  for (const type of ["click", "dblclick", "mousedown"]) el.addEventListener(type, (e) => e.stopPropagation());
  return { el, input };
}

/** Puts the focus at the end of the text of a new editor. */
export function focusEnd(input: HTMLTextAreaElement) {
  queueMicrotask(() => {
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  });
}
