// The search and the order of the Worktrees tab. This module imports nothing at run time, for its unit tests.

import type { Worktree } from "./api";

/** The text that a search matches: the short name, the path and the branch. */
export function worktreeMatches(w: Worktree, label: string, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [label, w.path, w.branch ?? ""].some((s) => s.toLowerCase().includes(q));
}

/** The order of the rows: the favorites first, then the others, each in the order of git. */
export function worktreeOrder<T extends { path: string }>(items: T[], favorites: Set<string>): T[] {
  return [...items.filter((w) => favorites.has(w.path)), ...items.filter((w) => !favorites.has(w.path))];
}
