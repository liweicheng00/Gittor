// Records the scenes of the intro video with Playwright. Each scene gets a fresh repository, a fresh
// browser context and its own video file.
// Build the UI and the dev server first (see AGENTS.md), then:
//   node scripts/video/record.mjs <work-dir> <out-dir> [scene ...]
// The script starts a fresh dev server for each scene, because the server keeps the data of an open
// repository, and each scene makes the repository again.
// <work-dir> gets the repositories of make-repos.sh. <out-dir> gets <scene>.webm and scenes.json.
// stage.mjs holds the overlay, the Director and the loop. Set CHROMIUM to a Chromium binary when
// Playwright has no downloaded browser.
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { git, recordScenes, row } from "./stage.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const [, , workArg, outArg, ...only] = process.argv;
if (!workArg || !outArg) throw new Error("usage: record.mjs <work-dir> <out-dir> [scene ...]");
const work = resolve(workArg);
const out = resolve(outArg);
const repo = join(work, "rustcalc");

/** The settings of the UI before the first load of a scene. */
const presetSettings = (extra) => ({
  theme: "dark",
  leftTab: "branches",
  showSidebar: true,
  showDiff: true,
  keyHints: true,
  autoCheckUpdates: false,
  recent: [repo],
  tabs: [repo],
  activeTab: repo,
  ...extra,
});

