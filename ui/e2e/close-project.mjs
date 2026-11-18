// UI scenario for Mod+W: it closes the project tab that shows, not the window. The other tab shows
// next. After the last tab, the welcome screen shows.
// Start the dev server first (see README). Build a fresh repository with make-demo-repo.sh, then:
// node e2e/close-project.mjs <repo> <screenshot-dir>. The scenario makes a second repository next to it.
// Set CHROMIUM to a Chromium binary when Playwright has no downloaded browser.
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
const [,, repo, outDir] = process.argv;
const run = (dir, ...args) => execFileSync("git", ["-C", dir, "-c", "commit.gpgsign=false", "-c", "user.name=Close", "-c", "user.email=close@example.com", ...args], { encoding: "utf8" });

const second = `${repo}-close`;
rmSync(second, { recursive: true, force: true });
mkdirSync(second, { recursive: true });
run(second, "init", "-q", "-b", "trunk");
writeFileSync(`${second}/c.txt`, "close\n");
run(second, "add", ".");
run(second, "commit", "-q", "-m", "Only commit of close");

const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const page = await (await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1.5 })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push("pageerror: " + e));
page.on("console", (m) => m.type() === "error" && errors.push("console: " + m.text()));
const shot = async (name) => { await page.screenshot({ path: `${outDir}/${name}.png` }); console.log("shot", name); };
const check = (what, ok) => { console.log(ok ? "ok  " : "FAIL", what); if (!ok) errors.push("check: " + what); };
const within = async (what, fn, ms = 8000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return check(what, true);
    await page.waitForTimeout(100);
  }
  check(what, false);
};

await page.goto(`${process.env.GITTOR_E2E_URL ?? "http://127.0.0.1:5174"}/?repo=${encodeURIComponent(repo)}`);
await page.waitForSelector(".log-row", { timeout: 30000 });
await page.keyboard.press("Control+o");
await page.fill(".dialog-input", second);
await page.keyboard.press("Enter");
await within("the second project opens in a tab", async () => (await page.$$(".tab")).length === 2 && ((await page.textContent(".log-row >> nth=0")) ?? "").includes("Only commit of close"));

// Mod+W closes the tab that shows. The first project shows again.
await page.click(".log-row >> nth=0");
await page.keyboard.press("Control+w");
await within("Mod+W closes the active tab", async () => (await page.$$(".tab")).length === 1 && !(await page.isVisible(".welcome-card")));
await within("the other project shows", async () => !((await page.textContent(".log-row >> nth=0")) ?? "").includes("Only commit of close"));
await shot("cp1-one-tab");

// The last tab: the window stays and shows the welcome screen.
await page.keyboard.press("Control+w");
await within("after the last tab, the welcome screen shows", async () => await page.isVisible(".welcome-card"));
check("the recent list still has both projects", ((await page.textContent(".recent")) ?? "").includes("-close"));
await shot("cp2-welcome");
check("the welcome screen has no toolbar", !(await page.isVisible(".toolbar")));
check("the welcome screen has no status bar", !(await page.isVisible(".statusbar")));
await page.click(".welcome-settings");
await within("the Settings link opens Settings", async () => await page.isVisible(".settings-page"));
await page.keyboard.press("Escape");
// A low window: the top of the card can scroll into view, and nothing is cut above it.
await page.setViewportSize({ width: 1000, height: 360 });
await page.$eval(".welcome", (e) => (e.scrollTop = 0));
check("the top of the welcome card shows in a low window", await page.$eval(".welcome-logo", (logo) => logo.getBoundingClientRect().top >= logo.closest(".welcome").getBoundingClientRect().top));
await shot("cp3-welcome-low");
await page.setViewportSize({ width: 1600, height: 1000 });
// A repository shows the toolbar and the status bar again.
await page.click(".recent-item >> nth=0");
await within("a repository shows the toolbar and the status bar again", async () => (await page.isVisible(".toolbar")) && (await page.isVisible(".statusbar")));

console.log("errors:", JSON.stringify(errors));
await browser.close();
rmSync(second, { recursive: true, force: true });
if (errors.length) process.exit(1);
