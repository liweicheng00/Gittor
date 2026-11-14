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
const diffTitle = async () => ((await page.textContent(".diff .diff-title").catch(() => "")) ?? "").replace(/\s+/g, " ").trim();

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

// A file without a change shows its text, without colors.
await page.click(row("arith.rs"));
await within("the diff panel shows the file", async () => (await diffTitle()).endsWith("arith.rs") && !(await page.isVisible(".diff .diff-title .status")));
check("the file shows without changes", ((await page.textContent(".diff .diff-stats").catch(() => "")) ?? "").includes("no local changes"));
await shot("ft1-file");

// A changed file shows its local diff.
await page.click(row("main.rs"));
await within("a changed file shows its diff", async () => (await diffTitle()).includes("main.rs") && (await page.isVisible(".diff .diff-title .status")));
await shot("ft2-changed");

// A new file on disk comes into the list, with the color of an unversioned file.
writeFileSync(`${repo}/added-later.txt`, "new\n");
await within("a new file shows in the list", async () => (await page.$(row("added-later.txt"))) !== null, 10000);

// The search shows the matching files as a flat list.
await page.fill(".files-search", "start");
await within("the search finds the file in its folder", async () => (await page.$$(".files-file")).length === 1 && (await page.$(row("docs/guide/start.md"))) !== null);
await page.fill(".files-search", "");

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
