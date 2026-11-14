// Records the scenes of the short videos for social posts with Playwright. Each short has one scene:
// a tour of one topic in four to six fast steps.
// Build the UI and the dev server first (see AGENTS.md), then:
//   node scripts/video/shorts-record.mjs <work-dir> <out-dir> [scene ...]
// <work-dir> gets the repository of make-shorts-repo.sh. <out-dir> gets <scene>.webm and scenes.json.
// A scene calls d.mark(name) at each step and d.cam(...) for each place of the camera; shorts-build.mjs
// places the captions, the music and the moves of the camera on them.
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { git, recordScenes } from "./stage.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const [, , workArg, outArg, ...only] = process.argv;
if (!workArg || !outArg) throw new Error("usage: shorts-record.mjs <work-dir> <out-dir> [scene ...]");
const work = resolve(workArg);
const out = resolve(outArg);
const repo = join(work, "rustcalc");

const presetSettings = (extra) => ({
  theme: "dark",
  leftTab: "commit",
  showSidebar: true,
  showDiff: true,
  keyHints: false,
  autoCheckUpdates: false,
  diffRatio: 0.5,
  // The window is narrow: smaller side panels, and the log shows the subjects only.
  sidebarWidth: 240,
  rightWidth: 210,
  compareSideWidth: 270,
  showAuthor: false,
  showDate: false,
  showHash: false,
  recent: [repo],
  tabs: [repo],
  activeTab: repo,
  ...extra,
});

// The work of the agent: a division that can panic, and arguments that can panic.
const ARITH_HEAD = "pub fn add(a: i32, b: i32) -> i32 {\n    a.wrapping_add(b)\n}\n";
const ARITH_BAD = `${ARITH_HEAD}\npub fn div(a: i32, b: i32) -> i32 {\n    a / b\n}\n`;
const ARITH_GOOD = `${ARITH_HEAD}\npub fn div(a: i32, b: i32) -> Option<i32> {\n    a.checked_div(b)\n}\n`;
const MAIN_BAD = [
  "mod arith;", "", "fn main() {", "    let args: Vec<String> = std::env::args().collect();",
  "    let a: i32 = args[1].parse().unwrap();", "    let b: i32 = args[2].parse().unwrap();",
  "    println!(\"{}\", arith::div(a, b));", "}", "",
].join("\n");
const MAIN_GOOD = [
  "mod arith;", "", "fn main() {", "    let args: Vec<String> = std::env::args().collect();",
  "    let (Some(a), Some(b)) = (number(&args, 1), number(&args, 2)) else {",
  "        return eprintln!(\"usage: rustcalc <a> <b>\");", "    };",
  "    match arith::div(a, b) {", "        Some(q) => println!(\"{q}\"),", "        None => eprintln!(\"division by zero\"),", "    }", "}", "",
  "fn number(args: &[String], i: usize) -> Option<i32> {", "    args.get(i)?.parse().ok()", "}", "",
].join("\n");
const BRANCH = "agent/add-division";
const NOTE_ARITH = "Division by zero panics. Return Option<i32>.";
const NOTE_MAIN = "No unwrap. Print a usage message.";
const write = (name, text) => writeFileSync(join(repo, name), text);
const agentChanges = () => { write("arith.rs", ARITH_BAD); write("main.rs", MAIN_BAD); };

const file = (name) => `.cl-file:has(.path:text-is('${name}'))`;
const modified = ".diff .editor.modified";
const lineNumber = (scope, n) => `${scope} .line-numbers >> text=/^${n}$/`;
const showsFile = (d, name) => d.page.waitForFunction((n) => document.querySelector(".diff .diff-title")?.textContent?.includes(n), name);

