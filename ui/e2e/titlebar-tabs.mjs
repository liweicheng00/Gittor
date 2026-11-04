// UI scenario for the tabs in the title bar of macOS, with ?titlebar=mac in a browser: the tab bar is
// above the toolbar, leaves room for the window buttons, shows one tab too, and its empty part moves
// the window.
// Start the dev server first (see README). Build a fresh repository with make-demo-repo.sh, then:
// node e2e/titlebar-tabs.mjs <repo> <screenshot-dir>. The scenario makes a second repository next to it.
// Set CHROMIUM to a Chromium binary when Playwright has no downloaded browser.
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
const [,, repo, outDir] = process.argv;
const base = process.env.GITTOR_E2E_URL ?? "http://127.0.0.1:5174";
const run = (dir, ...args) => execFileSync("git", ["-C", dir, "-c", "commit.gpgsign=false", "-c", "user.name=T", "-c", "user.email=t@example.com", ...args], { encoding: "utf8" });

const second = `${repo}-tb`;
rmSync(second, { recursive: true, force: true });
mkdirSync(second, { recursive: true });
run(second, "init", "-q", "-b", "trunk");
writeFileSync(`${second}/t.txt`, "t\n");
run(second, "add", ".");
run(second, "commit", "-q", "-m", "Only commit of tb");

const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const page = await (await browser.newContext({ viewport: { width: 1400, height: 800 }, deviceScaleFactor: 2 })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push("pageerror: " + e));
page.on("console", (m) => m.type() === "error" && errors.push("console: " + m.text()));
const shot = async (name, height = 140) => { await page.screenshot({ path: `${outDir}/${name}.png`, clip: { x: 0, y: 0, width: 1400, height } }); console.log("shot", name); };
const check = (what, ok) => { console.log(ok ? "ok  " : "FAIL", what); if (!ok) errors.push("check: " + what); };
const within = async (what, fn, ms = 8000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return check(what, true);
    await page.waitForTimeout(100);
  }
  check(what, false);
};

await page.goto(`${base}/?titlebar=mac&repo=${encodeURIComponent(repo)}`);
await page.waitForSelector(".log-row", { timeout: 30000 });
const layout = () => page.evaluate(() => {
  const bar = document.querySelector(".tabbar");
  const tb = document.querySelector(".toolbar");
  const r = bar.getBoundingClientRect();
  return { hidden: bar.hidden, top: r.top, height: r.height, padLeft: parseFloat(getComputedStyle(bar).paddingLeft), above: r.bottom <= tb.getBoundingClientRect().top + 1, drag: bar.hasAttribute("data-tauri-drag-region"), tabs: bar.querySelectorAll(".tab").length };
});
let l = await layout();
check("the tab bar shows with one project", !l.hidden && l.tabs === 1);
check("the tab bar is at the top, above the toolbar", l.top === 0 && l.above);
check("it leaves room for the window buttons", l.padLeft >= 78 && l.height >= 36);
check("its empty part moves the window", l.drag);
await shot("tb1-one-tab");

await page.keyboard.press("Control+o");
await page.fill(".dialog-input", second);
await page.keyboard.press("Enter");
await within("a second project adds a tab in the title bar", async () => (await layout()).tabs === 2);
await page.click(".tab >> nth=0");
await within("a click on a tab switches the project", async () => !((await page.textContent(".log-row >> nth=0")) ?? "").includes("Only commit of tb"));
// The project loads its commit details after the switch. A close before that leaves requests for a
// closed repository.
await within("the details of the project load", async () => ((await page.textContent(".details-body").catch(() => "")) ?? "").includes("Hash"));
await page.waitForTimeout(500);
await shot("tb2-two-tabs");

// The last tab closes: the bar stays for the window buttons.
await page.keyboard.press("Control+w");
await within("Mod+W closes one tab", async () => (await layout()).tabs === 1);
await page.keyboard.press("Control+w");
await within("without tabs, the bar stays", async () => {
  const x = await layout();
  return !x.hidden && x.tabs === 0 && (await page.isVisible(".welcome-card"));
});

// Without the flag, the layout stays as before.
await page.goto(`${base}/?repo=${encodeURIComponent(repo)}`);
await page.waitForSelector(".log-row", { timeout: 30000 });
l = await layout();
check("without the title bar of macOS, one project has no tab bar", l.hidden);

console.log("errors:", JSON.stringify(errors));
await browser.close();
rmSync(second, { recursive: true, force: true });
if (errors.length) process.exit(1);
