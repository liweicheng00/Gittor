// UI scenario for Open in Editor: choose the editor in the settings, then open a file with F4, the button of
// the diff and the file menu, at the line of the cursor. A small script stands in for the editor and writes
// its arguments to a file. The IDE button opens the repository at the file in view. A missing program shows an
// error.
// Start the dev server first (see README). Build a fresh repository with make-demo-repo.sh, then:
// node e2e/open-in-editor.mjs <repo> <screenshot-dir>.
// Set CHROMIUM to a Chromium binary when Playwright has no downloaded browser.
import { chromium } from "playwright";
import { chmodSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
const [,, repo, outDir] = process.argv;
const script = `${repo}-editor.sh`;
const log = `${repo}-editor.log`;
writeFileSync(script, `#!/bin/sh\nprintf '%s\\n' "$@" > '${log}'\n`);
chmodSync(script, 0o755);
const opened = () => (existsSync(log) ? readFileSync(log, "utf8").trim() : "");

const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const page = await (await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1.5 })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push("pageerror: " + e));
// The missing program below fails on purpose.
page.on("console", (m) => m.type() === "error" && !m.text().includes("status of 400") && errors.push("console: " + m.text()));
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
// The dialog closes before the backend saves the setting. Wait for the saved value.
const savedSetting = (key, value) =>
  within(`the backend keeps the ${key} command`, async () =>
    page.evaluate(async ([k, v]) => (await (await fetch("/api/backend_settings", { method: "POST", body: "{}" })).json())[k] === v, [key, value]));
const setEditor = async (command) => {
  await page.click(".tb-button[title='Settings']");
  await page.waitForSelector(".settings-dialog");
  await page.click(".settings-page:has-text('Editor')");
  if (command === null) return;
  await page.fill(".editor-command", command);
  await page.click(".settings-dialog .dialog-buttons button:has-text('OK')");
  await savedSetting("editor", command);
};
const expectOpened = (what, line) => within(what, async () => opened() === `--goto\n${repo}/main.rs:${line}`);

await page.goto(`${process.env.GITTOR_E2E_URL ?? "http://127.0.0.1:5174"}/?repo=${encodeURIComponent(repo)}`);
await page.waitForSelector(".log-row", { timeout: 30000 });

// The Editor page: a preset fills the command.
await setEditor(null);
await page.selectOption(".editor-preset", { label: "Visual Studio Code" });
check("the preset fills the command", (await page.inputValue(".editor-command")) === "code --goto {file}:{line}:{column}");
// The page names the parameters and shows the commands that the setting makes.
const preview = () => page.$$eval(".command-preview code", (els) => els.map((e) => e.textContent));
await within("the preview shows the commands of F4 and of the IDE button", async () => {
  const p = await preview();
  return p[0] === `code --goto ${repo}/src/main.rs:12:5` && p[1] === `code ${repo} --goto ${repo}/src/main.rs:12:5`;
});
check("the page names the parameters", (await page.$$eval(".param-chip", (els) => els.map((e) => e.textContent).join(" "))) === "{file} {line} {column}");
await page.fill(".editor-command", "subl ");
await page.click(".param-chip:text-is('{file}')");
await within("a click on a parameter inserts it at the cursor", async () => (await page.inputValue(".editor-command")) === "subl {file}");
await within("the preview follows the command", async () => (await preview())[0] === `subl ${repo}/src/main.rs`);
await shot("oe1-settings");
await page.fill(".editor-command", `${script} --goto {file}:{line}`);
check("another command shows as Other command", (await page.$eval(".editor-preset", (e) => e.selectedOptions[0].textContent)) === "Other command");
await page.click(".settings-dialog .dialog-buttons button:has-text('OK')");
await savedSetting("editor", `${script} --goto {file}:{line}`);

// F4 in the Changes tab opens the selected file at the first change on the screen. main.rs adds line 4.
await page.keyboard.press("Control+2");
await page.click(".cl-file:has(.path:text-is('main.rs'))");
await page.waitForSelector(".diff .editor.modified .view-line");
await page.waitForTimeout(800);
await page.keyboard.press("F4");
await expectOpened("F4 opens the file at the first change", 4);
await within("the status bar says so", async () => ((await page.textContent(".sb-activity")) ?? "").includes("main.rs:4"));

// A click on line 2 of the diff, then the button of the diff toolbar.
rmSync(log, { force: true });
const lineTwo = await page.$$eval(".diff .editor.modified .line-numbers", (els) => {
  const e = els.find((x) => x.textContent?.trim() === "2");
  const r = e?.getBoundingClientRect();
  return r ? { y: r.top + r.height / 2 } : null;
});
const text = await page.$eval(".diff .editor.modified .view-lines", (e) => { const r = e.getBoundingClientRect(); return r.left + 40; });
await page.mouse.click(text, lineTwo.y);
await page.click(".diff .diff-open-editor");
await expectOpened("the button opens the line of the cursor", 2);
// F4 in the diff takes the same line.
rmSync(log, { force: true });
await page.keyboard.press("F4");
await expectOpened("F4 in the diff opens the line of the cursor", 2);

