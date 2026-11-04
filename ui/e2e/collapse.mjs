// e2e: large repository. run-all.sh runs this scenario only with a large repository.
// UI scenario for linear branch collapse on a large repository, for example git/git.
// Start the dev server first (see README), then: node e2e/collapse.mjs <repo> <screenshot-dir>
// Set CHROMIUM to a Chromium binary when Playwright has no downloaded browser.
import { chromium } from "playwright";
const [,, repo, outDir] = process.argv;
const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const page = await (await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1.5 })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push("pageerror: " + e));
await page.goto(`${process.env.GITTOR_E2E_URL ?? "http://127.0.0.1:5174"}/?repo=${encodeURIComponent(repo)}`);
await page.waitForSelector(".log-row", { timeout: 60000 });
await page.waitForTimeout(1500);
const count = async () => (await page.textContent(".statusbar")).replace(/\s+/g, " ");
console.log("before:", await count());
await page.screenshot({ path: `${outDir}/c1-expanded.png` });
let t = Date.now();
await page.click(".graph-tools button[title^='Collapse']");
await page.waitForFunction(() => !document.querySelector(".graph-tools button[title^='Expand']").disabled);
await page.waitForTimeout(800);
console.log("collapse ms:", Date.now() - t, "|", await count());
await page.screenshot({ path: `${outDir}/c2-collapsed.png` });
// A mark of a collapsed branch (data-folds of a row canvas) in the view: a click on it expands the branch.
const mark = await page.evaluate(() => {
  for (const c of document.querySelectorAll(".log-row canvas[data-folds]")) {
    const r = c.getBoundingClientRect();
    if (r.y < 150 || r.y > 600) continue;
    const [x, y] = JSON.parse(c.dataset.folds)[0];
    return { x: r.x + x, y: r.y + y };
  }
  return null;
});
console.log("mark at", JSON.stringify(mark));
if (mark) {
  const before = await count();
  await page.mouse.click(mark.x, mark.y - 1);
  await page.waitForTimeout(700);
  console.log("after expand:", await count(), (await count()) !== before ? "(expanded)" : "(NOT expanded)");
  if ((await count()) === before) errors.push("check: a click on the mark expands the branch");
  await page.screenshot({ path: `${outDir}/c3-edge-expanded.png` });
}
console.log("errors:", JSON.stringify(errors));
await browser.close();
if (errors.length) process.exit(1);
