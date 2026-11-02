// The recent repositories in groups by project. A project is a main repository; its linked worktrees go
// under it. A pure module, so that the unit tests can load it.

export interface RecentGroup {
  /** The main repository of the project. */
  project: string;
  /** True when the main repository itself is in the recent list. */
  listed: boolean;
  /** The linked worktrees of the project, the most recent first. */
  worktrees: string[];
}

/** The most recent projects that the list keeps, and the worktrees of one project that it keeps. */
export const MAX_PROJECTS = 12;
export const MAX_WORKTREES = 8;

/** `mainOf` gives the main repository of a linked worktree, "" for a main repository, and nothing for a
 * path that Gittor did not read yet. A path without an entry is a project of its own. */
const projectOf = (path: string, mainOf: Record<string, string>) => mainOf[path] || path;

/** Puts the recent paths in groups. The order of the groups is the order of their most recent use. */
export function groupRecent(recent: string[], mainOf: Record<string, string>): RecentGroup[] {
  const groups = new Map<string, RecentGroup>();
  for (const path of recent) {
    const project = projectOf(path, mainOf);
    let g = groups.get(project);
    if (!g) groups.set(project, (g = { project, listed: false, worktrees: [] }));
    if (path === project) g.listed = true;
    else g.worktrees.push(path);
  }
  return [...groups.values()];
}

/** Removes the oldest paths: the list keeps MAX_PROJECTS projects and MAX_WORKTREES worktrees of each.
 * Many worktrees of one project thus do not push the other projects out of the list. */
export function trimRecent(recent: string[], mainOf: Record<string, string>): string[] {
  const keep = new Set<string>();
  for (const g of groupRecent(recent, mainOf).slice(0, MAX_PROJECTS)) {
    if (g.listed) keep.add(g.project);
    for (const w of g.worktrees.slice(0, MAX_WORKTREES)) keep.add(w);
  }
  return recent.filter((p) => keep.has(p));
}
