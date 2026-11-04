import assert from "node:assert/strict";
import { test } from "node:test";
import { formatNote, formatNotes } from "../src/note-format.ts";

test("a note on a line names the file and the line", () => {
  assert.equal(formatNote("src/cli.rs", { line: 3, text: "Use a logger here\n" }), "src/cli.rs:3\nUse a logger here");
});

test("a note on more lines names the first and the last line", () => {
  assert.equal(formatNote("src/cli.rs", { line: 3, endLine: 7, text: "Split this" }), "src/cli.rs:3-7\nSplit this");
  assert.equal(formatNote("src/cli.rs", { line: 3, endLine: 0, text: "One line" }), "src/cli.rs:3\nOne line");
});

test("a note on the whole file names the file only", () => {
  assert.equal(formatNote("src/cli.rs", { line: 0, text: "The file needs tests" }), "src/cli.rs\nThe file needs tests");
});

test("the notes of a file: the file note first, then by line, with a blank line between", () => {
  const text = formatNotes("a.rs", [
    { line: 9, text: "Last" },
    { line: 0, text: "Whole file" },
    { line: 2, text: "Two\nlines" },
  ]);
  assert.equal(text, "a.rs\nWhole file\n\na.rs:2\nTwo\nlines\n\na.rs:9\nLast");
});
