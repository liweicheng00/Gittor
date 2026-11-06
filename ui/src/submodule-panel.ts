// The Submodules section under the changelists of the Changes tab: the submodules of the repository and,
// for the selected one, the commits between the recorded commit and the checked-out commit.

import type { OutgoingCommit, Submodule, SubmoduleRange } from "./api";
import { h, icon } from "./dom";
import { twisty } from "./icons";
import { save, settings } from "./settings";

/** The submodule is not at the recorded commit, or has local changes. */
export const needsAttention = (s: Submodule) => s.state !== "clean" || s.dirty || s.untracked;

/** The short badge of a state on its row, and the tooltip of the badge. */
const STATE_TEXT: Record<Submodule["state"], [string, string]> = {
  uninitialized: ["not initialized", "Its folder is empty"],
  clean: ["", ""],
  otherCommit: ["≠", "The checked-out commit is not the commit that the parent repository records"],
  conflict: ["!", "The submodule has a merge conflict in the parent repository"],
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

  constructor() {
    const updateAll = h("button", { class: "icon-button sm-update-all", title: "Update All: initialize all submodules and check out their recorded commits" }, icon("update"));
    updateAll.addEventListener("click", () => this.onUpdate([]));
    this.title = h("span", { class: "sm-title" }, "Submodules");
    this.stats = h("span", { class: "sm-stats" });
    const head = h("div", { class: "sm-head", title: "Show or hide the submodules" }, (this.twist = twisty(!settings.submodulesCollapsed)), this.title, this.stats, updateAll);
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
    this.el = h("section", { class: "submodule-panel", hidden: true }, head, h("div", { class: "sm-body" }, this.list, this.detail));
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
    const stats = statistics(subs);
    this.stats.replaceChildren(...stats);
    this.stats.title = stats.map((e) => e.title).join("\n");
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
        const [stateText, stateTitle] = STATE_TEXT[s.state];
        const badges = [
          stateText ? h("span", { class: "sm-badge", title: stateTitle }, stateText) : "",
          s.dirty || s.untracked ? h("span", { class: "sm-badge", title: "The submodule has uncommitted changes" }, "*") : "",
        ];
        const tools: HTMLElement[] = [];
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
          tools.push(branch, open);
        }
        const row = h(
          "div",
          {
            class: "sm-row" + (s.path === this.selected ? " selected" : ""),
            title: `${s.path}\nrecorded ${s.recorded}${s.current ? `\nchecked out ${s.current}` : ""}${s.url ? `\n${s.url}` : ""}`,
          },
          h("span", { class: "branch-icon" }, icon("submodule")),
          h("span", { class: "sm-path" }, s.path),
          ...badges,
          ...tools,
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

  /** One line about the selected submodule. It hides when the submodule is at the recorded commit and
   * has no changes. */
  private renderDetail() {
    const s = this.selectedSubmodule;
    const r = s && this.range?.path === s.path ? this.range : null;
    const parts: (HTMLElement | string)[] = [];
    const link = (text: string, title: string, run: () => void, cls: string) => {
      const a = h("button", { class: "sm-link " + cls, title }, text);
      a.addEventListener("click", run);
      return a;
    };
    if (s?.state === "uninitialized") {
      parts.push(link("Initialize and Update", "Clone the submodule and check out the recorded commit", () => this.onUpdate([s.path]), "sm-init"));
    } else if (s && needsAttention(s)) {
      if (s.state === "conflict") parts.push("Merge conflict");
      else if (!r) parts.push("Loading…");
      else if (r.recordedMissing) parts.push(h("span", { title: `The submodule does not have the recorded commit ${s.recorded}` }, "Recorded commit missing"));
      if (r?.behind.length) {
        parts.push(link(`${count(r.behind)} behind`, `Only in the recorded commit:\n${subjects(r.behind)}\nClick to show the newest one in the submodule`, () => this.onOpenCommit(s, r.behind[0].oid), "sm-behind"));
      }
      if (r?.ahead.length) {
        parts.push(link(`${count(r.ahead)} ahead`, `Only in the checked-out commit:\n${subjects(r.ahead)}\nCommit the submodule to record them`, () => this.onOpenCommit(s, r.ahead[0].oid), "sm-ahead"));
      }
      if (r?.changes.length) {
        const untracked = r.changes.filter((c) => c.status === "?").length;
        const files = `${r.changes.length} uncommitted${untracked ? ` (${untracked} new)` : ""}`;
        parts.push(h("span", { class: "sm-changes", title: r.changes.map((c) => `${c.status} ${c.path}`).join("\n") }, files));
      }
      // Not when the submodule has commits of its own: on a detached HEAD, an update would leave them behind.
      if ((s.state === "otherCommit" && r && !r.ahead.length) || r?.recordedMissing) {
        parts.push(link("Update", "Check out the commit that the parent repository records", () => this.onUpdate([s.path]), "sm-update"));
      }
    }
    this.detail.hidden = !parts.length;
    this.detail.replaceChildren(...parts.flatMap((p, i) => (i ? [h("span", { class: "sm-sep" }, "·"), p] : [p])));
  }
}

/** The subjects of the newest commits, for a tooltip. */
const subjects = (commits: OutgoingCommit[]) =>
  commits.slice(0, MAX_COMMITS).map((c) => `${c.oid.slice(0, 8)} ${c.subject}`).join("\n") + (commits.length > MAX_COMMITS ? `\n… ${commits.length - MAX_COMMITS} more` : "");

/** A tooltip lists only the newest commits. */
const MAX_COMMITS = 5;

/** The counts of the states of the submodules, for the line under the header. */
function statistics(subs: Submodule[]): HTMLElement[] {
  const n = (f: (s: Submodule) => boolean) => subs.filter(f).length;
  const parts: [number, string, string, string][] = [
    [n((s) => s.state === "otherCommit"), "≠ recorded", "at another commit than the recorded commit", "warn"],
    [n((s) => s.dirty || s.untracked), "dirty", "with uncommitted changes", "warn"],
    [n((s) => s.state === "uninitialized"), "not init", "not initialized", "warn"],
    [n((s) => s.state === "conflict"), "conflict", "in conflict", "warn"],
  ];
  return parts.filter(([c]) => c).map(([c, text, title, cls]) => h("span", { class: "sm-stat " + cls, title: `${c} ${title}` }, `${c} ${text}`));
}

const count = (commits: OutgoingCommit[]) => (commits.length >= 1000 ? "1000+" : String(commits.length));
