// UI scenario for the Files tab: the files of the working tree as a tree of folders, the colors of the
// local changes, a file without a change, a new file on disk, the search, and the keys Mod+` and Mod+1.
// Start the dev server first (see README). Build a fresh repository with make-demo-repo.sh, then:
// node e2e/files-tab.mjs <repo> <screenshot-dir>.
// Set CHROMIUM to a Chromium binary when Playwright has no downloaded browser.
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
const [,, repo, outDir] = process.argv;
// A folder with a file, so that the tree has a folder.
mkdirSync(`${repo}/docs/guide`, { recursive: true });
writeFileSync(`${repo}/docs/guide/start.md`, "# Start\n");

const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const page = await (await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1.5 })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push("pageerror: " + e));
page.on("console", (m) => m.type() === "error" && errors.push("console: " + m.text()));
const shot = async (name) => { await page.waitForTimeout(400); await page.screenshot({ path: `${outDir}/${name}.png` }); console.log("shot", name); };
const check = (what, ok) => { console.log(ok ? "ok  " : "FAIL", what); if (!ok) errors.push("check: " + what); };
const within = async (what, fn, ms = 8000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return check(what, true);
    await page.waitForTimeout(100);
  }
  check(what, false);
};
const row = (path) => `.files-file[data-path='${path}']`;
const nameClass = (sel) => page.$eval(`${sel} .files-name`, (e) => e.className).catch(() => "");
const diffTitle = async () => ((await page.textContent(".workspace > .diff .diff-title").catch(() => "")) ?? "").replace(/\s+/g, " ").trim();

await page.goto(`${process.env.GITTOR_E2E_URL ?? "http://127.0.0.1:5174"}/?repo=${encodeURIComponent(repo)}`);
await page.waitForSelector(".log-row", { timeout: 30000 });

// The left tab labels all fit, with the new tab.
const cut = await page.$$eval(".lp-tab", (els) => els.filter((e) => e.scrollWidth > e.clientWidth).map((e) => e.textContent));
check("no left tab label is cut", cut.length === 0);

// The Files tab is the first tab. Mod+` shows it.
check("the Files tab is the first tab", ((await page.textContent(".lp-tab >> nth=0")) ?? "").trim() === "Files");
await page.click(".log-row >> nth=0");
await page.keyboard.press("Control+Backquote");
await within("Mod+` shows the Files tab", async () => await page.isVisible(".files-panel"));
await within("the tab lists the files of the working tree", async () => (await page.$$(".files-file")).length >= 5);
check("a folder starts closed", (await page.$("[data-path='docs/guide/start.md']")) === null && (await page.$(".files-dir[data-dir='docs/']")) !== null);
check("a changed file has the color of its status", (await nameClass(row("main.rs"))).includes("status-text-M"));
check("an unversioned file has its color", (await nameClass(row("NOTES.txt"))).includes("status-text-?"));
check("a folder above an unversioned file has its color", (await nameClass(".files-dir[data-dir='docs/']")).includes("status-text-?"));
check("a file without a change has no color", !(await nameClass(row("arith.rs"))).includes("status-text"));

// A click opens a folder; the next folder opens too.
await page.click(".files-dir[data-dir='docs/']");
await page.click(".files-dir[data-dir='docs/guide/']");
await within("the folders open", async () => (await page.$(row("docs/guide/start.md"))) !== null);

// A click opens the file in the center panel, in place of the log, as in an IDE: its text, without colors.
const pane = ".file-host > .diff";
const paneTitle = async () => ((await page.textContent(`${pane} .diff-title`).catch(() => "")) ?? "").replace(/\s+/g, " ").trim();
const tabs = () => page.$$eval(".center-tab .center-tab-name", (els) => els.map((e) => e.textContent));
await page.click(row("arith.rs"));
await within("the center panel shows the file", async () => (await paneTitle()).endsWith("arith.rs") && !(await page.isVisible(`${pane} .diff-title .status`)));
check("the log hides", !(await page.isVisible(".log-row >> nth=0")));
check("the tabs are Log and the file", JSON.stringify(await tabs()) === JSON.stringify(["Log", "arith.rs"]));
await shot("ft1-file");

