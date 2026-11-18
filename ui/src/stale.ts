// Which local branches are stale. This module imports nothing at run time, for its unit tests.
// The marks of the user are full ref names: "refs/heads/x" puts a branch in Stale, and "!refs/heads/x"
// keeps it out of Stale, also when the automatic rule finds it.

/** The part of a branch that the rules read. */
export interface StaleInput {
  full: string;
  current: boolean;
  /** The time of the last commit, in seconds. */
  time: number;
  /** The tracked branch is gone from the remote. */
  gone: boolean;
}

/** The automatic rule: no commit for `days` days, or a tracked branch that is gone. 0 days turns the age
 * off. The current branch is never stale by the rule. */
export function autoStale(b: StaleInput, days: number, now: number): boolean {
  if (b.current) return false;
  return b.gone || (days > 0 && b.time > 0 && b.time < now - days * 24 * 60 * 60);
}

export function isStale(b: StaleInput, marks: ReadonlySet<string>, days: number, now: number): boolean {
  if (marks.has(b.full)) return true;
  if (marks.has("!" + b.full)) return false;
  return autoStale(b, days, now);
}

/** The marks after the user marks branches as stale (`on`), or removes them from Stale. */
export function nextMarks(marks: readonly string[], branches: StaleInput[], on: boolean, days: number, now: number): string[] {
  const out = new Set(marks);
  for (const b of branches) {
    out.delete(b.full);
    out.delete("!" + b.full);
    const auto = autoStale(b, days, now);
    if (on && !auto) out.add(b.full);
    if (!on && auto) out.add("!" + b.full);
  }
  return [...out];
}
