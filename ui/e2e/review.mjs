// UI scenario for Review Branch: start a review, mark a file as viewed, add a note, switch between
// reviews, and merge from the Reviews tab with Squash, then Undo.
// Start the dev server first (see README). Build a fresh repository with make-demo-repo.sh, then:
// node e2e/review.mjs <repo> <screenshot-dir>.
// Set CHROMIUM to a Chromium binary when Playwright has no downloaded browser.
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
const [,, repo, outDir] = process.argv;
const git = (...args) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).replace(/\s+$/, "");
const has = (b) => git("branch", "--list", b) !== "";
git("config", "commit.gpgsign", "false");

const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const page = await (await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1.5 })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push("pageerror: " + e));
page.on("console", (m) => m.type() === "error" && errors.push("console: " + m.text()));
const shot = async (name) => { await page.waitForTimeout(600); await page.screenshot({ path: `${outDir}/${name}.png` }); console.log("shot", name); };
const check = (what, ok) => { console.log(ok ? "ok  " : "FAIL", what); if (!ok) errors.push("check: " + what); };
const within = async (what, fn, ms = 8000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return check(what, true);
    await page.waitForTimeout(200);
  }
  check(what, false);
};
const text = async (sel) => ((await page.textContent(sel).catch(() => "")) ?? "");
const files = () => page.$$eval(".review-window .review-file .rebase-subject", (els) => els.map((e) => e.textContent).join(","));
// The branch fields of the Review Branch dialog: buttons that open the branch picker.
const branchValue = (n) => page.inputValue(`.dialog input[type=hidden] >> nth=${n}`);
const pickBranch = async (n, name) => {
  await page.click(`.dialog .dialog-branch >> nth=${n}`);
  await page.waitForSelector(".branch-picker");
  await page.click(`.branch-picker .menu-item:has(.menu-label:text-is('${name}')) >> nth=0`);
  await page.waitForSelector(".branch-picker", { state: "detached" });
};

await page.goto(`${process.env.GITTOR_E2E_URL ?? "http://127.0.0.1:5174"}/?repo=${encodeURIComponent(repo)}`);
await page.waitForSelector(".sidebar .branch", { timeout: 30000 });

// Start a review from the context menu of a branch.
await page.click(".sidebar .branch:has-text('feature/cli') >> nth=0", { button: "right" });
await page.click(".menu-item:has-text('Review Branch')");
await page.waitForSelector(".dialog:has-text('Review Branch')");
check("the base is main", (await branchValue(1)) === "main");
await page.click(".dialog-buttons button:has-text('Start Review')");
await page.waitForSelector(".review-window");
// From the merge base: logo.bin came to main later, so it is not a change of the branch.
await within("the review shows the changes of the branch only", async () => (await files()) === "cli.rs");
check("two commits", (await page.$$(".review-window .review-commit")).length === 3);
await within("no conflicts", async () => (await text(".review-status")).includes("No conflicts with main"));

// Viewed, and a note on the line of the cursor.
await page.click(".review-window .review-file input.review-viewed");
await within("the file is viewed", async () => (await text(".review-window .compare-files-title >> nth=1")).includes("1/1 viewed"));
// A note with the icon in the gutter: the icon shows at the line under the mouse.
// The editor of the right side: the modified editor of a diff, or the one editor of an added file.
const modified = ".review-window .diff-host:not([hidden]) .monaco-editor:not(.original)";
const lineNumber = (n) => page.locator(`${modified} .line-numbers`).filter({ hasText: new RegExp(`^${n}$`) }).first();
await lineNumber(3).hover();
await within("the note icon shows at the line under the mouse", async () => (await page.$$(`${modified} .note-add-icon`)).length === 1);
await page.click(`${modified} .note-add-icon`);
await page.waitForSelector(".review-window .note-card.draft textarea");
check("the new note is on line 3", (await page.getAttribute(".review-window .note-card.draft", "data-line")) === "3");
await page.fill(".review-window .note-card.draft textarea", "Use a logger here");
await page.keyboard.press("Escape");
await within("Esc cancels the note", async () => (await page.$(".review-window .note-card.draft")) === null);
check("Esc in the note does not close the review", (await page.$(".review-window")) !== null);
await lineNumber(3).hover();
await page.click(`${modified} .note-add-icon`);
await page.fill(".review-window .note-card.draft textarea", "Use a logger here");
await page.press(".review-window .note-card.draft textarea", "Control+Enter");
await within("the note shows in the list", async () => (await text(".review-notes-list")).includes("Use a logger here"));
await within("the note shows as a card in the diff", async () => (await text(".review-window .note-card")).includes("Use a logger here"));
await within("the diff marks the line", async () => (await page.$$(".review-window .review-note-bar")).length > 0);

