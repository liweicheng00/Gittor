// The parts of the Markdown preview without DOM (markdown-model.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { markBlocks, removedAnchors, resolvePath, slug, type LineChange } from "../src/markdown-model.ts";

const change = (o1: number, o2: number, m1: number, m2: number): LineChange => ({
  originalStartLineNumber: o1,
  originalEndLineNumber: o2,
  modifiedStartLineNumber: m1,
  modifiedEndLineNumber: m2,
});

test("marks of the new side", () => {
  const blocks: [number, number][] = [[1, 1], [3, 5], [7, 7], [9, 10]];
  // Lines 3-4 replace old line 3; line 7 is new; nothing touches 1 and 9-10.
  const changes = [change(3, 3, 3, 4), change(5, 0, 7, 7)];
  assert.deepEqual(markBlocks(blocks, changes, "modified"), [null, "changed", "added", null]);
});

test("marks of the old side", () => {
  const blocks: [number, number][] = [[1, 1], [3, 3], [5, 6]];
  // Old line 3 changed; old lines 5-6 were removed.
  const changes = [change(3, 3, 3, 4), change(5, 6, 6, 0)];
  assert.deepEqual(markBlocks(blocks, changes, "original"), [null, "changed", "removed"]);
});

test("a changed block wins over an added block", () => {
  assert.deepEqual(markBlocks([[1, 5]], [change(0, 0, 1, 1), change(3, 3, 3, 3)], "modified"), ["changed"]);
});

test("the places of removed blocks in one column", () => {
  const blocks: [number, number][] = [[1, 1], [3, 3], [5, 6]];
  // Old 3 changed into new 3-4: it shows before new line 3. Old 5-6 removed after new line 6: before 7.
  const changes = [change(3, 3, 3, 4), change(5, 6, 6, 0)];
  assert.deepEqual(removedAnchors(blocks, changes), [null, 3, 7]);
});

test("paths of images", () => {
  assert.equal(resolvePath("docs", "shot.png"), "docs/shot.png");
  assert.equal(resolvePath("docs/guide", "../img/a b.png"), "docs/img/a b.png");
  assert.equal(resolvePath("docs", "./img/a%20b.png?raw=1#x"), "docs/img/a b.png");
  assert.equal(resolvePath("docs", "/assets/logo.svg"), "assets/logo.svg");
  assert.equal(resolvePath("", "logo.png"), "logo.png");
  // Never above the root, never a URL.
  assert.equal(resolvePath("docs", "../../x.png"), null);
  assert.equal(resolvePath("", "https://example.com/a.png"), null);
  assert.equal(resolvePath("", "//example.com/a.png"), null);
  assert.equal(resolvePath("", "data:image/png;base64,AA"), null);
  assert.equal(resolvePath("", "#top"), null);
});

test("anchors of headings", () => {
  assert.equal(slug("Build and Test"), "build-and-test");
  assert.equal(slug("What's new in 1.2?"), "whats-new-in-12");
  assert.equal(slug("中文 標題"), "中文-標題");
});
