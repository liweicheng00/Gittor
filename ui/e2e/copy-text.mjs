// UI scenario for text selection and copy (AGENTS.md, "Text selection and copy"): the user selects text
// with the mouse and Mod+C copies it; a text selection wins over the copy of a list; without a text
// selection, Mod+C on a file row copies the absolute path, on a commit the revision number, on a branch
// its name. Start the dev server first (see README). Build a fresh repository with make-demo-repo.sh, then:
// node e2e/copy-text.mjs <repo> <screenshot-dir>.
// Set CHROMIUM to a Chromium binary when Playwright has no downloaded browser.
import { chromium } from "playwright";
const [,, repo, outDir] = process.argv;

const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const page = await (await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1.5, permissions: ["clipboard-read", "clipboard-write"] })).newPage();
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
const clipboard = () => page.evaluate(() => navigator.clipboard.readText());
const selection = () => page.evaluate(() => getSelection().toString());
/** Mod+C, with a known text on the clipboard before it. Returns the new text of the clipboard. */
const copy = async () => {
  await page.evaluate(() => navigator.clipboard.writeText("<nothing>"));
  await page.keyboard.press("Control+C");
  await page.waitForTimeout(250);
  return clipboard();
};
/** Drags the mouse over the first text of an element, as a user who selects it. Returns that text. */
const dragOver = async (selector) => {
  const r = await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = walker.nextNode())) if (n.textContent.trim().length > 2) break;
    if (!n) return null;
    const range = document.createRange();
    range.selectNodeContents(n);
    const b = range.getClientRects()[0];
    return { x: b.left, y: b.top + b.height / 2, w: b.width, text: n.textContent };
  }, selector);
  if (!r) return null;
  await page.mouse.move(r.x + 1, r.y);
  await page.mouse.down();
  await page.mouse.move(r.x + r.w / 2, r.y, { steps: 4 });
  await page.mouse.move(r.x + r.w - 1, r.y, { steps: 4 });
  await page.mouse.up();
  await page.waitForTimeout(150);
  return r.text;
};
/** The user selects the text of an element with the mouse, and Mod+C copies that text. */
const selectable = async (what, selector) => {
  const text = await dragOver(selector);
  const sel = await selection();
  const flat = (t) => (t ?? "").replace(/\s+/g, " ").trim();
  check(`${what}: the mouse selects the text`, flat(sel).length > 2 && (flat(text).includes(flat(sel)) || flat(sel).includes(flat(text))));
  const got = await copy();
  check(`${what}: Mod+C copies the selected text`, sel !== "" && got === sel);
};
const tab = (name) => page.click(`.lp-tab[aria-label^='${name}']`);
const menu = async (label) => { await page.waitForTimeout(400); await page.click(`.menu-item:has(.menu-label:text-is("${label}"))`); };

await page.goto(`${process.env.GITTOR_E2E_URL ?? "http://127.0.0.1:5174"}/?repo=${encodeURIComponent(repo)}`);
await page.waitForSelector(".log-row", { timeout: 30000 });

// The log: a commit row is an item. Mod+C copies the full revision number.
await page.click(".log-row:has-text('Rename math to arith')");
await page.waitForSelector(".change:has-text('arith.rs')");
const oid = await copy();
check("Mod+C on a commit copies the full revision number", /^[0-9a-f]{40}$/.test(oid));

// The details of the commit: the text is selectable, and the selection wins though the log has the commit.
await page.waitForSelector(".details-subject");
await selectable("the subject in the details", ".details-subject");
await shot("copy1-details");
await selectable("the fields of the details", ".details-meta");
await selectable("the title of the changes", ".changes-title");
await selectable("the title of the diff", ".workspace > .diff .diff-title");
await selectable("the status bar", ".sb-left");

// A press on a row removes the old text selection, so Mod+C copies the commit again.
await dragOver(".details-subject");
await page.click(".log-row:has-text('Rename math to arith')");
check("a press on a commit removes the text selection", (await selection()) === "");
check("Mod+C copies the revision number again", (await copy()) === oid);

// The files of the commit (the right panel): the absolute path. Two files give two lines.
await page.click(".change:has-text('arith.rs')");
check("Mod+C on a file of a commit copies the absolute path", (await copy()) === `${repo}/arith.rs`);
await page.click(".change:has-text('arith.rs')", { button: "right" });
await menu("Copy Path");
await within("Copy Path copies the absolute path", async () => (await clipboard()) === `${repo}/arith.rs`);
await page.click(".change:has-text('arith.rs')", { button: "right" });
await menu("Copy Relative Path");
await within("Copy Relative Path copies the path in the repository", async () => (await clipboard()) === "arith.rs");

