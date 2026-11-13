import assert from "node:assert/strict";
import { test } from "node:test";
import { diffLines } from "../src/diff3.ts";
import { lineAfter, lineHunks as hunksWith, rangeEdits } from "../src/text-edit.ts";

const lineHunks = (a: string[], b: string[]) => hunksWith(a, b, diffLines);

/** Applies the edits as Monaco does: all ranges are in the old text. */
function apply(before: string, after: string): string {
  const [a, b] = [before.split("\n"), after.split("\n")];
  const edits = rangeEdits(a, b, lineHunks(a, b));
  const offset = (line: number, column: number) => a.slice(0, line - 1).reduce((n, l) => n + l.length + 1, 0) + column - 1;
  let out = before;
  // From the end, so the offsets of the earlier edits stay.
  for (const e of [...edits].reverse()) {
    assert.ok(e.startLine >= 1 && e.endLine <= a.length, "the range is in the text");
    assert.ok(e.startColumn <= a[e.startLine - 1].length + 1 && e.endColumn <= a[e.endLine - 1].length + 1, "the columns are in the lines");
    out = out.slice(0, offset(e.startLine, e.startColumn)) + e.text + out.slice(offset(e.endLine, e.endColumn));
  }
  return out;
}
const lines = (n: number) => Array.from({ length: n }, (_, i) => `line ${i + 1}`).join("\n") + "\n";

test("the same text needs no edit", () => {
  assert.deepEqual(lineHunks(["a", "b", ""], ["a", "b", ""]), []);
});

test("a changed line in the middle replaces that line only", () => {
  const before = lines(10);
  const after = before.replace("line 5\n", "LINE 5\n");
  const [a, b] = [before.split("\n"), after.split("\n")];
  assert.deepEqual(rangeEdits(a, b, lineHunks(a, b)), [{ startLine: 5, startColumn: 1, endLine: 5, endColumn: 7, text: "LINE 5" }]);
  assert.equal(apply(before, after), after);
});

test("two changes far apart give two small edits", () => {
  const before = lines(400);
  const after = before.replace("line 20\n", "line 20\nnew\n").replace("line 380\n", "");
  const [a, b] = [before.split("\n"), after.split("\n")];
  const edits = rangeEdits(a, b, lineHunks(a, b));
  assert.deepEqual(edits, [
    { startLine: 21, startColumn: 1, endLine: 21, endColumn: 1, text: "new\n" },
    { startLine: 380, startColumn: 1, endLine: 381, endColumn: 1, text: "" },
  ]);
  assert.equal(apply(before, after), after);
});

test("an added line, a removed line, an append and a cut", () => {
  const before = lines(6);
  for (const after of [
    before.replace("line 3\n", "line 3\nnew\n"),
    before.replace("line 3\n", ""),
    before + "more\n",
    before + "no line end",
    lines(3),
    "",
    "first\n" + before,
    before.slice(0, -1),
    "other",
  ]) {
    assert.equal(apply(before, after), after);
    assert.equal(apply(after, before), before);
  }
});

test("repeated lines", () => {
  for (const [a, b] of [["x\nx\n", "x\nx\nx\n"], ["a\na\na\n", "a\n"], ["ab", "abab"], ["aa\n", "a\n"], ["a\nb", "b\na"]]) {
    assert.equal(apply(a, b), b);
    assert.equal(apply(b, a), a);
  }
});

test("random edits give the new text", () => {
  let seed = 42;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let i = 0; i < 500; i++) {
    const a = Array.from({ length: Math.floor(rnd() * 10) }, () => "abc"[Math.floor(rnd() * 3)]);
    const b = [...a];
    for (let k = 0; k < 3; k++) {
      const at = Math.floor(rnd() * (b.length + 1));
      if (rnd() < 0.5) b.splice(at, 0, "abc"[Math.floor(rnd() * 3)]);
      else b.splice(at, 1);
    }
    const [x, y] = [a.join("\n") + (rnd() < 0.5 ? "\n" : ""), b.join("\n") + (rnd() < 0.5 ? "\n" : "")];
    assert.equal(apply(x, y), y, JSON.stringify([x, y]));
  }
});

test("a very large change is one edit", () => {
  const a = Array.from({ length: 12000 }, (_, i) => `a${i}`);
  const b = Array.from({ length: 12000 }, (_, i) => `b${i}`);
  assert.deepEqual(lineHunks(["top", ...a, "end"], ["top", ...b, "end"]), [{ a0: 1, a1: 12001, b0: 1, b1: 12001 }]);
});

test("a line of the view keeps its text when lines change above and below it", () => {
  const before = lines(400);
  const a = before.split("\n");
  // Two lines come above line 200, one line goes away above it, and lines change below it.
  const after = before.replace("line 20\n", "line 20\nnew a\nnew b\n").replace("line 90\n", "").replace("line 300\n", "LINE 300\nmore\n");
  const b = after.split("\n");
  const hunks = lineHunks(a, b);
  assert.equal(hunks.length, 3);
  const at = lineAfter(199, hunks);
  assert.equal(at, 200);
  assert.equal(b[at], "line 200");
  assert.equal(b[lineAfter(349, hunks)], "line 350");
  assert.equal(lineAfter(5, hunks), 5);
  assert.equal(b[lineAfter(299, hunks)], "LINE 300", "a replaced line goes to its new text");
  // A line that went away: the place where it was.
  const cut = lineHunks(a, before.replace("line 50\nline 51\nline 52\n", "one\n").split("\n"));
  assert.equal(lineAfter(51, cut), 49, "the last new line of the hunk");
});
