// UI scenario for submodules: the Submodules section under the changelists of the Changes tab, the commits between the recorded and the checked-out
// commit, the diff of a submodule, and Update.
// Start the dev server first (see README). Build a fresh repository with make-demo-repo.sh, then:
// node e2e/submodules.mjs <repo> <screenshot-dir>. The scenario adds a submodule to the repository.
// Set CHROMIUM to a Chromium binary when Playwright has no downloaded browser.
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
const [,, repo, outDir] = process.argv;
const run = (dir, ...args) => execFileSync("git", ["-C", dir, "-c", "protocol.file.allow=always", ...args], { encoding: "utf8" }).replace(/\s+$/, "");
const git = (...args) => run(repo, ...args);
// The name of the tab of the repository: its folder.
const name = basename(repo);

// A library repository with two commits, added to the demo repository as a submodule.
const lib = `${repo}-lib`;
rmSync(lib, { recursive: true, force: true });
mkdirSync(lib, { recursive: true });
run(lib, "init", "-q", "-b", "main");
for (const [n, text] of [["One", "pub fn one() {}\n"], ["Two", "pub fn two() {}\n"]]) {
  writeFileSync(`${lib}/lib.rs`, text);
  run(lib, "add", ".");
  run(lib, "-c", "user.name=Lib", "-c", "user.email=lib@example.com", "-c", "commit.gpgsign=false", "commit", "-q", "-m", n);
}
const c1 = run(lib, "rev-parse", "HEAD~1");
const c2 = run(lib, "rev-parse", "HEAD");
git("submodule", "add", "-q", lib, "vendor/lib");
git("-c", "commit.gpgsign=false", "commit", "-q", "-m", "Add the lib submodule");
const sub = `${repo}/vendor/lib`;

const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const page = await (await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1.5 })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push("pageerror: " + e));
page.on("console", (m) => m.type() === "error" && errors.push("console: " + m.text()));
const shot = async (name) => { await page.waitForTimeout(500); await page.screenshot({ path: `${outDir}/${name}.png` }); console.log("shot", name); };
const check = (what, ok) => { console.log(ok ? "ok  " : "FAIL", what); if (!ok) errors.push("check: " + what); };
const within = async (what, fn, ms = 6000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return check(what, true);
    await page.waitForTimeout(200);
  }
  check(what, false);
};

await page.goto(`${process.env.GITTOR_E2E_URL ?? "http://127.0.0.1:5174"}/?repo=${encodeURIComponent(repo)}`);
await page.waitForSelector(".log-row", { timeout: 30000 });
// The left tabs fit the default width of the left pane: no label is cut.
const cut = await page.$$eval(".lp-tab", (tabs) => tabs.filter((t) => !t.hidden && t.scrollWidth > t.clientWidth).map((t) => t.textContent));
check(`no left tab label is cut (${cut.join(", ")})`, cut.length === 0);
// Control+5 opens the Changes tab at the submodules.
await page.waitForSelector(".submodule-panel:not([hidden])", { state: "attached" });
await page.keyboard.press("Control+5");
await within("Control+5 shows the submodules in the Changes tab", async () => (await page.isVisible(".commit-panel .sm-row")) && (await page.getAttribute(".lp-tab:text-is('Changes')", "class")).includes("on"));
const head = () => page.textContent(".sm-head .sm-title");
const rowText = () => page.textContent(".sm-row");
check("the tab lists vendor/lib on its branch", (await rowText()).includes("vendor/lib") && (await rowText()).includes("main"));
await page.click(".sm-row");
await within("a clean submodule has no detail line", async () => await page.$eval(".sm-detail", (e) => e.hidden));
// Each submodule takes one line.
const noCut = async (when) => {
  const cut = await page.$$eval(".sm-path, .sm-stats, .sm-head, .sm-detail", (els) => els.filter((e) => e.scrollWidth > e.clientWidth).map((e) => e.className));
  check(`no text of the section is cut ${when} (${cut.join(", ")})`, cut.length === 0);
};
await noCut("for a clean submodule");
check("the row is one line", (await page.$eval(".sm-row", (e) => e.getBoundingClientRect().height)) <= 26);
// The section is under the commit message.
check("the section is under the commit message", await page.evaluate(() => document.querySelector(".commit-bottom").getBoundingClientRect().bottom <= document.querySelector(".submodule-panel").getBoundingClientRect().top + 1));

