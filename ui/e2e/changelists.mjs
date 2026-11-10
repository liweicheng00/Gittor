// UI scenario for changelists and the commit panel. Start the dev server first (see README).
// Build a fresh repository with make-demo-repo.sh, then add local changes:
//   echo "More docs" >> README.md; sed -i 's/wrapping_add/saturating_add/' arith.rs
//   echo 'pub fn sub() {}' > sub.rs; git add sub.rs
// Then: node e2e/changelists.mjs <repo> <screenshot-dir>. The scenario changes the repository.
// Set CHROMIUM to a Chromium binary when Playwright has no downloaded browser.
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import { appendFileSync, writeFileSync } from "node:fs";
const [,, repo, outDir] = process.argv;
const git = (...args) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" }).replace(/\s+$/, "");
const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const page = await (await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1.5 })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push("pageerror: " + e));
page.on("console", (m) => m.type() === "error" && errors.push("console: " + m.text()));
const shot = async (name) => { await page.waitForTimeout(700); await page.screenshot({ path: `${outDir}/${name}.png` }); console.log("shot", name); };
const check = (what, ok) => { console.log(ok ? "ok  " : "FAIL", what); if (!ok) errors.push("check: " + what); };
const within = async (what, fn, ms = 8000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return check(what, true);
    await page.waitForTimeout(200);
  }
  check(what, false);
};
const tree = async () => (await page.textContent(".commit-tree")).replace(/\s+/g, " ");
const toastText = async () => (await page.textContent(".toasts").catch(() => "")).replace(/\s+/g, " ");
const clearToasts = () => page.evaluate(() => document.querySelectorAll(".toast").forEach((t) => t.remove()));

await page.goto(`${process.env.GITTOR_E2E_URL ?? "http://127.0.0.1:5174"}/?repo=${encodeURIComponent(repo)}`);
await page.waitForSelector(".log-row", { timeout: 30000 });
await page.click(".lp-tab:has-text('Changes')");
await page.waitForSelector(".cl-file");
console.log("tree:", await tree());
check("tab shows the count", (await page.textContent(".lp-tab:has-text('Changes') .lp-count")) === "5");
await page.click(".cl-file:has-text('arith.rs')");
await page.waitForTimeout(1200);
await shot("cl1-commit-panel");

// A double click on a local change opens the compare window with that file.
const name = "arith.rs";
await page.dblclick(".commit-panel .cl-file:has-text('arith.rs')");
await page.waitForSelector(".history-window[aria-label='Compare Branches']");
await within(`the compare window shows ${name}`, async () => ((await page.textContent(".compare-file.selected").catch(() => "")) ?? "").includes(String(name).split("/").pop()));
check("the right side is the working tree", (await page.inputValue(".compare-select >> nth=1")) === "\u0000worktree");
await shot("cl8-compare");
await page.keyboard.press("Escape");

// New changelist with README.md, from the file menu.
await page.click(".cl-file:has-text('README.md')", { button: "right" });
await page.click(".menu-item:has-text('New Changelist')");
await page.fill(".dialog-field:has-text('Name') input", "Docs");
await page.fill(".dialog-field:has-text('Comment') textarea", "Document the release");
await page.click(".dialog-buttons button:has-text('Create')");
await page.waitForSelector(".cl-header:has-text('Docs')");
// Move sub.rs with drag and drop.
await page.dragAndDrop(".cl-file:has-text('sub.rs')", ".cl-header:has-text('Docs')");
await page.waitForTimeout(800);
console.log("tree:", await tree());
check("Docs holds README.md and sub.rs", /Docs ?2 files.*README\.md.*sub\.rs/.test(await tree()));
await shot("cl2-two-changelists");

