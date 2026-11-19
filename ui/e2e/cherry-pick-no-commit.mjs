// UI scenario for Cherry-Pick without Commit in the menu of a commit: the changes of the commit become
// local changes, HEAD stays, and the local changes of the user stay too. Undo in the toast puts the files
// back as they were before.
// Start the dev server first (see README). Build a fresh repository with make-demo-repo.sh, then:
// node e2e/cherry-pick-no-commit.mjs <repo> <screenshot-dir>.
// Set CHROMIUM to a Chromium binary when Playwright has no downloaded browser.
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
const [,, repo, outDir] = process.argv;
const git = (...args) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" }).trim();
const head = git("rev-parse", "HEAD");
// The demo repository has local changes in main.rs and NOTES.txt. The commit "Add a CLI entry point"
// of feature/cli adds cli.rs.
const mainBefore = readFileSync(`${repo}/main.rs`, "utf8");

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

await page.goto(`${process.env.GITTOR_E2E_URL ?? "http://127.0.0.1:5174"}/?repo=${encodeURIComponent(repo)}`);
await page.waitForSelector(".log-row", { timeout: 30000 });
await page.click(".log-row:has-text('Add a CLI entry point')", { button: "right" });
await page.waitForTimeout(400);
await shot("cpn1-menu");
await page.click(".menu-item:has-text('Cherry-Pick without Commit')");
await within("the commit adds cli.rs as a local change", async () => git("status", "--porcelain", "cli.rs") === "A  cli.rs");
check("HEAD stays", git("rev-parse", "HEAD") === head);
check("the local change of main.rs stays", readFileSync(`${repo}/main.rs`, "utf8") === mainBefore);
await page.click(".lp-tab[aria-label^='Changes']");
await within("the Changes tab lists cli.rs", async () => (await page.$(".cl-file:has(.path:text-is('cli.rs'))")) !== null);
await shot("cpn2-changes");

// Undo: cli.rs goes, and the local changes of before stay.
await page.click(".toast:has-text('Applied the changes') .toast-action:has-text('Undo')");
await within("Undo removes cli.rs", async () => git("status", "--porcelain", "cli.rs") === "");
check("Undo keeps the local change of main.rs", readFileSync(`${repo}/main.rs`, "utf8") === mainBefore);
check("Undo keeps NOTES.txt", git("status", "--porcelain", "NOTES.txt") === "?? NOTES.txt");

console.log("errors:", JSON.stringify(errors));
await browser.close();
if (errors.length) process.exit(1);
