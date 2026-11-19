import assert from "node:assert/strict";
import { test } from "node:test";
import { absPath } from "../src/abs-path.ts";

test("joins the root and the path", () => {
  assert.equal(absPath("/home/ada/demo", "src/main.rs"), "/home/ada/demo/src/main.rs");
  assert.equal(absPath("/home/ada/demo/", "main.rs"), "/home/ada/demo/main.rs");
  assert.equal(absPath("/", "main.rs"), "/main.rs");
});

test("uses the separator of a Windows root", () => {
  assert.equal(absPath("C:\\work\\demo", "src/main.rs"), "C:\\work\\demo\\src\\main.rs");
  assert.equal(absPath("C:/work/demo", "src/main.rs"), "C:/work/demo/src/main.rs");
});

test("an empty path gives the root, and no root gives the path", () => {
  assert.equal(absPath("/home/ada/demo", ""), "/home/ada/demo");
  assert.equal(absPath("", "src/main.rs"), "src/main.rs");
});
