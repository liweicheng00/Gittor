// Branches panel: local branches, remote branches grouped by remote, and tags.

import type { BranchInfo, RecentBranch } from "./api";
import { compareTags } from "./version-sort";
import { isStale } from "./stale";
import { h, icon, twisty } from "./dom";
import { type KeyedItem, reconcile } from "./keyed";

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** The rows of one draw of the list, with the key and the signature of each for `reconcile`. */
class RowList {
  readonly items: KeyedItem<HTMLElement>[] = [];
  add(key: string, sig: unknown, el: HTMLElement) {
    this.items.push({ key, sig: JSON.stringify(sig), build: () => el });
  }
}


export class Sidebar {
  readonly el: HTMLElement;
  private list: HTMLElement;
  private search: HTMLInputElement;
  private refs: BranchInfo[] = [];
  private recent: RecentBranch[] = [];
  private collapsed = new Set<string>(["Stale", "Tags"]);
  private filterSet = new Set<string>();
  /** Favorite branches and tags, by full ref name. */
  private favorites = new Set<string>();
  private onlyFavorites = false;
  /** The marks of the user (see stale.ts), and the days without a commit that make a branch stale. */
  private stale = new Set<string>();
  private staleDays = 30;
  /** Branches with a prefix ("feature/a") show in a folder of the prefix, as IntelliJ's Group by Directory. */
  private groupByPrefix = false;
  private favBtn: HTMLButtonElement;
  onToggleFavorite: (b: BranchInfo) => void = () => {};
  onNavigate: (b: BranchInfo) => void = () => {};
  onToggleFilter: (b: BranchInfo) => void = () => {};
  onContextMenu: (b: BranchInfo, e: MouseEvent) => void = () => {};
  /** The context menu of a multiple selection: two or more branches and tags. */
  onMultiMenu: (refs: BranchInfo[], e: MouseEvent) => void = () => {};
  /** The selected branches and tags, by full ref name. Ctrl+click and Shift+click select more than one. */
  private selection = new Set<string>();
  private anchor: string | null = null;
  onCheckout: (b: BranchInfo) => void = () => {};
  /** The context menu of a remote group. */
  onRemoteMenu: (remote: string, e: MouseEvent) => void = () => {};
  /** The context menu of the Local group header. */
  onLocalMenu: (e: MouseEvent) => void = () => {};
  /** The context menu of the Tags group header. */
  onTagsMenu: (e: MouseEvent) => void = () => {};
  /** The tags of a remote, after a fetch or a check. Null: not known, so no tag shows as local only. */
  private remoteTags: { remote: string; names: Set<string> } | null = null;

  constructor() {
    this.search = h("input", { class: "sidebar-search", placeholder: "Search branches and tags", spellcheck: false });
    this.search.addEventListener("input", () => this.render());
    this.list = h("div", { class: "sidebar-list" });
    this.favBtn = h("button", { class: "icon-button fav-filter", title: "Show only the favorite branches" }, icon("star"));
    this.favBtn.addEventListener("click", () => {
      this.onlyFavorites = !this.onlyFavorites;
      this.favBtn.classList.toggle("on", this.onlyFavorites);
      this.render();
    });
    this.el = h("aside", { class: "sidebar" }, h("div", { class: "pane-title" }, "Branches"), h("div", { class: "sidebar-search-row" }, this.search, this.favBtn), this.list);
  }

  setGroupByPrefix(on: boolean) {
    this.groupByPrefix = on;
    this.render();
  }

  // Each setter draws the list only when its data changed. A reload of the same refs then makes no new
  // elements: the list does not flash, and a click on a row still works.
  setRefs(refs: BranchInfo[]) {
    if (same(refs, this.refs)) return;
    this.refs = refs;
    const known = new Set(refs.map((b) => b.full));
    this.selection = new Set([...this.selection].filter((f) => known.has(f)));
    this.render();
  }

  setRemoteTags(remote: string | null, names: string[] | null) {
    const next = remote && names ? { remote, names: new Set(names) } : null;
    if (same(next && [next.remote, [...next.names]], this.remoteTags && [this.remoteTags.remote, [...this.remoteTags.names]])) return;
    this.remoteTags = next;
    this.render();
  }

