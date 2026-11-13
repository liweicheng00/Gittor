// UI scenario for notes on local changes in the Compare window (a double click in the Changes tab): add a
// note, resolve it (only its icon stays), open it again with the icon, and a change of the file on disk
// clears its notes. The diff panel under the Changes tab has no notes.
// Start the dev server first (see README). Build a fresh repository with make-demo-repo.sh, then:
// node e2e/local-notes.mjs <repo> <screenshot-dir>.
// Set CHROMIUM to a Chromium binary when Playwright has no downloaded browser.
import { chromium } from "playwright";
import { appendFileSync } from "node:fs";
const [,, repo, outDir] = process.argv;
// A second changed file, for the copy of the notes of all files.
appendFileSync(`${repo}/arith.rs`, "// more\n");

const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const page = await (await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1.5 })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push("pageerror: " + e));
page.on("console", (m) => m.type() === "error" && errors.push("console: " + m.text()));
const shot = async (name) => { await page.screenshot({ path: `${outDir}/${name}.png` }); console.log("shot", name); };
const check = (what, ok) => { console.log(ok ? "ok  " : "FAIL", what); if (!ok) errors.push("check: " + what); };
const within = async (what, fn, ms = 8000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return check(what, true);
    await page.waitForTimeout(100);
  }
  check(what, false);
};
const win = ".history-window[aria-label='Compare Branches']";
const cards = () => page.$$eval(`${win} .note-card:not(.draft)`, (els) => els.map((e) => e.textContent));
const chips = () => page.$$(`${win} .note-chip`);
const modified = `${win} .editor.modified`;
const lineNumber = (n) => page.locator(`${modified} .line-numbers`).filter({ hasText: new RegExp(`^${n}$`) }).first();
/** Opens the Compare window of a local change with a double click, and waits for its diff. */
const compareOf = async (file) => {
  await page.dblclick(`.cl-file:has(.path:text-is('${file}'))`);
  await page.waitForSelector(win);
  await within(`the Compare window shows ${file}`, async () => ((await page.textContent(`${win} .compare-file.selected`).catch(() => "")) ?? "").includes(file));
  await page.waitForSelector(`${modified} .view-line`);
};
const closeCompare = async () => {
  await page.keyboard.press("Escape");
  await page.waitForSelector(win, { state: "detached" });
};
/** Adds a note on a line with the note icon in the gutter. */
const addNote = async (line, text) => {
  await lineNumber(line).hover();
  await within(`the note icon shows at line ${line}`, async () => (await page.$$(`${modified} .note-add-icon`)).length === 1);
  await page.click(`${modified} .note-add-icon`);
  await page.waitForSelector(`${win} .note-card.draft textarea`);
  await page.fill(`${win} .note-card.draft textarea`, text);
  await page.press(`${win} .note-card.draft textarea`, "Control+Enter");
  await within(`the note "${text}" shows as a card`, async () => (await cards()).some((t) => t.includes(text)));
};

await page.goto(`${process.env.GITTOR_E2E_URL ?? "http://127.0.0.1:5174"}/?repo=${encodeURIComponent(repo)}`);
await page.waitForSelector(".log-row", { timeout: 30000 });
await page.click(".lp-tab:text-is('Changes')");

// The diff panel under the Changes tab has no notes.
await page.click(".cl-file:has(.path:text-is('main.rs'))");
await page.waitForSelector(".diff .editor.modified .view-line");
await page.locator(".diff .editor.modified .line-numbers").filter({ hasText: /^2$/ }).first().hover();
await page.waitForTimeout(500);
check("the diff panel has no note icon", (await page.$$(".diff .editor.modified .note-add-icon")).length === 0);

// A note in the Compare window, with the icon in the gutter, as in a review.
await compareOf("main.rs");
await addNote(2, "Ask the agent to log this");
await shot("ln1-note");

// A note on another file of the window.
await page.click(`${win} .compare-file:has-text('arith.rs')`);
await page.waitForFunction((w) => document.querySelector(`${w} .diff-title`)?.textContent?.includes("arith.rs"), win);
await page.waitForSelector(`${modified} .view-line`);
await addNote(1, "Check the overflow");

// The right side on a branch: these are no local changes, so no notes.
await page.selectOption(`${win} .compare-select >> nth=1`, "feature/cli");
await within("the window shows the files of feature/cli", async () => !(((await page.textContent(`${win} .compare-files-title`)) ?? "").includes(" in ")));
await within("the window loads a file of feature/cli", async () => ((await page.textContent(`${win} .diff-title`).catch(() => "")) ?? "").trim() !== "");
await page.waitForTimeout(500);
check("a branch on the right side has no notes", (await cards()).length === 0 && (await chips()).length === 0);
await closeCompare();

// The button of the Changes tab copies the open notes of all files.
await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
const clipboard = () => page.evaluate(() => navigator.clipboard.readText());
await page.click(".commit-copy-notes");
await within("the button copies the notes of all files, by file", async () =>
  (await clipboard()) === "arith.rs:1\nCheck the overflow\n\nmain.rs:2\nAsk the agent to log this");
await compareOf("main.rs");
await within("main.rs shows its note again", async () => (await cards()).some((t) => t.includes("Ask the agent")));

// Resolve: only the icon stays at the line.
await page.click(`${win} .note-card:has-text('Ask the agent') .note-card-resolve`);
await within("a resolved note shows its icon only", async () => (await cards()).length === 0 && (await chips()).length === 1);
await shot("ln2-resolved");
await page.click(`${win} .note-chip`);
await within("a click on the icon shows the note", async () => (await cards()).some((t) => t.includes("resolved")));
await page.click(`${win} .note-card .note-card-fold`);
await within("the fold button shows the icon again", async () => (await cards()).length === 0 && (await chips()).length === 1);
await closeCompare();
await page.click(".commit-copy-notes");
await within("the button leaves out the resolved note", async () => (await clipboard()) === "arith.rs:1\nCheck the overflow");

// The note stays after a reload, while the file is the same.
await page.reload();
await page.waitForSelector(".log-row", { timeout: 30000 });
await page.click(".lp-tab:text-is('Changes')");
await page.waitForSelector(".cl-file:has(.path:text-is('main.rs'))");
await compareOf("main.rs");
await within("the note stays after a reload", async () => (await chips()).length === 1);

// A change of the file on disk clears its notes; the window loads the file again.
appendFileSync(`${repo}/main.rs`, "// changed by an agent\n");
await within("a change of the file clears its notes", async () => (await chips()).length === 0 && (await cards()).length === 0, 10000);

console.log("errors:", JSON.stringify(errors));
await browser.close();
if (errors.length) process.exit(1);
