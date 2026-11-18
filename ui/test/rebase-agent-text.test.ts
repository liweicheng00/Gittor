import assert from "node:assert/strict";
import { test } from "node:test";
import { agentText } from "../src/rebase-agent-text.ts";
import type { PlanLine } from "../src/rebase-plan.ts";
import type { RewriteCheck } from "../src/api";

const mk = (oid: string, subject: string, action = "pick"): PlanLine => ({ oid, subject, message: subject, author: "Ada", action: action as PlanLine["action"] });

// Display order newest first: E D C B, with A dropped.
const lines: PlanLine[] = [mk("e5e5e5e5", "E: remove util"), mk("d4d4d4d4", "D: greeting"), mk("c3c3c3c3", "C: add util"), mk("b2b2b2b2", "B: change notes"), mk("a1a1a1a1", "A: add notes", "drop")];

const check: RewriteCheck = {
  head: "e5e5e5e5",
  steps: [
    { oid: "a1a1a1a1", status: "dropped", conflicts: [] },
    { oid: "b2b2b2b2", status: "conflict", conflicts: [{ path: "notes.md", kind: "modify/delete" }] },
    { oid: "c3c3c3c3", status: "afterConflict", conflicts: [] },
    { oid: "d4d4d4d4", status: "afterConflict", conflicts: [] },
    { oid: "e5e5e5e5", status: "afterConflict", conflicts: [] },
  ],
  firstChanged: 0,
  changedFiles: ["notes.md"],
  remotes: [{ name: "origin/topic/plan", commits: 3 }],
  otherRefs: ["topic/plan-ui"],
  blockingFiles: [],
};

test("the text lists the todo oldest first with full oids", () => {
  const t = agentText({ repoPath: "/work/demo", branch: "topic/plan", head: "e5e5e5e5", base: "e84df80a", lines, check });
  const todo = t.slice(t.indexOf("## Todo")).split("```")[1];
  assert.deepEqual(
    todo.trim().split("\n"),
    ["drop a1a1a1a1 A: add notes", "pick b2b2b2b2 B: change notes", "pick c3c3c3c3 C: add util", "pick d4d4d4d4 D: greeting", "pick e5e5e5e5 E: remove util"],
  );
});

test("the text reports the conflict with its file and kind", () => {
  const t = agentText({ repoPath: "/work/demo", branch: "topic/plan", head: "e5e5e5e5", base: "e84df80a", lines, check });
  assert.match(t, /b2b2b2b2 "B: change notes": CONFLICT in notes\.md \(modify\/delete\)/);
});

test("the text warns about the pushed commits and the different files", () => {
  const t = agentText({ repoPath: "/work/demo", branch: "topic/plan", head: "e5e5e5e5", base: "e84df80a", lines, check });
  assert.match(t, /3 commit\(s\) are on origin\/topic\/plan/);
  assert.match(t, /The files at the end differ from now: notes\.md/);
});

test("the Undo line names the current HEAD", () => {
  const t = agentText({ repoPath: "/work/demo", branch: "topic/plan", head: "e5e5e5e5", base: "e84df80a", lines, check });
  assert.match(t, /git reset --keep e5e5e5e5/);
});

test("a root base uses --root", () => {
  const t = agentText({ repoPath: "/work/demo", branch: "topic/plan", head: "e5e5e5e5", base: "", lines, check });
  assert.match(t, /rebase -i --empty=keep --root/);
  assert.match(t, /Base: \(root commit\)/);
});
