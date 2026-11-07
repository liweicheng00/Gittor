// UI scenario for the "H" label of the commit that is checked out, on a branch and on a detached HEAD.
// Start the dev server first (see README). Build a fresh repository with make-demo-repo.sh, then:
// node e2e/head-label.mjs <repo> <screenshot-dir>. Set CHROMIUM to a Chromium binary when Playwright has
// no downloaded browser.
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
const [,, repo, outDir] = process.argv;
const git = (...args) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" }).trim();

const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const page = await (await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1.5 })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push("pageerror: " + e));
page.on("console", (m) => m.type() === "error" && errors.push("console: " + m.text()));
const shot = async (name) => { await page.waitForTimeout(300); await page.screenshot({ path: `${outDir}/${name}.png` }); console.log("shot", name); };
const check = (what, ok) => { console.log(ok ? "ok  " : "FAIL", what); if (!ok) errors.push("check: " + what); };
const within = async (what, fn, ms = 6000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return check(what, true);
    await page.waitForTimeout(100);
  }
  check(what, false);
};
// The labels of the row of HEAD, in order.
const headLabels = () => page.$$eval(".log-row.head .subject .ref", (els) => els.map((e) => e.textContent));

await page.goto(`${process.env.GITTOR_E2E_URL ?? "http://127.0.0.1:5174"}/?repo=${encodeURIComponent(repo)}`);
await page.waitForSelector(".log-row", { timeout: 30000 });

// On a branch: "H" comes first, then the branch.
await within("the row of HEAD has the H label first", async () => {
  const l = await headLabels();
  return l[0] === "H" && l.includes("main");
});
check("only one row has the H label", (await page.$$(".ref-h")).length === 1);
await shot("hl1-branch");

// A detached HEAD: "H" in place of the long HEAD label.
const parent = git("rev-parse", "HEAD~1");
git("checkout", "-q", "--detach", parent);
await page.keyboard.press("F5");
await within("the H label moves to the detached commit", async () => {
  const oid = await page.$eval(".log-row.head .hash", (e) => e.textContent).catch(() => "");
  const l = await headLabels();
  return parent.startsWith(oid ?? "-") && l[0] === "H" && !l.includes("HEAD");
});
await shot("hl2-detached");

git("checkout", "-q", "main");
console.log("errors:", JSON.stringify(errors));
await browser.close();
if (errors.length) process.exit(1);
