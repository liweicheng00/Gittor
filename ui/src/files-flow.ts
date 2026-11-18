// The Files tab: loads the files of the working tree, shows the status of the local changes, and opens a
// file in the center panel, in place of the log, as the editor of an IDE does. Each open file has a tab
// next to the tab "Log". A file shows its text as it is now, with the notes on its lines, the list of the
// notes with Copy All, and a note on the whole file. Show Diff in the menu shows the diff of a change in
// the diff panel.

import { api } from "./api";
import { setFileViewReload, showLocalDiff } from "./commit-flow";
import { DiffView } from "./diff-view";
import { showMenu } from "./context-menu";
import { copyText, h, icon } from "./dom";
import { openInEditor } from "./editor-flow";
import { showHistory } from "./history-flow";
import { keymap } from "./keyboard";
import { listLocalNotes, localNoteHandlers } from "./local-notes";
import { NotesPanel } from "./notes-panel";
import { visit } from "./nav";
import { settings } from "./settings";
import { centerHooks, centerTabs, commitPanel, fileHost, filesPanel, filterBar, leftTabHooks, log, showLeftTab } from "./shell";

/** The list of files is old: the local changes changed while the tab did not show. */
let stale = true;
let request = 0;

async function loadFiles() {
  stale = false;
  const req = ++request;
  const files = await api.worktreeFiles().catch(() => null);
  if (req !== request || !files) return;
  filesPanel.setFiles(files);
}

/** A new set of local changes can add or remove files. The tab loads them now, or when it shows. */
commitPanel.onLoad = (files) => {
  filesPanel.setStatus(new Map(files.map((f) => [f.change.path, f.change.status])));
  if (settings.leftTab === "files" && settings.showSidebar) void loadFiles();
  else stale = true;
};
leftTabHooks.files = () => {
  if (stale || !filesPanel.hasFiles) void loadFiles();
};

/** The local change of a path, or null. A file in more than one changelist gives its first row. */
const localChange = (path: string) => commitPanel.allFiles().find((f) => f.change.path === path) ?? null;

/** The editor of the open files: a DiffView that shows one file as text, with its notes. */
let editor: DiffView | null = null;
const notesPanel = new NotesPanel((t) => void copyText(t));
/** The open files, in the order of their tabs, and the one that shows; null shows the log. */
let openFiles: string[] = [];
let active: string | null = null;
let fileRequest = 0;

function theEditor(): DiffView {
  if (editor) return editor;
  const ed = new DiffView();
  ed.onHide = () => active && closeFile(active);
  ed.onOpenInEditor = (path, line, column) => void openInEditor(path, line, column);
  ed.onHistory = (path) => showHistory(path);
  fileHost.append(ed.el, notesPanel.el);
  editor = ed;
  return ed;
}

/** Draws the tabs of the center panel: Log, then the open files. They show only with an open file. */
function renderTabs() {
  centerTabs.hidden = openFiles.length === 0;
  const tab = (label: string, on: boolean, title: string, select: () => void, close?: () => void) => {
    const el = h("div", { class: "center-tab" + (on ? " on" : ""), title, role: "tab" }, h("span", { class: "center-tab-name" }, label));
    el.addEventListener("mousedown", (e) => {
      if (e.button === 1 && close) {
        e.preventDefault();
        return close();
      }
      if (e.button === 0 && !(e.target as HTMLElement).closest(".center-tab-close")) select();
    });
    if (close) {
      const x = h("button", { class: "center-tab-close", title: "Close the file" }, icon("close"));
      x.addEventListener("click", (e) => {
        e.stopPropagation();
        close();
      });
      el.append(x);
    }
    return el;
  };
  centerTabs.replaceChildren(
    tab("Log", active === null, "The log of the commits", () => showLog()),
    ...openFiles.map((p) => tab(p.slice(p.lastIndexOf("/") + 1), p === active, p, () => void openFile(p), () => closeFile(p))),
  );
}

/** Shows the log in the center panel again. The files stay open in their tabs. */
function showLog() {
  active = null;
  fileHost.hidden = true;
  log.el.hidden = filterBar.el.hidden = false;
  log.redraw();
  renderTabs();
}

function closeFile(path: string) {
  const at = openFiles.indexOf(path);
  if (at < 0) return;
  openFiles.splice(at, 1);
  if (active !== path) return renderTabs();
  const next = openFiles[Math.min(at, openFiles.length - 1)];
  if (next) void openFile(next);
  else showLog();
}

/** Opens a file of the working tree in the center panel, with its notes. `again` loads it again. */
async function openFile(path: string, again = false) {
  if (!again) {
    visit({
      key: `files\0${path}`,
      label: `File: ${path}`,
      open: () => {
        showLeftTab("files");
        filesPanel.select(path);
        void openFile(path);
      },
    });
    if (!openFiles.includes(path)) openFiles.push(path);
  }
  active = path;
  log.el.hidden = filterBar.el.hidden = true;
  fileHost.hidden = false;
  renderTabs();
  const ed = theEditor();
  const req = ++fileRequest;
  ed.setSource({ path, rev: "worktree" });
  ed.setSides("working tree", "");
  try {
    const pair = await api.filePair("worktree", "worktree", path, null);
    if (req !== fileRequest || active !== path) return;
    if (pair.right.missing) {
      notesPanel.clear();
      return ed.message("The file is not in the working tree.");
    }
    ed.showFile(path, pair.right);
    if (pair.right.binary) return notesPanel.clear();
    const reload = async () => {
      const list = await listLocalNotes(path);
      if (req !== fileRequest || active !== path) return;
      const handlers = localNoteHandlers(path, reload);
      ed.setNotes(list, handlers);
      notesPanel.set(path, list, { ...handlers, reveal: (line) => ed.revealLine(line) });
    };
    await reload();
  } catch (e) {
    if (req === fileRequest) ed.message(String(e).replace(/^Error: /, ""));
  }
}
// A change of the file on disk loads its text and notes again.
setFileViewReload(async () => {
  if (active) await openFile(active, true);
});
// Another repository: its files are not open.
centerHooks.reset = () => {
  openFiles = [];
  showLog();
};

filesPanel.onOpen = (path) => void openFile(path);
// A double click or Enter opens the file too; the editor of the settings opens only from the menu or with its key.
filesPanel.onActivate = (path) => void openFile(path);
filesPanel.onMenu = (path, e) => {
  const change = localChange(path);
  showMenu(e.clientX, e.clientY, [
    { label: "Show Diff", disabled: !change || change.change.status === "?", action: () => change && void showLocalDiff(change) },
    { label: "Open in Editor", shortcut: keymap.shortcut("openInEditor"), action: () => void openInEditor(path) },
    { label: "Show History", disabled: change?.change.status === "?", action: () => showHistory(path) },
    {
      label: "Show in the Changes Tab",
      disabled: !change,
      action: () => {
        if (!change) return;
        showLeftTab("commit");
        commitPanel.revealFile(path, change.list);
      },
    },
    { separator: true },
    { label: "Copy Path", action: () => void copyText(path) },
  ]);
};
