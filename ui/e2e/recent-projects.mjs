// UI scenario for the recent repositories in groups by project: the Open menu and the welcome screen show
// each project, and its linked worktrees under it. Many worktrees do not push other projects out.
// Start the dev server first (see README). Build a fresh repository with make-demo-repo.sh, then:
// node e2e/recent-projects.mjs <repo> <screenshot-dir>. The scenario makes folders next to <repo>.
// Set CHROMIUM to a Chromium binary when Playwright has no downloaded browser.
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
const [,, repo, outDir] = process.argv;
const git = (dir, ...args) => execFileSync("git", ["-C", dir, ...args], { encoding: "utf8" }).trim();
const base = process.env.GITTOR_E2E_URL ?? "http://127.0.0.1:5174";

// Another project, and 14 worktrees of the demo repository.
const lib = `${repo}-rp-lib`;
const wtDir = `${repo}-rp-wt`;
const clean = () => {
  for (const p of [lib, wtDir]) rmSync(p, { recursive: true, force: true });
  git(repo, "worktree", "prune");
};
clean();
mkdirSync(lib);
git(lib, "init", "-q", "-b", "main");
git(lib, "-c", "user.name=T", "-c", "user.email=t@e", "commit", "-q", "--allow-empty", "-m", "Start");
const trees = Array.from({ length: 14 }, (_, i) => `${wtDir}/feature-${i}`);
for (const [i, t] of trees.entries()) git(repo, "worktree", "add", "-q", "-b", `rp-${i}`, t, "main");

const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const page = await (await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1.5 })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push("pageerror: " + e));
page.on("console", (m) => m.type() === "error" && errors.push("console: " + m.text()));
const shot = async (n) => { await page.waitForTimeout(300); await page.screenshot({ path: `${outDir}/${n}.png` }); console.log("shot", n); };
const check = (what, ok) => { console.log(ok ? "ok  " : "FAIL", what); if (!ok) errors.push("check: " + what); };
const within = async (what, fn, ms = 6000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return check(what, true);
    await page.waitForTimeout(100);
  }
  check(what, false);
};
const menuRows = () => page.$$eval(".menu .menu-item", (els) => els.map((e) => ({ title: e.title, indent: e.classList.contains("indent") })).filter((r) => r.title));
const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem("gittor.settings.v1") ?? "{}"));

// A list of an older version: the paths only, the worktrees first. Gittor reads their projects.
await page.goto(`${base}/?repo=${encodeURIComponent(repo)}`);
await page.waitForSelector(".log-row", { timeout: 30000 });
await page.evaluate((recent) => {
  const s = JSON.parse(localStorage.getItem("gittor.settings.v1") ?? "{}");
  s.recent = recent;
  delete s.recentProjects;
  localStorage.setItem("gittor.settings.v1", JSON.stringify(s));
}, [...trees.slice(0, 4), lib, repo]);
await page.reload();
await page.waitForSelector(".log-row", { timeout: 30000 });
await page.click(".tb-button:has-text('Open')");
await page.waitForSelector(".menu .menu-item[title]");
let rows = await menuRows();
check("the demo repository comes first: the most recent use is a worktree of it", rows[0]?.title === repo && !rows[0].indent);
check("its worktrees are under it, indented", rows.slice(1, 5).every((r, i) => r.indent && r.title === trees[i]));
check("the other project follows", rows[5]?.title === lib && !rows[5].indent);
await shot("rp1-open-menu");
await page.keyboard.press("Escape");

// Open 14 worktrees, one after the other: the list keeps the other project.
for (const t of trees) await page.evaluate(async (p) => {
  const s = JSON.parse(localStorage.getItem("gittor.settings.v1") ?? "{}");
  s.recent = [p, ...s.recent.filter((x) => x !== p)];
  localStorage.setItem("gittor.settings.v1", JSON.stringify(s));
}, t);
await page.reload();
await page.waitForSelector(".log-row", { timeout: 30000 });
// A real open of a worktree records its project and trims the list.
await page.click(".tb-button:has-text('Open')");
await page.waitForTimeout(400);
await page.click(`.menu .menu-item[title='${trees[13]}']`);
await within("the worktree opens in a tab", async () => (await page.$$(".tab")).length === 2);
await within("the list keeps the other project", async () => (await stored()).recent?.includes(lib));
const s = await stored();
check("the list keeps 8 worktrees of the project", s.recent.filter((p) => p.startsWith(wtDir)).length === 8);
check("the project of the worktree is known", s.recentProjects?.[trees[13]] === repo);
await page.click(".tb-button:has-text('Open')");
await page.waitForSelector(".menu .menu-item[title]");
rows = await menuRows();
check("the menu shows 2 projects", rows.filter((r) => !r.indent).map((r) => r.title).join() === `${repo},${lib}`);
await shot("rp2-many-worktrees");
await page.keyboard.press("Escape");

// The welcome screen shows the same groups. Its remove button on a project removes its worktrees too.
await page.evaluate(() => {
  const s = JSON.parse(localStorage.getItem("gittor.settings.v1") ?? "{}");
  s.tabs = [];
  s.activeTab = null;
  localStorage.setItem("gittor.settings.v1", JSON.stringify(s));
});
await page.goto(`${base}/`);
await page.waitForSelector(".recent-item");
check("the welcome screen indents the worktrees", (await page.$$(".recent-item.worktree")).length === 8);
await shot("rp3-welcome");
await page.click(`.recent-item[title='${repo}'] .icon-button`);
await within("the project and its worktrees go away", async () => (await page.$$eval(".recent-item", (els) => els.map((e) => e.title))).join() === lib);

console.log("errors:", JSON.stringify(errors));
await browser.close();
clean();
if (errors.length) process.exit(1);
