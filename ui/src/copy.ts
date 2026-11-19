// What Mod+C copies. A text selection always wins: the browser copies it. Without a text selection,
// Mod+C copies the items of the list that the user used last: the path, the hash or the name.
// AGENTS.md has the rules ("Text selection and copy").

import { absPath } from "./abs-path";
import { settings } from "./settings";

type Source = () => string | null | undefined;
const sources = new WeakMap<Element, Source>();

/** Gives a list its text for Mod+C: the text of its selected items, or nothing when no item is selected. */
export function copySource(list: HTMLElement, text: Source) {
  sources.set(list, text);
}

/** The absolute path of a file of the repository of this window. */
export const repoPath = (rel: string) => absPath(settings.activeTab ?? "", rel);
/** The absolute paths of files, one for each line. */
export const repoPaths = (rels: string[]) => rels.map(repoPath).join("\n");

function sourceAt(t: EventTarget | null): Element | null {
  for (let el = t instanceof Element ? t : null; el; el = el.parentElement) if (sources.has(el)) return el;
  return null;
}

const isField = (t: EventTarget | null) => t instanceof Element && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || !!t.closest(".monaco-editor"));

/** The list that the user used last, by a mouse press, a key or the focus. */
let scope: Element | null = null;
let pressTime = 0;

window.addEventListener("mousedown", (e) => {
  scope = sourceAt(e.target);
  pressTime = Date.now();
  // Many rows prevent the default action of a press (a redraw, a custom drag), or are draggable. The
  // browser does not remove the text selection then, and Mod+C would copy that old text.
  if (e.button === 0 && !e.shiftKey && !isField(e.target)) window.getSelection()?.removeAllRanges();
}, true);
// A press can move the focus to another list (a branch shows its commit in the log). The press wins.
window.addEventListener("focusin", (e) => {
  if (Date.now() - pressTime > 1000) scope = sourceAt(e.target) ?? scope;
}, true);
window.addEventListener("keydown", (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey || ["Shift", "Control", "Meta", "Alt"].includes(e.key)) return;
  scope = sourceAt(e.target) ?? scope;
}, true);

/** True when the user has selected text on the page. Mod+C then belongs to the browser. */
export function hasTextSelection(): boolean {
  const s = window.getSelection();
  return !!s && !s.isCollapsed && s.toString() !== "";
}

/** The text that Mod+C copies at this element, or "" when the browser must do the copy. */
export function itemCopyText(target: EventTarget | null): string {
  if (isField(target) || hasTextSelection()) return "";
  const at = scope?.isConnected ? scope : sourceAt(target);
  return (at && sources.get(at)?.()) || "";
}
