// The Submodules section of the Changes tab.

import { api, type Submodule } from "./api";
import { showMenu } from "./context-menu";
import { copyText, formatDate } from "./dom";
import { toast } from "./notify";
import { checkoutSubmoduleBranch, updateSubmodules } from "./operations";
import { jumpToOid, openRepo } from "./repo";
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
submodulePanel.onOpenCommit = (s, oid) => void openCommit(s, oid);
submodulePanel.onUpdate = (paths) => void updateSubmodules(paths);
/** The menu of the branches of a submodule: local branches first, then remote branches. "recorded" marks
 * a branch at the commit that the parent repository records. */
async function branchMenu(s: Submodule, e: MouseEvent) {
  const anchor = (e.currentTarget as HTMLElement).getBoundingClientRect();
  let branches;
  try {
    branches = await api.submoduleBranches(s.path);
  } catch (err) {
    toast(String(err).replace(/^Error: /, ""), "error");
    return;
  }
  const item = (b: (typeof branches)[number]) => ({
    label: b.name,
    checked: b.current,
    shortcut: b.atRecorded ? "recorded" : "",
    detail: `Last commit ${formatDate(b.time)}`,
    disabled: b.current,
    action: () => void checkoutSubmoduleBranch(s.path, b.name, b.remote),
  });
  const local = branches.filter((b) => !b.remote);
  const remote = branches.filter((b) => b.remote);
  showMenu(anchor.left, anchor.bottom, [
    { header: "Local Branches" },
    ...(local.length ? local.map(item) : [{ label: "No local branch", disabled: true, action: () => {} }]),
    ...(remote.length ? [{ header: "Remote Branches" }, ...remote.map(item)] : []),
  ]);
}

submodulePanel.onBranchMenu = (s, e) => void branchMenu(s, e);
submodulePanel.onMenu = (s, e) =>
  showMenu(e.clientX, e.clientY, [
    { label: "Open as Repository", disabled: s.state === "uninitialized", action: () => void openRepo(submodulePath(s)) },
    { label: s.state === "uninitialized" ? "Initialize and Update" : "Update to the Recorded Commit", action: () => void updateSubmodules([s.path]) },
    { separator: true },
    { label: "Copy Path", action: () => void copyText(s.path) },
    { label: "Copy URL", disabled: !s.url, action: () => s.url && void copyText(s.url) },
  ]);
