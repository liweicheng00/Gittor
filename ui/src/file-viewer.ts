// The file viewer of the Files tab: the text of a working-tree file in a window, with notes on its lines,
// the list of the notes with Copy All, and a note on the whole file. The notes are the notes on local
// changes (local-notes.ts): they go away when the file changes. Open in Editor opens the editor of the
// settings only on request.

import { api } from "./api";
import { h, icon } from "./dom";
import { sharedDiff } from "./history-view";
import { listLocalNotes, localNoteHandlers } from "./local-notes";
import { NotesPanel } from "./notes-panel";
import { closeWindows, onRepoChange, registerWindow } from "./windows";

export interface FileViewerCallbacks {
  openInEditor: (path: string, line: number) => void;
  copyText: (text: string) => void;
}

/** Opens a working-tree file in the viewer. */
export function openFileViewer(path: string, cb: FileViewerCallbacks) {
  closeWindows();
  const d = sharedDiff();
  const notes = new NotesPanel((t) => cb.copyText(t));
  const editBtn = h("button", { class: "tb-button file-viewer-edit", "data-key-action": "openInEditor" }, icon("edit"), "Open in Editor");
  const copyBtn = h("button", { class: "tb-button", title: "Copy the path of the file" }, icon("copy"), "Copy Path");
  const closeBtn = h("button", { class: "tb-button" }, "Close");
  const win = h(
    "div",
    { class: "history-window file-viewer", role: "dialog", "aria-label": "File" },
    h("div", { class: "merge-header" }, h("b", {}, "File"), h("code", { class: "file-viewer-path" }, path), h("span", { class: "spacer" }), editBtn, copyBtn, closeBtn),
    h("div", { class: "history-body file-viewer-body" }, h("div", { class: "review-right" }, d.el, notes.el)),
  );
  const overlay = h("div", { class: "merge-overlay" }, win);
  document.body.append(overlay);
  let request = 0;

  const close = () => {
    unregister();
    stopWatching();
    d.setNotes([], null);
    overlay.remove();
    document.removeEventListener("keydown", onKey, true);
  };
  const unregister = registerWindow(() => close(), "file");
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape" && !document.querySelector(".overlay")) {
      e.preventDefault();
      close();
    }
  };
  document.addEventListener("keydown", onKey, true);
  closeBtn.addEventListener("click", close);
  copyBtn.addEventListener("click", () => cb.copyText(path));
  editBtn.addEventListener("click", () => cb.openInEditor(path, d.cursorLine()));
  d.onHistory = () => {};
  d.onNextFile = () => {};
  d.onPrevFile = () => {};

  /** Loads the text and the notes. A change of the file on disk loads them again. */
  const load = async () => {
    const req = ++request;
    try {
      const pair = await api.filePair("worktree", "worktree", path, null);
      if (req !== request) return;
      d.setSides("working tree", "");
      d.setSource({ path, rev: "worktree" });
      if (pair.right.missing) {
        notes.clear();
        return d.message("The file is not in the working tree.");
      }
      d.showFile(path, pair.right);
      if (pair.right.binary) return notes.clear();
      const reload = async () => {
        const list = await listLocalNotes(path);
        if (req !== request) return;
        const handlers = localNoteHandlers(path, reload);
        d.setNotes(list, handlers);
        notes.set(path, list, { ...handlers, reveal: (line) => d.revealLine(line) });
      };
      await reload();
    } catch (e) {
      if (req === request) d.message(String(e).replace(/^Error: /, ""));
    }
  };
  const stopWatching = onRepoChange((change) => change === "files" && void load());
  void load();
}
