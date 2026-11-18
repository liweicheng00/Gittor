import assert from "node:assert/strict";
import { test } from "node:test";
import type { Worktree } from "../src/api";
import { worktreeMatches, worktreeOrder } from "../src/worktree-filter.ts";

const wt = (path: string, branch: string | null): Worktree => ({ path, head: "abc", branch, detached: !branch, bare: false, locked: false, prunable: false, current: false, main: false });

test("an empty search matches all worktrees", () => {
  assert.equal(worktreeMatches(wt("/w/app", "main"), "app", "  "), true);
});

test("the search matches the name, the path and the branch, without case", () => {
  const w = wt("/work/proj-fix", "feature/Login");
  assert.equal(worktreeMatches(w, "proj-fix", "FIX"), true);
  assert.equal(worktreeMatches(w, "proj-fix", "/work"), true);
  assert.equal(worktreeMatches(w, "proj-fix", "login"), true);
  assert.equal(worktreeMatches(w, "proj-fix", "release"), false);
});

test("a detached worktree matches no branch", () => {
  assert.equal(worktreeMatches(wt("/w/x", null), "x", "main"), false);
});

test("the favorites come first, each part in its order", () => {
  const items = ["/a", "/b", "/c", "/d"].map((path) => ({ path }));
  assert.deepEqual(worktreeOrder(items, new Set(["/d", "/b"])).map((w) => w.path), ["/b", "/d", "/a", "/c"]);
});
