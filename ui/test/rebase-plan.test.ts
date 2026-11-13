import assert from "node:assert/strict";
import { test } from "node:test";
import { moveLine, planError, setAction, squashGroups, squashOnto, toPlan, type PlanLine } from "../src/rebase-plan.ts";

// Display order is newest first. These commits are, top to bottom: E D C B A.
const mk = (oid: string, action = "pick"): PlanLine => ({ oid, subject: oid, message: oid, author: "x", action: action as PlanLine["action"] });
const lines = () => ["E", "D", "C", "B", "A"].map((o) => mk(o));
const order = (ls: PlanLine[]) => ls.map((l) => `${l.action} ${l.oid}`);

test("moveLine moves C to the top", () => {
  assert.deepEqual(order(moveLine(lines(), 2, 0)), ["pick C", "pick E", "pick D", "pick B", "pick A"]);
});

test("squashOnto puts the dragged line right above its target and marks it squash", () => {
  // Squash C (index 2) into D (index 1): C goes above D, below E.
  assert.deepEqual(order(squashOnto(lines(), 2, 1, false)), ["pick E", "squash C", "pick D", "pick B", "pick A"]);
});

test("squashOnto with fixup, dragging an older line up onto a newer one", () => {
  // Squash A (index 4) into E (index 0): A goes above E (top), as a fixup.
  assert.deepEqual(order(squashOnto(lines(), 4, 0, true)), ["fixup A", "pick E", "pick D", "pick C", "pick B"]);
});

test("a line cannot squash onto itself", () => {
  assert.deepEqual(order(squashOnto(lines(), 2, 2, false)), order(lines()));
});

test("planError rejects the oldest kept commit as a squash", () => {
  const ls = setAction(lines(), 4, "squash"); // A is the oldest, marked squash
  assert.equal(planError(ls), "The oldest kept commit cannot be squashed: there is no commit below it.");
});

test("planError allows a squash when a kept commit is below it", () => {
  const ls = setAction(lines(), 3, "squash"); // B squashes into A
  assert.equal(planError(ls), null);
});

test("planError rejects dropping every commit", () => {
  const ls = lines().map((l) => ({ ...l, action: "drop" as PlanLine["action"] }));
  assert.equal(planError(ls), "The plan drops every commit. Keep at least one.");
});

test("squashGroups joins squashes with the kept commit below them", () => {
  // Display: E, squash D, C, B, A -> oldest first: A B C D(squash) E
  const ls = setAction(lines(), 1, "squash");
  const oldest = [...ls].reverse();
  // A[0] B[1] C[2] D[3,squash into C] E[4]
  assert.deepEqual(squashGroups(oldest), [[0], [1], [2, 3], [4]]);
});

test("toPlan returns the entries oldest first and keeps group messages", () => {
  const ls = setAction(lines(), 1, "squash");
  ls[2] = { ...ls[2], message2: "joined message" }; // C keeps the group message
  const plan = toPlan(ls);
  assert.deepEqual(plan.map((e) => `${e.action} ${e.oid}`), ["pick A", "pick B", "pick C", "squash D", "pick E"]);
  assert.equal(plan.find((e) => e.oid === "C")?.message, "joined message");
});

test("toPlan drops the message of a dropped commit", () => {
  const ls = setAction(lines(), 0, "drop");
  assert.equal(toPlan(ls).find((e) => e.oid === "E")?.message, undefined);
});
