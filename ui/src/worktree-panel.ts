// The Worktrees tab: the worktrees of the repository, with a search and favorites. Favorite worktrees come
// first. The star filter shows only the favorites and the current worktree.

import type { Worktree } from "./api";
import { h, icon } from "./dom";
import { type KeyedItem, reconcile } from "./keyed";
import { pathLabels } from "./path-labels";
import { worktreeMatches, worktreeOrder } from "./worktree-filter";

export class WorktreePanel {
  readonly el: HTMLElement;
  private readonly list: HTMLElement;
  private readonly search: HTMLInputElement;
  private readonly favBtn: HTMLButtonElement;
  private readonly count: HTMLElement;
  private worktrees: Worktree[] = [];
  private favorites = new Set<string>();
  private onlyFavorites = false;
  private selected = "";
  onOpen: (w: Worktree) => void = () => {};
  onMenu: (w: Worktree, e: MouseEvent) => void = () => {};
  onAdd: () => void = () => {};
  onToggleFavorite: (w: Worktree) => void = () => {};

  constructor() {
    this.search = h("input", { class: "worktree-search", type: "search", placeholder: "Search worktrees", spellcheck: false });
    this.search.addEventListener("input", () => this.render());
    this.search.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        this.list.focus();
        this.move(1);
      } else if (e.key === "Enter") {
        const first = this.visible()[0];
        if (first && !first.current) this.onOpen(first);
      }
    });
    this.favBtn = h("button", { class: "icon-button fav-filter", title: "Show only the favorite worktrees" }, icon("star"));
    this.favBtn.addEventListener("click", () => {
      this.onlyFavorites = !this.onlyFavorites;
      this.favBtn.classList.toggle("on", this.onlyFavorites);
      this.render();
    });
    const add = h("button", { class: "icon-button worktree-add", title: "Add a worktree" }, "+");
    add.addEventListener("click", () => this.onAdd());
    this.count = h("span", { class: "group-count" });
    this.list = h("div", { class: "worktree-list", tabIndex: 0 });
    this.list.addEventListener("keydown", (e) => this.onKey(e));
    this.el = h(
      "div",
      { class: "worktree-panel" },
      h("div", { class: "pane-title" }, "Worktrees", this.count, h("span", { class: "spacer" }), add),
      h("div", { class: "sidebar-search-row" }, this.search, this.favBtn),
      this.list,
    );
  }

  /** The number of worktrees. */
  get size(): number {
    return this.worktrees.length;
  }

  setWorktrees(w: Worktree[], favorites: string[]) {
    const fav = new Set(favorites);
    if (JSON.stringify(w) === JSON.stringify(this.worktrees) && [...fav].sort().join("\n") === [...this.favorites].sort().join("\n")) return;
    this.worktrees = w;
    this.favorites = fav;
    this.render();
  }

  focus() {
    this.search.focus();
    this.search.select();
  }

  /** The rows that show now, in their order, with their short names. */
  private rows(): { w: Worktree; label: string }[] {
    // Worktrees with the same folder name show the folders above them too.
    const labels = pathLabels(this.worktrees.map((w) => w.path));
    const all = this.worktrees.map((w, i) => ({ w, label: labels[i] ?? w.path, path: w.path }));
    const q = this.search.value;
    const shown = all.filter(({ w, label }) => worktreeMatches(w, label, q) && (!this.onlyFavorites || w.current || this.favorites.has(w.path)));
    return worktreeOrder(shown, this.favorites);
  }

  private visible(): Worktree[] {
    return this.rows().map((r) => r.w);
  }

  private render() {
    this.count.textContent = String(this.worktrees.length);
    const rows = this.rows();
    if (!rows.some((r) => r.w.path === this.selected)) this.selected = "";
    const items: KeyedItem<HTMLElement>[] = rows.map(({ w, label }) => {
      const fav = this.favorites.has(w.path);
      return {
        key: w.path,
        sig: JSON.stringify([w, label, fav, this.selected === w.path]),
        build: () => this.row(w, label, fav),
      };
    });
    if (!rows.length) {
      const text = this.worktrees.length ? "No worktree matches" : "No worktrees";
      items.push({ key: "\0empty", sig: text, build: () => h("div", { class: "worktree-empty muted-inline" }, text) });
    }
    reconcile(this.list, items);
  }

  private row(w: Worktree, label: string, fav: boolean): HTMLElement {
    const detail = w.branch ?? (w.detached ? `detached ${w.head?.slice(0, 8) ?? ""}` : w.bare ? "bare" : "");
    const favBtn = h("button", { class: "fav-toggle" + (fav ? " on" : ""), title: fav ? "Remove from favorites" : "Add to favorites" }, icon(fav ? "star-filled" : "star"));
    favBtn.addEventListener("dblclick", (e) => e.stopPropagation());
    favBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.onToggleFavorite(w);
    });
    const el = h(
      "div",
      {
        class: "branch worktree" + (w.current ? " current" : "") + (fav ? " favorite" : "") + (this.selected === w.path ? " selected" : ""),
        title: `${w.path}${w.locked ? "\nlocked" : ""}${w.prunable ? "\nprunable: the folder is missing" : ""}`,
      },
      h("span", { class: "branch-icon" + (w.current ? " current" : "") }, icon("worktree")),
      h("span", { class: "branch-name" }, label),
      h("span", { class: "worktree-branch" }, detail),
      w.prunable ? h("span", { class: "behind" }, "missing") : w.locked ? h("span", { class: "muted-inline", title: "Locked" }, icon("lock")) : "",
      favBtn,
    );
    el.addEventListener("click", () => this.select(w.path));
    el.addEventListener("dblclick", () => !w.current && this.onOpen(w));
    el.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      this.select(w.path);
      this.onMenu(w, e);
    });
    return el;
  }

  private select(path: string) {
    if (this.selected === path) return;
    this.selected = path;
    this.render();
  }

  private move(step: number) {
    const rows = this.visible();
    if (!rows.length) return;
    const at = rows.findIndex((w) => w.path === this.selected);
    const next = at < 0 ? (step > 0 ? 0 : rows.length - 1) : Math.max(0, Math.min(rows.length - 1, at + step));
    this.select(rows[next].path);
    this.list.querySelector(".worktree.selected")?.scrollIntoView({ block: "nearest" });
  }

  private onKey(e: KeyboardEvent) {
    const w = this.worktrees.find((x) => x.path === this.selected);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      this.move(e.key === "ArrowDown" ? 1 : -1);
    } else if (e.key === "Enter" && w && !w.current) {
      e.preventDefault();
      this.onOpen(w);
    }
  }
}
