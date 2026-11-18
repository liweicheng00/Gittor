import assert from "node:assert/strict";
import { test } from "node:test";
import { autoStale, isStale, nextMarks } from "../src/stale.ts";

const DAY = 24 * 60 * 60;
const now = 1000 * DAY;
const b = (full: string, ageDays: number, extra: { current?: boolean; gone?: boolean } = {}) => ({ full, time: now - ageDays * DAY, current: !!extra.current, gone: !!extra.gone });

test("a branch without a commit for the set days is stale", () => {
  assert.equal(autoStale(b("refs/heads/a", 31), 30, now), true);
  assert.equal(autoStale(b("refs/heads/a", 29), 30, now), false);
});

test("0 days turns the age off, but a gone tracked branch is still stale", () => {
  assert.equal(autoStale(b("refs/heads/a", 400), 0, now), false);
  assert.equal(autoStale(b("refs/heads/a", 1, { gone: true }), 0, now), true);
});

test("the current branch is never stale by the rule", () => {
  assert.equal(autoStale(b("refs/heads/a", 400, { current: true, gone: true }), 30, now), false);
});

test("a mark puts a new branch in Stale, and a removal keeps an old branch out", () => {
  const fresh = b("refs/heads/new", 1);
  const old = b("refs/heads/old", 100);
  let marks = nextMarks([], [fresh], true, 30, now);
  assert.deepEqual(marks, ["refs/heads/new"]);
  assert.equal(isStale(fresh, new Set(marks), 30, now), true);
  marks = nextMarks(marks, [old], false, 30, now);
  assert.equal(isStale(old, new Set(marks), 30, now), false);
  assert.deepEqual(marks.sort(), ["!refs/heads/old", "refs/heads/new"]);
});

test("a mark again clears the earlier opposite mark", () => {
  const old = b("refs/heads/old", 100);
  const marks = nextMarks(["!refs/heads/old"], [old], true, 30, now);
  assert.deepEqual(marks, []);
  assert.equal(isStale(old, new Set(marks), 30, now), true);
});
