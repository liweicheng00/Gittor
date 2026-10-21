// The default keys of the keymap: two actions must not share a key. keyboard.ts loads the whole UI, so
// the test reads its source text.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../src/keyboard.ts", import.meta.url), "utf8");

/** The default keys of each action: the strings of its `defaults:` expression, on Mac and on other systems. */
function defaults(): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const m of source.matchAll(/\{\s*id:\s*"([^"]+)"[\s\S]*?defaults:\s*(.*?)(?:,\s*run:|,?\s*\n)/g)) {
    out.set(m[1], new Set([...m[2].matchAll(/"([^"]+)"/g)].map((k) => k[1])));
  }
  return out;
}

test("the keymap has actions", () => {
  assert.ok(defaults().size > 20);
});

test("no two actions have the same default key", () => {
  const owner = new Map<string, string>();
  for (const [id, keys] of defaults()) {
    for (const key of keys) {
      assert.ok(!owner.has(key), `${key} is the default of ${owner.get(key)} and ${id}`);
      owner.set(key, id);
    }
  }
});
