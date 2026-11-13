// UI scenario for the refresh without flicker: other programs write files in bursts while the user reads
// a diff, has a text selection in it, and has a draft of a commit message. The scenario checks that the
// selection, the place of the diff and the rows of the lists stay, that the data is current within a
// bound, and that the number of loads and of new elements stays low.
// Start the dev server first (see README). Build a fresh repository with make-demo-repo.sh, then:
// node e2e/refresh-quiet.mjs <repo> <screenshot-dir>. The scenario changes the repository.
// Set CHROMIUM to a Chromium binary when Playwright has no downloaded browser.
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
const [,, repo, outDir] = process.argv;
const git = (...args) => execFileSync("git", ["-C", repo, "-c", "commit.gpgsign=false", ...args], { encoding: "utf8" }).replace(/\s+$/, "");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A long file with a change near the top and one near the end, and many new files, so the list scrolls.
const longLines = Array.from({ length: 300 }, (_, i) => `line ${i + 1}`);
writeFileSync(`${repo}/long.txt`, longLines.join("\n") + "\n");
git("add", "long.txt");
git("commit", "-q", "-m", "Long file");
writeFileSync(`${repo}/long.txt`, longLines.map((l, i) => (i === 4 || i === 279 ? l.toUpperCase() : l)).join("\n") + "\n");
mkdirSync(`${repo}/pile`);
for (let i = 0; i < 40; i++) writeFileSync(`${repo}/pile/f-${String(i).padStart(2, "0")}.txt`, "x\n");

const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const page = await (await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1.5 })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push("pageerror: " + e));
page.on("console", (m) => m.type() === "error" && errors.push("console: " + m.text()));
const loads = { local_changes: 0, refresh: 0 };
page.on("request", (r) => {
  const name = r.url().split("/api/")[1];
  if (name in loads) loads[name]++;
});
const shot = async (name) => { await page.waitForTimeout(500); await page.screenshot({ path: `${outDir}/${name}.png` }); console.log("shot", name); };
const check = (what, ok) => { console.log(ok ? "ok  " : "FAIL", what); if (!ok) errors.push("check: " + what); };
const within = async (what, fn, ms = 5000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return check(what, true);
    await page.waitForTimeout(100);
  }
  check(what, false);
};
const treeText = () => page.textContent(".commit-tree");
const modified = ".diff-host:not(.md-preview) .editor.modified";
/** The diff as the user sees it: the text and the number of the first line, and the selection. */
const view = () =>
  page.evaluate((sel) => {
    const byTop = (list) => [...list].map((el) => ({ top: el.getBoundingClientRect().top, text: el.textContent.replace(/\s/g, " ") })).sort((a, b) => a.top - b.top);
    const lines = byTop(document.querySelectorAll(`${sel} .view-line`));
    const numbers = byTop(document.querySelectorAll(`${sel} .margin-view-overlays .line-numbers`));
    return { text: lines[0]?.text, top: Math.round(lines[0]?.top ?? 0), number: Number(numbers[0]?.text), selected: document.querySelectorAll(`${sel} .selected-text`).length };
  }, modified);

await page.goto(`${process.env.GITTOR_E2E_URL ?? "http://127.0.0.1:5174"}/?repo=${encodeURIComponent(repo)}`);
await page.waitForSelector(".log-row", { timeout: 30000 });
await page.click(".lp-tab:has-text('Changes')");
await page.waitForSelector(".cl-file:has-text('long.txt')");
// The watcher counts from the load of the repository; the first change comes after it.
await page.waitForTimeout(1500);

// The user writes a draft of the message, opens the long file, reads its middle and selects text there.
await page.fill(".commit-message", "Draft of a message");
await page.click(".cl-file:has-text('long.txt')");
await page.waitForSelector(`${modified} .view-line`);
await within("the diff of the long file shows", async () => /2 changes/.test(await page.textContent(".diff-stats")));
const box = await page.locator(modified).boundingBox();
await page.mouse.move(box.x + 200, box.y + 100);
for (let i = 0; i < 60; i++) {
  await page.mouse.wheel(0, 340);
  await page.waitForTimeout(20);
}
await within("the diff scrolled to the middle", async () => (await view()).number > 50);
const line = await page.locator(`${modified} .view-line`).nth(6).boundingBox();
await page.mouse.move(line.x + 5, line.y + 8);
await page.mouse.down();
await page.mouse.move(line.x + 90, line.y + 8 + 2 * line.height, { steps: 5 });
await page.mouse.up();
// The list of changes: scrolled down, with the mouse on a row.
const tree = await page.locator(".commit-tree").boundingBox();
await page.mouse.move(tree.x + 120, tree.y + 120);
await page.mouse.wheel(0, 300);
await page.waitForTimeout(600);
const before = await view();
check("the user has a selection in the middle of the file", before.selected > 0 && /^line \d+$/.test(before.text));
const scrollBefore = await page.evaluate(() => document.querySelector(".commit-tree").scrollTop);
check("the list of changes is scrolled", scrollBefore > 0);

