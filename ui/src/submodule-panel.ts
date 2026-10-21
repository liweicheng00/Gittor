// Submodules tab: the submodules of the repository and, for the selected one, the commits between the
// recorded commit and the checked-out commit.

import type { OutgoingCommit, Submodule, SubmoduleRange } from "./api";
import { formatDate, h, icon } from "./dom";

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
  private subs: Submodule[] = [];
  private selected: string | null = null;
  private range: SubmoduleRange | null = null;
  onSelect: (s: Submodule) => void = () => {};
  onMenu: (s: Submodule, e: MouseEvent) => void = () => {};
  onOpen: (s: Submodule) => void = () => {};
  onOpenCommit: (s: Submodule, oid: string) => void = () => {};
  onUpdate: (paths: string[]) => void = () => {};
  onRefresh: () => void = () => {};

  constructor() {
    const refresh = h("button", { class: "icon-button", title: "Refresh" }, icon("refresh"));
    refresh.addEventListener("click", () => this.onRefresh());
    const updateAll = h("button", { class: "tb-button", title: "Initialize all submodules and check out their recorded commits" }, "Update All");
    updateAll.addEventListener("click", () => this.onUpdate([]));
    this.list = h("div", { class: "sm-list", tabIndex: 0 });
    this.list.addEventListener("keydown", (e) => {
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      e.preventDefault();
      if (!this.subs.length) return;
      const i = this.subs.findIndex((s) => s.path === this.selected);
      this.select(this.subs[Math.max(0, Math.min(this.subs.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)))]);
    });
    this.detail = h("div", { class: "sm-detail" });
    this.el = h("section", { class: "submodule-panel" }, h("div", { class: "commit-toolbar" }, refresh, h("span", { class: "spacer" }), updateAll), this.list, this.detail);
    this.render();
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
        const badges = [STATE_TEXT[s.state], s.dirty ? "modified" : "", s.untracked ? "unversioned files" : ""].filter(Boolean);
        const where = s.state === "uninitialized" ? "" : s.branch ?? "detached";
        const row = h(
          "div",
          {
            class: "sm-row" + (s.path === this.selected ? " selected" : ""),
            title: `${s.path}\nrecorded ${s.recorded}${s.current ? `\nchecked out ${s.current}` : ""}${s.url ? `\n${s.url}` : ""}`,
          },
          h("div", { class: "sm-name" }, h("span", { class: "branch-icon" }, icon("submodule")), h("span", { class: "sm-path" }, s.path)),
          h(
            "div",
            { class: "sm-meta" },
            where ? h("span", { class: s.branch ? "" : "sm-detached" }, s.branch ? icon("branch") : "", ` ${where}`) : "",
            h("code", {}, commit),
            ...badges.map((b) => h("span", { class: "sm-badge" }, b)),
          ),
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
    if (!s) {
      this.detail.replaceChildren(h("div", { class: "muted commit-empty" }, "Select a submodule to see how its checked-out commit differs from the recorded commit."));
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
      parts.push(h("p", { class: "sm-summary" }, "The submodule is not initialized. Its folder is empty."));
      actions.append(button("Initialize and Update", "Clone the submodule and check out the recorded commit", () => this.onUpdate([s.path])));
    } else {
      const r = this.range?.path === s.path ? this.range : null;
      parts.push(h("p", { class: "sm-summary" }, summary(s, r)));
      // Not when the submodule has commits of its own: on a detached HEAD, an update would leave them behind.
      if ((s.state === "otherCommit" && r && !r.ahead.length) || r?.recordedMissing) {
        actions.append(button("Update to Recorded", "Check out the commit that the parent repository records", () => this.onUpdate([s.path])));
      }
      actions.append(button("Open as Repository", "Open the submodule in a new tab", () => this.onOpen(s)));
      if (r) {
        if (r.behind.length) parts.push(this.commits(s, `Only in the recorded commit (${count(r.behind)})`, r.behind));
        if (r.ahead.length) parts.push(this.commits(s, `Only in the checked-out commit (${count(r.ahead)})`, r.ahead));
        if (r.changes.length) {
          parts.push(
            h(
              "div",
              { class: "sm-section" },
              h("div", { class: "sm-section-title" }, `Local changes (${r.changes.length})`),
              ...r.changes.map((c) =>
                h("div", { class: "sm-file", title: c.path }, h("span", { class: c.status === "?" ? "sm-status sm-unversioned" : `sm-status status-text-${c.status}` }, c.status), c.path),
              ),
            ),
          );
        }
      }
    }
    this.detail.replaceChildren(h("div", { class: "sm-detail-head", title: s.path }, s.path), actions, ...parts);
  }

  private commits(s: Submodule, title: string, commits: OutgoingCommit[]) {
    return h(
      "div",
      { class: "sm-section" },
      h("div", { class: "sm-section-title" }, title),
      ...commits.map((c) => {
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
    );
  }
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
  if (behind) return `${plural(behind)} behind the recorded commit ${recorded}. Update checks out the recorded commit.`;
  if (ahead) return `${plural(ahead)} ahead of the recorded commit ${recorded}. Commit the submodule in the parent repository to record them.`;
  return `At another commit than the recorded commit ${recorded}.`;
}
