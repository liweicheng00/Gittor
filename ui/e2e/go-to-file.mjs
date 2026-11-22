// UI scenario for Go to File: double Shift shows a search over the window. It finds a file of the
// working tree by its name, also by the letters of the name in order, and Enter opens the file in the
// center panel. Mod+Shift+O shows it too, Escape closes it, and Shift with a letter does not count.
// Start the dev server first (see README). Build a fresh repository with make-demo-repo.sh, then:
// node e2e/go-to-file.mjs <repo> <screenshot-dir>.
// Set CHROMIUM to a Chromium binary when Playwright has no downloaded browser.
import { chromium } from "playwright";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
const [,, repo, outDir] = process.argv;
// A file in a folder, for a query with a folder. The search lists untracked files too.
mkdirSync(`${repo}/docs/guide`, { recursive: true });
writeFileSync(`${repo}/docs/guide/start.md`, "# Start\n");

const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const page = await (await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1.5 })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push("pageerror: " + e));
page.on("console", (m) => m.type() === "error" && errors.push("console: " + m.text()));
const shot = async (name) => { await page.screenshot({ path: `${outDir}/${name}.png` }); console.log("shot", name); };
const check = (what, ok) => { console.log(ok ? "ok  " : "FAIL", what); if (!ok) errors.push("check: " + what); };
const within = async (what, fn, ms = 5000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return check(what, true);
    await page.waitForTimeout(100);
  }
  check(what, false);
};
const finder = ".file-finder";
const rows = () => page.$$eval(".file-finder-row", (els) => els.map((e) => e.getAttribute("title")));
const doubleShift = async () => {
  await page.keyboard.press("Shift");
  await page.keyboard.press("Shift");
};

await page.goto(`${process.env.GITTOR_E2E_URL ?? "http://127.0.0.1:5174"}/?repo=${encodeURIComponent(repo)}`);
await page.waitForSelector(".log-row", { timeout: 30000 });
await page.click(".log-row >> nth=0");

// Shift with a letter, then one Shift: no search.
await page.keyboard.press("Shift+A");
await page.keyboard.press("Shift");
await page.waitForTimeout(300);
check("Shift with a letter does not count as a press of Shift", !(await page.isVisible(finder)));
await page.waitForTimeout(500);

// Double Shift shows the search with the focus in its field.
await doubleShift();
await within("double Shift shows Go to File", async () => await page.isVisible(finder));
check("the field has the focus", await page.$eval(".file-finder-input", (e) => e === document.activeElement));
await within("the list shows the files of the working tree", async () => (await rows()).length > 3);

// The letters of the name in order find the file; the matched letters are marked.
await page.keyboard.type("prs");
await within("prs finds parser.rs first", async () => (await rows())[0] === "parser.rs");
check("the matched letters are marked", (await page.$$(".file-finder-row.selected mark")).length > 0);
await shot("gf1-search");
await page.keyboard.press("Enter");
await within("Enter opens the file in the center panel", async () => !(await page.isVisible(finder)) && ((await page.textContent(".center-tab.on").catch(() => "")) ?? "").includes("parser.rs"));

// Down chooses the next row; a folder in the query matches the path.
await doubleShift();
await within("Go to File shows again", async () => await page.isVisible(finder));
await page.keyboard.type("guide/st");
await within("a query with a folder finds docs/guide/start.md", async () => (await rows())[0] === "docs/guide/start.md");
await page.keyboard.press("Enter");
await within("the second file opens", async () => ((await page.textContent(".center-tab.on").catch(() => "")) ?? "").includes("start.md"));

// Mod+Shift+O shows it too, and Escape closes it without a change.
await page.click(".log-row >> nth=0").catch(() => {});
await page.keyboard.press("Control+Shift+O");
await within("Mod+Shift+O shows Go to File", async () => await page.isVisible(finder));
await page.keyboard.type("zzzz");
await within("no match shows a text", async () => ((await page.textContent(".file-finder-list")) ?? "").includes("No file matches"));
await page.keyboard.press("Escape");
await within("Escape closes Go to File", async () => !(await page.isVisible(finder)));

console.log("errors:", JSON.stringify(errors));
await browser.close();
rmSync(`${repo}/docs`, { recursive: true, force: true });
if (errors.length) process.exit(1);
