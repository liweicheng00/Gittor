// UI scenario for the Markdown preview of the diff panel: the default preview, the marks of a diff in two
// columns and in one, images of the repository, blocked network images, removed scripts, colored code,
// task lists, anchor links, and the toggle to the source.
// Start the dev server first (see README). Build a fresh repository with make-demo-repo.sh, then:
// node e2e/markdown-preview.mjs <repo> <screenshot-dir>. Set CHROMIUM to a Chromium binary when
// Playwright has no downloaded browser.
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
const [,, repo, outDir] = process.argv;
const git = (...args) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" }).trim();

const before = `# Guide

Intro paragraph that stays.

Old paragraph that goes away.

## Usage

- [x] Install
- [ ] Configure

\`\`\`rust
fn main() { println!("hi"); }
\`\`\`

![Logo](logo.png)

![Remote](https://example.com/remote.png)

<img src="x" onerror="window.__hacked = 1"><script>window.__hacked = 2</script>

See [usage](#usage) or [the site](https://example.com).

\`\`\`mermaid
graph LR
  A[Write] --> B[Ship]
\`\`\`

\`\`\`mermaid
gantt
  title A plan
  section Work
  Task :a1, 2024-01-01, 3d
\`\`\`
`;
// A removed paragraph, a changed list, and a new paragraph at the end.
const after = before.replace("Old paragraph that goes away.\n\n", "").replace("- [ ] Configure", "- [ ] Configure it well").replace("B[Ship]", "B[Ship it]") + "\nA new paragraph.\n";

mkdirSync(`${repo}/docs`, { recursive: true });
writeFileSync(`${repo}/docs/guide.md`, before);
writeFileSync(`${repo}/docs/logo.png`, readFileSync(new URL("../../crates/app/icons/icon.png", import.meta.url)));
git("add", "docs");
git("-c", "commit.gpgsign=false", "commit", "-q", "-m", "Add the guide");
writeFileSync(`${repo}/docs/guide.md`, after);

const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const page = await (await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1.5 })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push("pageerror: " + e));
page.on("console", (m) => m.type() === "error" && errors.push("console: " + m.text()));
const shot = async (name) => { await page.waitForTimeout(400); await page.screenshot({ path: `${outDir}/${name}.png` }); console.log("shot", name); };
const check = (what, ok) => { console.log(ok ? "ok  " : "FAIL", what); if (!ok) errors.push("check: " + what); };
const within = async (what, fn, ms = 8000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return check(what, true);
    await page.waitForTimeout(150);
  }
  check(what, false);
};
const count = (sel) => page.$$eval(sel, (els) => els.length);
const preview = ".diff .md-preview";

await page.goto(`${process.env.GITTOR_E2E_URL ?? "http://127.0.0.1:5174"}/?repo=${encodeURIComponent(repo)}`);
await page.waitForSelector(".log-row", { timeout: 30000 });
await page.click(".lp-tab:text-is('Changes')");
await page.click(".cl-file:has(.path:text-is('guide.md'))");

// Preview by default, side by side: the old text at the left, the new text at the right.
await within("a Markdown file shows its preview", async () => (await page.isVisible(preview)) && (await count(`${preview} .md-cols-2 .md-body`)) === 2);
check("the editors are hidden", !(await page.isVisible(".diff .monaco-diff-editor")));
check("the toggle shows and is on", await page.isVisible(".diff-preview-toggle.on"));
await within("the diff marks the blocks", async () =>
  (await count(`${preview} .md-col:last-child .md-added`)) >= 1 &&
  (await count(`${preview} .md-col:first-child .md-removed`)) >= 1 &&
  (await count(`${preview} .md-col:last-child .md-changed`)) >= 1);
check("the new paragraph is marked as added", ((await page.textContent(`${preview} .md-col:last-child .md-added`)) ?? "").includes("A new paragraph"));
check("the old paragraph is marked as removed", ((await page.textContent(`${preview} .md-col:first-child .md-removed`)) ?? "").includes("Old paragraph"));