// The card floats at the right of its line.
const card = await page.locator(".review-window .note-card").first().boundingBox();
const editorBox = await page.locator(modified).boundingBox();
const line3 = await lineNumber(3).boundingBox();
check("the card is at the right of the diff", card.x > editorBox.x + editorBox.width / 2 && card.x + card.width <= editorBox.x + editorBox.width);
check("the card is at the height of its line", Math.abs(card.y - line3.y) < 6);

// A double click on a line adds a note there too.
await page.locator(`${modified} .view-line`).filter({ hasText: "fn" }).first().dblclick();
await page.waitForSelector(".review-window .note-card.draft textarea");
await page.fill(".review-window .note-card.draft textarea", "Second note");
await page.click(".review-window .note-card.draft button:has-text('Add Note')");
await within("the second note shows", async () => (await page.$$(".review-window .note-card:not(.draft)")).length === 2);

// A note on more lines: a drag of the icon from line 2 to line 4.
await lineNumber(2).hover();
await within("the icon shows at line 2", async () => (await page.$$(`${modified} .note-add-icon`)).length === 1);
const icon2 = await page.locator(`${modified} .note-add-icon`).boundingBox();
const line4 = await lineNumber(4).boundingBox();
await page.mouse.move(icon2.x + icon2.width / 2, icon2.y + icon2.height / 2);
await page.mouse.down();
await page.mouse.move(icon2.x + icon2.width / 2, line4.y + line4.height / 2, { steps: 5 });
check("the drag marks the lines", (await page.$$(`${modified} .note-range`)).length > 0);
await page.mouse.up();
await page.waitForSelector(".review-window .note-card.draft textarea");
check("the new note is on lines 2-4", ((await text(".review-window .note-card.draft .note-card-head")) ?? "").includes("L2-4"));
await page.fill(".review-window .note-card.draft textarea", "Three lines");
await page.press(".review-window .note-card.draft textarea", "Control+Enter");
await within("the list shows the lines of the note", async () => (await text(".review-notes-list")).includes("L2-4Three lines"));
await shot("rv0-range-note");
await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
await page.locator(".review-window .note-card:has-text('Three lines') .note-card-copy").click();
await within("the card copies the lines", async () => (await page.evaluate(() => navigator.clipboard.readText())) === "cli.rs:2-4\nThree lines");
await page.locator(".review-window .note-card:has-text('Three lines') .note-card-delete").click();
await within("the note on more lines is gone", async () => (await page.$$(".review-window .note-card")).length === 2);

// A mouse selection of more lines opens a new note on these lines when the button goes up.
const textLeft = (await page.locator(`${modified} .view-lines`).boundingBox()).x;
const from = await lineNumber(1).boundingBox();
const to = await lineNumber(3).boundingBox();
await page.mouse.move(textLeft + 20, from.y + from.height / 2);
await page.mouse.down();
await page.mouse.move(textLeft + 60, to.y + to.height / 2, { steps: 5 });
await page.mouse.up();
await page.waitForSelector(".review-window .note-card.draft textarea");
check("a selection of lines 1-3 opens a note on them", ((await text(".review-window .note-card.draft .note-card-head")) ?? "").includes("L1-3"));
await shot("rv0b-selection-note");
await page.keyboard.press("Escape");
await within("Esc closes the note of the selection", async () => (await page.$(".review-window .note-card.draft")) === null);

