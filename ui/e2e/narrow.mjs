// UI scenario for the narrow and medium layouts, as in a side panel of another app. Start the dev server
// first (see README). Build a fresh repository with make-demo-repo.sh and run narrow.prep.sh in it, then:
// node e2e/narrow.mjs <repo> <screenshot-dir>.
// Set CHROMIUM to a Chromium binary when Playwright has no downloaded browser.
import { chromium } from "playwright";
const [,, repo, outDir] = process.argv;
const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const context = await browser.newContext({ viewport: { width: 400, height: 900 }, deviceScaleFactor: 1.5 });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push("pageerror: " + e));
page.on("console", (m) => m.type() === "error" && errors.push("console: " + m.text()));
const shot = async (name) => { await page.waitForTimeout(500); await page.screenshot({ path: `${outDir}/${name}.png` }); console.log("shot", name); };
const check = (what, ok) => { console.log(ok ? "ok  " : "FAIL", what); if (!ok) errors.push("check: " + what); };
const within = async (what, fn, ms = 8000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return check(what, true);
    await page.waitForTimeout(200);
  }
  check(what, false);
};
const layout = () => page.evaluate(() => document.documentElement.dataset.layout);
const shows = (sel) => page.evaluate((sel) => { const e = document.querySelector(sel); return !!e && e.getClientRects().length > 0 && e.getBoundingClientRect().width > 0; }, sel);
const noSideScroll = () => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

await page.goto(`${process.env.GITTOR_E2E_URL ?? "http://127.0.0.1:5174"}/?repo=${encodeURIComponent(repo)}`);
await page.waitForSelector(".log-row", { state: "attached", timeout: 30000 });

// 400 px: one column, the left tabs with a Log tab, and no Files tab.
check("the layout is narrow at 400 px", (await layout()) === "narrow");
check("the page does not scroll sideways", await noSideScroll());
check("the Log tab shows", await shows(".lp-tab[aria-label='Log']"));
check("the Files tab does not show", !(await shows(".lp-tab[aria-label='Files']")));
check("the toolbar shows Update, Push and the menu button", (await shows(".tb-split")) && (await shows(".tb-button[title^='Push']")) && (await shows(".tb-more")));
check("the toolbar hides Settings", !(await shows(".tb-button[title='Settings']")));

// The menu button shows the other buttons in a second row.
await page.click(".tb-more");
await within("the second row shows Settings", () => shows(".tb-button[title='Settings']"));
await shot("narrow-1-more");
await page.click(".tb-more");
await within("the second row closes", async () => !(await shows(".tb-button[title='Settings']")));

// The Changes tab, and a click on a file: the diff shows as a page in one column, with Back.
await page.click(".lp-tab[aria-label^='Changes']");
await page.waitForSelector(".cl-file");
await shot("narrow-2-changes");
await page.click(".cl-file:has-text('arith.rs')");
await within("the diff page shows", async () => (await shows(".workspace > .diff")) && !(await shows(".workspace > .top")));
await within("the diff shows the file", async () => ((await page.textContent(".diff-toolbar")) ?? "").includes("arith.rs"));
const sideBySide = () => page.evaluate(() => !!document.querySelector(".workspace > .diff .monaco-diff-editor.side-by-side"));
check("the diff page has one column", !(await sideBySide()));
check("the tabs hide under the diff page", !(await shows(".lp-tab[aria-label='Log']")));
await shot("narrow-3-diff");
await page.click(".diff-back");
await within("Back shows the Changes tab again", async () => (await shows(".commit-panel")) && !(await shows(".workspace > .diff")));
await page.click(".cl-file:has-text('arith.rs')");
await within("the diff page opens again", () => shows(".workspace > .diff"));
await page.keyboard.press("Escape");
await within("Escape closes the diff page", async () => !(await shows(".workspace > .diff")));

// The Log tab: the log with the commit details under it, and no changed files.
await page.click(".lp-tab[aria-label='Log']");
await within("the log shows", () => shows(".log-row"));
await page.click(".log-row:has-text('Rename math to arith')");
await within("the commit details show under the log", async () => (await shows(".details-panel")) && ((await page.textContent(".details-panel")) ?? "").includes("Rename math to arith"));
check("the changed files do not show", !(await shows(".changes-panel")));
check("the log has no author column", !(await shows(".log-row .author")));
check("the filter bar shows the text field only", (await shows(".filter-text")) && !(await shows(".filter-path")));
await page.click(".filter-more");
await within("the filter button shows the other filters", () => shows(".filter-path"));
await page.click(".filter-more");
await shot("narrow-4-log");
check("the page still does not scroll sideways", await noSideScroll());

// 800 px: the medium layout keeps the left pane and puts the details under the log.
await page.setViewportSize({ width: 800, height: 900 });
await within("the layout is medium at 800 px", async () => (await layout()) === "medium");
check("the left pane, the log and the details show", (await shows(".leftpane")) && (await shows(".log-row")) && (await shows(".details-panel")));
check("the changed files do not show in the medium layout", !(await shows(".changes-panel")));
check("the Files tab shows again", await shows(".lp-tab[aria-label='Files']"));
check("the Log tab does not show", !(await shows(".lp-tab[aria-label='Log']")));
check("no side scroll at 800 px", await noSideScroll());
await shot("narrow-5-medium");

// 1600 px: the wide layout as before. View › Left Panel off keeps the log, also after a reload.
await page.setViewportSize({ width: 1600, height: 900 });
await within("the layout is wide at 1600 px", async () => (await layout()) === "wide");
check("the changed files show again", await shows(".changes-panel"));
await page.click(".lp-tab[aria-label^='Changes']");
await page.click(".cl-file:has-text('arith.rs')");
await within("the wide diff panel is side by side again", sideBySide);
await page.click(".tb-button:has-text('View')");
await page.waitForTimeout(400);
await page.click(".menu-item:has-text('Left Panel')");
const centerWidth = () => page.evaluate(() => document.querySelector(".center").getBoundingClientRect().width);
await within("without the left pane the log keeps its width", async () => !(await shows(".leftpane")) && (await centerWidth()) > 600);
await page.reload();
await page.waitForSelector(".log-row", { state: "attached", timeout: 30000 });
await within("the left pane stays off after a reload", async () => !(await shows(".leftpane")) && (await centerWidth()) > 600);
await page.click(".tb-button:has-text('View')");
await page.waitForTimeout(400);
await page.click(".menu-item:has-text('Left Panel')");
await within("the left pane shows again", () => shows(".leftpane"));

console.log("errors:", JSON.stringify(errors));
if (errors.length) process.exitCode = 1;
await browser.close();
