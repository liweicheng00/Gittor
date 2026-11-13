// The smallest edits of whole lines that turn one text into another. The diff view applies them to the
// model that shows, so the lines that did not change stay as they are: the cursor, the selection and
// the place of the view stay too.

import type { Hunk } from "./diff3";

/** An edit as Monaco takes it: the range of the old text (lines and columns from 1) and the new text. */
export interface RangeEdit {
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
  text: string;
}

/** Above this number of lines between the first and the last change, one edit replaces all of them. */
const MAX_DIFF_LINES = 20000;

/** The changed line ranges between two texts, as lines without line ends. `diff` is `diffLines` of diff3.ts. */
export function lineHunks(before: string[], after: string[], diff: (a: string[], b: string[]) => Hunk[]): Hunk[] {
  let pre = 0;
  while (pre < before.length && pre < after.length && before[pre] === after[pre]) pre++;
  if (pre === before.length && pre === after.length) return [];
  let suf = 0;
  while (suf < before.length - pre && suf < after.length - pre && before[before.length - 1 - suf] === after[after.length - 1 - suf]) suf++;
  // A very large part: the line diff would cost too much.
  if (before.length + after.length - 2 * (pre + suf) > MAX_DIFF_LINES) return [{ a0: pre, a1: before.length - suf, b0: pre, b1: after.length - suf }];
  return diff(before, after);
}

/** The edits that turn `before` into `after`. All ranges are in `before`; they do not overlap. */
export function rangeEdits(before: string[], after: string[], hunks: Hunk[]): RangeEdit[] {
  const end = (i: number) => before[i].length + 1;
  return hunks.map((h) => {
    const text = after.slice(h.b0, h.b1).join("\n");
    // Lines replace lines.
    if (h.a1 > h.a0 && h.b1 > h.b0) return { startLine: h.a0 + 1, startColumn: 1, endLine: h.a1, endColumn: end(h.a1 - 1), text };
    if (h.a1 === h.a0) {
      // New lines before a line, or after the last line.
      if (h.a0 < before.length) return { startLine: h.a0 + 1, startColumn: 1, endLine: h.a0 + 1, endColumn: 1, text: text + "\n" };
      return { startLine: before.length, startColumn: end(before.length - 1), endLine: before.length, endColumn: end(before.length - 1), text: "\n" + text };
    }
    // Lines go away, with the line end after them, or before them at the end of the text.
    if (h.a1 < before.length) return { startLine: h.a0 + 1, startColumn: 1, endLine: h.a1 + 1, endColumn: 1, text: "" };
    if (h.a0 > 0) return { startLine: h.a0, startColumn: end(h.a0 - 1), endLine: h.a1, endColumn: end(h.a1 - 1), text: "" };
    return { startLine: 1, startColumn: 1, endLine: h.a1, endColumn: end(h.a1 - 1), text: "" };
  });
}

/**
 * Where a line of the old text is in the new text. `line` counts from 0. A line that a hunk replaced
 * goes to the same place in the new lines of the hunk, or to its last new line.
 */
export function lineAfter(line: number, hunks: Hunk[]): number {
  let delta = 0;
  for (const h of hunks) {
    if (line < h.a0) break;
    if (line < h.a1) return h.b0 + Math.min(line - h.a0, Math.max(0, h.b1 - h.b0 - 1));
    delta = h.b1 - h.a1;
  }
  return line + delta;
}
