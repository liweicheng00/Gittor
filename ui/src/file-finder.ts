// Go to File: a search field over the window that finds a file of the working tree by its name and opens
// it in the center panel. Double Shift or the key of the keymap shows it. Up and Down choose a row,
// Enter opens it, Escape closes the search.

import { api } from "./api";
import { h } from "./dom";
import { fileIcon } from "./file-icon";
import { matchFiles } from "./file-match";

/** Opens a file in the center panel; files-flow.ts sets it. */
export const fileFinderHooks = { open: (_path: string) => {} };

let close: (() => void) | null = null;

export function fileFinderOpen(): boolean {
  return close !== null;
}

/** The name with the matched characters in <mark>. */
function nameWithHits(name: string, hits: number[]): Node[] {
  const set = new Set(hits);
  const out: Node[] = [];
  let run = "";
  let marked = false;
  const flush = () => {
    if (run) out.push(marked ? h("mark", {}, run) : document.createTextNode(run));
    run = "";
  };
  [...name].forEach((c, i) => {
    if (set.has(i) !== marked) {
      flush();
      marked = set.has(i);
    }
    run += c;
  });
  flush();
  return out;
}

export async function showFileFinder() {
  if (close) return;
  const input = h("input", { class: "file-finder-input", placeholder: "Find a file by name", spellcheck: false, "aria-label": "Find a file by name" });
  const list = h("div", { class: "file-finder-list", role: "listbox" });
  const box = h("div", { class: "file-finder", role: "dialog", "aria-label": "Go to File" }, input, list);
  const backdrop = h("div", { class: "file-finder-backdrop" }, box);
  let files: string[] = [];
  let rows: string[] = [];
  let selected = 0;

  const done = () => {
    backdrop.remove();
    window.removeEventListener("keydown", onKey, true);
    close = null;
  };
  const openRow = (i: number) => {
    const path = rows[i];
    if (!path) return;
    done();
    fileFinderHooks.open(path);
  };
  const paint = () => {
    list.querySelectorAll(".file-finder-row").forEach((el, i) => el.classList.toggle("selected", i === selected));
    list.querySelector(".file-finder-row.selected")?.scrollIntoView({ block: "nearest" });
  };
  const render = () => {
    const matches = matchFiles(files, input.value);
    rows = matches.map((m) => m.path);
    selected = 0;
    list.replaceChildren(
      ...matches.map((m, i) => {
        const slash = m.path.lastIndexOf("/");
        const row = h(
          "div",
          { class: "file-finder-row", role: "option", title: m.path },
          fileIcon(m.path),
          h("span", { class: "file-finder-name" }, ...nameWithHits(m.path.slice(slash + 1), m.hits)),
          h("span", { class: "file-finder-dir muted-inline" }, slash > 0 ? m.path.slice(0, slash) : ""),
        );
        row.addEventListener("mousedown", (e) => {
          e.preventDefault();
          openRow(i);
        });
        return row;
      }),
    );
    if (!matches.length) list.append(h("div", { class: "file-finder-empty muted-inline" }, files.length ? "No file matches." : "Loading the files…"));
    paint();
  };
  // The capture phase comes before the key handler of the app.
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopImmediatePropagation();
      done();
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (rows.length) selected = (selected + (e.key === "ArrowDown" ? 1 : rows.length - 1)) % rows.length;
      paint();
    } else if (e.key === "Enter") {
      e.preventDefault();
      e.stopImmediatePropagation();
      openRow(selected);
    } else if (e.target !== input && !e.metaKey && !e.ctrlKey && e.key.length === 1) {
      input.focus();
    }
  };
  backdrop.addEventListener("mousedown", (e) => e.target === backdrop && done());
  input.addEventListener("input", render);
  window.addEventListener("keydown", onKey, true);
  close = done;
  document.body.append(backdrop);
  input.focus();
  render();
  files = await api.worktreeFiles().catch(() => []);
  if (close === done) render();
}

// Double Shift: two presses of Shift alone, the second within 400 ms of the first.
const DOUBLE_MS = 400;
let lastShift = 0;
let other = false;
window.addEventListener(
  "keydown",
  (e) => {
    // A new press of Shift starts clean; any other key while Shift is down spoils it.
    if (e.key === "Shift" && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey) other = false;
    else if (e.key !== "Shift") {
      other = true;
      lastShift = 0;
    }
  },
  true,
);
window.addEventListener(
  "keyup",
  (e) => {
    if (e.key !== "Shift") return;
    const now = Date.now();
    if (!other && now - lastShift < DOUBLE_MS) {
      lastShift = 0;
      // Not over a dialog of the app, and not in the search itself.
      if (!fileFinderOpen() && !document.querySelector(".overlay")) void showFileFinder();
    } else {
      lastShift = other ? 0 : now;
    }
  },
  true,
);
