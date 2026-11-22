// The search of Go to File: it ranks the files of the working tree for a query, as the file search of
// IntelliJ does. This module imports nothing at run time, for its unit tests.

export interface FileMatch {
  path: string;
  /** The places of the matched characters in the file name, for the highlight. */
  hits: number[];
  score: number;
}

/** The places of the characters of `query` in `text`, in order, or null. Earlier and closer is better. */
function subsequence(text: string, query: string): number[] | null {
  const hits: number[] = [];
  let at = 0;
  for (const c of query) {
    const i = text.indexOf(c, at);
    if (i < 0) return null;
    hits.push(i);
    at = i + 1;
  }
  return hits;
}

const range = (start: number, n: number) => Array.from({ length: n }, (_, i) => start + i);

/** The score of one path for a lower-case query without spaces, or null when it does not match. */
export function scorePath(path: string, query: string): FileMatch | null {
  const slash = path.lastIndexOf("/");
  const name = path.slice(slash + 1).toLowerCase();
  const full = path.toLowerCase();
  if (!query) return { path, hits: [], score: 0 };
  // A query with a slash matches the whole path; the highlight stays on the name part.
  if (query.includes("/")) {
    const at = full.indexOf(query);
    if (at >= 0) return { path, hits: [], score: 500 - at };
    return subsequence(full, query) ? { path, hits: [], score: 100 } : null;
  }
  if (name === query) return { path, hits: range(0, query.length), score: 1000 };
  if (name.startsWith(query)) return { path, hits: range(0, query.length), score: 900 - (name.length - query.length) };
  const at = name.indexOf(query);
  if (at >= 0) return { path, hits: range(at, query.length), score: 700 - at };
  const sub = subsequence(name, query);
  if (sub) return { path, hits: sub, score: 500 - (sub[sub.length - 1] - sub[0]) };
  if (full.includes(query)) return { path, hits: [], score: 300 };
  return subsequence(full, query) ? { path, hits: [], score: 100 } : null;
}

/** The files that match `query`, best first, at most `limit`. Spaces in the query are ignored. */
export function matchFiles(paths: string[], query: string, limit = 50): FileMatch[] {
  const q = query.toLowerCase().replace(/\s+/g, "");
  const out: FileMatch[] = [];
  for (const p of paths) {
    const m = scorePath(p, q);
    if (m) out.push(m);
  }
  out.sort((a, b) => b.score - a.score || a.path.length - b.path.length || a.path.localeCompare(b.path));
  return out.slice(0, limit);
}