  /** The remote of the last check of the tags, or null. */
  get remoteTagsOf(): string | null {
    return this.remoteTags?.remote ?? null;
  }

  setRecent(recent: RecentBranch[]) {
    if (same(recent, this.recent)) return;
    this.recent = recent;
    this.render();
  }

  setFavorites(full: Iterable<string>) {
    const next = new Set(full);
    if (same([...next].sort(), [...this.favorites].sort())) return;
    this.favorites = next;
    this.render();
  }

  setStale(marks: Iterable<string>, days: number) {
    const next = new Set(marks);
    if (days === this.staleDays && same([...next].sort(), [...this.stale].sort())) return;
    this.stale = next;
    this.staleDays = days;
    this.render();
  }

  isStale(b: BranchInfo): boolean {
    return b.kind === "local" && isStale(b, this.stale, this.staleDays, this.staleClock);
  }

  /** The time that the age of a branch counts from: the newest commit of all refs. An old repository
   * that nobody changed for a long time then does not show all its branches as stale. */
  get staleClock(): number {
    let newest = 0;
    for (const b of this.refs) if (b.time > newest) newest = b.time;
    return newest || Date.now() / 1000;
  }

  isFavorite(b: BranchInfo): boolean {
    return this.favorites.has(b.full);
  }

  setFilter(names: string[]) {
    if (same([...names].sort(), [...this.filterSet].sort())) return;
    this.filterSet = new Set(names);
    this.render();
  }

  /** The selected branches and tags, in the order of the list. */
  get selected(): BranchInfo[] {
    return this.refs.filter((b) => this.selection.has(b.full));
  }

  clearSelection() {
    this.selection.clear();
    this.paintSelection();
  }

  private paintSelection() {
    for (const el of this.list.querySelectorAll<HTMLElement>(".branch[data-ref]")) el.classList.toggle("selected", this.selection.has(el.dataset.ref!));
  }

  /** Selects with the modifier keys of a click: Ctrl or Cmd adds or removes one, Shift adds a range. */
  private clickSelect(b: BranchInfo, e: MouseEvent): boolean {
    if (e.shiftKey && this.anchor) {
      const order = [...new Set([...this.list.querySelectorAll<HTMLElement>(".branch[data-ref]")].map((el) => el.dataset.ref!))];
      const [i, j] = [order.indexOf(this.anchor), order.indexOf(b.full)];
      if (i >= 0 && j >= 0) {
        if (!(e.ctrlKey || e.metaKey)) this.selection.clear();
        for (const f of order.slice(Math.min(i, j), Math.max(i, j) + 1)) this.selection.add(f);
        this.paintSelection();
        return true;
      }
    }
    if (e.ctrlKey || e.metaKey) {
      if (this.selection.has(b.full)) this.selection.delete(b.full);
      else this.selection.add(b.full);
      this.anchor = b.full;
      this.paintSelection();
      return true;
    }
    this.selection = new Set([b.full]);
    this.anchor = b.full;
    this.paintSelection();
    return false;
  }

