// Records the scenes of the short videos for social posts with Playwright. Each short has one scene.
// Build the UI and the dev server first (see AGENTS.md), then:
//   node scripts/video/shorts-record.mjs <work-dir> <out-dir> [scene ...]
// <work-dir> gets the repository of make-shorts-repo.sh. <out-dir> gets <scene>.webm and scenes.json.
// A scene calls d.mark(name) at each step and d.cam(...) for each place of the camera; shorts-build.mjs
// places the captions, the music and the moves of the camera on them.
import { writeFileSync } from "node:fs";
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

const scenes = [
  {
    // Short 1: notes on the changes of the agent, before any commit.
    name: "notes",
    prep: agentChanges,
    // The video starts on the diff of the agent, not on the commit that the log selects.
    async setup(d) {
      await d.page.click(file("arith.rs"));
      await showsFile(d, "arith.rs");
      await d.page.waitForSelector(`${modified} .view-line`);
      await d.wait(500);
    },
    async run(d) {
      await d.wait(1600);
      await d.cam(DIFF, { zoom: 2 });
      await d.wait(900);
      d.mark("note1");
      await addNote(d, 6, NOTE_ARITH);
      await d.wait(1100);
      await d.cam([file("arith.rs"), file("main.rs")], { zoom: 2 });
      await d.wait(500);
      await d.click(file("main.rs"), { after: 0 });
      await showsFile(d, "main.rs");
      await d.wait(500);
      await d.cam(DIFF, { zoom: 2 });
      await d.wait(900);
      d.mark("note2");
      await addNote(d, 5, NOTE_MAIN);
      d.mark("done");
      await d.wait(2400);
    },
  },
  {
    // Short 2: copy the notes, paste them to the agent, and the fix clears the notes.
    name: "paste",
    prep: agentChanges,
    async setup(d) {
      for (const [path, line, text] of [["arith.rs", 6, NOTE_ARITH], ["main.rs", 5, NOTE_MAIN]]) {
        await d.page.evaluate((body) => fetch("/api/local_note_edit", { method: "POST", body: JSON.stringify(body) }), { root: repo, action: "add", path, line, text });
      }
      await d.page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
      await d.page.click(file("arith.rs"));
      await d.page.waitForSelector(".diff .note-card:not(.draft)");
      await d.wait(600);
    },
    async run(d) {
      await d.cam(DIFF, { zoom: 2 });
      await d.wait(1700);
      await d.cam([".commit-copy-notes", file("main.rs")], { zoom: 2 });
      await d.wait(700);
      d.mark("copy");
      await d.click(".commit-copy-notes", { after: 700 });
      const notes = await d.page.evaluate(() => navigator.clipboard.readText());
      // The terminal is over the log and above the new side of the diff, so one place of the camera
      // shows the terminal and the code that changes under it.
      const box = await d.page.evaluate((sel) => {
        const side = document.querySelector(sel).getBoundingClientRect();
        const top = document.querySelector(".diff").getBoundingClientRect().top;
        const h = 330;
        return { x: innerWidth - 520, y: top - h - 10, w: 508, h, title: "agent — rustcalc" };
      }, DIFF);
      d.mark("term");
      await term(d, "open", box);
      await term(d, "print", `<span class="dim">~/rustcalc</span> <span class="hi">main</span>\n<span class="you">›</span> `);
      await d.cam(".vid-term", { zoom: 1.9, align: "top", pad: 8 });
      await d.wait(1200);
      // The badge of the keys goes into the terminal, where the camera is.
      await d.page.evaluate(() => {
        window.__vidKeys("⌘ V");
        const r = document.querySelector(".vid-term").getBoundingClientRect();
        Object.assign(document.querySelector(".vid-keys").style, { left: `${r.left + r.width / 2}px`, top: `${r.top + r.height * 0.62}px` });
      });
      await d.wait(350);
      d.mark("paste");
      await term(d, "print", esc(notes).replace(/\n/g, "\n  "));
      await d.wait(1900);
      await term(d, "print", `\n\n<span class="dim">● Reading 2 review notes</span>\n`);
      await d.wait(900);
      await term(d, "print", `● Edit <span class="hi">arith.rs</span>\n  <span class="del">- pub fn div(a: i32, b: i32) -&gt; i32 {</span>\n  <span class="add">+ pub fn div(a: i32, b: i32) -&gt; Option&lt;i32&gt; {</span>\n`);
      write("arith.rs", ARITH_GOOD);
      d.mark("fix");
      await d.page.waitForFunction(() => !document.querySelector(".diff .note-card") && document.querySelector(".diff .editor.modified")?.textContent?.includes("checked_div"), null, { timeout: 15000 });
      await d.wait(900);
      await term(d, "print", `● Edit <span class="hi">main.rs</span>\n`);
      write("main.rs", MAIN_GOOD);
      await d.wait(900);
      await term(d, "print", `<span class="ok">✔ Fixed 2 notes</span>\n<span class="you">›</span> `);
      d.mark("cleared");
      await d.wait(2800);
    },
  },
  {
    // Short 3: a review of the branch of the agent, then a squash merge, all without a remote.
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
];

await recordScenes({ scenes, work, out, only, makeRepos: join(here, "make-shorts-repo.sh"), settings: presetSettings, css: HIDE_PATH, view: VIEW });