// The compare window lists the files of the changelist of the file only.
const compareFiles = () => page.$$eval(".compare-files .compare-file", (els) => els.map((e) => e.textContent ?? ""));
const compareOf = async (file) => {
  await page.dblclick(`.commit-panel .cl-file:has-text('${file}')`);
  await page.waitForSelector(".history-window[aria-label='Compare Branches']");
  await within(`the compare window shows ${file}`, async () => ((await page.textContent(".compare-file.selected").catch(() => "")) ?? "").includes(file));
};
await compareOf("README.md");
await within("the compare window of Docs lists README.md and sub.rs only", async () => {
  const f = await compareFiles();
  return f.length === 2 && f.some((t) => t.includes("README.md")) && f.some((t) => t.includes("sub.rs"));
});
check("the compare window names the changelist", ((await page.textContent(".compare-files-title")) ?? "").includes("2 files in Docs"));
await shot("cl2b-compare-docs");
await page.keyboard.press("Escape");
await compareOf("arith.rs");
await within("the compare window of Changes has no file of Docs", async () => {
  const f = await compareFiles();
  return f.length > 0 && !f.some((t) => t.includes("README.md") || t.includes("sub.rs"));
});
check("the compare window names Changes", ((await page.textContent(".compare-files-title")) ?? "").includes("in Changes"));
await page.keyboard.press("Escape");

// Commit only the Docs changelist.
await page.click(".cl-header:has-text('Docs')", { button: "right" });
await shot("cl3-changelist-menu");
await page.click(".menu-item:has-text('Commit Only This Changelist')");
check("draft message loaded", (await page.inputValue(".commit-message")) === "Document the release");
check("commit button names the list", (await page.textContent(".commit-button")).includes("Docs"));
await shot("cl4-ready");
await page.click(".commit-button");
await page.waitForTimeout(2000);
console.log("toast:", await toastText());
const files = git("show", "--name-only", "--format=", "HEAD");
check("commit has only the Docs files", files === "README.md\nsub.rs");
check("commit message", git("log", "-1", "--format=%s") === "Document the release");
check("other files still modified", git("status", "--porcelain") === " M arith.rs\n M main.rs\n?? NOTES.txt");
console.log("status:", JSON.stringify(git("status", "--porcelain")), "tree:", await tree());
check("Docs list is empty and stays", /Docs ?0 files/.test(await tree()));
await shot("cl5-committed");

// Undo the commit: the changes come back as local changes.
await page.click(".toast-action:has-text('Undo')");
await page.waitForTimeout(1500);
check("undo restores the files", git("status", "--porcelain").includes("README.md") && git("log", "-1", "--format=%s") !== "Document the release");
await clearToasts();

// Amend loads the last message.
await page.check(".commit-amend input");
await page.waitForTimeout(500);
check("amend loads the HEAD message", (await page.inputValue(".commit-message")).length > 0);
await page.uncheck(".commit-amend input");

// The fixed changelists: .ignore first, Changes second, then the others.
const names = () => page.$$eval(".cl-header[data-list] .cl-name", (els) => els.map((e) => e.textContent));
check("the changelists are .ignore, Changes, Docs", JSON.stringify((await names()).slice(0, 3)) === JSON.stringify([".ignore", "Changes", "Docs"]));
// A new change goes to Changes, also when another changelist exists.
appendFileSync(`${repo}/parser.rs`, "// local setting\n");
await within("the new change is in Changes", async () => {
  const t = await tree();
  return /Changes.*parser\.rs.*Docs/.test(t) && !/Docs.*parser\.rs/.test(t);
});
// A file in .ignore cannot be checked, and no commit takes it.
await page.dragAndDrop(".cl-file:has-text('parser.rs')", ".cl-header:has-text('.ignore')");
await within("parser.rs is in .ignore", async () => /\.ignore ?1 file ?parser\.rs/.test(await tree()));
// A mouse drag over the rows selects no text.
const first = await page.locator(".cl-header:has-text('.ignore') .cl-name").boundingBox();
const last = await page.locator(".cl-header:has-text('Docs') .cl-name").boundingBox();
await page.mouse.move(first.x + 2, first.y + first.height / 2);
await page.mouse.down();
await page.mouse.move(last.x + last.width, last.y + last.height / 2, { steps: 10 });
await page.mouse.up();
check("a drag over the changelists selects no text", (await page.evaluate(() => window.getSelection().toString())) === "");
check("the box of parser.rs is off", await page.isDisabled(".cl-file:has-text('parser.rs') .cl-check"));
check("the box of .ignore is off", await page.isDisabled(".cl-header:has-text('.ignore') .cl-check"));
await page.click(".cl-header:has-text('.ignore')", { button: "right" });
await page.waitForTimeout(400);
check("the menu cannot remove .ignore", await page.isDisabled(".menu-item:has-text('Remove Changelist')"));
check("the menu cannot commit .ignore", await page.isDisabled(".menu-item:has-text('Commit Only This Changelist')"));
await page.keyboard.press("Escape");
await shot("cl9-ignore");