/** The scenes in order. `prep` changes the repositories before the page opens. */
const scenes = [
  {
    name: "log",
    async run(d) {
      await d.wait(1200);
      await d.click(row("Merge branch 'feature/tokenizer'"), { after: 1600 });
      await d.click(row("Tokenize parentheses"), { after: 1600 });
      await d.click(row("Return None on overflow"), { after: 1500 });
      await d.click(row("Merge branch 'fix/readme'"), { after: 1600 });
      await d.move(".sidebar .branch:has-text('feature/cli') >> nth=0", { ms: 700 });
      await d.wait(900);
    },
  },
  {
    name: "open",
    settings: () => ({
      recent: [join(work, "rustcalc-wt/parser-fix"), repo, join(work, "rustcalc-wt/cli-flags"), join(work, "website"), join(work, "rustcalc-wt/release-0.3"), join(work, "infra")],
      tabs: [repo, join(work, "website"), join(work, "infra")],
    }),
    async run(d) {
      await d.wait(500);
      await d.click(row("Merge branch 'feature/tokenizer'"), { after: 700 });
      await d.click(".tb-button:has-text('Open')", { after: 900 });
      for (const p of ["rustcalc-wt/parser-fix", "rustcalc-wt/cli-flags", "rustcalc-wt/release-0.3", "website", "infra"]) {
        await d.move(`.menu .menu-item[title='${join(work, p)}']`, { ms: 420 });
        await d.wait(380);
      }
      await d.click(`.menu .menu-item[title='${join(work, "rustcalc-wt/cli-flags")}']`, { after: 0 });
      await d.page.waitForSelector(".tab:has-text('cli-flags')", { timeout: 15000 });
      await d.wait(1500);
      // Alt+1 to Alt+9 show the project tab at that place.
      for (const n of [1, 2, 3, 4]) {
        await d.keys(`Alt+${n}`);
        await d.wait(1050);
      }
      await d.click(".tab:has-text('website')", { after: 1200 });
    },
  },
  {
    name: "worktrees",
    async run(d) {
      await d.wait(700);
      await d.click(".group-action[title='Add a worktree']", { after: 300 });
      await d.page.waitForSelector(".dialog-field:has-text('Branch') input");
      await d.click(".dialog-field:has-text('Branch') input", { after: 150 });
      await d.type("hotfix/overflow");
      await d.click(".dialog-field:has-text('Folder') input", { after: 150 });
      await d.page.fill(".dialog-field:has-text('Folder') input", "");
      await d.type(join(work, "rustcalc-wt/hotfix"), 22);
      await d.wait(400);
      await d.click(".dialog-buttons button:has-text('Create')", { after: 0 });
      const item = ".sidebar .worktree:has(.branch-name:text-is('hotfix'))";
      await d.page.waitForSelector(item, { timeout: 15000 });
      await d.wait(1300);
      await d.click(item, { double: true, after: 0 });
      await d.page.waitForSelector(".tab.worktree:has-text('hotfix')", { timeout: 15000 });
      await d.wait(1200);
      await d.move(".tab.worktree:has-text('hotfix')", { ms: 600 });
      await d.wait(1800);
    },
  },
  {
    name: "changes",
    prep() {
      execFileSync("sh", ["-c", `cd "${repo}" && echo "More docs" >> README.md && sed -i 's/wrapping_add/saturating_add/' arith.rs && echo 'pub fn sub(a: i32, b: i32) -> i32 { a - b }' > sub.rs && git add sub.rs`]);
    },
    async run(d) {
      await d.wait(700);
      await d.click(".lp-tab:has-text('Changes')", { after: 900 });
      await d.click(".cl-file:has-text('arith.rs')", { after: 1100 });
      // A changelist for the docs: README.md goes there.
      await d.click(".cl-file:has-text('README.md')", { button: "right", after: 200 });
      await d.menu("New Changelist");
      await d.page.waitForSelector(".dialog-field:has-text('Name') input");
      await d.click(".dialog-field:has-text('Name') input", { after: 150 });
      await d.type("Docs");
      await d.click(".dialog-buttons button:has-text('Create')", { after: 900 });
      // Check only arith.rs and sub.rs, then commit.
      await d.click(".cl-file:has-text('main.rs') .cl-check", { after: 400 });
      await d.click(".cl-file:has-text('NOTES.txt') .cl-check", { after: 400 });
      await d.click(".commit-message", { after: 150 });
      await d.type("Use saturating add and add sub");
      await d.wait(400);
      await d.click(".commit-button", { after: 2200 });
    },
  },
  {
    name: "submodules",
    // A smaller diff panel gives the Submodules section under the commit message more room.
    settings: () => ({ diffRatio: 0.26 }),
    prep() {
      // A library with two commits. rustcalc records the second one, but its checkout is at the first.
      const lib = join(work, "rustlib");
      rmSync(lib, { recursive: true, force: true });
      mkdirSync(lib, { recursive: true });
      git(lib, "init", "-q", "-b", "main");
      for (const [msg, text] of [["Add the parser of numbers", "pub fn number() {}\n"], ["Parse negative numbers", "pub fn number() {}\npub fn negative() {}\n"]]) {
        writeFileSync(join(lib, "lib.rs"), text);
        git(lib, "add", ".");
        git(lib, "-c", "user.name=Grace Hopper", "-c", "user.email=grace@example.com", "commit", "-q", "-m", msg);
      }
      git(repo, "stash", "-q", "-u");
      git(repo, "-c", "protocol.file.allow=always", "submodule", "add", "-q", lib, "vendor/rustlib");
      git(repo, "commit", "-q", "-m", "Add the rustlib submodule");
      git(join(repo, "vendor/rustlib"), "checkout", "-q", "HEAD~1");
    },
    async run(d) {
      await d.wait(700);
      await d.click(".lp-tab:has-text('Changes')", { after: 900 });
      await d.click(".cl-file:has-text('rustlib')", { after: 1800 });
      await d.click(".sm-row", { after: 1600 });
      await d.move(".sm-detail .sm-behind", { ms: 500 });
      await d.wait(1200);
      await d.click(".sm-detail .sm-update", { after: 0 });
      await d.page.waitForFunction(() => !document.querySelector(".sm-row")?.textContent?.includes("≠"), null, { timeout: 15000 });
      await d.wait(2200);
    },
  },
  {
    name: "markdown",
    // A larger diff panel shows more of the preview.
    settings: () => ({ diffRatio: 0.62 }),
    prep() {
      const before = [
        "# rustcalc", "", "A small calculator in Rust.", "", "## Build", "",
        "- [x] Install Rust", "- [ ] Build with cargo", "",
        "```rust", "fn main() {", "    println!(\"{}\", add(2, 3));", "}", "```", "",
        "## How it works", "", "```mermaid", "graph LR", "  A[Input] --> B[Tokenizer]", "  B --> C[Parser]", "```", "",
      ].join("\n");
      const after = before
        .replace("A small calculator in Rust.", "A small calculator in Rust.\n\nIt knows + - * / and parentheses.")
        .replace("- [ ] Build with cargo", "- [x] Build with `cargo build --release`")
        .replace("  B --> C[Parser]", "  B --> C[Parser]\n  C --> D[Evaluate]");
      git(repo, "stash", "-q", "-u");
      mkdirSync(join(repo, "docs"), { recursive: true });
      writeFileSync(join(repo, "docs/GUIDE.md"), before);
      git(repo, "add", "docs");
      git(repo, "commit", "-q", "-m", "Add the guide");
      writeFileSync(join(repo, "docs/GUIDE.md"), after);
    },
    async run(d) {
      await d.wait(700);
      await d.click(".lp-tab:has-text('Changes')", { after: 800 });
      await d.click(".cl-file:has-text('GUIDE.md')", { after: 0 });
      await d.page.waitForSelector(".diff-preview-toggle:not([hidden])", { timeout: 15000 });
      await d.wait(2600);
      // Scroll the preview down to the diagram.
      await d.move(".diff", { dy: 60, ms: 600 });
      for (let i = 0; i < 6; i++) {
        await d.page.mouse.wheel(0, 70);
        await d.wait(120);
      }
      await d.wait(2200);
      await d.click(".diff-preview-toggle", { after: 2200 });
      await d.click(".diff-preview-toggle", { after: 1800 });
    },
  },
  {
    name: "history",
    prep() {
      git(repo, "stash", "-q", "-u");
      execFileSync("sh", ["-c", `cd "${repo}" && echo 'pub fn sub(a: i32, b: i32) -> i32 { a - b }' > sub.rs && git add sub.rs && git -c commit.gpgsign=false commit -qm "Add a sub function" && echo 'pub fn neg(a: i32) -> i32 { -a }' >> sub.rs && git -c commit.gpgsign=false commit -qam "Add neg"`]);
    },
    async run(d) {
      await d.wait(900);
      await d.click(row("Add neg"), { after: 600 });
      await d.click(row("Add a sub function"), { modifiers: ["Control"], after: 600 });
      await d.click(row("Add neg"), { button: "right", after: 200 });
      await d.menu("Squash 2 Commits");
      await d.page.waitForSelector(".dialog textarea");
      await d.wait(700);
      await d.click(".dialog textarea", { after: 100 });
      await d.page.keyboard.press("Control+A");
      await d.type("Add sub and neg");
      await d.wait(300);
      await d.click(".dialog-buttons button:has-text('Squash')", { after: 1800 });
      await d.click(".toast-action:has-text('Undo')", { after: 2200 });
    },
  },
  {
    name: "review",
    async run(d) {
      await d.page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
      await d.wait(700);
      await d.click(".sidebar .branch:has-text('feature/cli') >> nth=0", { button: "right", after: 200 });
      await d.menu("Review Branch");
      await d.page.waitForSelector(".dialog:has-text('Review Branch')");
      await d.wait(500);
      await d.click(".dialog-buttons button:has-text('Start Review')", { after: 0 });
      await d.page.waitForSelector(".review-window");
      await d.wait(1500);
      const modified = ".review-window .diff-host:not([hidden]) .monaco-editor:not(.original)";
      const line = (n) => `${modified} .line-numbers >> text=/^${n}$/`;
      await d.move(line(2), { dx: 6 });
      await d.wait(500);
      await d.click(`${modified} .note-add-icon`, { after: 300 });
      await d.page.waitForSelector(".review-window .note-card.draft textarea");
      await d.type("Use a logger here");
      await d.page.keyboard.press("Control+Enter");
      await d.wait(1000);
      await d.click(".review-file-note-input", { after: 150 });
      await d.type("The file needs tests");
      await d.page.keyboard.press("Enter");
      await d.wait(900);
      await d.click(".review-notes-copy", { after: 300 });
      const text = await d.page.evaluate(() => navigator.clipboard.readText());
      await d.page.evaluate((t) => window.__vidClipboard(t), text);
      await d.wait(2600);
    },
  },
  {
    name: "tools",
    settings: () => ({ recent: [repo, join(work, "website")], tabs: [repo, join(work, "website")] }),
    async run(d) {
      await d.page.evaluate(async () => {
        const s = await (await fetch("/api/backend_settings", { method: "POST", body: "{}" })).json();
        await fetch("/api/set_backend_settings", { method: "POST", body: JSON.stringify({ ...s, editor: "true", terminal: "true {dir}" }) });
      });
      await d.wait(700);
      await d.click(".tb-button:has-text('Refresh')", { after: 1700 });
      await d.click(".tb-ide", { after: 1700 });
      await d.click(".tb-terminal", { after: 1800 });
      // Drag the second tab out of the tab bar: it opens in a new window.
      const tab = `.tab[data-root='${join(work, "website")}']`;
      await d.drag(tab, { x: 520, y: 330 }, { ms: 1400 });
      await d.wait(3000);
    },
  },
];


await recordScenes({ scenes, work, out, only, makeRepos: join(here, "make-repos.sh"), settings: presetSettings });
