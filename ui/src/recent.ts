// The recent repositories as rows: each project, then its linked worktrees under it.

import { api } from "./api";
import { pathLabels } from "./path-labels";
import { groupRecent } from "./recent-groups";
import { setRecentProject, settings } from "./settings";

export interface RecentRow {
  path: string;
  /** A short name: unique for a project, the folder name for a worktree. */
  name: string;
  /** The project of a worktree; null for a project. */
  project: string | null;
}

export function recentRows(): RecentRow[] {
  const groups = groupRecent(settings.recent, settings.recentProjects);
  const names = pathLabels(groups.map((g) => g.project));
  return groups.flatMap((g, i) => [
    { path: g.project, name: names[i], project: null },
    ...g.worktrees.map((w) => ({ path: w, name: w.split(/[\\/]/).pop() ?? w, project: g.project })),
  ]);
}

/** Reads the main repository of the recent paths that Gittor did not read yet, for example the paths
 * of an older version. Returns true when a group changed. */
export async function learnRecentProjects(): Promise<boolean> {
  const unknown = settings.recent.filter((p) => !(p in settings.recentProjects));
  if (!unknown.length) return false;
  const infos = await Promise.all(unknown.map((p) => api.repoInfo(p).catch(() => null)));
  let changed = false;
  infos.forEach((info, i) => {
    if (!info) return;
    setRecentProject(unknown[i], info.mainRoot);
    changed ||= !!info.mainRoot;
  });
  return changed;
}
