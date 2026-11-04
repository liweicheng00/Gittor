// UI scenario for the fetch of a remote branch when the user picks it: the branch switcher checks out
// the newest state, and a review of a remote branch shows its newest commits.
// Start the dev server first (see README). Build a fresh repository with make-demo-repo.sh, then:
// node e2e/fetch-on-pick.mjs <repo> <screenshot-dir>. The scenario adds commits to <repo>-origin.
// Set CHROMIUM to a Chromium binary when Playwright has no downloaded browser.
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
const [,, repo, outDir] = process.argv;
const origin = `${repo}-origin`;
const git = (dir, ...args) => execFileSync("git", ["-C", dir, "-c", "user.name=Remote", "-c", "user.email=remote@example.com", ...args], { encoding: "utf8" }).trim();

// A new commit on a branch of the origin, without a checkout there. The repository has not fetched it.
const addCommit = (branch, subject) => {
  const parent = git(origin, "rev-parse", `refs/heads/${branch}`);
  const oid = git(origin, "commit-tree", `${parent}^{tree}`, "-p", parent, "-m", subject);
  git(origin, "update-ref", `refs/heads/${branch}`, oid);
  return oid;
};
const parserTip = addCommit("feature/parser", "Remote work on the parser");
// The local change of main.rs would stop the checkout of feature/parser, which changes main.rs too.
git(repo, "stash", "-u", "-q");
const readmeTip = addCommit("fix/readme", "Remote work on the readme");

const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const page = await (await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1.5 })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push("pageerror: " + e));
page.on("console", (m) => m.type() === "error" && errors.push("console: " + m.text()));
const shot = async (name) => { await page.screenshot({ path: `${outDir}/${name}.png` }); console.log("shot", name); };
const check = (what, ok) => { console.log(ok ? "ok  " : "FAIL", what); if (!ok) errors.push("check: " + what); };
const within = async (what, fn, ms = 10000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return check(what, true);
    await page.waitForTimeout(100);
  }
  check(what, false);
};
const text = async (sel) => ((await page.textContent(sel).catch(() => "")) ?? "");

await page.goto(`${process.env.GITTOR_E2E_URL ?? "http://127.0.0.1:5174"}/?repo=${encodeURIComponent(repo)}`);
await page.waitForSelector(".log-row", { timeout: 30000 });
check("the repository does not have the new commits yet", git(repo, "rev-parse", "origin/feature/parser") !== parserTip);

// The branch switcher: a remote branch is fetched, then checked out.
await page.click(".tb-branch-button");
await page.waitForSelector(".switcher");
await page.click(".switcher .menu-item:has(.menu-label:text-is('origin/feature/parser'))");
await within("the new local branch has the newest commit of the remote", async () => {
  try {
    return git(repo, "rev-parse", "HEAD") === parserTip && git(repo, "rev-parse", "--abbrev-ref", "HEAD") === "feature/parser";
  } catch {
    return false;
  }
});
await within("the log shows the fetched commit", async () => (await text(".log-row >> nth=0")).includes("Remote work on the parser"));
await shot("fp1-checkout");

// A review of a remote branch: the review shows its newest commit.
await page.click(".sidebar .branch:has-text('feature/cli') >> nth=0", { button: "right" });
await page.click(".menu-item:has-text('Review Branch')");
await page.waitForSelector(".dialog:has-text('Review Branch')");
await page.click(".dialog .dialog-branch >> nth=0");
await page.waitForSelector(".branch-picker");
await page.click(".branch-picker .menu-item:has(.menu-label:text-is('origin/fix/readme'))");
await page.click(".dialog-buttons button:has-text('Start Review')");
await page.waitForSelector(".review-window");
await within("the review of the remote branch shows its newest commit", async () => (await text(".review-window .review-commits")).includes("Remote work on the readme"));
check("the remote branch moved to the newest commit", git(repo, "rev-parse", "origin/fix/readme") === readmeTip);
await shot("fp2-review");

console.log("errors:", JSON.stringify(errors));
await browser.close();
if (errors.length) process.exit(1);
