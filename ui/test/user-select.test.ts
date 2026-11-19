// The guard for text selection (AGENTS.md, "Text selection and copy"). The user must be able to select
// the text of the app with the mouse. `user-select: none` is only for the selectors of the list below,
// each with its reason. The test reads the CSS as text.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/** The selectors that may have `user-select: none`, and why. */
const ALLOWED: Record<string, string> = {
  "body.resizing-x": "A splitter moves. The drag must not select text on its way.",
  "body.resizing-x *": "A splitter moves. The drag must not select text on its way.",
  "body.resizing-y": "A splitter moves. The drag must not select text on its way.",
  "body.resizing-y *": "A splitter moves. The drag must not select text on its way.",
  ".tabbar": "The project tabs: a custom drag moves a tab, and the bar is the title bar of the window.",
  ".group-header": "A header of the Branches tab: a click opens and closes the group.",
  ".commit-tree": "The files of the Changes tab are draggable to a changelist. Mod+C copies their paths.",
  ".cl-header": "A header of a changelist: a click opens and closes it, and files drop on it.",
  ".sm-head": "The header of the Submodules section: a click opens and closes it.",
  ".rebase-grip": "The handle of a row of the rebase editor: it starts the custom drag.",
};

const rulesOf = (file: string) => {
  const css = readFileSync(new URL(`../src/${file}`, import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ selectors: m[1].split(",").map((s) => s.trim().replace(/\s+/g, " ")), body: m[2] }));
};

for (const file of ["style.css", "glow.css"]) {
  test(`${file}: user-select: none is only on the allowed selectors`, () => {
    const found: string[] = [];
    for (const r of rulesOf(file)) {
      if (!/(^|[;\s])(-webkit-)?user-select\s*:\s*none/.test(r.body)) continue;
      for (const s of r.selectors) {
        found.push(s);
        assert.ok(ALLOWED[s], `${file}: "${s}" has user-select: none. The user cannot select its text. Remove it, or add the selector to ALLOWED with a reason (AGENTS.md, "Text selection and copy").`);
      }
    }
    if (file === "style.css") for (const s of Object.keys(ALLOWED)) assert.ok(found.includes(s), `"${s}" is in ALLOWED, but style.css has no such rule. Remove the entry.`);
  });

  test(`${file}: user-select has a value that all web views know`, () => {
    for (const r of rulesOf(file)) {
      for (const m of r.body.matchAll(/user-select\s*:\s*([a-z-]+)/g)) assert.ok(["none", "text", "auto"].includes(m[1]), `${file}: "${r.selectors.join(", ")}" has user-select: ${m[1]}`);
    }
  });
}
