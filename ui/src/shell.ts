// The components of the window, the layout, the theme and the status bar.

import { pathLabels } from "./path-labels";
import { ApiError, errorHint } from "./api";
import { ChangesPanel } from "./changes-panel";
import { CommitPanel } from "./commit-panel";
import { menuBelow } from "./context-menu";
import { DetailsPanel } from "./details-panel";
import { DiffView, setMonacoTheme } from "./diff-view";
import { dragResize, h, icon } from "./dom";
import { FilterBar } from "./filter-bar";
import { LogView } from "./log-view";
import { toast } from "./notify";
import { OpBanner } from "./op-banner";
import { save, settings } from "./settings";
import { Sidebar } from "./sidebar";
import { FilesPanel } from "./files-panel";
import { ReviewPanel } from "./review-panel";
import { StashPanel } from "./stash-panel";
import { SubmodulePanel } from "./submodule-panel";
import { app } from "./state";

export const mod = navigator.platform.includes("Mac") ? "⌘" : "Ctrl+";

export const log = new LogView();
export const sidebar = new Sidebar();
sidebar.setGroupByPrefix(settings.groupBranchesByPrefix);
export const filterBar = new FilterBar();
export const changes = new ChangesPanel();
export const details = new DetailsPanel();
export const diff = new DiffView();
export const commitPanel = new CommitPanel();
export const stashPanel = new StashPanel();
export const reviewPanel = new ReviewPanel();
export const filesPanel = new FilesPanel();
export const submodulePanel = new SubmodulePanel();

export const banner = new OpBanner();
export const authors = new Set<string>();

export const openBtn = h("button", { class: "tb-button", title: `Open a repository (${mod}O)` }, icon("open"), "Open", icon("chevron-down", "icon-caret"));
export const refreshBtn = h("button", { class: "tb-button", title: `Reload commits and branches (${mod}R)`, disabled: true }, icon("refresh"), "Refresh");
/** The menu part of the Update button: Fetch of all remotes or of one remote. */
export const fetchBtn = h("button", { class: "tb-button tb-split-menu", title: "Fetch all remotes, or one remote", "aria-label": "Fetch", disabled: true }, icon("chevron-down", "icon-caret"));
export const updateBtn = h("button", { class: "tb-button", title: `Update the current branch: fetch, then fast-forward. A branch with commits of its own asks for Merge or Rebase (${mod}T)`, disabled: true }, icon("update"), "Update");
export const pushBtn = h("button", { class: "tb-button", title: `Push the current branch (${mod}⇧K)`, disabled: true }, icon("push"), "Push");
export const remoteBtn = h("button", { class: "tb-button tb-icon tb-remote", title: "Open the current branch on the web page of its remote", "aria-label": "Remote", disabled: true }, icon("remote"));
export const localHistoryBtn = h("button", { class: "tb-button", title: "Local History: the recent versions of changed files", disabled: true }, icon("history"), "Local History");
export const ideBtn = h("button", { class: "tb-button tb-icon tb-ide", title: "Open the repository in the editor of Settings › Editor", "aria-label": "IDE", disabled: true }, icon("ide"));
export const terminalBtn = h("button", { class: "tb-button tb-icon tb-terminal", title: "Open a terminal in the folder of the repository", "aria-label": "Terminal", disabled: true }, icon("terminal"));
const repoLabel = h("span", { class: "tb-repo" });
export const branchBtn = h("button", { class: "tb-button tb-branch-button", title: "Switch branch (recent branches first)", hidden: true }, icon("branch"), icon("chevron-down", "icon-caret"));
export const viewBtn = h("button", { class: "tb-button", title: "View options" }, "View", icon("chevron-down", "icon-caret"));
const themeBtn = h("button", { class: "tb-button tb-icon", title: "Theme" }, icon("theme"));
export const settingsBtn = h("button", { class: "tb-button tb-icon", title: "Settings" }, icon("settings"));
export const toolbar = h("header", { class: "toolbar" }, openBtn, refreshBtn, h("span", { class: "tb-split" }, updateBtn, fetchBtn), pushBtn, localHistoryBtn, repoLabel, branchBtn, h("span", { class: "spacer" }), remoteBtn, ideBtn, terminalBtn, viewBtn, themeBtn, settingsBtn);

export const tabBar = h("nav", { class: "tabbar", hidden: true });
/** The tabs, in a part of the tab bar that scrolls without a scroll bar. The + button stays outside it. */
export const tabScroll = h("div", { class: "tabbar-scroll" });

/** On macOS the app draws under a transparent title bar. The tabs then take the free space at the right
 * of the window buttons, and the empty part of the tab bar moves the window. `?titlebar=mac` shows the
 * same layout in a browser, for the tests. */
