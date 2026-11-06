// The Submodules section under the changelists of the Changes tab: the submodules of the repository and,
// for the selected one, the commits between the recorded commit and the checked-out commit.

import type { OutgoingCommit, Submodule, SubmoduleRange } from "./api";
import { formatDate, h, icon } from "./dom";
import { twisty } from "./icons";
import { save, settings } from "./settings";

/** The submodule is not at the recorded commit, or has local changes. */
export const needsAttention = (s: Submodule) => s.state !== "clean" || s.dirty || s.untracked;

const STATE_TEXT: Record<Submodule["state"], string> = {
  uninitialized: "not initialized",
  clean: "",
  otherCommit: "other commit",
  conflict: "conflict",
};

export class SubmodulePanel {
  readonly el: HTMLElement;
  private list: HTMLElement;
  private detail: HTMLElement;
  private title: HTMLElement;
  private twist: HTMLElement;
  private stats: HTMLElement;
  private subs: Submodule[] = [];
  private selected: string | null = null;
  private range: SubmoduleRange | null = null;
  onSelect: (s: Submodule) => void = () => {};
  onMenu: (s: Submodule, e: MouseEvent) => void = () => {};
  onOpen: (s: Submodule) => void = () => {};
  onOpenCommit: (s: Submodule, oid: string) => void = () => {};
  /** A click on the branch of a row: the menu of the branches of the submodule. */
  onBranchMenu: (s: Submodule, e: MouseEvent) => void = () => {};
  onUpdate: (paths: string[]) => void = () => {};
  onRefresh: () => void = () => {};

