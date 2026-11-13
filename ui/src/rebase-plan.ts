// The plan of an interactive rebase, as the editor shows it: newest commit first, like the log. The
// functions are pure, so ui/test/rebase-plan.test.ts can check them without the DOM. A squash or fixup
// joins its commit into the kept commit below it, as git rebase does oldest first.

import type { PlanAction, PlanEntry, RewriteRange } from "./api";

export interface PlanLine {
  oid: string;
  subject: string;
  message: string;
  author: string;
  action: PlanAction;
  /** A message that the user set for a reword, or for the whole squash group. */
  message2?: string;
}

/** The number of fixup!, squash! and amend! commits in a range. */
export function autosquashCount(range: RewriteRange): number {
  return range.entries.filter((e) => /^(fixup|squash|amend)! /.test(e.subject)).length;
}

/** The lines of a range, newest first, all Pick. The flow applies autosquash (it needs autosquash.ts). */
export function linesOf(range: RewriteRange): PlanLine[] {
  return range.entries.map((e) => ({ ...e, action: "pick" as PlanAction })).reverse();
}

/** Moves the line at `from` to the place `to` (both in display order). */
export function moveLine(lines: PlanLine[], from: number, to: number): PlanLine[] {
  if (from === to || from < 0 || from >= lines.length) return lines;
  const next = lines.slice();
  const [line] = next.splice(from, 1);
  next.splice(to, 0, line);
  return next;
}

/** Joins the line at `from` into the target line: it moves right above the target and becomes squash, or
 * fixup. The target stays a kept commit (pick or reword). A line cannot join into itself. */
export function squashOnto(lines: PlanLine[], from: number, target: number, fixup: boolean): PlanLine[] {
  if (from === target || from < 0 || target < 0 || from >= lines.length || target >= lines.length) return lines;
  const next = lines.slice();
  const line = { ...next[from], action: (fixup ? "fixup" : "squash") as PlanAction };
  next.splice(from, 1);
  // The target shifts by one when the removed line was above it.
  const at = from < target ? target - 1 : target;
  next.splice(at, 0, line);
  return next;
}

/** Sets the action of one line. A kept commit keeps its reword message; a squash keeps the group message. */
export function setAction(lines: PlanLine[], index: number, action: PlanAction): PlanLine[] {
  const next = lines.slice();
  next[index] = { ...next[index], action };
  return next;
}

/** The error of a plan, or null when it is valid. The oldest kept commit cannot be a squash or fixup,
 * because there is no commit below it to join into. */
export function planError(lines: PlanLine[]): string | null {
  const kept = lines.filter((l) => l.action !== "drop");
  if (!kept.length) return "The plan drops every commit. Keep at least one.";
  const oldestKept = kept[kept.length - 1];
  if (oldestKept.action === "squash" || oldestKept.action === "fixup") {
    return "The oldest kept commit cannot be squashed: there is no commit below it.";
  }
  return null;
}

/** The groups of a kept commit and the squashes and fixups above it, oldest first. Each group is the
 * indexes into the oldest-first plan. A group with more than one line becomes one commit. */
export function squashGroups(oldestFirst: PlanLine[]): number[][] {
  const groups: number[][] = [];
  oldestFirst.forEach((l, i) => {
    if (l.action === "drop") return;
    if (l.action === "squash" || l.action === "fixup") groups[groups.length - 1]?.push(i);
    else groups.push([i]);
  });
  return groups;
}

/** The plan for the backend, oldest first. The message of a reword or a squash group goes on its lines. */
export function toPlan(lines: PlanLine[]): PlanEntry[] {
  const oldest = [...lines].reverse();
  return oldest.map((l) => ({
    oid: l.oid,
    action: l.action,
    message: l.action === "drop" ? undefined : l.message2,
    author: undefined,
  }));
}

/** Where a drop puts a commit: right above (newer than) the target, right below it, or into it. */
export type DropPlace = "above" | "below" | "onto";

/** Moves the commit `fromOid` next to `targetOid`, or joins it into the target (squash, or fixup). A drop
 * in the log graph uses this to start the editor with the move done. Unknown oids change nothing. */
export function placeRelative(lines: PlanLine[], fromOid: string, targetOid: string, where: DropPlace, fixup = false): PlanLine[] {
  const from = lines.findIndex((l) => l.oid === fromOid);
  const target = lines.findIndex((l) => l.oid === targetOid);
  if (from < 0 || target < 0 || from === target) return lines;
  if (where === "onto") return squashOnto(lines, from, target, fixup);
  // The target moves up by one when the dragged line leaves a place above it.
  const t = from < target ? target - 1 : target;
  return moveLine(lines, from, where === "above" ? t : t + 1);
}
