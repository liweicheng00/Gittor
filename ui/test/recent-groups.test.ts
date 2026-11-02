import assert from "node:assert/strict";
import { test } from "node:test";
import { groupRecent, MAX_PROJECTS, MAX_WORKTREES, trimRecent } from "../src/recent-groups.ts";

test("worktrees go under their main repository, in the order of the last use", () => {
  const mainOf = { "/w/app-a": "/r/app", "/w/app-b": "/r/app", "/r/app": "", "/r/lib": "" };
  const groups = groupRecent(["/w/app-a", "/r/lib", "/r/app", "/w/app-b"], mainOf);
  assert.deepEqual(groups, [
    { project: "/r/app", listed: true, worktrees: ["/w/app-a", "/w/app-b"] },
    { project: "/r/lib", listed: true, worktrees: [] },
  ]);
});

test("a project shows when only its worktrees are in the list", () => {
  assert.deepEqual(groupRecent(["/w/x"], { "/w/x": "/r/app" }), [{ project: "/r/app", listed: false, worktrees: ["/w/x"] }]);
});

test("a path that was not read yet is a project of its own", () => {
  assert.deepEqual(groupRecent(["/a"], {}), [{ project: "/a", listed: true, worktrees: [] }]);
});

test("many worktrees do not push the other projects out of the list", () => {
  const mainOf: Record<string, string> = { "/r/app": "", "/r/lib": "" };
  const trees = Array.from({ length: 20 }, (_, i) => `/w/app-${i}`);
  for (const t of trees) mainOf[t] = "/r/app";
  const out = trimRecent([...trees, "/r/app", "/r/lib"], mainOf);
  assert.ok(out.includes("/r/lib"));
  assert.ok(out.includes("/r/app"));
  assert.deepEqual(out.filter((p) => p.startsWith("/w/")), trees.slice(0, MAX_WORKTREES));
});

test("the list keeps the most recent projects", () => {
  const recent = Array.from({ length: MAX_PROJECTS + 3 }, (_, i) => `/r/p${i}`);
  assert.deepEqual(trimRecent(recent, {}), recent.slice(0, MAX_PROJECTS));
});