  constructor() {
    const refresh = h("button", { class: "icon-button", title: "Refresh the submodules" }, icon("refresh"));
    refresh.addEventListener("click", () => this.onRefresh());
    const updateAll = h("button", { class: "tb-button", title: "Initialize all submodules and check out their recorded commits" }, "Update All");
    updateAll.addEventListener("click", () => this.onUpdate([]));
    this.title = h("span", { class: "sm-title" }, "Submodules");
    const head = h("div", { class: "sm-head", title: "Show or hide the submodules" }, (this.twist = twisty(!settings.submodulesCollapsed)), this.title, h("span", { class: "spacer" }), refresh, updateAll);
    head.addEventListener("click", (e) => {
      if ((e.target as HTMLElement).closest("button")) return;
      this.setCollapsed(!settings.submodulesCollapsed);
    });
    this.list = h("div", { class: "sm-list", tabIndex: 0 });
    this.list.addEventListener("keydown", (e) => {
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      e.preventDefault();
      if (!this.subs.length) return;
      const i = this.subs.findIndex((s) => s.path === this.selected);
      this.select(this.subs[Math.max(0, Math.min(this.subs.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)))]);
    });
    this.detail = h("div", { class: "sm-detail" });
    this.stats = h("div", { class: "sm-stats" });
    this.el = h("section", { class: "submodule-panel", hidden: true }, head, h("div", { class: "sm-body" }, this.stats, this.list, this.detail));
    this.el.classList.toggle("collapsed", settings.submodulesCollapsed);
    this.render();
  }

  /** Shows or hides the list. The setting keeps the choice. */
  setCollapsed(collapsed: boolean) {
    settings.submodulesCollapsed = collapsed;
    save();
    this.el.classList.toggle("collapsed", collapsed);
    this.twist.classList.toggle("open", !collapsed);
  }

  /** Opens the section and puts the keyboard focus on the list. */
  focus() {
    this.setCollapsed(false);
    this.list.focus();
  }

  get count() {
    return this.subs.length;
  }

  /** The submodules that need attention: the count on the tab. */
  get attention() {
    return this.subs.filter(needsAttention).length;
  }

  get selectedSubmodule(): Submodule | undefined {
    return this.subs.find((s) => s.path === this.selected);
  }

  /** Sets the list. The selection stays when its submodule is still there. */
  set(subs: Submodule[]) {
    // No new elements when nothing changed: a new row under the mouse loses the click.
    if (JSON.stringify(subs) === JSON.stringify(this.subs)) return;
    this.subs = subs;
    this.el.hidden = !subs.length;
    const n = this.attention;
    this.title.replaceChildren("Submodules", h("span", { class: "sm-count" + (n ? " attention" : ""), title: n ? `${n} need attention` : "" }, String(n || subs.length)));
    this.stats.replaceChildren(...statistics(subs));
    if (!subs.some((s) => s.path === this.selected)) {
      this.selected = null;
      this.range = null;
    }
    this.render();
  }

  setRange(range: SubmoduleRange | null) {
    if (JSON.stringify(range) === JSON.stringify(this.range)) return;
    this.range = range;
    this.renderDetail();
  }

  setDetailMessage(text: string) {
    this.range = null;
    this.detail.replaceChildren(h("div", { class: "muted commit-empty" }, text));
  }

  private select(s: Submodule) {
    if (this.selected !== s.path) this.range = null;
    this.selected = s.path;
    this.render();
    this.list.querySelector(".sm-row.selected")?.scrollIntoView({ block: "nearest" });
    this.onSelect(s);
  }

  private render() {
    this.list.replaceChildren(
      ...this.subs.map((s) => {
        const commit = (s.current ?? s.recorded).slice(0, 8);
        const badges = [STATE_TEXT[s.state], s.dirty || s.untracked ? "uncommitted" : ""].filter(Boolean);
        const tools = h("span", { class: "sm-tools" });
        if (s.state !== "uninitialized") {
          const branch = h(
            "button",
            { class: "sm-branch" + (s.branch ? "" : " sm-detached"), title: "Check out another branch in the submodule" },
            icon("branch"),
            h("span", { class: "sm-branch-name" }, s.branch ?? "detached"),
            icon("chevron-down"),
          );
          branch.addEventListener("mousedown", (e) => e.stopPropagation());
          branch.addEventListener("click", (e) => {
            e.stopPropagation();
            this.onBranchMenu(s, e);
          });
          const open = h("button", { class: "icon-button sm-open", title: "Open as Repository" }, icon("open"));
          open.addEventListener("mousedown", (e) => e.stopPropagation());
          open.addEventListener("click", (e) => {
            e.stopPropagation();
            this.onOpen(s);
          });
          tools.append(branch, open);
        }
        const row = h(
          "div",
          {
            class: "sm-row" + (s.path === this.selected ? " selected" : ""),
            title: `${s.path}\nrecorded ${s.recorded}${s.current ? `\nchecked out ${s.current}` : ""}${s.url ? `\n${s.url}` : ""}`,
          },
          h("div", { class: "sm-name" }, h("span", { class: "branch-icon" }, icon("submodule")), h("span", { class: "sm-path" }, s.path), tools),
          h("div", { class: "sm-meta" }, h("code", {}, commit), ...badges.map((b) => h("span", { class: "sm-badge" }, b))),
        );
        row.addEventListener("mousedown", (e) => e.button === 0 && this.select(s));
        row.addEventListener("dblclick", () => s.state !== "uninitialized" && this.onOpen(s));
        row.addEventListener("contextmenu", (e) => {
          e.preventDefault();
          if (this.selected !== s.path) this.select(s);
          this.onMenu(s, e);
        });
        return row;
      }),
    );
    this.renderDetail();
  }

  private renderDetail() {
    const s = this.selectedSubmodule;
    this.detail.hidden = !s;
    if (!s) {
      this.detail.replaceChildren();
      return;
    }
    const parts: (HTMLElement | string)[] = [];
    const button = (label: string, title: string, run: () => void) => {
      const b = h("button", { class: "tb-button", title }, label);
      b.addEventListener("click", run);
      return b;
    };
    const actions = h("div", { class: "sm-actions" });
    if (s.state === "uninitialized") {
      parts.push(h("span", { class: "sm-summary" }, "Not initialized."));
      actions.append(button("Initialize and Update", "Clone the submodule and check out the recorded commit", () => this.onUpdate([s.path])));
    } else {
      const r = this.range?.path === s.path ? this.range : null;
      parts.push(h("span", { class: "sm-summary", title: `Recorded commit ${s.recorded}` }, summary(s, r)));
      // Not when the submodule has commits of its own: on a detached HEAD, an update would leave them behind.
      if ((s.state === "otherCommit" && r && !r.ahead.length) || r?.recordedMissing) {
        actions.append(button("Update to Recorded", "Check out the commit that the parent repository records", () => this.onUpdate([s.path])));
      }
      if (r) {
        if (r.changes.length) {
          const untracked = r.changes.filter((c) => c.status === "?").length;
          const files = `${r.changes.length} uncommitted file${r.changes.length === 1 ? "" : "s"}${untracked ? ` (${untracked} unversioned)` : ""}`;
          parts.push(h("div", { class: "sm-changes", title: r.changes.map((c) => `${c.status} ${c.path}`).join("\n") }, files));
        }
        if (r.behind.length) parts.push(this.commits(s, `Only in the recorded commit (${count(r.behind)})`, r.behind));
        if (r.ahead.length) parts.push(this.commits(s, `Only in the checked-out commit (${count(r.ahead)})`, r.ahead));
      }
    }
    this.detail.replaceChildren(h("div", { class: "sm-detail-line" }, ...parts.splice(0, 1), actions), ...parts);
  }

  private commits(s: Submodule, title: string, commits: OutgoingCommit[]) {
    return h(
      "div",
      { class: "sm-section" },
      h("div", { class: "sm-section-title" }, title),
      ...commits.slice(0, MAX_COMMITS).map((c) => {
        const row = h(
          "div",
          { class: "sm-commit", title: `${c.oid}\n${c.author}, ${formatDate(c.time)}\nDouble-click to show the commit in the submodule` },
          h("code", {}, c.oid.slice(0, 8)),
          h("span", { class: "sm-subject" }, c.subject),
          h("span", { class: "sm-author" }, c.author),
        );
        row.addEventListener("dblclick", () => this.onOpenCommit(s, c.oid));
        return row;
      }),
      commits.length > MAX_COMMITS ? h("div", { class: "sm-more muted" }, `${commits.length - MAX_COMMITS} more: open the submodule to see them`) : "",
    );
  }
}

