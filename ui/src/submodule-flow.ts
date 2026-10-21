// The Submodules tab.

import { api, type Submodule } from "./api";
import { showMenu } from "./context-menu";
import { copyText } from "./dom";
import { updateSubmodules } from "./operations";
import { jumpToOid, loadSubmodules, openInNewWindow, openRepo } from "./repo";
import { submodulePanel } from "./shell";
import { app } from "./state";

const submodulePath = (s: Submodule) => `${app.view?.root ?? ""}/${s.path}`;

let request = 0;

async function showRange(s: Submodule) {
  const req = ++request;
  if (s.state === "uninitialized" || (s.state === "clean" && !s.dirty && !s.untracked)) {
    submodulePanel.setRange(null);
    return;
  }
  try {
    const r = await api.submoduleRange(s.path);
    if (req === request) submodulePanel.setRange(r);
  } catch (e) {
    if (req === request) submodulePanel.setDetailMessage(String(e).replace(/^Error: /, ""));
  }
}

/** Opens the submodule in its tab, and shows the commit there. */
async function openCommit(s: Submodule, oid: string) {
  await openRepo(submodulePath(s));
  if (app.view?.root.endsWith(s.path)) await jumpToOid(oid, true);
}

submodulePanel.onSelect = (s) => void showRange(s);
submodulePanel.onOpen = (s) => void openRepo(submodulePath(s));
submodulePanel.onOpenWindow = (s) => openInNewWindow(submodulePath(s));
submodulePanel.onOpenCommit = (s, oid) => void openCommit(s, oid);
submodulePanel.onUpdate = (paths) => void updateSubmodules(paths);
submodulePanel.onRefresh = () => void loadSubmodules();
submodulePanel.onMenu = (s, e) =>
  showMenu(e.clientX, e.clientY, [
    { label: "Open as Repository", disabled: s.state === "uninitialized", action: () => void openRepo(submodulePath(s)) },
    { label: "Open in New Window", disabled: s.state === "uninitialized", action: () => openInNewWindow(submodulePath(s)) },
    { label: s.state === "uninitialized" ? "Initialize and Update" : "Update to the Recorded Commit", action: () => void updateSubmodules([s.path]) },
    { separator: true },
    { label: "Copy Path", action: () => void copyText(s.path) },
    { label: "Copy URL", disabled: !s.url, action: () => s.url && void copyText(s.url) },
  ]);
