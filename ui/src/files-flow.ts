// The Files tab: loads the files of the working tree, shows the status of the local changes, and opens a
// file. A file with a local change shows its diff; another file shows its text without colors.

import { api } from "./api";
import { showLocalDiff } from "./commit-flow";
import { showMenu } from "./context-menu";
import { copyText } from "./dom";
import { openInEditor } from "./editor-flow";
import { showHistory } from "./history-flow";
import { visit } from "./nav";
import { settings } from "./settings";
import { commitPanel, diff, filesPanel, leftTabHooks, showLeftTab } from "./shell";
import { app } from "./state";

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

async function openFile(path: string) {
  const change = localChange(path);
  if (change) return void showLocalDiff(change);
  visit({
    key: `files\0${path}`,
    label: `File: ${path}`,
    open: () => {
      showLeftTab("files");
      filesPanel.select(path);
      void openFile(path);
    },
  });
  app.request++;
  app.diffSource = "local";
  diff.setSource({ path, rev: "worktree" });
  diff.setSides("working tree", "");
  try {
    const pair = await api.filePair("worktree", "worktree", path, null);
    if (app.diffSource !== "local") return;
    diff.showFile(path, pair.right);
  } catch (e) {
    diff.message(String(e).replace(/^Error: /, ""));
  }
}

filesPanel.onOpen = (path) => void openFile(path);
filesPanel.onActivate = (path) => void openInEditor(path);
filesPanel.onMenu = (path, e) => {
  const change = localChange(path);
  showMenu(e.clientX, e.clientY, [
    { label: "Open in Editor", action: () => void openInEditor(path) },
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
