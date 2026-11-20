// The components of the window, the layout, the theme and the status bar.

import { pathLabels } from "./path-labels";
import { ApiError, errorHint, inTauri } from "./api";
import { ChangesPanel } from "./changes-panel";
import { CommitPanel } from "./commit-panel";
import { menuBelow } from "./context-menu";
import { DetailsPanel } from "./details-panel";
import { DiffView, setMonacoTheme } from "./diff-view";
import { layoutModeFor, topGrid, type LayoutMode } from "./layout-mode";
import { GLOW_MONACO } from "./glow-monaco";
import { dragResize, h, icon } from "./dom";
import type { IconName } from "./icons";
import { FilterBar } from "./filter-bar";
import { LogView } from "./log-view";
import { toast } from "./notify";
import { OpBanner } from "./op-banner";
import { save, settings } from "./settings";
import { Sidebar } from "./sidebar";
import { FilesPanel } from "./files-panel";
import { WorktreePanel } from "./worktree-panel";
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
export const worktreePanel = new WorktreePanel();
export const submodulePanel = new SubmodulePanel();

export const banner = new OpBanner();
export const authors = new Set<string>();

// Open and Refresh show their icon only; the name is in the tooltip, and out of view for screen readers.
export const openBtn = h("button", { class: "tb-button tb-icon-only", title: "Open", "aria-label": "Open" }, icon("open"), h("span", { class: "sr-label" }, "Open"), icon("chevron-down", "icon-caret"));
export const refreshBtn = h("button", { class: "tb-button tb-icon-only", title: "Refresh", "aria-label": "Refresh", disabled: true }, icon("refresh"), h("span", { class: "sr-label" }, "Refresh"));
/** The menu part of the Update button: Fetch of all remotes or of one remote. */
export const fetchBtn = h("button", { class: "tb-button tb-split-menu", title: "Fetch", "aria-label": "Fetch", disabled: true }, icon("chevron-down", "icon-caret"));
export const updateBtn = h("button", { class: "tb-button", title: "Update the Current Branch", disabled: true }, icon("update"), "Update");
export const pushBtn = h("button", { class: "tb-button tb-keep", title: "Push", disabled: true }, icon("push"), "Push");
export const remoteBtn = h("button", { class: "tb-button tb-icon tb-remote", title: "Open on the Remote", "aria-label": "Remote", disabled: true }, icon("remote"));
export const localHistoryBtn = h("button", { class: "tb-button", title: "Local History", disabled: true }, icon("history"), "Local History");
export const ideBtn = h("button", { class: "tb-button tb-icon tb-ide", title: "Open in IDE", "aria-label": "IDE", disabled: true }, icon("ide"));
export const terminalBtn = h("button", { class: "tb-button tb-icon tb-terminal", title: "Open in Terminal", "aria-label": "Terminal", disabled: true }, icon("terminal"));
/** The name of the repository. It hides while the tab bar shows, because the tab names it. */
export const repoLabel = h("span", { class: "tb-repo" });
export const branchBtn = h("button", { class: "tb-button tb-branch-button tb-keep", title: "Switch Branch", hidden: true }, icon("branch"), icon("chevron-down", "icon-caret"));
export const viewBtn = h("button", { class: "tb-button", title: "View" }, "View", icon("chevron-down", "icon-caret"));
const themeBtn = h("button", { class: "tb-button tb-icon", title: "Theme" }, icon("theme"));
export const settingsBtn = h("button", { class: "tb-button tb-icon", title: "Settings" }, icon("settings"));
/** The narrow layout: the button that shows the other buttons of the toolbar in a second row. */
export const moreBtn = h("button", { class: "tb-button tb-icon tb-more tb-keep", title: "More", "aria-label": "More", "aria-expanded": "false" }, icon("more"));
export const toolbar = h("header", { class: "toolbar" }, openBtn, refreshBtn, h("span", { class: "tb-split tb-keep" }, updateBtn, fetchBtn), pushBtn, localHistoryBtn, repoLabel, branchBtn, h("span", { class: "spacer" }), remoteBtn, ideBtn, terminalBtn, viewBtn, themeBtn, settingsBtn, moreBtn);

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
/** The grip above the commit details under the log (medium and narrow layouts). */
const logGrip = h("div", { class: "hgrip-row log-grip" });
/** The tabs of the center panel: Log and the files that the Files tab opened. They hide without a file. */
export const centerTabs = h("div", { class: "center-tabs", role: "tablist", hidden: true });
/** The place of the open file, in place of the log. */
export const fileHost = h("div", { class: "file-host", hidden: true });
/** Called when another repository shows: its files are not open. */
export const centerHooks = {
  reset: () => {},
  /** Closes the active file of the center panel, or the last file while the log shows. False without a file. */
  closeFile: (): boolean => false,
};
const center = h("section", { class: "center" }, centerTabs, banner.el, filterBar.el, log.el, fileHost);
const right = h("section", { class: "right" }, changes.el, detailsGrip, details.el);
/** A left tab: an icon, and a tooltip with its name. The name also stays in the tab for screen readers, out
 * of view. The tooltip gets the key of the tab on hover (key-hint-flow.ts). */
