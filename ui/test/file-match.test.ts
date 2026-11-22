import assert from "node:assert/strict";
import { test } from "node:test";
import { matchFiles, scorePath } from "../src/file-match.ts";

const paths = ["src/main.rs", "src/parser.rs", "docs/guide/start.md", "README.md", "ui/src/main-view.ts", "crates/git/src/lib.rs"];
const names = (q: string) => matchFiles(paths, q).map((m) => m.path);

test("the exact name comes first, then a name that starts with the query", () => {
  assert.deepEqual(names("main.rs").slice(0, 1), ["src/main.rs"]);
  assert.deepEqual(names("main").slice(0, 2), ["src/main.rs", "ui/src/main-view.ts"]);
});

test("the search does not care about the case and spaces", () => {
  assert.deepEqual(names("README"), ["README.md"]);
  assert.deepEqual(names("read me"), ["README.md"]);
});

test("the letters of a name in order match, as an abbreviation", () => {
  assert.deepEqual(names("prs"), ["src/parser.rs"]);
  assert.deepEqual(scorePath("src/parser.rs", "prs")?.hits, [0, 2, 3]);
});

test("a query with a slash matches the folders too", () => {
  assert.deepEqual(names("guide/st"), ["docs/guide/start.md"]);
  assert.deepEqual(names("git/lib"), ["crates/git/src/lib.rs"]);
});

test("a name match is better than a match in the folders only", () => {
  // "src" is in many folders, but no name has it.
  assert.ok(names("src").length >= 4);
  const m = matchFiles(["src/a.ts", "x/src.ts"], "src");
  assert.equal(m[0].path, "x/src.ts");
});

test("no match gives no row, and an empty query gives all files up to the limit", () => {
  assert.deepEqual(names("zzz"), []);
  assert.equal(matchFiles(paths, "", 3).length, 3);
});
