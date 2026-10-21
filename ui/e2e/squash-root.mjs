// UI scenario: squash two commits when the older one is the root commit of the branch. The scenario
// makes its own repository with two commits next to the demo repository.
// Start the dev server first (see README), then: node e2e/squash-root.mjs <repo> <screenshot-dir>
// Set CHROMIUM to a Chromium binary when Playwright has no downloaded browser.
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
const [,, demo, outDir] = process.argv;
const repo = `${demo}-root`;
const git = (...args) => execFileSync("git", ["-C", repo, "-c", "user.name=Ada", "-c", "user.email=ada@example.com", "-c", "commit.gpgsign=false", ...args], { encoding: "utf8" }).trim();

rmSync(repo, { recursive: true, force: true });
mkdirSync(repo, { recursive: true });
git("init", "-q", "-b", "main");
writeFileSync(`${repo}/app.py`, "print('one')\n");
git("add", ".");
git("commit", "-q", "-m", "init");
writeFileSync(`${repo}/app.py`, "print('one')\nprint('two')\n");
git("commit", "-q", "-am", "init again");
const tree = git("rev-parse", "HEAD^{tree}");

const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const page = await (await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1.5 })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push("pageerror: " + e));
page.on("console", (m) => m.type() === "error" && errors.push("console: " + m.text()));
const shot = async (name) => { await page.waitForTimeout(500); await page.screenshot({ path: `${outDir}/${name}.png` }); console.log("shot", name); };
const check = (what, ok) => { console.log(ok ? "ok  " : "FAIL", what); if (!ok) errors.push("check: " + what); };
const within = async (what, fn, ms = 6000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return check(what, true);
    await page.waitForTimeout(200);
  }
  check(what, false);
};

await page.goto(`${process.env.GITTOR_E2E_URL ?? "http://127.0.0.1:5174"}/?repo=${encodeURIComponent(repo)}`);
await page.waitForSelector(".log-row", { timeout: 30000 });

// Select both commits; the older one is the root commit.
await page.click(".log-row:has-text('init again')");
await page.click(".log-row >> nth=1", { modifiers: ["Control"] });
await page.click(".log-row:has-text('init again')", { button: "right" });
await page.waitForTimeout(400);
await page.click(".menu-item:has-text('Squash 2 Commits')");
await page.waitForSelector(".dialog textarea");
await page.fill(".dialog textarea", "init");
await page.click(".dialog-buttons button:has-text('Squash')");
await within("the branch has one commit", async () => git("rev-list", "--count", "HEAD") === "1");
check("the commit has the files of both commits", git("rev-parse", "HEAD^{tree}") === tree);
check("the commit has the new message", git("log", "-1", "--format=%s") === "init");
await within("the log shows one commit", async () => (await page.$$(".log-row")).length === 1);
check("no error toast", (await page.$(".toast-error")) === null);
await shot("sr1-squashed-root");

console.log("errors:", JSON.stringify(errors));
await browser.close();
rmSync(repo, { recursive: true, force: true });
if (errors.length) process.exit(1);
