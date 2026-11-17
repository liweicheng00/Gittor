// UI scenario for the Stale group of the Branches tab: a local branch without a commit for a long time,
// and a branch whose tracked branch is gone from the remote. The current branch never shows there.
// Start the dev server first (see README). Build a fresh repository with make-demo-repo.sh, then:
// node e2e/stale-branches.mjs <repo> <screenshot-dir>.
// Set CHROMIUM to a Chromium binary when Playwright has no downloaded browser.
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
const [,, repo, outDir] = process.argv;
const git = (...args) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", env: { ...process.env, ...gitEnv } }).trim();
let gitEnv = {};
// An old branch: its last commit is from 2020.
gitEnv = { GIT_AUTHOR_DATE: "2020-01-02T10:00:00Z", GIT_COMMITTER_DATE: "2020-01-02T10:00:00Z" };
const tree = git("rev-parse", "HEAD^{tree}");
const oldCommit = git("commit-tree", tree, "-p", "HEAD", "-m", "Old work");
git("branch", "old/ancient", oldCommit);
gitEnv = {};
// A branch whose tracked branch is gone from the remote.
git("branch", "merged-pr", "HEAD");
git("config", "branch.merged-pr.remote", "origin");
git("config", "branch.merged-pr.merge", "refs/heads/merged-pr");

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
await page.click(".lp-tab:text-is('Branches')");
const stale = ".sidebar .group-header:has(span:text-is('Stale'))";
await page.waitForSelector(stale);
check("the Stale group shows its count", ((await page.textContent(`${stale} .group-count`)) ?? "").trim() === "2");
// The rows of the group come after its header and before the next header.
const staleNames = () =>
  page.evaluate(() => {
    const head = [...document.querySelectorAll(".sidebar .group-header")].find((h) => h.textContent.startsWith("Stale"));
    const names = [];
    for (let n = head?.nextElementSibling; n && !n.classList.contains("group-header"); n = n.nextElementSibling) {
      const name = n.querySelector(".branch-name")?.textContent;
      if (name) names.push(name);
    }
    return names;
  });
check("the Stale group is closed at first", (await staleNames()).length === 0);
await page.click(stale);
await within("the group lists the old branch and the branch with a gone tracked branch", async () => {
  const names = (await staleNames()).join(",");
  return names.includes("ancient") && names.includes("merged-pr") && !names.includes("main");
});
check("a branch with a gone tracked branch has the badge", (await page.$(".sidebar .branch:has(.branch-name:text-is('merged-pr')) .branch-gone")) !== null);
check("the header says what stale is", ((await page.getAttribute(stale, "title")) ?? "").includes("90 days"));
await shot("stale1-group");

console.log("errors:", JSON.stringify(errors));
await browser.close();
if (errors.length) process.exit(1);
