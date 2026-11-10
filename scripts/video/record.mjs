// Records the scenes of the intro video with Playwright. Each scene gets a fresh repository, a fresh
// browser context and its own video file.
// Build the UI and the dev server first (see AGENTS.md), then:
//   node scripts/video/record.mjs <work-dir> <out-dir> [scene ...]
// The script starts a fresh dev server for each scene, because the server keeps the data of an open
// repository, and each scene makes the repository again.
// <work-dir> gets the repositories of make-repos.sh. <out-dir> gets <scene>.webm and scenes.json.
// Set CHROMIUM to a Chromium binary when Playwright has no downloaded browser.
import { createRequire } from "node:module";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const { chromium } = createRequire(join(root, "ui/package.json"))("playwright");
const [, , workArg, outArg, ...only] = process.argv;
if (!workArg || !outArg) throw new Error("usage: record.mjs <work-dir> <out-dir> [scene ...]");
const work = resolve(workArg);
const out = resolve(outArg);
mkdirSync(out, { recursive: true });
const port = process.env.VIDEO_PORT ?? "5191";
const base = `http://127.0.0.1:${port}`;
const repo = join(work, "rustcalc");
const git = (dir, ...args) => execFileSync("git", ["-C", dir, "-c", "commit.gpgsign=false", ...args], { encoding: "utf8" }).trim();

// The page is 1600x900. build.sh scales the video to 1920x1080, so the text is larger than at 1920x1080.
// A larger device scale does not help: the video keeps the CSS pixels.
const VIEW = { width: 1600, height: 900 };

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

/** A cursor and a ring on each click, because the video does not show the mouse. A fake window frame
 * for window.open, because a popup records to another file. */
