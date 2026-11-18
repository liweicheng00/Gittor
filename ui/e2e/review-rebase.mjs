// UI scenario for Interactive Rebase from the Review window: the Rebase… button for all commits of the
// review, and "Interactively Rebase from Here…" in the menu of one commit. A branch that is not checked
// out is checked out first, after a question.
// Start the dev server first (see README). Build a fresh repository with make-demo-repo.sh, then:
// node e2e/review-rebase.mjs <repo> <screenshot-dir>.
// Set CHROMIUM to a Chromium binary when Playwright has no downloaded browser.
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
const [,, repo, outDir] = process.argv;
const git = (...args) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" }).trim();

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
const rebaseRows = () => page.$$eval(".rebase-dialog .rebase-row .rebase-subject", (els) => els.map((e) => e.textContent));

await page.goto(`${process.env.GITTOR_E2E_URL ?? "http://127.0.0.1:5174"}/?repo=${encodeURIComponent(repo)}`);
await page.waitForSelector(".sidebar .branch", { timeout: 30000 });

// A review of feature/cli, while main is checked out.
await page.click(".sidebar .branch:has-text('feature/cli') >> nth=0", { button: "right" });
await page.waitForTimeout(400);
await page.click(".menu-item:has-text('Review Branch')");
await page.waitForSelector(".dialog:has-text('Review Branch')");
await page.click(".dialog-buttons button:has-text('Start Review')");
await page.waitForSelector(".review-window .review-commit");

// Rebase… asks to check out the branch, then opens the editor with all commits of the review.
await page.click(".review-window .review-rebase");
await page.waitForSelector(".dialog:has-text('must be checked out')");
await page.click(".dialog-buttons button:has-text('Checkout')");
await page.waitForSelector(".rebase-dialog .rebase-row", { timeout: 15000 });
check("the branch is checked out", git("rev-parse", "--abbrev-ref", "HEAD") === "feature/cli");
await within("the editor has the two commits of the review", async () => JSON.stringify(await rebaseRows()) === JSON.stringify(["Print arguments one per line", "Add a CLI entry point"]));
check("the editor is over the Review window", await page.isVisible(".review-window"));
await shot("rr1-editor");
await page.click(".rebase-dialog button:has-text('Cancel')");
await page.waitForSelector(".rebase-dialog", { state: "detached" });

// The menu of a commit: the editor starts at that commit.
await page.click(".review-window .review-commit:has-text('Print arguments')", { button: "right" });
await page.waitForTimeout(400);
await page.click(".menu-item:has-text('Interactively Rebase from Here')");
await page.waitForSelector(".rebase-dialog .rebase-row");
await within("the editor starts at the commit of the menu", async () => JSON.stringify(await rebaseRows()) === JSON.stringify(["Print arguments one per line"]));
await page.click(".rebase-dialog button:has-text('Cancel')");
await page.waitForSelector(".rebase-dialog", { state: "detached" });
check("the Review window stays open", await page.isVisible(".review-window"));

console.log("errors:", JSON.stringify(errors));
await browser.close();
if (errors.length) process.exit(1);
