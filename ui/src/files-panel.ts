// The Files tab: the files of the working tree as a tree of folders, as the Project view of IntelliJ.
// A file with a local change has the color of its status, and so has each folder above it. A search shows
// the matching files as a flat list. The folders are closed at first, so a large repository draws fast.

import { h, twisty } from "./dom";
import { fileIcon } from "./file-icon";
import { reconcile, type KeyedItem } from "./keyed";

interface Dir {
  dirs: Map<string, Dir>;
  files: string[];
}

/** The most important status of a folder: a conflict, then a change, an addition, an unversioned file. */
const RANK: Record<string, number> = { U: 5, D: 4, M: 3, R: 3, C: 3, A: 2, "?": 1 };

export class FilesPanel {
  readonly el: HTMLElement;
  private readonly list: HTMLElement;
  private readonly search: HTMLInputElement;
  private readonly count: HTMLElement;
  private paths: string[] = [];
  private root: Dir = { dirs: new Map(), files: [] };
  /** The status of each changed file, and of each folder above a changed file (key "a/b/"). */
  private status = new Map<string, string>();
  /** The open folders, by path with a slash at the end. */
  private readonly open = new Set<string>();
  private selected = "";
  private loaded = false;
  /** A click on a file. */
  onOpen: (path: string) => void = () => {};
  /** A double click on a file, or Enter. */
  onActivate: (path: string) => void = () => {};
  onMenu: (path: string, e: MouseEvent) => void = () => {};

  constructor() {
    this.search = h("input", { class: "files-search", type: "search", placeholder: "Find a file", spellcheck: false });
    this.count = h("span", { class: "files-count muted-inline" });
    this.list = h("div", { class: "files-list", tabIndex: 0, role: "tree" });
    this.el = h("div", { class: "files-panel" }, h("div", { class: "files-head" }, this.search, this.count), this.list);
    this.search.addEventListener("input", () => this.render());
    this.list.addEventListener("keydown", (e) => this.onKey(e));
  }

  /** The selected file, or "". */
  get selectedPath(): string {
    return this.selected;
  }

  /** True after the first list of files. */
  get hasFiles(): boolean {
    return this.loaded;
  }

  setFiles(paths: string[]) {
    this.loaded = true;
    if (paths.length === this.paths.length && paths.every((p, i) => p === this.paths[i])) return;
    this.paths = paths;
    const root: Dir = { dirs: new Map(), files: [] };
    for (const p of paths) {
      let d = root;
      for (const part of p.split("/").slice(0, -1)) {
        let next = d.dirs.get(part);
        if (!next) d.dirs.set(part, (next = { dirs: new Map(), files: [] }));
        d = next;
      }
      d.files.push(p);
    }
    this.root = root;
    this.render();
  }

  /** The local changes: the status letter of each changed path. */
  setStatus(changes: Map<string, string>) {
    const status = new Map<string, string>();
    for (const [path, s] of changes) {
      status.set(path, s);
      const parts = path.split("/");
      for (let i = 1; i < parts.length; i++) {
        const dir = parts.slice(0, i).join("/") + "/";
        const old = status.get(dir);
        if (!old || (RANK[s] ?? 0) > (RANK[old] ?? 0)) status.set(dir, s);
      }
    }
    const same = status.size === this.status.size && [...status].every(([k, v]) => this.status.get(k) === v);
    if (same) return;
    this.status = status;
    this.render();
  }

  /** Marks a file as selected, opens its folders, and scrolls to it. */
  select(path: string) {
    this.selected = path;
    const parts = path.split("/");
    for (let i = 1; i < parts.length; i++) this.open.add(parts.slice(0, i).join("/") + "/");
    this.render();
    this.list.querySelector<HTMLElement>(`.files-row[data-path="${CSS.escape(path)}"]`)?.scrollIntoView({ block: "nearest" });
  }

  focus() {
    this.list.focus();
  }

  private render() {
    const q = this.search.value.trim().toLowerCase();
    const items: KeyedItem<HTMLElement>[] = [];
    if (q) {
      // A search shows the matching files as a flat list, with their folders.
      const hits = this.paths.filter((p) => p.toLowerCase().includes(q));
      this.count.textContent = `${hits.length} of ${this.paths.length}`;
      for (const p of hits.slice(0, 2000)) items.push(this.fileItem(p, 0, true));
    } else {
      this.count.textContent = `${this.paths.length} files`;
      this.walk(this.root, "", 0, items);
    }
    reconcile(this.list, items);
  }