const overlayScript = () => {
  if (window.top !== window) return;
  const css = `
    #vid-cursor { position: fixed; left: 0; top: 0; width: 22px; height: 22px; z-index: 2147483647;
      pointer-events: none; transform: translate(-3px, -2px); filter: drop-shadow(0 1px 2px rgba(0,0,0,.6)); }
    .vid-ring { position: fixed; z-index: 2147483646; pointer-events: none; width: 44px; height: 44px;
      margin: -22px 0 0 -22px; border-radius: 50%; border: 3px solid #ffb02e; background: rgba(255,176,46,.25);
      animation: vid-ring .55s ease-out forwards; }
    .vid-ring.right { border-color: #4da3ff; background: rgba(77,163,255,.25); }
    @keyframes vid-ring { from { transform: scale(.3); opacity: 1; } to { transform: scale(1.4); opacity: 0; } }
    .vid-window { position: fixed; z-index: 2147483000; border-radius: 10px; overflow: hidden;
      box-shadow: 0 18px 60px rgba(0,0,0,.65); border: 1px solid #555; background: #1e1f22;
      animation: vid-open .25s ease-out; }
    @keyframes vid-open { from { transform: scale(.92); opacity: 0; } to { transform: none; opacity: 1; } }
    .vid-titlebar { height: 28px; display: flex; align-items: center; gap: 8px; padding: 0 12px;
      background: #2b2d30; color: #bbb; font: 12px system-ui; }
    .vid-titlebar i { width: 12px; height: 12px; border-radius: 50%; display: inline-block; }
    .vid-window iframe { border: 0; display: block; }
    .vid-clipboard { position: fixed; z-index: 2147483000; right: 24px; bottom: 110px; width: 360px;
      background: #1b1c1f; color: #ddd; border: 1px solid #4da3ff; border-radius: 8px; padding: 10px 14px;
      font: 12px/1.45 ui-monospace, monospace; white-space: pre-wrap; box-shadow: 0 10px 40px rgba(0,0,0,.6);
      animation: vid-open .25s ease-out; }
    .vid-keys { position: fixed; z-index: 2147483000; left: 50%; top: 38%; transform: translateX(-50%);
      padding: 14px 26px; border-radius: 14px; background: rgba(20, 22, 27, 0.92); color: #fff;
      border: 1px solid rgba(255, 255, 255, 0.18); font: 600 34px/1 system-ui; letter-spacing: .02em;
      box-shadow: 0 12px 40px rgba(0,0,0,.5); animation: vid-open .18s ease-out; pointer-events: none; }
    .vid-clipboard b { display: block; font: 600 11px system-ui; color: #4da3ff; margin-bottom: 6px;
      text-transform: uppercase; letter-spacing: .06em; }`;
  const arrow = `<svg viewBox="0 0 22 22" width="22" height="22"><path d="M3 2 L3 18 L7.5 14 L10.5 20.5 L13.5 19.2 L10.6 12.8 L16.5 12.8 Z" fill="#fff" stroke="#000" stroke-width="1.3" stroke-linejoin="round"/></svg>`;
  const install = () => {
    const style = document.createElement("style");
    style.textContent = css;
    document.head.append(style);
    const cursor = document.createElement("div");
    cursor.id = "vid-cursor";
    cursor.innerHTML = arrow;
    cursor.style.left = "720px";
    cursor.style.top = "420px";
    document.body.append(cursor);
    const at = (e) => { cursor.style.left = `${e.clientX}px`; cursor.style.top = `${e.clientY}px`; };
    for (const t of ["mousemove", "mousedown", "mouseup", "dragover"]) addEventListener(t, at, true);
    addEventListener("mousedown", (e) => {
      const ring = document.createElement("div");
      ring.className = e.button === 2 ? "vid-ring right" : "vid-ring";
      ring.style.left = `${e.clientX}px`;
      ring.style.top = `${e.clientY}px`;
      document.body.append(ring);
      setTimeout(() => ring.remove(), 700);
    }, true);
    // Keep the cursor last, above dialogs and menus that open later.
    new MutationObserver(() => { if (document.body.lastElementChild !== cursor) document.body.append(cursor); })
      .observe(document.body, { childList: true });
  };
  if (document.body) install();
  else addEventListener("DOMContentLoaded", install);
  window.open = (url) => {
    const box = document.createElement("div");
    box.className = "vid-window";
    const w = Math.round(innerWidth * 0.62);
    const h = Math.round(innerHeight * 0.66);
    const x = Math.min(Math.max(window.__vidMouse?.x ?? 300, 20), innerWidth - w - 20);
    const y = Math.min(Math.max(window.__vidMouse?.y ?? 200, 20), innerHeight - h - 20);
    Object.assign(box.style, { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h + 28}px` });
    const name = new URL(url, location.href).searchParams.get("repo")?.split("/").pop() ?? "Gittor";
    box.innerHTML = `<div class="vid-titlebar"><i style="background:#ff5f57"></i><i style="background:#febc2e"></i><i style="background:#28c840"></i><span style="margin-left:8px">${name} — Gittor</span></div>`;
    const frame = document.createElement("iframe");
    frame.src = url;
    frame.width = String(w);
    frame.height = String(h);
    box.append(frame);
    document.body.append(box);
    return null;
  };
  addEventListener("mousemove", (e) => { window.__vidMouse = { x: e.clientX, y: e.clientY }; }, true);
  // The video does not show the keyboard: a badge shows the keys that the director presses.
  window.__vidKeys = (text) => {
    document.querySelectorAll(".vid-keys").forEach((e) => e.remove());
    const box = document.createElement("div");
    box.className = "vid-keys";
    box.textContent = text;
    document.body.append(box);
    setTimeout(() => box.remove(), 1300);
  };
  window.__vidClipboard = (text) => {
    const box = document.createElement("div");
    box.className = "vid-clipboard";
    box.innerHTML = "<b>Clipboard</b>";
    box.append(text);
    document.body.append(box);
  };
};

/** Mouse moves that a viewer can follow. */
class Director {
  constructor(page) {
    this.page = page;
    this.x = VIEW.width / 2;
    this.y = VIEW.height / 2;
  }
  wait(ms) { return this.page.waitForTimeout(ms); }
  async point(target, dx = 0, dy = 0) {
    if (typeof target !== "string") return target;
    const loc = this.page.locator(target).first();
    await loc.waitFor({ state: "visible", timeout: 15000 });
    await loc.scrollIntoViewIfNeeded();
    const b = await loc.boundingBox();
    return { x: b.x + b.width / 2 + dx, y: b.y + b.height / 2 + dy };
  }
  async move(target, { dx = 0, dy = 0, ms } = {}) {
    const p = await this.point(target, dx, dy);
    const dist = Math.hypot(p.x - this.x, p.y - this.y);
    const time = ms ?? Math.min(900, Math.max(300, dist * 1.1));
    const steps = Math.max(8, Math.round(time / 16));
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
      await this.page.mouse.move(this.x + (p.x - this.x) * e, this.y + (p.y - this.y) * e);
      await this.page.waitForTimeout(time / steps / 2);
    }
    this.x = p.x;
    this.y = p.y;
    return p;
  }
  async click(target, opts = {}) {
    await this.move(target, opts);
    await this.wait(opts.before ?? 250);
    const button = opts.button ?? "left";
    if (opts.modifiers) for (const m of opts.modifiers) await this.page.keyboard.down(m);
    if (opts.double) await this.page.mouse.dblclick(this.x, this.y, { button });
    else await this.page.mouse.click(this.x, this.y, { button });
    if (opts.modifiers) for (const m of opts.modifiers) await this.page.keyboard.up(m);
    await this.wait(opts.after ?? 450);
  }
  /** Clicks a menu item. A menu ignores a click right after it opens. */
  async menu(label) {
    await this.wait(450);
    await this.click(`.menu-item:has-text("${label}")`);
  }
  /** Presses keys and shows them in a badge, for example keys("Alt+2"). */
  async keys(combo, label = combo) {
    await this.page.evaluate((t) => window.__vidKeys(t), label);
    await this.wait(250);
    await this.page.keyboard.press(combo);
  }
  async type(text, delay = 55) {
    await this.page.keyboard.type(text, { delay });
  }
  async drag(from, to, { ms = 1200 } = {}) {
    await this.move(from);
    await this.wait(250);
    await this.page.mouse.down();
    await this.move(to, { ms });
    await this.wait(250);
    await this.page.mouse.up();
  }
}

const row = (subject) => `.log-row:has(.subject-text:text-is("${subject}"))`;

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

const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const meta = existsSync(join(out, "scenes.json")) ? JSON.parse(readFileSync(join(out, "scenes.json"), "utf8")) : {};
for (const scene of scenes) {
  if (only.length && !only.includes(scene.name)) continue;
  execFileSync(join(here, "make-repos.sh"), [work], { stdio: "ignore" });
  const cfg = join(out, "cfg");
  rmSync(cfg, { recursive: true, force: true });
  mkdirSync(cfg);
  const server = spawn(join(root, "target/debug/gittor-devserver"), [join(root, "ui/dist"), port], { env: { ...process.env, GITTOR_CONFIG_DIR: cfg }, stdio: "ignore" });
  for (let i = 0; ; i++) {
    if (await fetch(`${base}/`).then((r) => r.ok, () => false)) break;
    if (i > 100) throw new Error("the dev server does not start");
    await new Promise((r) => setTimeout(r, 100));
  }
  scene.prep?.();
  const settings = presetSettings(scene.settings?.() ?? {});
  const tmp = join(out, `tmp-${scene.name}`);
  rmSync(tmp, { recursive: true, force: true });
  const context = await browser.newContext({ viewport: VIEW, recordVideo: { dir: tmp, size: VIEW } });
  await context.addInitScript((s) => {
    if (sessionStorage.getItem("vid-init")) return;
    sessionStorage.setItem("vid-init", "1");
    localStorage.setItem("gittor.settings.v1", JSON.stringify(s));
  }, settings);
  await context.addInitScript(overlayScript);
  const page = await context.newPage();
  const t0 = Date.now();
  page.on("pageerror", (e) => console.log(`[${scene.name}] pageerror: ${e}`));
  await page.goto(`${base}/`);
  await page.waitForSelector(".log-row", { timeout: 30000 });
  await page.waitForTimeout(1200);
  const start = (Date.now() - t0) / 1000;
  const d = new Director(page);
  await page.mouse.move(d.x, d.y);
  try {
    await scene.run(d);
  } catch (e) {
    await page.screenshot({ path: join(out, `${scene.name}-error.png`) });
    throw e;
  }
  const duration = (Date.now() - t0) / 1000 - start;
  const video = page.video();
  await context.close();
  renameSync(await video.path(), join(out, `${scene.name}.webm`));
  rmSync(tmp, { recursive: true, force: true });
  const exited = new Promise((r) => server.once("exit", r));
  server.kill("SIGKILL");
  await exited;
  meta[scene.name] = { start: +start.toFixed(2), duration: +duration.toFixed(2) };
  writeFileSync(join(out, "scenes.json"), JSON.stringify(meta, null, 2));
  console.log(`${scene.name}: start ${start.toFixed(1)} s, ${duration.toFixed(1)} s`);
}
await browser.close();