export const tabsInTitleBar =
  new URLSearchParams(location.search).get("titlebar") === "mac" || ("__TAURI_INTERNALS__" in window && /Mac/.test(navigator.userAgent));
if (tabsInTitleBar) {
  document.documentElement.classList.add("titlebar-tabs");
  tabBar.setAttribute("data-tauri-drag-region", "");
}

const statusLeft = h("span", { class: "sb-left" });
const statusMid = h("span", { class: "sb-mid" });
/** The running or the last operation. It is at the left end, where the eye looks first. */
export const statusActivity = h("span", { class: "sb-activity" });
export const statusBar = h("footer", { class: "statusbar" }, statusActivity, statusLeft, statusMid);

const sideGrip = h("div", { class: "vgrip" });
const rightGrip = h("div", { class: "vgrip" });
const diffGrip = h("div", { class: "hgrip-row" });
const detailsGrip = h("div", { class: "hgrip-row" });
const center = h("section", { class: "center" }, banner.el, filterBar.el, log.el);
const right = h("section", { class: "right" }, changes.el, detailsGrip, details.el);
export const tabBranches = h("button", { class: "lp-tab", title: `Branches (${mod}1)` }, "Branches");
export const tabCommit = h("button", { class: "lp-tab", title: `Local changes and commit (${mod}2)` }, "Changes");
export const tabStash = h("button", { class: "lp-tab", title: `Stashes (${mod}3)` }, "Stash");
export const tabReviews = h("button", { class: "lp-tab", title: `Reviews (${mod}4)` }, "Reviews");
export const tabFiles = h("button", { class: "lp-tab", title: `The files of the working tree (${mod}6)` }, "Files");
// The submodules show under the commit message, so that their changes show together with the files.
commitPanel.el.append(submodulePanel.el);
const leftPane = h("aside", { class: "leftpane" }, h("div", { class: "lp-tabs" }, tabBranches, tabCommit, tabStash, tabReviews, tabFiles), sidebar.el, commitPanel.el, stashPanel.el, reviewPanel.el, filesPanel.el);
/** Called when the Files tab shows, so that it can load its files. */
export const leftTabHooks = { files: () => {} };
export function showLeftTab(tab: "branches" | "commit" | "stash" | "reviews" | "files") {
  settings.leftTab = tab;
  save();
  if (!settings.showSidebar) {
    settings.showSidebar = true;
    applyLayout();
  }
  tabBranches.classList.toggle("on", tab === "branches");
  tabCommit.classList.toggle("on", tab === "commit");
  tabStash.classList.toggle("on", tab === "stash");
  sidebar.el.hidden = tab !== "branches";
  commitPanel.el.hidden = tab !== "commit";
  stashPanel.el.hidden = tab !== "stash";
  tabReviews.classList.toggle("on", tab === "reviews");
  reviewPanel.el.hidden = tab !== "reviews";
  tabFiles.classList.toggle("on", tab === "files");
  filesPanel.el.hidden = tab !== "files";
  if (tab === "files") leftTabHooks.files();
}
tabBranches.addEventListener("click", () => showLeftTab("branches"));
tabCommit.addEventListener("click", () => showLeftTab("commit"));
tabStash.addEventListener("click", () => showLeftTab("stash"));
tabReviews.addEventListener("click", () => showLeftTab("reviews"));
tabFiles.addEventListener("click", () => showLeftTab("files"));
const top = h("div", { class: "top" }, leftPane, sideGrip, center, rightGrip, right);
export const workspace = h("main", { class: "workspace" }, top, diffGrip, diff.el);
export const welcome = h("main", { class: "welcome" });
const appRoot = document.getElementById("app")!;
appRoot.append(...(tabsInTitleBar ? [tabBar, toolbar] : [toolbar, tabBar]), welcome, workspace, statusBar);

export function applyLayout() {
  top.style.gridTemplateColumns = `${settings.showSidebar ? `${settings.sidebarWidth}px 4px` : "0 0"} minmax(300px, 1fr) 4px ${settings.rightWidth}px`;
  leftPane.hidden = !settings.showSidebar;
  sideGrip.hidden = !settings.showSidebar;
  workspace.style.gridTemplateRows = settings.showDiff ? `${1 - settings.diffRatio}fr 5px ${settings.diffRatio}fr` : "1fr 0 0";
  diffGrip.hidden = !settings.showDiff;
  diff.el.hidden = !settings.showDiff;
  right.style.gridTemplateRows = `${settings.detailsRatio}fr 5px ${1 - settings.detailsRatio}fr`;
}

