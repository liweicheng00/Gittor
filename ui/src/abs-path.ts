// The absolute path of a file of a repository, for the clipboard.

/** Joins the root of a repository (or worktree) and a path in it. The result uses the separator of the root. */
export function absPath(root: string, rel: string): string {
  if (!root) return rel;
  const windows = root.includes("\\") && !root.includes("/");
  const sep = windows ? "\\" : "/";
  const base = root.length > 1 && root.endsWith(sep) ? root.slice(0, -1) : root;
  const tail = (windows ? rel.replace(/\//g, "\\") : rel).replace(/^[\\/]+/, "");
  if (!tail) return base;
  return base === sep ? sep + tail : base + sep + tail;
}