/** Adds a note at a line of the diff of a local change. */
async function addNote(d, line, text) {
  await d.move(lineNumber(modified, line), { dx: 6 });
  await d.wait(250);
  await d.click(`${modified} .note-add-icon`, { after: 200 });
  await d.page.waitForSelector(".diff .note-card.draft textarea");
  await d.type(text, 28);
  await d.wait(250);
  await d.page.keyboard.press("Control+Enter");
  await d.page.waitForSelector(`.diff .note-card:not(.draft):has-text("${text.slice(0, 12)}")`);
}

// The status bar shows the path of the work dir, which is long and says nothing to a viewer.
const HIDE_PATH = ".statusbar .sb-left, .statusbar .sb-mid { visibility: hidden; }";
// The page has the form of the place of the app in a video for a phone (4:5). The build shows all of it
// or a part of it: d.cam(...) says which part.
const VIEW = { width: 1000, height: 1250 };

const DIFF = ".diff .editor.modified";
const term = (d, fn, arg) => d.page.evaluate(([f, a]) => window.__vidTerm[f](a), [fn, arg]);
const esc = (t) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;");

/** Clicks an item of the open menu, with the camera on it. */
async function pick(d, label, zoom = 1.8) {
  const item = `.menu-item:has-text("${label}")`;
  await d.page.waitForSelector(item);
  await d.cam(item, { zoom });
  await d.wait(700);
  await d.click(item);
}
/** Closes the toasts, so the next step shows only its own toast. */
const closeToasts = (d) => d.page.evaluate(() => document.querySelectorAll(".toast button[title=Close]").forEach((b) => b.click()));
const logRow = (subject) => `.log-row:has(.subject-text:text-is("${subject}"))`;
const LOG = [".log-row >> nth=0", ".log-row >> nth=9"];
const commit = (message, date) => execFileSync("git", ["-C", repo, "-c", "commit.gpgsign=false", "commit", "-q", "-am", message], { env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } });

const CALC = [
  "pub fn total(items: &[i32]) -> i32 {", "    let mut sum = 0;", "    for i in items {", "        sum += i;", "    }", "    sum", "}", "",
  "pub fn average(items: &[i32]) -> i32 {", "    let sum = total(items);", "    sum / items.len() as i32", "}", "",
].join("\n");
const GUIDE = [
  "# rustcalc", "", "A small calculator in Rust.", "", "## Build", "", "- [x] Install Rust", "- [ ] Build with cargo", "",
  "## How it works", "", "```mermaid", "graph LR", "  A[Input] --> B[Tokenizer]", "  B --> C[Parser]", "```", "",
].join("\n");