// The submodule at another commit: the tab counts it, and the detail lists the missing commit.
run(sub, "checkout", "-q", c1);
await page.keyboard.press("F5");
await within("the row shows another commit and detached", async () => (await rowText()).includes("≠") && (await rowText()).includes("detached"));
await within("the header counts the submodule", async () => (await page.$(".sm-count.attention")) !== null && (await head()).includes("1"));
await within("the detail says one commit behind", async () => ((await page.textContent(".sm-detail .sm-behind").catch(() => "")) ?? "").includes("1 behind"));
check("the tooltip names the commit Two", ((await page.getAttribute(".sm-detail .sm-behind", "title")) ?? "").includes("Two"));
check("the detail is one line", (await page.$eval(".sm-detail", (e) => e.getBoundingClientRect().height)) <= 24);

// Local changes of the submodule: a changed file and a file that git does not track.
writeFileSync(`${sub}/lib.rs`, "pub fn changed() {}\n");
writeFileSync(`${sub}/extra.rs`, "pub fn extra() {}\n");
await page.keyboard.press("F5");
await within("the detail counts the uncommitted files", async () => (await page.textContent(".sm-detail")).includes("2 uncommitted (1 new)"));
check("the row shows uncommitted changes", (await rowText()).includes("*"));
await within("the line under the header counts the states", async () => {
  const t = await page.textContent(".sm-stats");
  return t.includes("1 ≠ recorded") && t.includes("1 dirty");
});
// The changed submodule shows in the changelist and in the section below it.
await within("the submodule is in the changelist too", async () => (await page.$(".cl-file:has-text('lib')")) !== null);
await noCut("with all marks");
await shot("sm1-submodules-tab");
// A click on the header hides the list, and the setting keeps it.
await page.click(".sm-head .sm-title");
await within("the header hides the list", async () => !(await page.isVisible(".sm-row")));
check("the setting keeps the hidden list", JSON.parse(await page.evaluate(() => localStorage.getItem("gittor.settings.v1"))).submodulesCollapsed === true);
await page.click(".sm-head .sm-title");
await within("the header shows the list again", async () => await page.isVisible(".sm-row"));
run(sub, "checkout", "-q", "--", ".");
rmSync(`${sub}/extra.rs`);

// The Changes tab groups the files by folder: the submodule shows as "lib" under "vendor".
await within("the submodule is a local change", async () => (await page.$(".cl-file:has-text('lib')")) !== null);
await page.click(".cl-file:has-text('lib')");
await within("the diff shows the two commits", async () => {
  const t = await page.textContent(".diff");
  return t.includes(c1.slice(0, 12)) && t.includes(c2.slice(0, 12)) && t.includes("Submodule");
});
await shot("sm2-submodule-diff");

// Update to the recorded commit, with the button of the detail.
await page.keyboard.press("Control+5");
await page.click(".sm-row");
await page.click(".sm-detail .sm-update");
await within("Update checks out the recorded commit", async () => run(sub, "rev-parse", "HEAD") === c2);
await within("the row shows the submodule as clean", async () => !(await rowText()).includes("≠"));
await within("the header has no count of attention", async () => (await page.$(".sm-count.attention")) === null);

// The branch of the row opens the branches of the submodule. "recorded" marks main: its tip is the
// recorded commit.
await page.click(".sm-row .sm-branch");
await page.waitForSelector(".menu .menu-header:text-is('Remote Branches')");
check("the menu marks main as recorded", ((await page.textContent(".menu-item:has(.menu-label:text-matches('^main'))")) ?? "").includes("recorded"));
await shot("sm1b-branch-menu");
await page.waitForTimeout(400);
await page.click(".menu-item:has(.menu-label:text-matches('^main'))");
await within("the submodule is on main", async () => run(sub, "rev-parse", "--abbrev-ref", "HEAD") === "main");
await within("the row shows main", async () => (await page.textContent(".sm-row .sm-branch")).includes("main"));

// A checkout that changes the recorded commit offers Update Submodules.
git("checkout", "-q", "-b", "old-lib");
run(sub, "checkout", "-q", c1);
git("-c", "commit.gpgsign=false", "commit", "-q", "-am", "Use the old lib");
git("checkout", "-q", "main");
run(sub, "checkout", "-q", c2);
await page.keyboard.press("F5");
await page.click(".lp-tab:text-is('Branches')");
await page.waitForSelector(".branch:has-text('old-lib')");
await page.dblclick(".branch:has-text('old-lib')");
await within("the checkout offers Update Submodules", async () => (await page.$(".toast-action:has-text('Update Submodules')")) !== null);
await shot("sm3-update-offer");
await page.click(".toast-action:has-text('Update Submodules')");
await within("the submodule follows the checkout", async () => run(sub, "rev-parse", "HEAD") === c1);

