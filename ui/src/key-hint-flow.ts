// Shortcut hints: after a mouse click on a button that has a shortcut, the shortcut shows next to the
// mouse for a moment, so that the user can use the key the next time. Settings › General can turn it off.
// A button names its keymap action with the attribute data-key-action.

import { h } from "./dom";
import { keymap, keyWorksAt } from "./keyboard";
import { formatKey } from "./keymap";
import { settings } from "./settings";
import { fetchBtn, filterBar, localHistoryBtn, pushBtn, refreshBtn, settingsBtn, tabBranches, tabCommit, tabReviews, tabStash, tabSubmodules, updateBtn } from "./shell";

/** The hint of one action shows at most once in this time. */
const AGAIN_MS = 3000;
const SHOW_MS = 1800;

const lastShown = new Map<string, number>();

for (const [el, action] of [
  [refreshBtn, "refresh"],
  [fetchBtn, "fetch"],
  [updateBtn, "update"],
  [pushBtn, "push"],
  [localHistoryBtn, "localHistory"],
  [settingsBtn, "settings"],
  [tabBranches, "branches"],
  [tabCommit, "commit"],
  [tabStash, "stash"],
  [tabReviews, "reviews"],
  [tabSubmodules, "submodules"],
  [filterBar.text, "filter"],
] as const) el.dataset.keyAction = action;

/** Shows the keys of an action next to the mouse. */
function showHint(label: string, keys: string[], x: number, y: number) {
  document.querySelector(".copy-hint")?.remove();
  const el = h(
    "div",
    { class: "copy-hint key-hint", role: "status" },
    h("span", { class: "key-hint-label" }, label),
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
    const el = (e.target as HTMLElement | null)?.closest<HTMLElement>("[data-key-action]");
    const id = el?.dataset.keyAction;
    if (!el || !id) return;
    const keys = keymap.keysOf(id);
    if (!keys.length || !keyWorksAt(id, el)) return;
    const now = Date.now();
    if (now - (lastShown.get(id) ?? 0) < AGAIN_MS) return;
    lastShown.set(id, now);
    const label = keymap.actions.find((a) => a.id === id)?.label ?? id;
    showHint(label, keys, e.clientX, e.clientY);
  },
  true,
);
