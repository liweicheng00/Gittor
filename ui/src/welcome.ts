// The welcome screen.

import { h, icon } from "./dom";
import { askForRepo, cloneRepo, openRepo } from "./repo";
import { learnRecentProjects, recentRows } from "./recent";
import { removeRecent } from "./settings";
import { settingsBtn, statusBar, toolbar, welcome, workspace } from "./shell";

/** Shows the workspace of a repository, or the welcome screen. The toolbar and the status bar are for a
 * repository: the welcome screen has none. */
export function showWorkspace(show: boolean) {
  workspace.hidden = !show;
  welcome.hidden = show;
  toolbar.hidden = !show;
  statusBar.hidden = !show;
  if (!show) renderWelcome();
}

function renderWelcome() {
  void learnRecentProjects().then((changed) => changed && !welcome.hidden && renderWelcome());
  const open = h("button", { class: "primary big" }, "Open Repository…");
  open.addEventListener("click", () => void askForRepo());
  const clone = h("button", { class: "big" }, "Clone Repository…");
  clone.addEventListener("click", () => void cloneRepo());
  // The toolbar does not show here: this link opens Settings, for example for the git program.
  const settingsLink = h("button", { class: "welcome-settings", "data-key-action": "settings" }, icon("settings"), "Settings…");
  settingsLink.addEventListener("click", () => settingsBtn.click());
  const recentList = h("div", { class: "recent" });
  const rows = recentRows();
  for (const r of rows) {
    const item = h(
      "div",
      { class: "recent-item" + (r.project ? " worktree" : ""), title: r.project ? `Worktree of ${r.project}\n${r.path}` : r.path },
      r.project ? icon("worktree", "recent-icon") : "",
      h("span", { class: "recent-name" }, r.name),
      h("span", { class: "recent-path" }, r.path),
    );
    const remove = h("button", { class: "icon-button", title: r.project ? "Remove from the list" : "Remove the project and its worktrees from the list" }, icon("close"));
    remove.addEventListener("click", (e) => {
      e.stopPropagation();
      removeRecent(...(r.project ? [r.path] : rows.filter((o) => o.path === r.path || o.project === r.path).map((o) => o.path)));
      renderWelcome();
    });
    item.append(remove);
    item.addEventListener("click", () => void openRepo(r.path));
    recentList.append(item);
  }
  welcome.replaceChildren(
    h(
      "div",
      { class: "welcome-card" },
      h("div", { class: "welcome-logo" }, h("span", { class: "dot a" }), h("span", { class: "dot b" }), h("span", { class: "dot c" })),
      h("h1", {}, "Gittor"),
      h("p", { class: "muted-inline" }, "A light git log viewer with the commit graph of IntelliJ."),
      h("div", { class: "welcome-actions" }, open, clone),
      settingsLink,
      rows.length ? h("div", { class: "recent-title" }, "Recent repositories") : "",
      recentList,
    ),
  );
}