// Ahead: the parent goes back to main, and the submodule stays at the old commit plus one new commit.
run(sub, "checkout", "-q", c2);
writeFileSync(`${sub}/lib.rs`, "pub fn three() {}\n");
run(sub, "-c", "user.name=Lib", "-c", "user.email=lib@example.com", "-c", "commit.gpgsign=false", "commit", "-q", "-am", "Three");
git("checkout", "-q", "main");
await page.keyboard.press("F5");
await page.click(".lp-tab:text-is('Changes')");
await page.click(".sm-row");
await within("the detail says one commit ahead", async () => ((await page.textContent(".sm-detail .sm-ahead").catch(() => "")) ?? "").includes("1 ahead"));
check("no Update for a submodule with commits of its own", (await page.$(".sm-detail .sm-update")) === null);
await shot("sm4-ahead");

// A click on "1 ahead" opens the submodule in a tab and selects the commit there.
await page.click(".sm-detail .sm-ahead");
await within("the submodule opens in a tab", async () => (await page.textContent(".tab.on .tab-name")).includes("lib"));
await within("the commit Three is selected", async () => (await page.textContent(".log-row.selected")).includes("Three"));
await shot("sm5-open-commit");

// Drag a tab in the tab bar: it changes its place.
const tabNames = () => page.$$eval(".tab .tab-name", (els) => els.map((e) => e.textContent));
const drag = async (selector, dx, dy) => {
  const box = await page.locator(selector).boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(box.x + box.width / 2 + (dx * i) / 10, box.y + box.height / 2 + (dy * i) / 10);
  await page.mouse.up();
};
check("the tabs are the repository and lib", JSON.stringify(await tabNames()) === JSON.stringify([name, "lib"]));
const first = await page.locator(`.tab:has-text('${name}')`).boundingBox();
const libTab = await page.locator(".tab:has-text('lib')").boundingBox();
await drag(".tab:has-text('lib')", first.x - libTab.x - 10, 0);
await within("a drag in the tab bar puts lib first", async () => JSON.stringify(await tabNames()) === JSON.stringify(["lib", name]));
check("the order is saved", JSON.parse(await page.evaluate(() => localStorage.getItem("gittor.settings.v1"))).tabs[0].endsWith("vendor/lib"));

// Drag a tab out of the tab bar: the repository moves to a window of its own, as in a browser. The
// main window keeps its other tabs.
const box = await page.locator(".tab:has-text('lib')").boundingBox();
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await page.mouse.down();
for (let i = 1; i <= 10; i++) await page.mouse.move(box.x + box.width / 2 + i * 10, box.y + box.height / 2 + i * 20);
await within("the drag shows the hint for a new window", async () => (await page.$(".tab-detach-hint")) !== null);
await shot("sm6-drag-out");
const [popup] = await Promise.all([page.context().waitForEvent("page"), page.mouse.up()]);
popup.on("pageerror", (e) => errors.push("popup pageerror: " + e));
popup.on("console", (m) => m.type() === "error" && errors.push("popup console: " + m.text()));
await popup.waitForSelector(".log-row", { timeout: 30000 });
await within("the window shows the submodule log", async () => (await popup.textContent(".log")).includes("Three"));
check("the window has no tab bar", await popup.$eval(".tabbar", (e) => e.hidden));
await within("the main window shows the parent repository", async () => (await page.textContent(".tb-repo")).includes(name));
check("the main window has one tab now", await page.$eval(".tabbar", (e) => e.hidden));
await popup.click(".lp-tab:text-is('Stash')");
const stored = JSON.parse(await page.evaluate(() => localStorage.getItem("gittor.settings.v1")));
check("the settings keep the tabs of the main window", stored.tabs.length === 1 && stored.tabs[0].endsWith(name));

// A repository shows in one window only: the main window does not open the submodule again.
await page.click(".lp-tab:text-is('Changes')");
await page.click(".sm-row .sm-open");
await within("the main window says that another window shows it", async () => (await page.$(".toast:has-text('is open in another window')")) !== null);
check("the main window opens no tab for it", await page.$eval(".tabbar", (e) => e.hidden));
await popup.screenshot({ path: `${outDir}/sm8-new-window.png` });
await shot("sm7-open-elsewhere");

// After the window closes, the main window can open the submodule again. A page that Playwright closes
// runs no beforeunload, so the entry of the window gets old first.
await popup.close();
await page.waitForTimeout(11000);
await page.click(".sm-row .sm-open");
await within("the submodule opens in a tab again", async () => (await page.textContent(".tab.on .tab-name").catch(() => "")).includes("lib"));
console.log("errors:", JSON.stringify(errors));
await browser.close();
if (errors.length) process.exit(1);