// Marks on the elements that must stay, and a count of the new elements of each list.
await page.evaluate(() => {
  for (const el of document.querySelectorAll(".cl-file, .log-row, .sidebar-list .branch")) el.__before = true;
  const added = (window.__added = {});
  for (const sel of [".commit-tree", ".log-body", ".sidebar-list"]) {
    added[sel] = 0;
    new MutationObserver((records) => {
      for (const r of records) added[sel] += [...r.addedNodes].filter((n) => n.nodeType === 1).length;
    }).observe(document.querySelector(sel), { childList: true });
  }
});
const kept = (sel) => page.evaluate((s) => [...document.querySelectorAll(s)].filter((el) => el.__before).length, sel);
const added = () => page.evaluate(() => ({ ...window.__added }));
const rowsBefore = await kept(".cl-file");
const loadsBefore = loads.local_changes;

// Burst 1: other files change 12 times in about 4 s, and 4 new files come.
mkdirSync(`${repo}/zz-burst`);
const firstShown = within("the first new file shows during the burst", async () => (await treeText()).includes("new-0.txt"), 2500);
let lastWrite = 0;
for (let i = 0; i < 12; i++) {
  if (i % 3 === 0) writeFileSync(`${repo}/zz-burst/new-${i / 3}.txt`, "new\n");
  else appendFileSync(`${repo}/main.rs`, `fn burst_${i}() {}\n`);
  lastWrite = Date.now();
  await sleep(350);
}
await firstShown;
await within("the last new file shows soon after the burst", async () => (await treeText()).includes("new-3.txt"), 2500 - (Date.now() - lastWrite));
// The watcher sends one batch each second while files keep changing; a load for each write would be 12.
await page.waitForTimeout(1200);
const burstLoads = loads.local_changes - loadsBefore;
check(`few loads of the local changes for 12 writes (${burstLoads})`, burstLoads >= 2 && burstLoads <= 7);
check("the rows of the files that did not change keep their elements", (await kept(".cl-file")) === rowsBefore);
const afterBurst = await added();
check(`the list of changes got few new elements (${afterBurst[".commit-tree"]})`, afterBurst[".commit-tree"] <= 16);
check("the log and the branches got no new elements", afterBurst[".log-body"] === 0 && afterBurst[".sidebar-list"] === 0);
check("the list of changes kept its scroll position", (await page.evaluate(() => document.querySelector(".commit-tree").scrollTop)) === scrollBefore);
const quiet = await view();
check("the diff kept its place and its selection", quiet.text === before.text && quiet.top === before.top && quiet.number === before.number && quiet.selected === before.selected);
check("the draft of the message stays", (await page.inputValue(".commit-message")) === "Draft of a message");
await shot("rq1-after-burst");

// Burst 2: the file that the user reads changes. Three lines come above the view, and a line changes
// below it. The text on the screen stays where it is; the line numbers go up by three.
const text = readFileSync(`${repo}/long.txt`, "utf8").split("\n");
text.splice(9, 0, "added by an agent 1", "added by an agent 2", "added by an agent 3");
text[292] = "changed by an agent";
writeFileSync(`${repo}/long.txt`, text.join("\n"));
await within("the diff of the shown file follows the file", async () => /4 changes/.test(await page.textContent(".diff-stats")));
await page.waitForTimeout(400);
const moved = await view();
check(`the same text stays at the top of the diff (${moved.text}, was ${before.text})`, moved.text === before.text && moved.top === before.top);
check("the line numbers follow the new lines above", moved.number === before.number + 3);
check("the selection stays", moved.selected === before.selected);
await shot("rq2-file-changed");

// A commit from another program: the log shows it, and the rows of the other commits keep their elements.
const logRows = await kept(".log-row");
const branchRows = await kept(".sidebar-list .branch");
git("add", "zz-burst");
git("commit", "-q", "-m", "Commit of an agent", "--", "zz-burst");
await within("the commit of the other program shows in the log", async () => (await page.textContent(".log-row >> nth=0")).includes("Commit of an agent"));
const [keptRows, newRows] = [await kept(".log-row"), (await added())[".log-body"]];
// The new commit, and the commit before it, which is not HEAD now.
check(`the other rows of the log keep their elements (${keptRows} of ${logRows})`, keptRows === logRows - 1);
check(`two new rows in the log (${newRows})`, newRows === 2);
check("the committed files left the list", !(await treeText()).includes("new-0.txt"));
const afterCommit = await view();
check("the diff kept its place after the commit", afterCommit.text === before.text && afterCommit.top === before.top && afterCommit.selected === before.selected);
// The branch of HEAD has a new commit: only its row is new.
await page.click(".lp-tab:text-is('Branches')");
const branchesNow = await page.locator(".sidebar-list .branch").count();
check("the rows of the other branches keep their elements", (await kept(".sidebar-list .branch")) >= Math.min(branchRows, branchesNow) - 3);
await page.click(".lp-tab:has-text('Changes')");

// While the mouse is down, the view does not load again; it loads when the mouse goes up.
const msg = await page.locator(".commit-message").boundingBox();
await page.mouse.move(msg.x + 20, msg.y + 20);
await page.mouse.down();
writeFileSync(`${repo}/held.txt`, "held\n");
await page.waitForTimeout(2500);
check("no load while the mouse is down", !(await treeText()).includes("held.txt"));
await page.mouse.up();
await within("the load runs when the mouse goes up", async () => (await treeText()).includes("held.txt"), 2000);
check("the draft of the message is still there", (await page.inputValue(".commit-message")) === "Draft of a message");
await shot("rq3-end");
console.log("errors:", JSON.stringify(errors));
await browser.close();
if (errors.length) process.exit(1);