  private walk(d: Dir, prefix: string, depth: number, items: KeyedItem<HTMLElement>[]) {
    for (const name of [...d.dirs.keys()].sort((a, b) => a.localeCompare(b))) {
      const full = `${prefix}${name}/`;
      const isOpen = this.open.has(full);
      items.push(this.dirItem(name, full, depth, isOpen));
      if (isOpen) this.walk(d.dirs.get(name)!, full, depth + 1, items);
    }
    for (const p of [...d.files].sort((a, b) => a.localeCompare(b))) items.push(this.fileItem(p, depth, false));
  }

  private dirItem(name: string, full: string, depth: number, isOpen: boolean): KeyedItem<HTMLElement> {
    const s = this.status.get(full) ?? "";
    return {
      key: `d:${full}`,
      sig: `${name}|${depth}|${isOpen}|${s}`,
      build: () => {
        const row = h(
          "div",
          { class: "files-row files-dir", "data-dir": full, role: "treeitem", "aria-expanded": String(isOpen), title: full.slice(0, -1), style: { paddingLeft: `${6 + depth * 14}px` } },
          twisty(isOpen),
          h("span", { class: "files-name" + (s ? ` status-text-${s} files-changed` : "") }, name),
        );
        row.addEventListener("mousedown", (e) => {
          if (e.button !== 0) return;
          e.preventDefault();
          this.toggle(full);
        });
        return row;
      },
    };
  }

  private fileItem(path: string, depth: number, withDir: boolean): KeyedItem<HTMLElement> {
    const s = this.status.get(path) ?? "";
    const slash = path.lastIndexOf("/");
    const sel = path === this.selected;
    return {
      key: `f:${path}`,
      sig: `${depth}|${withDir}|${s}|${sel}`,
      build: () => {
        const row = h(
          "div",
          { class: "files-row files-file" + (sel ? " selected" : ""), "data-path": path, role: "treeitem", title: path, style: { paddingLeft: `${6 + depth * 14 + 16}px` } },
          fileIcon(path),
          h("span", { class: "files-name" + (s ? ` status-text-${s} files-changed` : "") }, path.slice(slash + 1)),
          withDir && slash > 0 ? h("span", { class: "files-dir-hint muted-inline" }, path.slice(0, slash)) : "",
        );
        row.addEventListener("mousedown", (e) => {
          if (e.button !== 0) return;
          this.pick(path);
        });
        row.addEventListener("dblclick", () => this.onActivate(path));
        row.addEventListener("contextmenu", (e) => {
          e.preventDefault();
          this.pick(path);
          this.onMenu(path, e);
        });
        return row;
      },
    };
  }

  private toggle(full: string) {
    if (this.open.has(full)) this.open.delete(full);
    else this.open.add(full);
    this.render();
  }

  private pick(path: string) {
    if (this.selected !== path) {
      this.selected = path;
      this.render();
    }
    this.onOpen(path);
  }

  /** Up and Down move between the rows; Left and Right close and open a folder; Enter opens the file. */
  private onKey(e: KeyboardEvent) {
    const rows = [...this.list.querySelectorAll<HTMLElement>(".files-row")];
    const at = rows.findIndex((r) => r.classList.contains("selected") || r.classList.contains("cursor"));
    const cur = rows[at];
    const go = (i: number) => {
      const r = rows[Math.max(0, Math.min(rows.length - 1, i))];
      if (!r) return;
      for (const x of rows) x.classList.remove("cursor");
      if (r.dataset.path) this.pick(r.dataset.path);
      else r.classList.add("cursor");
      r.scrollIntoView({ block: "nearest" });
    };
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      go(at < 0 ? 0 : at + (e.key === "ArrowDown" ? 1 : -1));
    } else if ((e.key === "ArrowRight" || e.key === "ArrowLeft") && cur?.dataset.dir) {
      e.preventDefault();
      const isOpen = this.open.has(cur.dataset.dir);
      if (isOpen !== (e.key === "ArrowRight")) this.toggle(cur.dataset.dir);
    } else if (e.key === "Enter" && cur?.dataset.path) {
      e.preventDefault();
      this.onActivate(cur.dataset.path);
    }
  }
}