// The Branches tab: the name of a branch is selectable. Without a text selection, Mod+C copies the name
// of the selected branch, though the press shows its commit in the log.
await tab("Branches");
const branch = ".sidebar .group-header:has-text('Local') ~ .branch:has-text('fix/readme') >> nth=0";
await page.click(branch);
await within("Mod+C on a branch copies its name", async () => (await copy()) === "fix/readme");
await selectable("the name of a branch", ".sidebar .branch-local .branch-name");
// A key in the log gives Mod+C back to the log.
await page.click(".log-row >> nth=1");
await page.keyboard.press("ArrowDown");
await within("Mod+C in the log copies a revision number", async () => /^[0-9a-f]{40}$/.test(await copy()));

// The Changes tab: its rows are draggable, so the mouse does not select their text. Mod+C copies the paths.
await tab("Changes");
const local = (name) => `.cl-file:has(.path:text-is('${name}'))`;
await page.click(local("main.rs"));
await within("Mod+C on a local change copies the absolute path", async () => (await copy()) === `${repo}/main.rs`);
await page.click(local("NOTES.txt"), { modifiers: ["Control"] });
await within("Mod+C on two files copies two lines", async () => (await copy()).split("\n").sort().join("|") === [`${repo}/NOTES.txt`, `${repo}/main.rs`].join("|"));
await shot("copy2-changes");
await page.click(local("main.rs"), { button: "right" });
await menu("Copy Paths");
await within("Copy Paths copies the absolute paths", async () => (await clipboard()).split("\n").every((p) => p.startsWith(`${repo}/`)) && (await clipboard()).split("\n").length === 2);
// The text of a field stays with the field.
await page.click(".commit-message");
await page.keyboard.type("Copy me");
await page.keyboard.press("Control+A");
check("Mod+C in the commit message copies its text", (await copy()) === "Copy me");
await page.keyboard.press("Backspace");
// A text selection wins over the paths: the summary under the files.
await page.click(local("main.rs"));
await selectable("the summary of the commit", ".commit-summary");

// The Worktrees tab: the row is selectable, and Mod+C copies the path of the worktree.
await tab("Worktrees");
await page.waitForSelector(".worktree-panel .worktree");
await page.click(".worktree-panel .worktree >> nth=0");
await within("Mod+C on a worktree copies its path", async () => (await copy()) === repo);
await selectable("the name of a worktree", ".worktree-panel .worktree .branch-name");

// The Files tab: the absolute path, and the text of the file in the editor.
await tab("Files");
await page.waitForSelector(".files-file[data-path='arith.rs']");
await page.click(".files-file[data-path='arith.rs']");
await within("the file opens", async () => (await page.$$(".file-host .view-line")).length > 0);
await page.click(".files-file[data-path='arith.rs']");
await within("Mod+C on a file of the Files tab copies the absolute path", async () => (await copy()) === `${repo}/arith.rs`);
await selectable("the name of a file in the Files tab", ".files-file[data-path='arith.rs'] .files-name");
await page.click(".files-file[data-path='arith.rs']", { button: "right" });
await menu("Copy Path");
await within("Copy Path of the Files tab copies the absolute path", async () => (await clipboard()) === `${repo}/arith.rs`);
await page.locator(".file-host .view-line:visible").first().click();
await page.keyboard.press("Control+A");
check("Mod+C in the editor copies the text of the file", (await copy()).includes("wrapping_add"));
await shot("copy3-files");
await page.click(".center-tab >> nth=0");

// A dialog and a toast: their text is selectable.
await page.keyboard.press("Control+B");
await page.waitForSelector(".dialog");
await selectable("the title of a dialog", ".dialog .dialog-title");
await page.keyboard.press("Escape");
await tab("Branches");
await page.click(".log-row:has-text('Add a CLI entry point')", { button: "right" });
await menu("New Tag…");
await page.waitForSelector(".dialog");
await page.fill(".dialog input >> nth=0", "copy-tag");
await page.click(".dialog-buttons .primary");
await page.waitForSelector(".toast");
await selectable("the text of a toast", ".toast");
await shot("copy4-toast");

// The Compare window: the absolute path of the selected file, and the selectable name.
await page.click(".sidebar .group-header:has-text('Local') ~ .branch:has-text('feature/cli') >> nth=0", { button: "right" });
await page.waitForTimeout(400);
await page.click(".menu-item:has-text('Compare Branches')");
await page.waitForSelector(".compare-files .compare-file");
await page.click(".compare-files .compare-file >> nth=0");
const compared = await page.getAttribute(".compare-files .compare-file.selected", "title");
await within("Mod+C on a file of the Compare window copies the absolute path", async () => (await copy()) === `${repo}/${compared}`);
await selectable("the name of a file in the Compare window", ".compare-files .compare-file.selected");
await shot("copy5-compare");
await page.keyboard.press("Escape");

await browser.close();
if (errors.length) {
  console.log(errors.join("\n"));
  process.exit(1);
}
console.log("copy-text: all checks passed");
