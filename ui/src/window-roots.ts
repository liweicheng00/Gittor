// The repositories of each app window. A repository shows in one window only, and a tab closes its
// repository in the backend only when no other window shows it.

import { api, focusWindow, windowLabel } from "./api";
import { toast } from "./notify";
import { settings, soloWindow } from "./settings";

const baseName = (p: string) => p.split(/[\\/]/).pop() ?? p;

// Each window writes the repositories of its tabs here.
const WINDOWS_KEY = "gittor.windows";
const windowId = windowLabel() ?? Math.random().toString(36).slice(2);

/** The repositories of each window, and when the window wrote them last. */
type WindowRoots = Record<string, { roots: string[]; at: number }>;

/** A window writes its entry every few seconds. An older entry belongs to a window that closed without
 * `beforeunload`. */
const ALIVE_MS = 10_000;

function windowRoots(): WindowRoots {
  try {
    return JSON.parse(localStorage.getItem(WINDOWS_KEY) ?? "{}");
  } catch {
    return {};
  }
}

export function publishRoots(roots: string[] | null) {
  const all = windowRoots();
  if (roots) all[windowId] = { roots, at: Date.now() };
  else delete all[windowId];
  try {
    localStorage.setItem(WINDOWS_KEY, JSON.stringify(all));
  } catch {}
}
setInterval(() => publishRoots(settings.tabs), 3000);

/** The other window that shows a repository, or undefined. */
const ownerElsewhere = (root: string) =>
  Object.entries(windowRoots()).find(([id, w]) => id !== windowId && Date.now() - (w.at ?? 0) < ALIVE_MS && w.roots?.includes(root))?.[0];
export const shownElsewhere = (root: string) => ownerElsewhere(root) !== undefined;

/** A repository shows in one window only. When another window shows it, that window comes to the front
 * and this function returns true. */
export async function inOtherWindow(path: string): Promise<boolean> {
  const root = (await api.repoInfo(path).catch(() => null))?.root ?? path;
  const owner = ownerElsewhere(root);
  if (owner === undefined) return false;
  try {
    await focusWindow(owner);
  } catch {
    // The window is gone: its entry is old.
    return false;
  }
  toast(`${baseName(root)} is open in another window.`, "info");
  return true;
}

/** Starts the list of windows again. The main window calls it at the start of the app. */
export function resetWindowRoots() {
  try {
    localStorage.removeItem(WINDOWS_KEY);
  } catch {}
}

// A window that closes gives its repositories free. A solo window closes those that no other window shows.
window.addEventListener("beforeunload", () => {
  const roots = settings.tabs.filter((r) => !shownElsewhere(r));
  publishRoots(null);
  if (soloWindow) for (const r of roots) void api.close(r).catch(() => {});
});