// The file menu.
rmSync(log, { force: true });
await page.click(".cl-file:has(.path:text-is('main.rs'))", { button: "right" });
check("the menu shows the key", ((await page.textContent(".menu-item:has-text('Open in Editor')")) ?? "").includes("F4"));
await shot("oe2-menu");
await page.click(".menu-item:has-text('Open in Editor')");
await within("the menu opens the file", async () => opened().startsWith(`--goto\n${repo}/main.rs:`));

// F4 in the Compare window opens the file of its diff.
rmSync(log, { force: true });
await page.dblclick(".cl-file:has(.path:text-is('main.rs'))");
await page.waitForSelector(".merge-overlay .editor.modified .view-line");
await page.waitForTimeout(800);
await page.keyboard.press("F4");
await within("F4 in the Compare window opens its file", async () => opened().startsWith(`--goto\n${repo}/main.rs:`));
await page.keyboard.press("Escape");
await page.waitForSelector(".merge-overlay", { state: "detached" });

// The IDE button opens the folder of the repository and the file of the diff panel at the cursor.
rmSync(log, { force: true });
await page.click(".tb-ide");
await within("the IDE button opens the repository at the file of the diff", async () => opened().startsWith(`${repo}\n--goto\n${repo}/main.rs:`));
await within("the click shows the key of the button", async () => ((await page.textContent(".key-hint").catch(() => "")) ?? "").includes("Shift+F4"));
await shot("oe4-ide");
// Shift+F4 does the same.
rmSync(log, { force: true });
await page.click(".cl-file:has(.path:text-is('main.rs'))");
await page.keyboard.press("Shift+F4");
await within("Shift+F4 opens the repository at the file of the diff", async () => opened().startsWith(`${repo}\n--goto\n${repo}/main.rs:`));

// The Review window has the IDE button too, and Shift+F4 works there.
await page.click(".lp-tab:text-is('Branches')");
await page.click(".sidebar .branch:has(.branch-name:text-is('feature/cli')) >> nth=0", { button: "right" });
await page.waitForTimeout(400);
await page.click(".menu-item:has-text('Review Branch')");
await page.click(".dialog-buttons button:has-text('Start Review')");
await page.waitForSelector(".review-window .review-ide");
rmSync(log, { force: true });
await page.click(".review-window .review-ide");
// cli.rs of the reviewed branch is not in the working tree: the editor opens the folder only.
await within("the IDE button of a review opens the folder when the file is not in the working tree", async () => opened() === repo);
rmSync(log, { force: true });
await page.click(".review-window .review-files");
await page.keyboard.press("Shift+F4");
await within("Shift+F4 works in the Review window", async () => opened() === repo);
await shot("oe5-review-ide");
await page.keyboard.press("Escape");
await page.waitForSelector(".review-window", { state: "detached" });

// topic/readme changes README.md, which is in the working tree: the IDE opens at that file.
await page.click(".lp-tab:text-is('Branches')");
await page.click(".sidebar .branch:has(.branch-name:text-is('topic/readme')) >> nth=0", { button: "right" });
await page.waitForTimeout(400);
await page.click(".menu-item:has-text('Review Branch')");
await page.click(".dialog-buttons button:has-text('Start Review')");
await page.waitForSelector(".review-window .review-ide");
await page.waitForFunction(() => document.querySelector(".review-window .diff-title")?.textContent?.includes("README.md"));
rmSync(log, { force: true });
await page.click(".review-window .review-ide");
await within("the IDE button of a review opens the repository at the file of the review", async () => opened().startsWith(`${repo}\n--goto\n${repo}/README.md:`));
await page.keyboard.press("Escape");
await page.waitForSelector(".review-window", { state: "detached" });
await page.click(".lp-tab:text-is('Changes')");

// A program that does not exist shows an error.
await setEditor("no-such-editor-xyz {file}");
await page.click(".cl-file:has(.path:text-is('main.rs'))");
await page.keyboard.press("F4");
await within("a missing program shows an error", async () => ((await page.textContent(".toasts").catch(() => "")) ?? "").includes("Cannot find the editor program no-such-editor-xyz"));
await shot("oe3-error");
await setEditor("");
// Without an editor, the IDE button asks for one.
await page.click(".tb-ide");
await within("without an editor, the IDE button asks for one", async () => ((await page.textContent(".toasts").catch(() => "")) ?? "").includes("Choose an editor in Settings › Editor"));
console.log("errors:", JSON.stringify(errors));
await browser.close();
if (errors.length) process.exit(1);