  private render() {
    const q = this.search.value.trim().toLowerCase();
    const match = (b: BranchInfo) => (!q || b.name.toLowerCase().includes(q)) && (!this.onlyFavorites || b.current || this.favorites.has(b.full));
    const groups: [string, BranchInfo[]][] = [];
    const current = this.refs.filter((b) => b.current);
    const recent = this.recent
      .map((r) => this.refs.find((b) => b.kind === "local" && b.name === r.name))
      .filter((b): b is BranchInfo => !!b && match(b) && !this.isStale(b));
    if (recent.length) groups.push(["Recent", recent]);
    const locals = this.refs.filter((b) => b.kind === "local" && match(b));
    // A stale branch shows in the Stale group only, not in Local.
    groups.push(["Local", locals.filter((b) => !this.isStale(b))]);
    groups.push(["Stale", locals.filter((b) => this.isStale(b))]);
    const remotes = new Map<string, BranchInfo[]>();
    for (const b of this.refs.filter((b) => b.kind === "remote" && match(b))) {
      const remote = b.name.split("/")[0];
      if (!remotes.has(remote)) remotes.set(remote, []);
      remotes.get(remote)!.push(b);
    }
    for (const [remote, list] of remotes) groups.push([`Remote: ${remote}`, list]);
    groups.push(["Tags", this.refs.filter((b) => b.kind === "tag" && match(b)).sort((a, b) => compareTags(a.name, b.name))]);

    const frag = new RowList();
    if (current.length) {
      const c = current[0];
      const head = h("div", { class: "sidebar-head", title: `${c.subject}\nClick: go to the commit of HEAD` }, h("span", { class: "head-icon" }, "HEAD"), " ", c.name);
      head.addEventListener("click", () => this.onNavigate(c));
      head.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        this.onContextMenu(c, e);
      });
      frag.add("head", c, head);
    }
    for (const [title, unsorted] of groups) {
      // Favorites first, as in IntelliJ; the order stays otherwise.
      const items = [...unsorted.filter((b) => this.favorites.has(b.full)), ...unsorted.filter((b) => !this.favorites.has(b.full))];
      if (!items.length) continue;
      const open = q ? true : !this.collapsed.has(title);
      const header = h(
        "div",
        { class: "group-header" },
        twisty(open),
        h("span", {}, title),
        h("span", { class: "group-count" }, String(items.length)),
      );
      header.addEventListener("click", () => {
        if (this.collapsed.has(title)) this.collapsed.delete(title);
        else this.collapsed.add(title);
        this.render();
      });
      if (title === "Tags") {
        header.addEventListener("contextmenu", (e) => {
          e.preventDefault();
          this.onTagsMenu(e);
        });
      }
      if (title === "Stale") header.title = (this.staleDays > 0 ? `Local branches without a commit for ${this.staleDays} days, ` : "Local branches ") + "with a tracked branch that is gone from the remote, or that you marked as stale";
      if (title === "Local") {
        header.addEventListener("contextmenu", (e) => {
          e.preventDefault();
          this.onLocalMenu(e);
        });
      }
      if (title.startsWith("Remote: ")) {
        header.addEventListener("contextmenu", (e) => {
          e.preventDefault();
          this.onRemoteMenu(title.slice("Remote: ".length), e);
        });
      }
      frag.add(`g:${title}`, [open, items.length], header);
      if (!open) continue;
      const label = (b: BranchInfo) => (title.startsWith("Remote") ? b.name.slice(b.name.indexOf("/") + 1) : b.name);
      if (this.groupByPrefix && !q && (title === "Local" || title.startsWith("Remote: "))) this.renderFolders(frag, title, items, label);
      else for (const b of items) frag.add(`b:${title}\0${b.full}`, this.itemSig(b, label(b), 0), this.item(b, label(b)));
    }
    reconcile(this.list, frag.items);
    this.paintSelection();
  }

  /** All that the row of a branch shows. */
  private itemSig(b: BranchInfo, label: string, depth: number): unknown {
    const localTag = b.kind === "tag" && !!this.remoteTags && !this.remoteTags.names.has(b.name);
    return [b, label, depth, this.filterSet.has(b.name), this.favorites.has(b.full), localTag && this.remoteTags?.remote];
  }

  /** The branches of a group in folders of their prefixes. A folder opens and closes with a click. */
  private renderFolders(frag: RowList, group: string, items: BranchInfo[], label: (b: BranchInfo) => string) {
    interface Folder {
      dirs: Map<string, Folder>;
      branches: BranchInfo[];
      count: number;
    }
    const root: Folder = { dirs: new Map(), branches: [], count: 0 };
    for (const b of items) {
      const parts = label(b).split("/");
      let f = root;
      f.count++;
      for (const p of parts.slice(0, -1)) {
        if (!f.dirs.has(p)) f.dirs.set(p, { dirs: new Map(), branches: [], count: 0 });
        f = f.dirs.get(p)!;
        f.count++;
      }
      f.branches.push(b);
    }
    const walk = (f: Folder, path: string, depth: number) => {
      for (const [name, sub] of [...f.dirs].sort(([a], [b]) => a.localeCompare(b))) {
        const key = `${group}\0${path}${name}/`;
        const open = !this.collapsed.has(key);
        const row = h(
          "div",
          { class: "branch-folder", style: { paddingLeft: `${8 + depth * 14}px` }, title: `${path}${name}/` },
          twisty(open),
          icon("folder"),
          h("span", { class: "branch-name" }, name),
          h("span", { class: "group-count" }, String(sub.count)),
        );
        row.addEventListener("click", () => {
          if (open) this.collapsed.add(key);
          else this.collapsed.delete(key);
          this.render();
        });
        frag.add(`f:${key}`, [open, sub.count, depth], row);
        if (open) walk(sub, `${path}${name}/`, depth + 1);
      }
      for (const b of f.branches) {
        const el = this.item(b, label(b).split("/").pop()!);
        el.style.paddingLeft = `${22 + depth * 14}px`;
        frag.add(`b:${group}\0${b.full}`, this.itemSig(b, label(b), depth + 1), el);
      }
    };
    walk(root, "", 0);
  }

  private item(b: BranchInfo, label: string): HTMLElement {
    const filtered = this.filterSet.has(b.name);
    const badges = h("span", { class: "badges" });
    if (b.ahead) badges.append(h("span", { class: "ahead", title: `${b.ahead} commits ahead of ${b.upstream}` }, `↑${b.ahead}`));
    if (b.behind) badges.append(h("span", { class: "behind", title: `${b.behind} commits behind ${b.upstream}` }, `↓${b.behind}`));
    if (b.gone) badges.append(h("span", { class: "tag-local branch-gone", title: `${b.upstream ?? "The tracked branch"} is gone from the remote` }, "gone"));
    if (b.kind === "tag" && this.remoteTags && !this.remoteTags.names.has(b.name)) {
      badges.append(h("span", { class: "tag-local", title: `Not on ${this.remoteTags.remote}. Push it from the context menu.` }, "local"));
    }
    const filterBtn = h("button", { class: "filter-toggle" + (filtered ? " on" : ""), title: filtered ? "Remove from the log filter" : "Show only this branch in the log" }, icon("filter"));
    filterBtn.addEventListener("dblclick", (e) => e.stopPropagation());
    filterBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.onToggleFilter(b);
    });
    const fav = this.favorites.has(b.full);
    const favBtn = h("button", { class: "fav-toggle" + (fav ? " on" : ""), title: fav ? "Remove from favorites" : "Add to favorites" }, icon(fav ? "star-filled" : "star"));
    favBtn.addEventListener("dblclick", (e) => e.stopPropagation());
    favBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.onToggleFavorite(b);
    });
    const el = h(
      "div",
      {
        class: `branch branch-${b.kind}` + (b.current ? " current" : "") + (filtered ? " filtered" : "") + (fav ? " favorite" : "") + (this.selection.has(b.full) ? " selected" : ""),
        "data-ref": b.full,
        title: `${b.name}\n${b.subject}\nCtrl+click or Shift+click: select more than one`,
      },
      h("span", { class: "branch-icon", title: b.current ? "The current branch" : "" }, icon(b.kind === "tag" ? "tag" : b.current ? "current" : "branch")),
      h("span", { class: "branch-name" }, label),
      badges,
      favBtn,
      filterBtn,
    );
    // A press with Shift does not select the text of the list.
    el.addEventListener("mousedown", (e) => e.shiftKey && e.preventDefault());
    el.addEventListener("click", (e) => {
      if (!this.clickSelect(b, e)) this.onNavigate(b);
    });
    el.addEventListener("dblclick", (e) => !(e.ctrlKey || e.metaKey || e.shiftKey) && (b.kind === "tag" ? this.onToggleFilter(b) : this.onCheckout(b)));
    el.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      if (!this.selection.has(b.full)) {
        this.selection = new Set([b.full]);
        this.anchor = b.full;
        this.paintSelection();
      }
      const refs = this.selected;
      if (refs.length > 1) this.onMultiMenu(refs, e);
      else this.onContextMenu(b, e);
    });
    return el;
  }
}