// A changed file opens as text too, in a second tab. Show Diff in its menu shows the diff in the diff panel.
await page.click(row("main.rs"));
await within("a changed file opens as text in a new tab", async () => (await paneTitle()).endsWith("main.rs") && JSON.stringify(await tabs()) === JSON.stringify(["Log", "arith.rs", "main.rs"]));
await page.click(row("main.rs"), { button: "right" });
await page.waitForTimeout(400);
await page.click(".menu-item:has-text('Show Diff')");
await within("Show Diff shows the diff of the change in the diff panel", async () => (await diffTitle()).includes("main.rs") && (await page.isVisible(".workspace > .diff .diff-title .status")));
await shot("ft2-changed");
// The tab Log shows the log again, and a tab of a file shows the file again.
await page.click(".center-tab:has-text('Log')");
await within("the tab Log shows the log", async () => await page.isVisible(".log-row >> nth=0"));
await page.click(".center-tab:has-text('main.rs')");
await within("the tab of a file shows it again", async () => (await paneTitle()).endsWith("main.rs"));
await page.click(".center-tab:has-text('main.rs') .center-tab-close");
await within("closing the tab shows the next file", async () => (await paneTitle()).endsWith("arith.rs") && JSON.stringify(await tabs()) === JSON.stringify(["Log", "arith.rs"]));

// A new file on disk comes into the list, with the color of an unversioned file.
writeFileSync(`${repo}/added-later.txt`, "new\n");
await within("a new file shows in the list", async () => (await page.$(row("added-later.txt"))) !== null, 10000);

// The search shows the matching files as a flat list.
await page.fill(".files-search", "start");
await within("the search finds the file in its folder", async () => (await page.$$(".files-file")).length === 1 && (await page.$(row("docs/guide/start.md"))) !== null);
await page.fill(".files-search", "");

// The open file has notes: on a line, on the whole file, and Copy All. No window and no editor opens.
await page.dblclick(row("arith.rs"));
check("no window opens", (await page.$(".merge-overlay")) === null);
check("no editor error shows", (await page.$(".toast-error")) === null);
const vLine = (n) => page.locator(`${pane} .line-numbers:visible`).filter({ hasText: new RegExp(`^${n}$`) }).first();
await vLine(1).hover();
await within("the note icon shows on the file", async () => (await page.$$(`${pane} .note-add-icon`)).length === 1);
await page.click(`${pane} .note-add-icon`);
await page.fill(`${pane} .note-card.draft textarea`, "Check this add");
await page.press(`${pane} .note-card.draft textarea`, "Control+Enter");
await within("the note shows as a card", async () => ((await page.textContent(`${pane} .note-card:not(.draft)`).catch(() => "")) ?? "").includes("Check this add"));
await page.fill(".file-host .review-file-note-input", "Rename this file");
await page.press(".file-host .review-file-note-input", "Enter");
await within("the note on the whole file shows in the list", async () => ((await page.textContent(".file-host .review-notes-list")) ?? "").includes("Rename this file"));
await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
await page.click(".file-host .review-notes-copy");
await within("Copy All copies the notes of the file", async () => (await page.evaluate(() => navigator.clipboard.readText())) === "arith.rs\nRename this file\n\narith.rs:1\nCheck this add");
await shot("ft3-file-notes");
// The last tab of a file closes: the log shows again, and the tabs hide.
await page.click(".center-tab:has-text('arith.rs') .center-tab-close");
await within("the log shows when no file is open", async () => (await page.isVisible(".log-row >> nth=0")) && !(await page.isVisible(".center-tabs")));

// Mod+1 shows the Branches tab, and a second press stays there.
await page.click(".log-row >> nth=0");
await page.keyboard.press("Control+1");
await within("Mod+1 shows the Branches tab", async () => await page.isVisible(".sidebar .branch"));
await page.keyboard.press("Control+1");
await page.waitForTimeout(400);
check("a second Mod+1 keeps the Branches tab", (await page.isVisible(".sidebar .branch")) && (await page.isVisible(".leftpane")));

console.log("errors:", JSON.stringify(errors));
await browser.close();
if (errors.length) process.exit(1);
