// UI scenario for submodules: the Submodules tab, the commits between the recorded and the checked-out
// commit, the diff of a submodule, and Update.
// Start the dev server first (see README). Build a fresh repository with make-demo-repo.sh, then:
// node e2e/submodules.mjs <repo> <screenshot-dir>. The scenario adds a submodule to the repository.
// Set CHROMIUM to a Chromium binary when Playwright has no downloaded browser.
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
const [,, repo, outDir] = process.argv;
const run = (dir, ...args) => execFileSync("git", ["-C", dir, "-c", "protocol.file.allow=always", ...args], { encoding: "utf8" }).replace(/\s+$/, "");
const git = (...args) => run(repo, ...args);

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

await page.goto(`http://127.0.0.1:5174/?repo=${encodeURIComponent(repo)}`);
await page.waitForSelector(".log-row", { timeout: 30000 });
await within("the Submodules tab shows", async () => await page.isVisible(".lp-tab:text-is('Modules')"));
await page.click(".lp-tab:text-is('Modules')");
await page.waitForSelector(".sm-row");
const rowText = () => page.textContent(".sm-row");
check("the tab lists vendor/lib on its branch", (await rowText()).includes("vendor/lib") && (await rowText()).includes("main"));
await page.click(".sm-row");
await within("a clean submodule is at the recorded commit", async () => (await page.textContent(".sm-detail")).includes("At the recorded commit"));

// The submodule at another commit: the tab counts it, and the detail lists the missing commit.
run(sub, "checkout", "-q", c1);
await page.keyboard.press("F5");
await within("the row shows another commit and detached", async () => (await rowText()).includes("other commit") && (await rowText()).includes("detached"));
await within("the tab counts the submodule", async () => (await page.textContent(".lp-tab:has-text('Modules')")).includes("1"));
await within("the detail says one commit behind", async () => (await page.textContent(".sm-detail")).includes("1 commit behind the recorded commit"));
check("the detail lists the commit Two", (await page.textContent(".sm-commit")).includes("Two"));

// Local changes of the submodule: a changed file and a file that git does not track.
writeFileSync(`${sub}/lib.rs`, "pub fn changed() {}\n");
writeFileSync(`${sub}/extra.rs`, "pub fn extra() {}\n");
await page.keyboard.press("F5");
await within("the detail lists the local changes", async () => {
  const t = await page.textContent(".sm-detail");
  return t.includes("Local changes (2)") && t.includes("lib.rs") && t.includes("extra.rs");
});
check("the row shows modified and unversioned files", (await rowText()).includes("modified") && (await rowText()).includes("unversioned files"));
await shot("sm1-submodules-tab");
run(sub, "checkout", "-q", "--", ".");
rmSync(`${sub}/extra.rs`);

// The Changes tab groups the files by folder: the submodule shows as "lib" under "vendor".
await page.click(".lp-tab:has-text('Changes')");
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
await page.click(".sm-actions button:has-text('Update to Recorded')");
await within("Update checks out the recorded commit", async () => run(sub, "rev-parse", "HEAD") === c2);
await within("the row shows the submodule as clean", async () => !(await rowText()).includes("other commit"));
await within("the tab has no count", async () => (await page.textContent(".lp-tab:has-text('Modules')")).trim() === "Modules");

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
await page.click(".lp-tab:text-is('Modules')");
await page.click(".sm-row");
await within("the detail says one commit ahead", async () => (await page.textContent(".sm-detail")).includes("1 commit ahead of the recorded commit"));
check("no Update for a submodule with commits of its own", (await page.$(".sm-actions button:has-text('Update to Recorded')")) === null);
await shot("sm4-ahead");

// A double click on a commit opens the submodule in a tab and selects the commit there.
await page.dblclick(".sm-commit:has-text('Three')");
await within("the submodule opens in a tab", async () => (await page.textContent(".tab.on .tab-name")).includes("lib"));
await within("the commit Three is selected", async () => (await page.textContent(".log-row.selected")).includes("Three"));
await shot("sm5-open-commit");
console.log("errors:", JSON.stringify(errors));
await browser.close();
if (errors.length) process.exit(1);