// The content: images, scripts, code, task lists.
await within("an image of the repository loads as data", async () => (await count(`${preview} .md-col:last-child img[src^="data:image/png"]`)) === 1);
check("a network image is blocked", ((await page.textContent(`${preview} .md-col:last-child`)) ?? "").includes("Image from example.com is blocked"));
check("no image loads from the network", (await count(`${preview} img[src^="http"]`)) === 0);
check("scripts and event attributes are removed", (await count(`${preview} script, ${preview} [onerror]`)) === 0 && (await page.evaluate(() => window.__hacked)) === undefined);
await within("the code block has the colors of Monaco", async () => (await count(`${preview} .md-col:last-child pre code[data-lang="rust"] span[class^="mtk"]`)) > 0);
// Mermaid: the backend draws a flowchart as SVG; a gantt chart keeps its code with a note.
await within("a Mermaid flowchart shows as an SVG image", async () => (await count(`${preview} .md-col:last-child .md-mermaid img[src^="data:image/svg+xml"]`)) === 1);
check("the diagram has the new label", decodeURIComponent((await page.getAttribute(`${preview} .md-col:last-child .md-mermaid img`, "src")) ?? "").includes("Ship it"));
check("the changed diagram is marked as changed", (await count(`${preview} .md-col:last-child .md-mermaid.md-changed`)) === 1);
await within("a gantt chart keeps its code with a note", async () =>
  ((await page.textContent(`${preview} .md-col:last-child`)) ?? "").includes("This Mermaid diagram is not shown") && (await count(`${preview} .md-col:last-child .md-mermaid pre`)) === 1);
check("the task list has two check boxes, one checked", (await count(`${preview} .md-col:last-child li.task-item input[disabled]`)) === 2 && (await count(`${preview} .md-col:last-child li.task-item input:checked`)) === 1);
await shot("md1-side-by-side");
await page.evaluate(() => document.querySelector(".diff .md-col:last-child .md-mermaid")?.scrollIntoView({ block: "start" }));
await shot("md3-mermaid");
await page.evaluate(() => (document.querySelector(".diff .md-preview").scrollTop = 0));

// An anchor link scrolls to its heading in the preview.
await page.click(`${preview} .md-col:last-child a[href="#usage"]`);
await within("the anchor link shows its heading", async () =>
  page.evaluate(() => {
    const h = document.querySelector(".diff .md-col:last-child #md-usage");
    const box = document.querySelector(".diff .md-preview").getBoundingClientRect();
    const r = h?.getBoundingClientRect();
    return !!r && r.top >= box.top - 1 && r.top < box.top + 80;
  }));

// One column: the removed paragraph shows between the new blocks, marked as removed.
await page.click(".diff-option:has-text('Side by side') input");
await within("one column", async () => (await count(`${preview} .md-cols-1 .md-body`)) === 1);
await within("the removed paragraph shows in the one column", async () =>
  ((await page.textContent(`${preview} .md-body > .md-removed`).catch(() => "")) ?? "").includes("Old paragraph"));
check("it shows before the paragraph that follows it", await page.evaluate(() => {
  const els = [...document.querySelectorAll(".diff .md-body > *")].map((e) => e.textContent ?? "");
  return els.findIndex((t) => t.includes("Old paragraph")) < els.findIndex((t) => t.startsWith("Usage"));
}));
check("the old version of a changed block comes before the new version", await page.evaluate(() => {
  const els = [...document.querySelectorAll(".diff .md-body > *")];
  const old = els.findIndex((e) => e.classList.contains("md-removed") && e.textContent.includes("Configure") && !e.textContent.includes("well"));
  const now = els.findIndex((e) => e.classList.contains("md-changed") && e.textContent.includes("Configure it well"));
  return old >= 0 && now >= 0 && old === now - 1;
}));
await shot("md2-one-column");
await page.click(".diff-option:has-text('Side by side') input");

// The toggle shows the source, and the choice stays.
await page.click(".diff-preview-toggle");
await within("the toggle shows the source", async () => (await page.isVisible(".diff .monaco-diff-editor")) && !(await page.isVisible(preview)));
check("the setting keeps the source", JSON.parse(await page.evaluate(() => localStorage.getItem("gittor.settings.v1"))).markdownPreview === false);
await page.click(".diff-preview-toggle");
await within("the toggle shows the preview again", async () => page.isVisible(preview));

// Another file has no toggle.
await page.click(".cl-file:has(.path:text-is('main.rs'))");
await within("a file that is not Markdown has no toggle and no preview", async () => !(await page.isVisible(".diff-preview-toggle")) && !(await page.isVisible(preview)));

console.log("errors:", JSON.stringify(errors));
await browser.close();
if (errors.length) process.exit(1);
