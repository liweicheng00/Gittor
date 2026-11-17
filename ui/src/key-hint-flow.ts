// Shortcut hints: after a mouse click on a button that has a shortcut, the shortcut shows next to the
// mouse for a moment, so that the user can use the key the next time. Settings › General can turn it off.
// A button names its keymap action with the attribute data-key-action. A key that the keymap does not
// hold, for example Mod+Enter in the commit message, goes in data-key-hint ("|" between two keys). The
// tooltip of such a button also names its keys, as the keymap has them now.

import { h } from "./dom";
import { keymap, keyWorksAt } from "./keyboard";
import { formatKey } from "./keymap";
import { settings } from "./settings";
import { fetchBtn, filterBar, localHistoryBtn, pushBtn, refreshBtn, settingsBtn, tabBranches, tabCommit, tabFiles, tabReviews, tabStash, updateBtn } from "./shell";

/** The hint of one action shows at most once in this time. */
const AGAIN_MS = 3000;
const SHOW_MS = 900;

const lastShown = new Map<string, number>();

for (const [el, action] of [
  [refreshBtn, "refresh"],
  [updateBtn, "update"],
  [fetchBtn, "fetch"],
  [pushBtn, "push"],
  [localHistoryBtn, "localHistory"],
  [settingsBtn, "settings"],
  [tabFiles, "files"],
  [tabBranches, "branches"],
  [tabCommit, "commit"],
  [tabStash, "stash"],
  [tabReviews, "reviews"],
  [filterBar.text, "filter"],
] as const) el.dataset.keyAction = action;

/** Shows the keys of an action next to the mouse. */
function showHint(keys: string[], x: number, y: number) {
  document.querySelector(".copy-hint")?.remove();
  const el = h(
    "div",
    { class: "copy-hint key-hint", role: "status" },
    ...keys.flatMap((k, i) => [i ? h("span", { class: "key-hint-or" }, "or") : "", h("kbd", { class: "key-hint-key" }, formatKey(k))]),
  );
  Object.assign(el.style, { left: `${x + 12}px`, top: `${y + 14}px` });
  document.body.append(el);
  // Keep the hint in the window.
  const r = el.getBoundingClientRect();
  if (r.right > window.innerWidth - 8) el.style.left = `${Math.max(8, window.innerWidth - 8 - r.width)}px`;
  if (r.bottom > window.innerHeight - 8) el.style.top = `${y - r.height - 10}px`;
  setTimeout(() => el.classList.add("out"), SHOW_MS);
  setTimeout(() => el.remove(), SHOW_MS + 300);
}

window.addEventListener(
  "click",
  (e) => {
    // detail is 0 for a click from the keyboard (Enter or Space on a button): no hint then.
    if (!settings.keyHints || e.detail === 0) return;
    const el = (e.target as HTMLElement | null)?.closest<HTMLElement>("[data-key-action], [data-key-hint]");
    if (!el) return;
    const keys = keysAt(el);
    const id = el.dataset.keyAction ?? `hint:${el.dataset.keyHint}`;
    if (!keys.length) return;
    const now = Date.now();
    if (now - (lastShown.get(id) ?? 0) < AGAIN_MS) return;
    lastShown.set(id, now);
    showHint(keys, e.clientX, e.clientY);
  },
  true,
);

/** The keys that work for a button now: of its keymap action, or of its data-key-hint. */
function keysAt(el: HTMLElement): string[] {
  const id = el.dataset.keyAction;
  if (id) return keyWorksAt(id, el) ? keymap.keysOf(id) : [];
  return el.dataset.keyHint ? el.dataset.keyHint.split("|") : [];
}

/** A key in parentheses at the end of a tooltip, as the code wrote it, for example "(Ctrl+Enter)". */
const WRITTEN_KEY = /\s*\((?:Ctrl|Cmd|Alt|Shift|Option|F\d+|[⌘⌃⌥⇧])[^()]*\)\s*$/;

// The tooltip names the keys as the keymap has them now. The suffix of the last hover goes first, so a
// tooltip that the code changes later keeps its new text.
window.addEventListener(
  "mouseover",
  (e) => {
    const el = (e.target as HTMLElement | null)?.closest<HTMLElement>("[data-key-action], [data-key-hint]");
    if (!el) return;
    let base = el.title;
    const old = el.dataset.keySuffix;
    if (old && base.endsWith(old)) base = base.slice(0, -old.length);
    base = base.replace(WRITTEN_KEY, "");
    const keys = keysAt(el);
    const suffix = keys.length ? ` (${keys.map(formatKey).join(", ")})` : "";
    const label = base || el.getAttribute("aria-label") || "";
    el.dataset.keySuffix = suffix;
    const title = label + suffix;
    if (title && el.title !== title) el.title = title;
  },
  true,
);
