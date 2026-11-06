// UI scenario for notes on local changes in the Changes tab: add a note, resolve it (only its icon stays),
// open it again with the icon, and a change of the file on disk clears its notes.
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
const cards = () => page.$$eval(".diff .note-card:not(.draft)", (els) => els.map((e) => e.textContent));
const chips = () => page.$$(".diff .note-chip");

await page.goto(`${process.env.GITTOR_E2E_URL ?? "http://127.0.0.1:5174"}/?repo=${encodeURIComponent(repo)}`);
await page.waitForSelector(".log-row", { timeout: 30000 });
await page.click(".lp-tab:text-is('Changes')");
await page.click(".cl-file:has(.path:text-is('main.rs'))");
const modified = ".diff .editor.modified";
await page.waitForSelector(`${modified} .view-line`);

// A note with the icon in the gutter, as in a review.
const lineNumber = (n) => page.locator(`${modified} .line-numbers`).filter({ hasText: new RegExp(`^${n}$`) }).first();
await lineNumber(2).hover();
await within("the note icon shows in the diff of a local change", async () => (await page.$$(`${modified} .note-add-icon`)).length === 1);
await page.click(`${modified} .note-add-icon`);
await page.waitForSelector(".diff .note-card.draft textarea");
await page.fill(".diff .note-card.draft textarea", "Ask the agent to log this");
await page.press(".diff .note-card.draft textarea", "Control+Enter");
await within("the note shows as a card", async () => (await cards()).some((t) => t.includes("Ask the agent to log this")));
await shot("ln1-note");

// A note on another file, then the button of the toolbar copies the open notes of all files.
await page.click(".cl-file:has(.path:text-is('arith.rs'))");
await page.waitForFunction(() => document.querySelector(".diff .diff-title")?.textContent?.includes("arith.rs"));
await page.waitForSelector(`${modified} .view-line`);
await lineNumber(1).hover();
await within("the note icon shows in arith.rs", async () => (await page.$$(`${modified} .note-add-icon`)).length === 1);
await page.click(`${modified} .note-add-icon`);
await page.fill(".diff .note-card.draft textarea", "Check the overflow");
await page.press(".diff .note-card.draft textarea", "Control+Enter");
await within("the second note shows", async () => (await cards()).some((t) => t.includes("Check the overflow")));
await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
const clipboard = () => page.evaluate(() => navigator.clipboard.readText());
await page.click(".commit-copy-notes");
await within("the button copies the notes of all files, by file", async () =>
  (await clipboard()) === "arith.rs:1\nCheck the overflow\n\nmain.rs:2\nAsk the agent to log this");
await page.click(".cl-file:has(.path:text-is('main.rs'))");
await page.waitForFunction(() => document.querySelector(".diff .diff-title")?.textContent?.includes("main.rs"));
await within("main.rs shows its note again", async () => (await cards()).some((t) => t.includes("Ask the agent")));

// Resolve: only the icon stays at the line.
await page.click(".diff .note-card:has-text('Ask the agent') .note-card-resolve");
await within("a resolved note shows its icon only", async () => (await cards()).length === 0 && (await chips()).length === 1);
await shot("ln2-resolved");
await page.click(".commit-copy-notes");
await within("the button leaves out the resolved note", async () => (await clipboard()) === "arith.rs:1\nCheck the overflow");
await page.click(".diff .note-chip");
await within("a click on the icon shows the note", async () => (await cards()).some((t) => t.includes("resolved")));
await page.click(".diff .note-card .note-card-fold");
await within("the fold button shows the icon again", async () => (await cards()).length === 0 && (await chips()).length === 1);

// The note stays after a reload, while the file is the same.
await page.reload();
await page.waitForSelector(".log-row", { timeout: 30000 });
await page.click(".lp-tab:text-is('Changes')");
// The list can load again after the first click: click until the diff shows main.rs.
await within("the diff shows main.rs after a reload", async () => {
  if (((await page.textContent(".diff .diff-title").catch(() => "")) ?? "").includes("main.rs")) return true;
  await page.click(".cl-file:has(.path:text-is('main.rs'))").catch(() => {});
  return false;
});
await within("the note stays after a reload", async () => (await chips()).length === 1);

// A change of the file on disk clears its notes.
appendFileSync(`${repo}/main.rs`, "// changed by an agent\n");
await within("a change of the file clears its notes", async () => (await chips()).length === 0 && (await cards()).length === 0, 10000);

console.log("errors:", JSON.stringify(errors));
await browser.close();
if (errors.length) process.exit(1);
