// UI scenario for many project tabs: the tabs scroll without a scroll bar, an edge fades where more tabs
// are, the wheel of a mouse scrolls them to the side, and the + button stays in view.
// Start the dev server first (see README). Build a fresh repository with make-demo-repo.sh, then:
// node e2e/tab-overflow.mjs <repo> <screenshot-dir>. The scenario makes small repositories next to <repo>.
// Set CHROMIUM to a Chromium binary when Playwright has no downloaded browser.
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
const [,, repo, outDir] = process.argv;
const base = process.env.GITTOR_E2E_URL ?? "http://127.0.0.1:5174";

// Eight more projects with long names.
const extra = Array.from({ length: 8 }, (_, i) => `${repo}-overflow-project-with-a-long-name-${i}`);
for (const dir of extra) {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const git = (...args) => execFileSync("git", ["-C", dir, "-c", "user.name=T", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false", ...args]);
  git("init", "-q", "-b", "main");
  writeFileSync(`${dir}/a.txt`, "a\n");
  git("add", ".");
  git("commit", "-q", "-m", "First");
}

const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const page = await (await browser.newContext({ viewport: { width: 1000, height: 700 }, deviceScaleFactor: 2 })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push("pageerror: " + e));
page.on("console", (m) => m.type() === "error" && errors.push("console: " + m.text()));
const check = (what, ok) => { console.log(ok ? "ok  " : "FAIL", what); if (!ok) errors.push("check: " + what); };
const within = async (what, fn, ms = 8000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return check(what, true);
    await page.waitForTimeout(100);
  }
  check(what, false);
};
const state = () => page.evaluate(() => {
  const s = document.querySelector(".tabbar-scroll");
  const add = document.querySelector(".tab-add").getBoundingClientRect();
  return {
    tabs: s.querySelectorAll(".tab").length,
    overflow: s.scrollWidth > s.clientWidth,
    scrollBar: s.offsetHeight - s.clientHeight,
    left: s.classList.contains("more-left"),
    right: s.classList.contains("more-right"),
    scrollLeft: s.scrollLeft,
    addInView: add.right <= window.innerWidth && add.width > 0,
  };
});

// The projects open as tabs; the first one is active.
await page.goto(`${base}/?repo=${encodeURIComponent(repo)}`);
await page.waitForSelector(".log-row", { timeout: 30000 });
await page.evaluate((roots) => {
  const s = JSON.parse(localStorage.getItem("gittor.settings.v1") ?? "{}");
  s.tabs = roots;
  s.activeTab = roots[0];
  localStorage.setItem("gittor.settings.v1", JSON.stringify(s));
}, [repo, ...extra]);
await page.reload();
await page.waitForSelector(".log-row", { timeout: 30000 });
await within("all projects have a tab", async () => (await state()).tabs === extra.length + 1);
let s = await state();
check("the tabs are wider than the bar", s.overflow);
check("no scroll bar shows", s.scrollBar === 0);
check("the right edge fades: more tabs are there", s.right && !s.left);
check("the + button stays in view", s.addInView);
const bar = await page.locator(".tabbar").boundingBox();
await page.screenshot({ path: `${outDir}/to1-start.png`, clip: { x: 0, y: bar.y, width: 1000, height: bar.height } });

// The wheel of a mouse scrolls the tabs to the side.
await page.mouse.move(bar.x + 300, bar.y + bar.height / 2);
await page.mouse.wheel(0, 400);
await within("the wheel scrolls the tabs", async () => (await state()).scrollLeft > 0);
await within("both edges fade in the middle", async () => {
  const x = await state();
  return x.left && x.right;
});
await page.screenshot({ path: `${outDir}/to2-middle.png`, clip: { x: 0, y: bar.y, width: 1000, height: bar.height } });

// The last tab, switched to with the keys, scrolls into view.
await page.keyboard.press("Control+PageUp");
await within("the active tab scrolls into view", async () =>
  page.evaluate(() => {
    const s = document.querySelector(".tabbar-scroll").getBoundingClientRect();
    const t = document.querySelector(".tab.on")?.getBoundingClientRect();
    return !!t && t.left >= s.left - 1 && t.right <= s.right + 1;
  }));
s = await state();
check("at the end, only the left edge fades", s.left && !s.right);

console.log("errors:", JSON.stringify(errors));
await browser.close();
for (const dir of extra) rmSync(dir, { recursive: true, force: true });
if (errors.length) process.exit(1);
