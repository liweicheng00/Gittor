// UI scenario for the conflicts dialog and the three-way merge window. Start the dev server first (see README).
// Build a fresh repository with make-demo-repo.sh, then: node e2e/merge-tool.mjs <repo> <screenshot-dir>.
// The scenario changes the repository. Set CHROMIUM to a Chromium binary when Playwright has no downloaded browser.
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
const [,, repo, outDir] = process.argv;
const git = (...args) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" }).replace(/\s+$/, "");
const gitTry = (...args) => { try { git(...args); } catch { /* a conflict is expected */ } };

// calc.rs: yours changes line 5, theirs changes line 8, both change line 2 differently.
const base = ["fn calc() {", "    let a = 1;", "    let b = 2;", "    let c = 3;", "    let d = 4;", "    let e = 5;", "    let f = 6;", "    let g = 7;", "}", ""];
const edit = (lines, changes) => lines.map((l, i) => changes[i] ?? l).join("\n");
git("stash", "-u", "-q");
writeFileSync(`${repo}/calc.rs`, base.join("\n"));
git("add", "calc.rs");
git("commit", "-q", "-m", "Add calc");
git("checkout", "-q", "-b", "calc-side");
writeFileSync(`${repo}/calc.rs`, edit(base, { 1: "    let a = 100; // theirs", 7: "    let g = 70; // theirs" }));
execFileSync("sh", ["-c", `cd "${repo}" && echo "- side note" >> README.md`]);
git("commit", "-q", "-am", "Side changes");
git("checkout", "-q", "main");
writeFileSync(`${repo}/calc.rs`, edit(base, { 1: "    let a = 10; // yours", 4: "    let d = 40; // yours" }));
execFileSync("sh", ["-c", `cd "${repo}" && echo "- main note" >> README.md`]);
git("commit", "-q", "-am", "Main changes");
gitTry("merge", "calc-side");

const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const page = await (await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1.5 })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push("pageerror: " + e));
page.on("console", (m) => m.type() === "error" && errors.push("console: " + m.text()));
page.on("dialog", (d) => d.accept());
const shot = async (name) => { await page.waitForTimeout(700); await page.screenshot({ path: `${outDir}/${name}.png` }); console.log("shot", name); };
const check = (what, ok) => { console.log(ok ? "ok  " : "FAIL", what); if (!ok) errors.push("check: " + what); };
const status = async () => (await page.textContent(".merge-status")).trim();
const within = async (what, fn, ms = 6000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return check(what, true);
    await page.waitForTimeout(100);
  }
  check(what, false);
};

await page.goto(`${process.env.GITTOR_E2E_URL ?? "http://127.0.0.1:5174"}/?repo=${encodeURIComponent(repo)}`);
await page.waitForSelector(".op-banner:not([hidden])", { timeout: 30000 });
check("banner shows the merge", (await page.textContent(".op-banner")).includes("Merge in progress"));
await page.click(".tb-button[title='Theme']");
await page.click(".menu-item:has-text('Dark')");

// A double click on a file with conflicts in the Changes tab opens the merge window.
await page.click(".lp-tab:text-is('Changes')");
await page.dblclick(".cl-file:has(.path:text-is('calc.rs'))");
await page.waitForSelector(".merge-window .monaco-editor");
check("the Changes tab opens the merge window", ((await page.textContent(".merge-header")) ?? "").includes("calc.rs"));
await page.click(".merge-footer button:has-text('Cancel')");
await page.waitForSelector(".merge-overlay", { state: "detached" });

await page.click(".op-banner button:has-text('Resolve')");
await page.waitForSelector(".conflict-row");
check("conflicts dialog lists both files", (await page.$$(".conflict-row")).length === 2);
await shot("m1-conflicts-dialog");

// Merge calc.rs in the merge window, in the dark theme.
await page.dblclick(".conflict-row:has-text('calc.rs')");
await page.waitForSelector(".merge-window .monaco-editor");
await page.waitForTimeout(1200);
console.log("status:", await status());
// The window opens with the non-conflicting changes in the result: only the conflict is left.
check("only the conflict is left", (await status()) === "1 change left, 1 conflict");
check("the result has the non-conflicting changes", ((await page.textContent(".merge-editor:nth-child(2) .view-lines")) ?? "").replace(/\s/g, "").includes("letd=40;//yours"));
check("the conflict has a bar of actions", (await page.$$(".merge-editor:nth-child(2) .m-actions-conflict")).length === 1);
// The » of yours is on the border of the left editor and the result.
const edges = await page.evaluate(() => {
  const a = document.querySelector(".merge-editor:nth-child(1) .m-arrow")?.getBoundingClientRect();
  const r = document.querySelector(".merge-editor:nth-child(2)")?.getBoundingClientRect();
  return a && r ? [a.right, r.left] : null;
});
check("the » of yours is at the border with the result", !!edges && Math.abs(edges[0] - edges[1]) <= 2);
await shot("m2-merge-window");
// Accept Both: yours, then theirs.
await page.click(".m-actions-conflict .m-action:text-is('Accept Both')");
await page.waitForTimeout(500);
check("all resolved", (await status()) === "All changes are resolved");
check("no bar is left", (await page.$$(".m-actions")).length === 0);
await shot("m3-resolved");
await page.click(".merge-footer button:has-text('Apply')");
// Apply opens the next file with conflicts at once.
await page.waitForFunction(() => document.querySelector(".merge-header")?.textContent?.includes("README.md"), null, { timeout: 10000 });
check("the next file opens in the merge window", true);
const merged = readFileSync(`${repo}/calc.rs`, "utf8");
console.log(merged);
check(
  "merged text",
  merged === edit(base, { 1: "    let a = 10; // yours\n    let a = 100; // theirs", 4: "    let d = 40; // yours", 7: "    let g = 70; // theirs" }),
);

// README.md: each side needs a decision. ✕ does not take yours; theirs is still open.
await page.waitForTimeout(800);
const doneBar = () => page.isVisible(".merge-done");
check("the done bar hides while a conflict is open", !(await doneBar()));
await page.click(".merge-window .m-reject");
await page.waitForTimeout(300);
check("after ✕ on yours, theirs is still open", (await status()) === "1 change left, 1 conflict" && !(await doneBar()));
// « takes theirs: each side has a decision now.
await page.click(".merge-editor:nth-child(3) .m-glyph-left");
await within("the conflict is resolved", async () => (await status()) === "All changes are resolved");
check("the done bar says that all conflicts are resolved", await doneBar());
await shot("m3c-done");
await page.click(".merge-done button:has-text('Apply')");
// The last file: Gittor offers to continue the merge.
await page.waitForSelector(".dialog:has-text('All Conflicts Are Resolved')", { timeout: 10000 });
check("no conflicts left", git("diff", "--name-only", "--diff-filter=U") === "");
check("README has the side note", readFileSync(`${repo}/README.md`, "utf8").includes("- side note"));
await shot("m3b-continue");
await page.click(".dialog-buttons button:has-text('Continue')");
await page.waitForFunction(() => document.querySelector(".op-banner")?.hidden, null, { timeout: 10000 });
check("merge commit", git("rev-list", "--parents", "-n", "1", "HEAD").split(" ").length === 3);
await shot("m4-merged");
console.log("errors:", JSON.stringify(errors));
await browser.close();
if (errors.length) process.exit(1);