// A note on the whole file, with the field under the list of notes.
check("the field is under the list of notes", await page.$eval(".review-file-note-input", (i) => {
  const list = document.querySelector(".review-notes-list");
  return !!list && (list.compareDocumentPosition(i) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0 && i.getBoundingClientRect().top > list.getBoundingClientRect().top;
}));
await page.fill(".review-file-note-input", "The file needs tests");
await page.press(".review-file-note-input", "Enter");
await within("the list labels it File", async () => (await text(".review-notes-list")).includes("FileThe file needs tests"));
await shot("rv1-review");

// Copy: one note from its card, one from the list, and all notes of the file.
await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
const clipboard = () => page.evaluate(() => navigator.clipboard.readText());
await page.locator(".review-window .note-card:has-text('Use a logger here') .note-card-copy").click();
await within("the card copies the file, the line and the note", async () => (await clipboard()) === "cli.rs:3\nUse a logger here");
await page.locator(".review-notes-list .review-note:has-text('The file needs tests') .review-note-copy").click();
await within("a file note copies the file and the note", async () => (await clipboard()) === "cli.rs\nThe file needs tests");
await page.click(".review-notes-copy");
const lineOf = await page.getAttribute(".review-window .note-card:has-text('Second note')", "data-line");
await within("Copy All copies all notes of the file", async () =>
  (await clipboard()) === `cli.rs\nThe file needs tests\n\ncli.rs:${lineOf}\nSecond note\n\ncli.rs:3\nUse a logger here`
    || (await clipboard()) === `cli.rs\nThe file needs tests\n\ncli.rs:3\nUse a logger here\n\ncli.rs:${lineOf}\nSecond note`);

// Resolve a note: only its icon stays in the diff, and Copy All leaves it out.
await page.locator(".review-window .note-card:has-text('Use a logger here') .note-card-resolve").click();
await within("a resolved review note shows its icon only", async () =>
  (await page.$$(".review-window .note-chip")).length === 1 && (await page.$$(".review-window .note-card:has-text('Use a logger here')")).length === 0);
await within("the list marks the note as resolved", async () => (await page.$$(".review-notes-list .review-note.resolved")).length === 1);
await page.click(".review-notes-copy");
await within("Copy All leaves out the resolved note", async () => !(await clipboard()).includes("Use a logger here") && (await clipboard()).includes("Second note"));
await shot("rv1d-resolved");
await page.click(".review-window .note-chip");
await page.locator(".review-window .note-card:has-text('Use a logger here') .note-card-resolve").click();
await within("the note opens again", async () => (await page.$$(".review-window .note-chip")).length === 0 && (await page.$$(".review-window .note-card:has-text('Use a logger here')")).length === 1);

// Delete the second note with its card.
await page.locator(".review-window .note-card:has-text('Second note') .note-card-delete").click();
await within("the card is gone", async () => (await page.$$(".review-window .note-card")).length === 1);

// The review of one commit: its own viewed boxes, notes and progress.
const commitRow = (n) => `.review-window .review-commit >> nth=${n}`;
await page.click(commitRow(1));
await within("a commit shows its files, not viewed yet", async () =>
  (await files()).includes("cli.rs") && (await text(".review-window .review-files-title")).includes("0/"));
check("the commit row shows its progress", /0\/\d/.test(await text(commitRow(1))));
await page.click(".review-window .review-file:has-text('cli.rs') input.review-viewed");
await within("the file is viewed in the commit", async () => (await page.isChecked(".review-window .review-file:has-text('cli.rs') input.review-viewed")));
await page.fill(".review-window .review-file-note-input", "A note on this commit");
await page.keyboard.press("Enter");
await within("the note is on the commit", async () => (await text(".review-window .review-notes")).includes("A note on this commit") && /of [0-9a-f]{8}/.test(await text(".review-window .review-notes-title")));
await within("the commit row counts the note", async () => (await page.$$(".review-window .review-commit .review-file-notes")).length === 1);
await shot("rv2b-commit");
// The box of a commit row marks all of its files.
const second = commitRow(2);
await page.click(`${second} >> input.review-viewed`);
await within("the box of the commit marks all of its files", async () => (await page.isChecked(`${second} >> input.review-viewed`)) && (await page.getAttribute(second, "class")).includes("viewed"));
await page.click(`${second} >> input.review-viewed`);
await within("the box of the commit clears its files", async () => !(await page.isChecked(`${second} >> input.review-viewed`)));
// Next Commit goes to the commit that has files that are not viewed.
await page.click(commitRow(1));
await page.click(".review-window .review-next-commit:has-text('Next Commit')");
await within("Next Commit selects the other commit", async () => (await page.getAttribute(second, "class")).includes("selected"));
// The note of the commit does not show in the changes of the whole branch.
await page.click(commitRow(0));
await within("All changes does not show the note of the commit", async () => !(await text(".review-window .review-notes")).includes("A note on this commit"));
await page.keyboard.press("Escape");
await page.waitForSelector(".review-window", { state: "detached" });

// A second review from the Reviews tab, then switch between the two.
// The tabs of the left pane: Mod+1 to Mod+4.
for (const [key, panel] of [["2", ".commit-panel"], ["3", ".stash-panel"], ["1", ".sidebar"]]) {
  await page.keyboard.press(`Control+${key}`);
  await within(`Mod+${key} shows ${panel}`, async () => !(await page.$eval(panel, (e) => e.hidden)));
}
await page.keyboard.press("Control+4");
await page.waitForSelector(".review-panel:not([hidden])");
await page.click(".review-panel button:has-text('New Review')");
await page.click(".dialog .dialog-branch >> nth=0");
await page.waitForSelector(".branch-picker");
const groups = await page.$$eval(".branch-picker .menu-header", (els) => els.map((e) => e.textContent));
check("the picker groups the branches as the branch switcher", groups.includes("Local") && groups.includes("Remote"));
check("each branch names the author of its last commit", (await text(".branch-picker .menu-item:has(.menu-label:text-is('feature/cli')) .branch-author")).trim() === "Ada Lovelace");
await shot("rv1b-branch-picker");
await page.keyboard.press("Escape");
await within("Esc closes the picker and not the dialog", async () => (await page.$(".branch-picker")) === null && (await page.$(".dialog")) !== null);
await pickBranch(0, "topic/readme");
check("the field shows the chosen branch", (await branchValue(0)) === "topic/readme" && (await text(".dialog .dialog-branch >> nth=0")).includes("topic/readme"));
check("a new review proposes main as the base", (await branchValue(1)) === "main");
await page.click(".dialog-buttons button:has-text('Start Review')");
await within("the second review opens", async () => (await files()) === "README.md");
await page.click(".review-switcher");
await page.waitForSelector(".branch-picker");
check("the switcher lists the reviews first", ((await text(".branch-picker .menu-header >> nth=0")) ?? "") === "Reviews");
await shot("rv1c-review-switcher");
await page.click(".branch-picker .menu-item:has-text('feature/cli → main')");
await within("the switcher opens the first review", async () => (await files()) === "cli.rs");
await page.keyboard.press("Escape");
await within("the tab lists both reviews", async () => (await page.$$(".review-row")).length === 2);
check("the tab counts the open reviews", (await text(".lp-tab:has-text('Reviews')")).includes("2"));
await shot("rv2-list");

// Merge from the list with Squash, and delete the branch.
const main = git("rev-parse", "main");
await page.click(".review-row:has-text('feature/cli') .review-finish");
await page.waitForSelector(".dialog:has-text('Merge feature/cli')");
await page.click(".review-mode:has-text('Squash') input");
check("the squash message lists the commits", (await page.inputValue(".review-merge-message")).includes("* Add a CLI entry point"));
await shot("rv3-merge-dialog");
await page.click(".dialog-buttons button:has-text('Merge')");
await within("main gets one new commit", async () => git("rev-parse", "main^") === main);
check("main has the file", git("show", "main:cli.rs").includes("pub fn run"));
check("the branch is deleted", !has("feature/cli"));
await within("the review shows as merged", async () => (await text(".review-row:has-text('feature/cli')")).includes("merged"));
check("the other local changes stay", git("status", "--porcelain").includes("main.rs"));
await shot("rv4-merged");

// Undo puts back main and the branch.
await page.click(".toast button:has-text('Undo')");
await within("Undo puts back main", async () => git("rev-parse", "main") === main);
check("Undo puts back the branch", has("feature/cli"));
// A review with folders shows a tree: one row for src/app, closed with a click.
git("branch", "-q", "feature/tree", "main");
const tmp = `${repo}-tree`;
execFileSync("git", ["-C", repo, "worktree", "add", "-q", tmp, "feature/tree"]);
for (const f of ["src/app/one.rs", "src/app/two.rs", "top.txt"]) {
  execFileSync("mkdir", ["-p", `${tmp}/${f.slice(0, f.lastIndexOf("/") + 1) || "."}`]);
  execFileSync("sh", ["-c", `echo x > '${tmp}/${f}'`]);
}
execFileSync("git", ["-C", tmp, "add", "."]);
execFileSync("git", ["-C", tmp, "-c", "commit.gpgsign=false", "commit", "-q", "-m", "Tree files"]);
execFileSync("git", ["-C", repo, "worktree", "remove", "--force", tmp]);
await page.click(".tb-button:has-text('Refresh')");
await page.keyboard.press("Control+1");
await page.waitForSelector(".sidebar .branch:has-text('feature/tree')");
await page.keyboard.press("Control+4");
await page.click(".review-panel button:has-text('New Review')");
await page.waitForSelector(".dialog:has-text('Review Branch')");
await pickBranch(0, "feature/tree");
await page.click(".dialog-buttons button:has-text('Start Review')");
await within("the tree has a row for src/app", async () => ((await page.textContent(".review-window .review-dir").catch(() => "")) ?? "").includes("src/app"));
check("the files under it come first", (await files()) === "one.rs,two.rs,top.txt");
await shot("rv5-tree");
await page.click(".review-window .review-dir");
await within("a click closes the folder", async () => (await files()) === "top.txt");
await page.click(".review-tree-toggle");
await within("the flat list shows all files", async () => (await files()) === "src/app/one.rs,src/app/two.rs,top.txt".split(",").map((p) => p.split("/").pop()).join(","));
await page.click(".review-tree-toggle");
await page.keyboard.press("Escape");

// A remote branch: the review works, and Merge keeps the remote branch.
const newReview = async (branch, base) => {
  await page.click(".review-panel button:has-text('New Review')");
  await page.waitForSelector(".dialog:has-text('Review Branch')");
  await pickBranch(0, branch);
  await pickBranch(1, base);
  await page.click(".dialog-buttons button:has-text('Start Review')");
  await page.waitForSelector(".review-window");
};
await newReview("origin/feature/cli", "main");
await within("the remote branch shows its changes", async () => (await files()).includes("cli.rs"));
await within("Merge is on for a local base", async () => !(await page.isDisabled(".review-window .review-merge")));
await page.click(".review-window .review-merge");
await page.waitForSelector(".dialog:has-text('Merge origin/feature/cli')");
check("no delete box for a remote branch", !((await text(".dialog")) ?? "").includes("Delete the branch"));
await shot("rv6-remote");
await page.keyboard.press("Escape");
await page.keyboard.press("Escape");
await page.waitForSelector(".review-window", { state: "detached" });
// A remote base: the review shows, and Merge is off.
await newReview("feature/tree", "origin/main");
await within("the remote base shows", async () => (await text(".review-window .merge-header")).includes("origin/main"));
await within("Merge is off for a remote base", () => page.isDisabled(".review-window .review-merge"));
await page.keyboard.press("Escape");
await within("the panel lists the remote review", async () => (await text(".review-panel")).includes("origin/feature/cli"));
console.log("errors:", JSON.stringify(errors));
await browser.close();
if (errors.length) process.exit(1);