const lpTab = (name: IconName, label: string, title: string) =>
  h("button", { class: "lp-tab", title, "aria-label": label }, icon(name, "lp-icon"), h("span", { class: "sr-label" }, label));
export const tabBranches = lpTab("branch", "Branches", "Branches");
export const tabCommit = lpTab("changes", "Changes", "Changes");
export const tabStash = lpTab("stash", "Stash", "Stash");
export const tabReviews = lpTab("review", "Reviews", "Reviews");
export const tabFiles = lpTab("folder", "Files", "Files");
export const tabWorktrees = lpTab("worktree", "Worktrees", "Worktrees");
/** The narrow layout only: the log, with the details of the selected commit under it. */
export const tabLog = lpTab("log", "Log", "Log");
tabLog.classList.add("lp-tab-log");
// The submodules show under the commit message, so that their changes show together with the files.
commitPanel.el.append(submodulePanel.el);
/** The left tabs. The narrow layout moves them above the workspace, so they also show with the Log tab. */
// The Log tab is last in the DOM, so the other tabs keep their order; the CSS shows it first.
const lpTabs = h("div", { class: "lp-tabs" }, tabFiles, tabBranches, tabCommit, tabWorktrees, tabStash, tabReviews, tabLog);
const leftPane = h("aside", { class: "leftpane" }, lpTabs, sidebar.el, commitPanel.el, stashPanel.el, reviewPanel.el, filesPanel.el, worktreePanel.el);
/** Called when the Files tab shows, so that it can load its files. */
export const leftTabHooks = { files: () => {} };
/** Shows a left tab. With `reveal`, a hidden left pane shows again; the start of the app does not reveal it,
 * so View › Left Panel stays off after a reload. */
export function showLeftTab(tab: "branches" | "commit" | "stash" | "reviews" | "files" | "worktrees", reveal = true) {
  settings.leftTab = tab;
  save();
  const wasLog = layout.logTab;
  layout.logTab = false;
  tabLog.classList.remove("on");
  if (reveal && !settings.showSidebar) {
    settings.showSidebar = true;
    applyLayout();
  } else if (wasLog) applyLayout();
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
  tabWorktrees.classList.toggle("on", tab === "worktrees");
  worktreePanel.el.hidden = tab !== "worktrees";
  if (tab === "files") leftTabHooks.files();
}
/** The narrow layout: shows the Log tab. In the other layouts the log always shows. */
export function showLogTab() {
  layout.logTab = true;
  for (const t of [tabFiles, tabBranches, tabCommit, tabWorktrees, tabStash, tabReviews]) t.classList.remove("on");
  tabLog.classList.add("on");
  applyLayout();
}
tabLog.addEventListener("click", showLogTab);
tabBranches.addEventListener("click", () => showLeftTab("branches"));
tabCommit.addEventListener("click", () => showLeftTab("commit"));
tabStash.addEventListener("click", () => showLeftTab("stash"));
tabReviews.addEventListener("click", () => showLeftTab("reviews"));
tabFiles.addEventListener("click", () => showLeftTab("files"));
tabWorktrees.addEventListener("click", () => showLeftTab("worktrees"));
const top = h("div", { class: "top" }, leftPane, sideGrip, center, rightGrip, right, logGrip);
export const workspace = h("main", { class: "workspace" }, top, diffGrip, diff.el);
export const welcome = h("main", { class: "welcome" });
const appRoot = document.getElementById("app")!;
appRoot.append(...(tabsInTitleBar ? [tabBar, toolbar] : [toolbar, tabBar]), welcome, workspace, statusBar);