/** The detail lists only the newest commits. */
const MAX_COMMITS = 5;

/** The counts of the states of the submodules, for the line under the header. */
function statistics(subs: Submodule[]): HTMLElement[] {
  const n = (f: (s: Submodule) => boolean) => subs.filter(f).length;
  const parts: [number, string, string][] = [
    [n((s) => s.state === "clean"), "at the recorded commit", ""],
    [n((s) => s.state === "otherCommit"), "at another commit", "warn"],
    [n((s) => s.dirty || s.untracked), "with uncommitted changes", "warn"],
    [n((s) => s.state === "uninitialized"), "not initialized", "warn"],
    [n((s) => s.state === "conflict"), "in conflict", "warn"],
    [n((s) => s.state !== "uninitialized" && !s.branch), "detached", ""],
  ];
  return parts.filter(([c]) => c).map(([c, text, cls]) => h("span", { class: "sm-stat " + cls }, `${c} ${text}`));
}

const count = (commits: OutgoingCommit[]) => (commits.length >= 1000 ? "1000+" : String(commits.length));

const plural = (n: number) => `${n} commit${n === 1 ? "" : "s"}`;

/** One sentence about the checked-out commit compared with the recorded commit. */
function summary(s: Submodule, r: SubmoduleRange | null): string {
  const recorded = s.recorded.slice(0, 8);
  if (s.state === "conflict") return "The submodule has a merge conflict in the parent repository.";
  if (s.state === "clean") return `At the recorded commit ${recorded}.`;
  if (!r) return "Loading…";
  if (r.recordedMissing) return `The submodule does not have the recorded commit ${recorded}. Update fetches it.`;
  const behind = r.behind.length;
  const ahead = r.ahead.length;
  if (behind && ahead) return `Diverged from the recorded commit ${recorded}: ${plural(ahead)} ahead, ${plural(behind)} behind.`;
  if (behind) return `${plural(behind)} behind the recorded commit ${recorded}.`;
  if (ahead) return `${plural(ahead)} ahead of the recorded commit ${recorded}. Commit the submodule to record them.`;
  return `At another commit than the recorded commit ${recorded}.`;
}
