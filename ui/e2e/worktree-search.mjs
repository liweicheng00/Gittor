// UI scenario for the Worktrees tab: Mod+3 opens it, the search finds worktrees by name, path and branch,
// and a star puts a worktree first. The star filter shows the favorites and the current worktree only.
// The favorites stay after a reload, and each worktree of the repository shows the same favorites.
// Start the dev server first (see README). Build a fresh repository with make-demo-repo.sh, then:
// node e2e/worktree-search.mjs <repo> <screenshot-dir>. The scenario makes worktrees next to <repo>.
// Set CHROMIUM to a Chromium binary when Playwright has no downloaded browser.
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
const [,, repo, outDir] = process.argv;
const git = (...args) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" }).trim();
const alpha = `${repo}-ws-alpha`;
const beta = `${repo}-ws-beta`;
for (const [p, b] of [[alpha, "ws-alpha"], [beta, "feature/beta"]]) {
  rmSync(p, { recursive: true, force: true });
  git("worktree", "add", "-q", "-b", b, p, "main");
}
const base = (p) => p.split("/").pop();

const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const page = await (await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1.5 })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push("pageerror: " + e));
page.on("console", (m) => m.type() === "error" && errors.push("console: " + m.text()));
const shot = async (n) => { await page.waitForTimeout(400); await page.screenshot({ path: `${outDir}/${n}.png` }); console.log("shot", n); };
const check = (what, ok) => { console.log(ok ? "ok  " : "FAIL", what); if (!ok) errors.push("check: " + what); };
const within = async (what, fn, ms = 8000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return check(what, true);
    await page.waitForTimeout(100);
  }
  check(what, false);
};
const names = () => page.$$eval(".worktree-panel .worktree .branch-name", (els) => els.map((e) => e.textContent));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const row = (p) => `.worktree-panel .worktree:has(.branch-name:text-is('${base(p)}'))`;

await page.goto(`${process.env.GITTOR_E2E_URL ?? "http://127.0.0.1:5174"}/?repo=${encodeURIComponent(repo)}`);
await page.waitForSelector(".log-row", { timeout: 30000 });
check("the Branches tab has no worktrees", (await page.$$(".sidebar .worktree")).length === 0);
await page.click(".log-row >> nth=0");
await page.keyboard.press("Control+3");
await within("Ctrl+3 shows the Worktrees tab", async () => (await page.isVisible(".worktree-panel")) && (await page.$(".lp-tab[aria-label^='Worktrees'].on")) !== null);
check("the search field has the focus", await page.$eval(".worktree-search", (e) => e === document.activeElement));
check("the tab shows the count", ((await page.textContent(".lp-tab[aria-label^='Worktrees'] .lp-count")) ?? "") === "3");
await within("the tab lists the three worktrees", async () => same(await names(), [base(repo), base(alpha), base(beta)]));

// The search: by name, by branch, and no match.
await page.keyboard.type("alpha");
await within("the search finds a worktree by its name", async () => same(await names(), [base(alpha)]));
await page.fill(".worktree-search", "feature/");
await within("the search finds a worktree by its branch", async () => same(await names(), [base(beta)]));
await shot("ws1-search");
await page.fill(".worktree-search", "nothing-like-this");
await within("no match shows a text", async () => (await names()).length === 0 && ((await page.textContent(".worktree-list")) ?? "").includes("No worktree matches"));
await page.fill(".worktree-search", "");

// A star puts the worktree first.
await page.hover(row(beta));
await page.click(`${row(beta)} .fav-toggle`);
await within("the favorite comes first", async () => same(await names(), [base(beta), base(repo), base(alpha)]));
check("the star of the favorite is on", (await page.$(`${row(beta)} .fav-toggle.on`)) !== null);
// The star filter: the favorites and the current worktree.
await page.click(".worktree-panel .fav-filter");
await within("the star filter shows the favorite and the current worktree", async () => same(await names(), [base(beta), base(repo)]));
await shot("ws2-favorites");
await page.click(".worktree-panel .fav-filter");

// The favorites stay after a reload.
await page.reload();
await page.waitForSelector(".log-row", { timeout: 30000 });
await within("the favorite stays after a reload", async () => same(await names(), [base(beta), base(repo), base(alpha)]));

// The keyboard: Down selects a row, Enter opens it. Another worktree has the same favorites.
await page.click(".worktree-search");
await page.fill(".worktree-search", "alpha");
await within("the search shows alpha", async () => same(await names(), [base(alpha)]));
await page.focus(".worktree-search");
await page.press(".worktree-search", "ArrowDown");
await within("Down selects the first row", async () => (await page.$(`${row(alpha)}.selected`)) !== null);
await page.keyboard.press("Enter");
await within("Enter opens the worktree in a tab", async () => ((await page.textContent(".tab.on").catch(() => "")) ?? "").includes(base(alpha)));
await page.fill(".worktree-search", "");
await within("the other worktree shows the same favorite", async () => same(await names(), [base(beta), base(repo), base(alpha)]) && (await page.$(`${row(alpha)}.current`)) !== null);

console.log("errors:", JSON.stringify(errors));
await browser.close();
for (const p of [alpha, beta]) rmSync(p, { recursive: true, force: true });
git("worktree", "prune");
if (errors.length) process.exit(1);