const scenes = [
  {
    // Tour: a tour of the basic work: the log, a diff, a checkout, a commit, and Undo.
    name: "tour",
    prep: agentChanges,
    // One column for the diff, so the camera shows the old line and the new line.
    settings: () => ({ leftTab: "branches", sideBySide: false }),
    async run(d) {
      const row = (subject) => `.log-row:has(.subject-text:text-is("${subject}"))`;
      await d.wait(1500);
      d.mark("log");
      await d.cam([".log-row >> nth=0", ".log-row >> nth=10"], { zoom: 1.7 });
      await d.wait(900);
      await d.click(row("Merge branch 'fix/readme'"), { after: 900 });
      await d.click(row("Rename math to arith and use wrapping add"), { after: 600 });
      d.mark("diff");
      await d.cam(".diff", { zoom: 1.9, align: "top left", pad: 0 });
      await d.wait(2300);
      d.mark("branches");
      const branch = ".sidebar .branch:has-text('feature/cli') >> nth=0";
      await d.cam(branch, { zoom: 1.9, align: "left" });
      await d.wait(700);
      await d.click(branch, { button: "right", after: 200 });
      await d.menu("Checkout");
      await d.page.waitForSelector(".toast", { timeout: 15000 });
      await d.wait(1500);
      // Only the toast of the commit shows at the Undo step.
      await d.page.evaluate(() => document.querySelector(".toast button[title=Close]")?.click());
      d.mark("changes");
      await d.click(".lp-tab:text-is('Changes')", { after: 300 });
      await d.cam([file("arith.rs"), ".commit-button"], { zoom: 1.9, align: "left" });
      await d.wait(900);
      await d.click(".commit-message", { after: 150 });
      await d.type("Add a division", 40);
      await d.wait(400);
      await d.click(".commit-button", { after: 0 });
      await d.page.waitForSelector(".toast:has-text('ommit')", { timeout: 15000 });
      d.mark("undo");
      await d.cam(".toast:has-text('ommit')", { zoom: 2 });
      await d.wait(1700);
      await d.click(".toast:has-text('ommit') .toast-action:has-text('Undo')", { after: 0 });
      await d.page.waitForSelector(file("arith.rs"), { timeout: 15000 });
      await d.cam("full");
      await d.wait(2300);
    },
  },
  {
    // Agent: a note on the change of the agent, the note goes to the agent, the fix clears it, then a commit.
    name: "agent",
    prep: () => write("arith.rs", ARITH_BAD),
    // The video starts on the diff of the agent, not on the commit that the log selects.
    async setup(d) {
      await d.page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
      await d.page.click(file("arith.rs"));
      await showsFile(d, "arith.rs");
      await d.page.waitForSelector(`${modified} .view-line`);
      await d.wait(500);
    },
    async run(d) {
      await d.wait(1500);
      await d.cam(DIFF, { zoom: 2 });
      await d.wait(800);
      d.mark("note");
      await addNote(d, 6, NOTE_ARITH);
      await d.wait(900);
      d.mark("copy");
      await d.cam([".commit-copy-notes", file("arith.rs")], { zoom: 2 });
      await d.wait(700);
      await d.click(".commit-copy-notes", { after: 600 });
      const notes = await d.page.evaluate(() => navigator.clipboard.readText());
      // The terminal is over the log and above the new side of the diff, so one place of the camera
      // shows the terminal and the code that changes under it.
      const box = await d.page.evaluate(() => {
        const top = document.querySelector(".diff").getBoundingClientRect().top;
        return { x: innerWidth - 520, y: top - 300, w: 508, h: 290, title: "agent — rustcalc" };
      });
      d.mark("term");
      await term(d, "open", box);
      await term(d, "print", `<span class="dim">~/rustcalc</span> <span class="hi">main</span>\n<span class="you">›</span> `);
      await d.cam(".vid-term", { zoom: 1.9, align: "top", pad: 8 });
      await d.wait(1000);
      // The badge of the keys goes into the terminal, where the camera is.
      await d.page.evaluate(() => {
        window.__vidKeys("⌘ V");
        const r = document.querySelector(".vid-term").getBoundingClientRect();
        Object.assign(document.querySelector(".vid-keys").style, { left: `${r.left + r.width / 2}px`, top: `${r.top + r.height * 0.62}px` });
      });
      await d.wait(350);
      await term(d, "print", esc(notes).replace(/\n/g, "\n  "));
      await d.wait(1400);
      await term(d, "print", `\n\n● Edit <span class="hi">arith.rs</span>\n  <span class="del">- pub fn div(a: i32, b: i32) -&gt; i32 {</span>\n  <span class="add">+ pub fn div(a: i32, b: i32) -&gt; Option&lt;i32&gt; {</span>\n`);
      write("arith.rs", ARITH_GOOD);
      d.mark("fix");
      await d.page.waitForFunction(() => !document.querySelector(".diff .note-card") && document.querySelector(".diff .editor.modified")?.textContent?.includes("checked_div"), null, { timeout: 15000 });
      await d.wait(600);
      await term(d, "print", `<span class="ok">✔ Fixed 1 note</span>\n<span class="you">›</span> `);
      await d.wait(1700);
      d.mark("commit");
      await term(d, "close");
      await d.cam([file("arith.rs"), ".commit-button"], { zoom: 1.9, align: "left" });
      await d.wait(800);
      await d.click(".commit-message", { after: 150 });
      await d.type("Add a checked division", 35);
      await d.wait(300);
      await d.click(".commit-button", { after: 0 });
      await d.page.waitForSelector(".toast:has-text('ommit')", { timeout: 15000 });
      await d.wait(2200);
    },
  },
  {
    // Review: a review of the branch of the agent, then a squash merge, all without a remote.
    name: "review",
    // One column for the diff: the two sides of the review window are too narrow for the code.
    settings: () => ({ leftTab: "branches", sideBySide: false }),
    prep() {
      git(repo, "checkout", "-q", "-b", BRANCH, "main");
      write("arith.rs", ARITH_GOOD);
      git(repo, "commit", "-q", "-am", "Add a checked division");
      write("main.rs", MAIN_GOOD);
      git(repo, "commit", "-q", "-am", "Read two numbers and divide them");
      git(repo, "checkout", "-q", "main");
    },
    async run(d) {
      const branch = `.sidebar .branch:has-text('${BRANCH}') >> nth=0`;
      await d.wait(1200);
      await d.cam(branch, { zoom: 1.9 });
      await d.wait(800);
      await d.click(branch, { button: "right", after: 200 });
      await d.menu("Review Branch");
      await d.page.waitForSelector(".dialog:has-text('Review Branch')");
      await d.cam(".dialog");
      await d.wait(900);
      d.mark("review");
      await d.click(".dialog-buttons button:has-text('Start Review')", { after: 0 });
      await d.page.waitForSelector(".review-window");
      await d.cam("full");
      await d.wait(1100);
      const side = ".review-window .diff-host:not([hidden]) .monaco-editor:not(.original)";
      await d.cam(".review-window .diff-host:not([hidden])", { zoom: 1.7, align: "top left", pad: 4 });
      await d.wait(700);
      await d.move(lineNumber(side, 6), { dx: 6 });
      await d.wait(300);
      d.mark("note");
      await d.click(`${side} .note-add-icon`, { after: 200 });
      await d.page.waitForSelector(".review-window .note-card.draft textarea");
      await d.type("Follow-up: add a test for b = 0.", 28);
      await d.wait(250);
      await d.page.keyboard.press("Control+Enter");
      await d.wait(1200);
      const viewed = (name) => `.review-window .review-file:has-text('${name}') input.review-viewed`;
      await d.cam([viewed("arith.rs"), viewed("main.rs"), ".review-window .review-file:has-text('main.rs')"], { zoom: 2 });
      await d.wait(700);
      d.mark("viewed");
      await d.click(viewed("arith.rs"), { after: 500 });
      await d.click(viewed("main.rs"), { after: 900 });
      await d.cam(".review-window .review-merge", { zoom: 1.9 });
      await d.wait(600);
      d.mark("merge");
      await d.click(".review-window .review-merge", { after: 0 });
      await d.page.waitForSelector(`.dialog:has-text('Merge ${BRANCH}')`);
      await d.cam(".dialog");
      await d.wait(900);
      await d.click(".review-mode:has-text('Squash') input", { after: 1000 });
      await d.click(".dialog-buttons button:has-text('Merge')", { after: 0 });
      await d.page.waitForSelector(".toast", { timeout: 15000 });
      d.mark("merged");
      await d.cam(".toast", { zoom: 2 });
      await d.wait(2300);
      // The new commit on main, with the changes of the branch.
      await d.cam([".log-row >> nth=0", ".log-row >> nth=5"], { zoom: 1.7 });
      await d.wait(600);
      await d.click(".log-row >> nth=0", { after: 2400 });
    },
  },
  {
    // History: squash two commits, change a message, drop a commit, and Undo.
    name: "history",
    settings: () => ({ leftTab: "branches" }),
    prep() {
      write("sub.rs", "pub fn sub(a: i32, b: i32) -> i32 { a - b }\n");
      git(repo, "add", "sub.rs");
      commit("Add a sub function", "2026-09-12T10:00");
      write("sub.rs", "pub fn sub(a: i32, b: i32) -> i32 { a - b }\npub fn neg(a: i32) -> i32 { -a }\n");
      commit("Add neg", "2026-09-12T11:00");
      write("README.md", "# Demo\n\nA demo repository for Gittor.\n\n## Build\n\n    cargo build --release\n");
      commit("Fix teh build docs", "2026-09-12T14:00");
      write("main.rs", "fn main() {\n    println!(\"hello, world\");\n    dbg!(1 + 1);\n}\n");
      commit("wip: debug prints", "2026-09-12T16:00");
    },
    async run(d) {
      await d.wait(1200);
      await d.cam(LOG, { zoom: 1.7 });
      await d.wait(800);
      d.mark("squash");
      await d.click(logRow("Add neg"), { after: 350 });
      await d.click(logRow("Add a sub function"), { modifiers: ["Control"], after: 350 });
      await d.click(logRow("Add neg"), { button: "right", after: 200 });
      await pick(d, "Squash 2 Commits");
      await d.page.waitForSelector(".dialog textarea");
      await d.cam(".dialog");
      await d.wait(500);
      await d.click(".dialog textarea", { after: 100 });
      await d.page.keyboard.press("Control+A");
      await d.type("Add sub and neg", 35);
      await d.wait(300);
      await d.click(".dialog-buttons button:has-text('Squash')", { after: 0 });
      await d.page.waitForSelector(logRow("Add sub and neg"), { timeout: 15000 });
      await d.cam(LOG, { zoom: 1.7 });
      await d.wait(900);
      await closeToasts(d);
      d.mark("reword");
      await d.click(logRow("Fix teh build docs"), { button: "right", after: 200 });
      await pick(d, "Edit Commit Message");
      await d.page.waitForSelector(".dialog textarea");
      await d.cam(".dialog");
      await d.wait(500);
      await d.click(".dialog textarea", { after: 100 });
      await d.page.keyboard.press("Control+A");
      await d.type("Fix the build docs", 35);
      await d.wait(300);
      await d.click(".dialog-buttons button >> nth=-1", { after: 0 });
      await d.page.waitForSelector(logRow("Fix the build docs"), { timeout: 15000 });
      await d.cam(LOG, { zoom: 1.7 });
      await d.wait(900);
      await closeToasts(d);
      d.mark("drop");
      await d.click(logRow("wip: debug prints"), { button: "right", after: 200 });
      await pick(d, "Drop Commit");
      await d.page.waitForSelector(".dialog-buttons button:has-text('Drop')");
      await d.cam(".dialog");
      await d.wait(700);
      await d.click(".dialog-buttons button:has-text('Drop')", { after: 0 });
      await d.page.waitForSelector(logRow("wip: debug prints"), { state: "detached", timeout: 15000 });
      d.mark("undo");
      await d.cam(".toast", { zoom: 2 });
      await d.wait(1200);
      await d.click(".toast .toast-action:has-text('Undo')", { after: 0 });
      await d.page.waitForSelector(logRow("wip: debug prints"), { timeout: 15000 });
      await d.cam(LOG, { zoom: 1.7 });
      await d.wait(2000);
    },
  },
  {
    // Changes: a changelist, one change of a file left out, a commit, and the rest stays.
    name: "changes",
    prep() {
      write("calc.rs", CALC);
      git(repo, "add", "calc.rs");
      commit("Add calc", "2026-09-12T10:00");
      write("calc.rs", CALC.replace("        sum += i;", "        sum = sum.saturating_add(*i);").replace("    let sum = total(items);", "    let sum = total(items);\n    println!(\"debug: {sum}\");"));
      write("README.md", "# Demo\n\nA demo repository for Gittor.\n\n## Build\n\n    cargo build\n\n## Use\n\n    rustcalc 6 3\n");
    },
    async run(d) {
      const panel = [".cl-header >> nth=0", ".commit-button"];
      await d.wait(1400);
      await d.cam(panel, { zoom: 1.9, align: "left" });
      await d.wait(800);
      d.mark("lists");
      await d.click(file("README.md"), { button: "right", after: 200 });
      await pick(d, "New Changelist");
      await d.page.waitForSelector(".dialog-field:has-text('Name') input");
      await d.cam(".dialog");
      await d.click(".dialog-field:has-text('Name') input", { after: 150 });
      await d.type("Docs", 60);
      await d.click(".dialog-buttons button:has-text('Create')", { after: 300 });
      await d.cam(panel, { zoom: 1.9, align: "left" });
      await d.wait(700);
      if (await d.page.isChecked(".cl-header:has-text('Docs') .cl-check")) await d.click(".cl-header:has-text('Docs') .cl-check", { after: 300 });
      await d.wait(800);
      d.mark("hunks");
      await d.click(file("calc.rs"), { after: 0 });
      await d.page.waitForSelector(".workspace .hunk-on >> nth=1");
      await d.cam(DIFF, { zoom: 1.9, align: "top" });
      await d.wait(1200);
      await d.click(".workspace .hunk-on >> nth=1", { after: 1400 });
      d.mark("commit");
      await d.cam(panel, { zoom: 1.9, align: "left" });
      await d.wait(700);
      await d.click(".commit-message", { after: 150 });
      await d.type("Use saturating add", 35);
      await d.wait(300);
      await d.click(".commit-button", { after: 0 });
      await d.page.waitForSelector(".toast:has-text('ommit')", { timeout: 15000 });
      d.mark("rest");
      await d.wait(1200);
      await d.click(file("calc.rs"), { after: 400 });
      await d.cam(DIFF, { zoom: 1.9, align: "top" });
      await d.wait(2400);
    },
  },
  {
    // Worktrees: add a worktree, open it in a tab, and drag the tab out to a new window.
    name: "worktrees",
    settings: () => ({ leftTab: "branches" }),
    async run(d) {
      const folder = join(work, "rustcalc-wt/parser");
      const item = ".sidebar .worktree:has(.branch-name:text-is('parser'))";
      await d.wait(1400);
      d.mark("add");
      await d.cam(".group-action[title='Add a worktree']", { zoom: 1.9, align: "left" });
      await d.wait(700);
      await d.click(".group-action[title='Add a worktree']", { after: 300 });
      await d.page.waitForSelector(".dialog-field:has-text('Branch') input");
      await d.cam(".dialog");
      await d.click(".dialog-field:has-text('Branch') input", { after: 150 });
      await d.type("agent/parser", 45);
      await d.click(".dialog-field:has-text('Folder') input", { after: 150 });
      await d.page.fill(".dialog-field:has-text('Folder') input", "");
      await d.type(folder, 18);
      await d.wait(400);
      await d.click(".dialog-buttons button:has-text('Create')", { after: 0 });
      await d.page.waitForSelector(item, { timeout: 15000 });
      await d.cam(item, { zoom: 1.9, align: "left" });
      await d.wait(1300);
      d.mark("tab");
      await d.click(item, { double: true, after: 0 });
      const tab = ".tab.worktree:has-text('parser')";
      await d.page.waitForSelector(tab, { timeout: 15000 });
      await d.cam([".tab >> nth=0", tab], { zoom: 1.8, align: "top left" });
      await d.wait(2200);
      d.mark("window");
      await d.drag(tab, { x: 300, y: 330 }, { ms: 1100 });
      await d.cam(".vid-window", { pad: 30 });
      await d.wait(3200);
    },
  },
  {
    // Inspect: the history of a file, Annotate, and the preview of a Markdown file with a diagram.
    name: "inspect",
    // One column for the diff: the camera shows all of the width of the preview.
    settings: () => ({ leftTab: "branches", sideBySide: false }),
    prep() {
      mkdirSync(join(repo, "docs"), { recursive: true });
      write("docs/GUIDE.md", GUIDE);
      git(repo, "add", "docs");
      commit("Add the guide", "2026-09-12T10:00");
      write("docs/GUIDE.md", GUIDE.replace("- [ ] Build with cargo", "- [x] Build with `cargo build --release`").replace("  B --> C[Parser]", "  B --> C[Parser]\n  C --> D[Evaluate]"));
    },
    async run(d) {
      await d.wait(1400);
      await d.click(logRow("Rename math to arith and use wrapping add"), { after: 0 });
      await d.page.waitForSelector(".change:has-text('arith.rs')");
      d.mark("history");
      await d.cam(".change:has-text('arith.rs')", { zoom: 1.9 });
      await d.wait(700);
      await d.click(".change:has-text('arith.rs')", { button: "right", after: 200 });
      await pick(d, "Show History");
      await d.page.waitForSelector(".history-row");
      await d.cam([".history-row >> nth=0", ".history-row >> nth=1"], { zoom: 1.7, align: "top left" });
      await d.wait(2400);
      d.mark("annotate");
      await d.click(".history-window .diff-option:has-text('Annotate') input", { after: 0 });
      await d.page.waitForSelector(".history-window .blame-first");
      await d.cam([".history-window .diff-option:has-text('Annotate')", ".history-window .blame-first >> nth=0"], { zoom: 1.6 });
      await d.wait(3000);
      await d.page.keyboard.press("Escape");
      d.mark("preview");
      await d.cam("full");
      await d.click(".lp-tab:text-is('Changes')", { after: 400 });
      await d.click(file("GUIDE.md"), { after: 0 });
      await d.page.waitForSelector(".diff-preview-toggle:not([hidden])", { timeout: 15000 });
      await d.cam(".diff", { zoom: 1.5, align: "top left", pad: 0 });
      await d.wait(3200);
      d.mark("source");
      await d.click(".diff-preview-toggle", { after: 2600 });
    },
  },
  {
    // Filter: a click on a label copies the branch name, a double click shows only that branch, then the
    // filters of the text and the user, and Clear.
    name: "filter",
    settings: () => ({ leftTab: "branches" }),
    async setup(d) {
      await d.page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    },
    async run(d) {
      const view = [".filter-text", ".log-row >> nth=9"];
      const label = ".log-row .ref[data-ref='feature/cli']";
      await d.wait(1400);
      await d.cam(view, { zoom: 1.7, align: "top" });
      await d.wait(900);
      d.mark("copy");
      await d.click(label, { after: 500 });
      const name = await d.page.evaluate(() => navigator.clipboard.readText());
      await d.page.evaluate((t) => {
        window.__vidClipboard(t);
        const r = document.querySelector(".log-row .ref[data-ref='feature/cli']").getBoundingClientRect();
        Object.assign(document.querySelector(".vid-clipboard").style, { left: `${r.right + 60}px`, top: `${r.top - 22}px`, right: "auto", bottom: "auto", width: "150px", font: "14px ui-monospace, monospace" });
      }, name);
      await d.wait(2200);
      await d.page.evaluate(() => document.querySelector(".vid-clipboard")?.remove());
      d.mark("branch");
      await d.click(label, { double: true, after: 0 });
      await d.page.waitForFunction(() => document.querySelector(".filter-label")?.textContent?.includes("feature/cli"));
      await d.wait(2600);
      d.mark("text");
      await d.click(".filter-x", { after: 500 });
      await d.click(".filter-text", { after: 150 });
      await d.type("parser", 70);
      await d.wait(2400);
      d.mark("user");
      await d.click(".filter-author", { after: 150 });
      await d.type("Grace", 70);
      await d.page.keyboard.press("Enter");
      await d.wait(2400);
      d.mark("clear");
      await d.click(".filter-clear", { after: 2400 });
    },
  },
];

await recordScenes({ scenes, work, out, only, makeRepos: join(here, "make-shorts-repo.sh"), settings: presetSettings, css: HIDE_PATH, view: VIEW });
