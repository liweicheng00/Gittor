// UI scenario for the Stale group of the Branches tab: the user marks branches as stale in their menu.
// A stale branch shows in the Stale group only, not in Local or Recent. The mark stays after a reload,
// and Remove from Stale puts the branch back in Local. The menu of a multiple selection marks many.
// Start the dev server first (see README). Build a fresh repository with make-demo-repo.sh, then:
// node e2e/stale-branches.mjs <repo> <screenshot-dir>.
// Set CHROMIUM to a Chromium binary when Playwright has no downloaded browser.
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
const [,, repo, outDir] = process.argv;
const git = (...args) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" }).trim();
git("branch", "old/ancient", "HEAD");
git("branch", "merged-pr", "HEAD");
git("branch", "spike", "HEAD");

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
/** The branch names of a group: the rows after its header and before the next header. */
const groupNames = (title) =>
  page.evaluate((title) => {
    const head = [...document.querySelectorAll(".sidebar .group-header")].find((h) => h.textContent.startsWith(title));
    const names = [];
    for (let n = head?.nextElementSibling; n && !n.classList.contains("group-header"); n = n.nextElementSibling) {
      const name = n.querySelector(".branch-name")?.textContent;
      if (name) names.push(name);
    }
    return head ? names : null;
  }, title);
const stale = ".sidebar .group-header:has(span:text-is('Stale'))";
const branchRow = (name) => `.sidebar .branch-local:has(.branch-name:text-is('${name}')) >> nth=0`;
const menuItem = async (label) => {
  await page.waitForTimeout(400);
  await page.click(`.menu-item:has-text('${label}')`);
};

await page.goto(`${process.env.GITTOR_E2E_URL ?? "http://127.0.0.1:5174"}/?repo=${encodeURIComponent(repo)}`);
await page.waitForSelector(".log-row", { timeout: 30000 });
await page.click(".lp-tab[aria-label^='Branches']");
await page.waitForSelector(branchRow("spike"));
check("without a mark there is no Stale group", (await page.$(stale)) === null);

// Mark one branch in its menu.
await page.click(branchRow("spike"), { button: "right" });
await menuItem("Mark as Stale");
await page.waitForSelector(stale);
check("the Stale group shows its count", ((await page.textContent(`${stale} .group-count`)) ?? "").trim() === "1");
check("the Stale group is closed at first", ((await groupNames("Stale")) ?? []).length === 0);
await within("the branch leaves Local", async () => !((await groupNames("Local")) ?? []).includes("spike"));
await page.click(stale);
await within("the Stale group lists the branch", async () => JSON.stringify(await groupNames("Stale")) === JSON.stringify(["spike"]));

// Mark two branches with the menu of a multiple selection.
await page.click(branchRow("old/ancient"));
await page.click(branchRow("merged-pr"), { modifiers: ["Control"] });
await page.click(branchRow("merged-pr"), { button: "right" });
await menuItem("Mark as Stale");
await within("the selection goes to Stale", async () => {
  const s = (await groupNames("Stale")) ?? [];
  const l = (await groupNames("Local")) ?? [];
  return s.length === 3 && !l.includes("merged-pr") && !l.some((n) => n.includes("ancient"));
});
check("the header says what the group is", ((await page.getAttribute(stale, "title")) ?? "").includes("marked as stale"));
await shot("stale1-group");

// The marks stay after a reload: they are in the repository.
await page.reload();
await page.waitForSelector(".log-row", { timeout: 30000 });
await within("the marks stay after a reload", async () => ((await page.textContent(`${stale} .group-count`).catch(() => "")) ?? "").trim() === "3");

// Remove from Stale puts the branch back in Local.
await page.click(stale);
await page.click(`.sidebar .branch-local:has(.branch-name:text-is('spike')) >> nth=0`, { button: "right" });
await menuItem("Remove from Stale");
await within("the branch is back in Local", async () => ((await groupNames("Local")) ?? []).includes("spike") && !((await groupNames("Stale")) ?? []).includes("spike"));

console.log("errors:", JSON.stringify(errors));
await browser.close();
if (errors.length) process.exit(1);