/** The width of the window in CSS pixels. In a browser the zoom of the app is a CSS zoom of the page. */
const pageWidth = () => (inTauri ? window.innerWidth : window.innerWidth / (settings.zoom || 1));

/** The layout mode for the width of the window, and the state of the narrow layout. */
export const layout: { mode: LayoutMode; logTab: boolean; diffPage: boolean } = { mode: layoutModeFor(pageWidth()), logTab: false, diffPage: false };
/** Called after the layout mode changes. */
export const layoutHooks: Array<(mode: LayoutMode) => void> = [];

export function applyLayout() {
  const mode = layout.mode;
  const narrow = mode === "narrow";
  document.documentElement.dataset.layout = mode;
  const g = topGrid({
    mode,
    showSidebar: settings.showSidebar,
    sidebarWidth: settings.sidebarWidth,
    rightWidth: settings.rightWidth,
    detailsHeight: settings.logDetailsHeight,
    logTab: layout.logTab,
  });
  top.style.gridTemplateColumns = g.columns;
  top.style.gridTemplateRows = g.rows;
  const parts: Array<[HTMLElement, keyof typeof g.places]> = [[leftPane, "left"], [sideGrip, "sideGrip"], [center, "center"], [rightGrip, "rightGrip"], [right, "right"], [logGrip, "detailsGrip"]];
  for (const [el, key] of parts) {
    const place = g.places[key];
    el.hidden = !place;
    el.style.gridColumn = place?.[0] ?? "";
    el.style.gridRow = place?.[1] ?? "";
  }
  // The right column holds the changed files and the details; the smaller layouts show the details only.
  right.style.gridTemplateRows = mode === "wide" ? `${settings.detailsRatio}fr 5px ${1 - settings.detailsRatio}fr` : "minmax(0, 1fr)";
  tabLog.hidden = !narrow;
  if (narrow && lpTabs.parentElement === leftPane) workspace.before(lpTabs);
  if (!narrow && lpTabs.parentElement !== leftPane) leftPane.prepend(lpTabs);
  // The diff page has its own Back button; the tabs hide under it.
  lpTabs.hidden = narrow && layout.diffPage;
  tabFiles.hidden = narrow;
  // The diff: a panel under the top part, or in the narrow layout a page in place of the top part.
  const diffShows = narrow ? layout.diffPage : settings.showDiff;
  top.hidden = narrow && layout.diffPage;
  workspace.style.gridTemplateRows = narrow ? (layout.diffPage ? "0 0 minmax(0, 1fr)" : "minmax(0, 1fr) 0 0") : settings.showDiff ? `${1 - settings.diffRatio}fr 5px ${settings.diffRatio}fr` : "1fr 0 0";
  diffGrip.hidden = narrow || !settings.showDiff;
  diff.el.hidden = !diffShows;
  diff.setInlineOnly(narrow);
}

