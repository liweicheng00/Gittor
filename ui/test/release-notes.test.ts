// The release notes (scripts/release-notes.mjs).
import { test } from "node:test";
import assert from "node:assert/strict";
// @ts-ignore: a plain JavaScript module of the scripts folder.
import { githubNotes, notesPath, parseNotes, updateNotes } from "../../scripts/release-notes.mjs";

const good = `Switch the project tabs with the keyboard.

## New
- Alt+1 to Alt+9 show the project tab at that place.

## Fixed
- The Markdown preview keeps the theme of the editors.
`;

test("good notes have no errors", () => {
  const notes = parseNotes(good);
  assert.deepEqual(notes.errors, []);
  assert.equal(notes.summary, "Switch the project tabs with the keyboard.");
  assert.deepEqual(notes.sections.map((s: { name: string }) => s.name), ["New", "Fixed"]);
});

test("the text for GitHub and for the update notification", () => {
  const notes = parseNotes(good);
  assert.equal(githubNotes(notes), good);
  assert.equal(
    updateNotes(notes),
    "Switch the project tabs with the keyboard.\n- Alt+1 to Alt+9 show the project tab at that place.\n- The Markdown preview keeps the theme of the editors.\n",
  );
});

test("the errors", () => {
  const errs = (text: string) => parseNotes(text).errors.join("\n");
  assert.match(errs("## New\n- A thing.\n"), /no summary/);
  assert.match(errs("Sum.\n\n## Fixes\n- A thing.\n"), /not one of/);
  assert.match(errs("Sum.\n\n## Fixed\n- A.\n## New\n- B.\n"), /order/);
  assert.match(errs("Sum.\n\n## New\n"), /no items/);
  assert.match(errs("Sum.\n\n## New\n- See 8e8b7d9.\n"), /hashes/);
  assert.match(errs("Sum.\n\n## New\n- A change in update-flow.ts.\n"), /file names/);
  assert.match(errs("Sum.\n\n## New\n- feat: a thing.\n"), /prefixes/);
  assert.match(errs(`Sum.\n\n## New\n- ${"word ".repeat(26)}\n`), /26 words/);
  assert.match(errs("Sum.\n\n## New\n- A.\nA free paragraph.\n"), /only a summary/);
});

test("the path of the notes", () => {
  assert.equal(notesPath("0.1.4"), "docs/releases/v0.1.4.md");
});