// Rollback of main.rs.
await page.click(".cl-file:has-text('main.rs')", { button: "right" });
await page.click(".menu-item:has-text('Rollback')");
await shot("cl6-rollback-dialog");
await page.click(".dialog-buttons button:has-text('Rollback')");
await page.waitForTimeout(1500);
check("main.rs rolled back", !git("status", "--porcelain").includes("main.rs"));
await clearToasts();

// Unversioned file: include it with the checkbox and commit with the default list.
await page.click(".cl-header:has-text('Changes') .cl-check");
await page.check(".cl-file:has-text('NOTES.txt') .cl-check");
await page.fill(".commit-message", "Add notes and arith change");
await page.keyboard.press("Control+Enter");
await page.waitForTimeout(2000);
check("commit with unversioned file", git("show", "--name-only", "--format=", "HEAD").includes("NOTES.txt"));
check("the commit does not take the file in .ignore", !git("show", "--name-only", "--format=", "HEAD").includes("parser.rs") && git("status", "--porcelain").includes("parser.rs"));

// Dark theme.
await page.click(".tb-button[title='Theme']");
await page.click(".menu-item:has-text('Dark')");
await page.click(".cl-header:has-text('Changes')");
await page.waitForTimeout(1200);
await shot("cl7-dark");

// An unversioned file moves to .ignore as it is: git does not add it.
writeFileSync(`${repo}/scratch.txt`, "my notes\n");
await page.click(".commit-toolbar button[title^='Refresh']");
await page.waitForSelector(".cl-file:has-text('scratch.txt')");
await page.click(".cl-file:has-text('scratch.txt')", { button: "right" });
await page.waitForTimeout(400);
await page.click(".menu-item:has(.menu-label:text-is('.ignore'))");
await within("the unversioned file shows in .ignore", async () =>
  (await page.evaluate(() => {
    const head = [...document.querySelectorAll(".cl-header")].find((h) => h.textContent.includes(".ignore"));
    for (let n = head?.nextElementSibling; n && !n.classList.contains("cl-header"); n = n.nextElementSibling) if (n.textContent.includes("scratch.txt")) return true;
    return false;
  })));
check("git did not add the file", git("ls-files", "scratch.txt") === "" && git("status", "--porcelain", "scratch.txt") === "?? scratch.txt");
await shot("cl8-ignore-unversioned");
// The compare window of a file in .ignore lists the files of .ignore only.
// .ignore holds parser.rs and scratch.txt now.
await compareOf("scratch.txt");
const ignored = (await compareFiles()).map((t) => t.replace(/[A-Z?]$/, "")).sort();
check("the compare window of .ignore lists its files only", JSON.stringify(ignored) === JSON.stringify(["parser.rs", "scratch.txt"]));
check("the compare window names .ignore", ((await page.textContent(".compare-files-title")) ?? "").includes("2 files in .ignore"));
await shot("cl8b-compare-ignore");
await page.keyboard.press("Escape");

console.log("errors:", JSON.stringify(errors));
await browser.close();
if (errors.length) process.exit(1);