{
  let start = 0;
  dragResize(sideGrip, "x", () => (start = settings.sidebarWidth), (d) => {
    settings.sidebarWidth = Math.max(160, Math.min(520, start + d));
    applyLayout();
  }, save);
  dragResize(rightGrip, "x", () => (start = settings.rightWidth), (d) => {
    settings.rightWidth = Math.max(240, Math.min(760, start - d));
    applyLayout();
  }, save);
  dragResize(diffGrip, "y", () => (start = settings.diffRatio), (d) => {
    settings.diffRatio = Math.max(0.12, Math.min(0.85, start - d / workspace.clientHeight));
    applyLayout();
  }, save);
  dragResize(detailsGrip, "y", () => (start = settings.detailsRatio), (d) => {
    settings.detailsRatio = Math.max(0.15, Math.min(0.85, start + d / right.clientHeight));
    applyLayout();
  }, save);
}

const darkQuery = matchMedia("(prefers-color-scheme: dark)");
export function applyTheme() {
  const dark = settings.theme === "dark" || (settings.theme === "system" && darkQuery.matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  setMonacoTheme(dark);
  log.render();
}
darkQuery.addEventListener("change", applyTheme);
themeBtn.addEventListener("click", () =>
  menuBelow(themeBtn, (["system", "light", "dark"] as const).map((t) => ({
    label: { system: "Follow system", light: "Light", dark: "Dark" }[t],
    checked: settings.theme === t,
    action: () => {
      settings.theme = t;
      save();
      applyTheme();
    },
  }))),
);

export async function task<T>(label: string, fn: () => Promise<T>): Promise<T | undefined> {
  app.busy++;
  statusActivity.textContent = label + "…";
  statusActivity.className = "sb-activity busy";
  try {
    const r = await fn();
    statusActivity.textContent = "";
    statusActivity.className = "sb-activity";
    return r;
  } catch (e) {
    const message = String(e).replace(/^Error: /, "");
    statusActivity.textContent = message;
    statusActivity.className = "sb-activity error";
    // A failure that the user must fix outside the app gets a notification with what to do.
    const hint = e instanceof ApiError ? errorHint(e.kind) : "";
    if (hint) toast(`${message}\n${hint}`, "error");
    return undefined;
  } finally {
    app.busy--;
  }
}

/** Sets a text only when it changed: the same text again makes no new node. */
function setText(el: HTMLElement, text: string) {
  if (el.textContent !== text) el.textContent = text;
}

let shownStatus = "";

/** Shows the repository, the branch and the counts. `background` is a reload after a change outside
 * the app: it leaves the activity text. The parts that did not change keep their elements. */
export function updateStatus(background = false) {
  if (!app.view) return;
  const branch = app.repoState?.rebasing
    ? `rebasing ${app.repoState.rebasing}`
    : (app.view.head?.replace("refs/heads/", "") ?? (app.view.headOid ? `detached at ${app.view.headOid.slice(0, 8)}` : "no commits"));
  // The same short name as the tab: folders with the same name show the folders above them.
  const root = app.view.root;
  const tabs = settings.tabs.includes(root) ? settings.tabs : [...settings.tabs, root];
  const label = pathLabels(tabs)[tabs.indexOf(root)] ?? root;
  const key = JSON.stringify([root, label, branch]);
  if (key !== shownStatus) {
    shownStatus = key;
    repoLabel.replaceChildren(h("b", { title: root }, label));
    branchBtn.replaceChildren(icon("branch"), branch, icon("chevron-down", "icon-caret"));
  }
  branchBtn.hidden = false;
  const changed = app.repoState?.changedFiles ?? 0;
  setText(statusLeft, app.view.root + (changed ? `  ·  ${changed} changed file${changed === 1 ? "" : "s"}` : ""));
  const commits = app.view.filtered
    ? `${app.view.rowCount.toLocaleString()} of ${app.view.totalCommits.toLocaleString()} commits match the filter`
    : `${app.view.totalCommits.toLocaleString()} commits`;
  setText(statusMid, commits + (app.view.collapsed ? ` · ${app.view.rowCount.toLocaleString()} rows shown, linear branches collapsed` : ""));
  filterBar.setInfo(app.view.filtered ? `${app.view.rowCount.toLocaleString()} of ${app.view.totalCommits.toLocaleString()}` : "");
  if (!app.busy && !background) statusActivity.textContent = `loaded in ${app.view.loadMs} ms`;
}

/** Shows or hides the diff panel. The panel comes back with the size that it had. */
export function toggleDiff(show = !settings.showDiff) {
  if (show === settings.showDiff) return;
  settings.showDiff = show;
  save();
  applyLayout();
}
diff.onHide = () => toggleDiff(false);
// A double click on a changed file of a commit shows the panel again.
document.addEventListener("dblclick", (e) => {
  if ((e.target as HTMLElement).closest(".changes-panel .change")) toggleDiff(true);
});

export function toggleSidebar() {
  settings.showSidebar = !settings.showSidebar;
  save();
  applyLayout();
}