/** Shows the layout for the new width of the window, when its mode changes. */
function followWidth() {
  const mode = layoutModeFor(pageWidth());
  if (mode === layout.mode) return;
  layout.mode = mode;
  layout.diffPage = false;
  closeMoreRow();
  // The narrow layout has no Files tab.
  if (mode === "narrow" && settings.leftTab === "files") showLeftTab("commit", false);
  applyLayout();
  for (const f of layoutHooks) f(mode);
}
window.addEventListener("resize", followWidth);

/** The narrow layout: the other buttons of the toolbar show in a second row while it is open. */
function closeMoreRow() {
  toolbar.classList.remove("more-open");
  moreBtn.setAttribute("aria-expanded", "false");
}
moreBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  const open = toolbar.classList.toggle("more-open");
  moreBtn.setAttribute("aria-expanded", String(open));
});
// A click on a button of the row, or outside the toolbar, closes the row.
document.addEventListener("click", (e) => {
  if (!toolbar.classList.contains("more-open")) return;
  const t = e.target as HTMLElement;
  if (t.closest(".toolbar") && !t.closest("button")) return;
  closeMoreRow();
});

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
  dragResize(logGrip, "y", () => (start = settings.logDetailsHeight), (d) => {
    settings.logDetailsHeight = Math.max(80, Math.min(top.clientHeight - 120, start - d));
    applyLayout();
  }, save);
  dragResize(detailsGrip, "y", () => (start = settings.detailsRatio), (d) => {
    settings.detailsRatio = Math.max(0.15, Math.min(0.85, start + d / right.clientHeight));
    applyLayout();
  }, save);
}

const darkQuery = matchMedia("(prefers-color-scheme: dark)");
/** A glow theme (Plasma, Ember) is a skin on Dark: `data-theme="dark"`, `data-style="glow"` and
 * `data-glow="<name>"`. The other themes have no `data-style` and no `data-glow`. */
export function applyTheme() {
  const t = settings.theme;
  const glow = t === "plasma" || t === "ember" ? t : undefined;
  const dark = glow !== undefined || t === "dark" || (t === "system" && darkQuery.matches);
  const root = document.documentElement;
  root.dataset.theme = dark ? "dark" : "light";
  if (glow) {
    root.dataset.style = "glow";
    root.dataset.glow = glow;
  } else {
    delete root.dataset.style;
    delete root.dataset.glow;
  }
  setMonacoTheme(glow ? GLOW_MONACO[glow] : dark ? "vs-dark" : "vs");
  log.render();
}
darkQuery.addEventListener("change", applyTheme);
themeBtn.addEventListener("click", () =>
  menuBelow(themeBtn, (["system", "light", "dark", "plasma", "ember"] as const).map((t) => ({
    label: { system: "Follow system", light: "Light", dark: "Dark", plasma: "Plasma", ember: "Ember" }[t],
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
export function toggleDiff(show = !diffShown()) {
  // The narrow layout shows the diff as a page over the tabs. The setting of the panel stays.
  if (layout.mode === "narrow") {
    if (show === layout.diffPage) return;
    layout.diffPage = show;
    applyLayout();
    return;
  }
  if (show === settings.showDiff) return;
  settings.showDiff = show;
  save();
  applyLayout();
}
/** True when the diff shows: the panel, or the page of the narrow layout. */
export function diffShown(): boolean {
  return layout.mode === "narrow" ? layout.diffPage : settings.showDiff;
}
diff.onHide = () => toggleDiff(false);
// In the narrow layout, a click on a local change opens the diff page. A click on its check box does not.
document.addEventListener("click", (e) => {
  if (layout.mode !== "narrow") return;
  const t = e.target as HTMLElement;
  if (t.closest(".leftpane .cl-file") && !t.closest("input, button")) toggleDiff(true);
});
// A double click on a changed file of a commit shows the panel again.
document.addEventListener("dblclick", (e) => {
  if ((e.target as HTMLElement).closest(".changes-panel .change")) toggleDiff(true);
});

export function toggleSidebar() {
  settings.showSidebar = !settings.showSidebar;
  save();
  applyLayout();
}
