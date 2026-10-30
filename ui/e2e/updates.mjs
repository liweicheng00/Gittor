// UI scenario for the updates of the app, with a fake update in the browser: the check after the start,
// the notification, the download with its progress, Restart, and the Updates row of Settings.
// Start the dev server first (see README), then: node e2e/updates.mjs <repo> <screenshot-dir>
// Set CHROMIUM to a Chromium binary when Playwright has no downloaded browser.
import { chromium } from "playwright";
const [,, repo, outDir] = process.argv;
const url = `${process.env.GITTOR_E2E_URL ?? "http://127.0.0.1:5174"}/?repo=${encodeURIComponent(repo)}`;

const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const errors = [];
const open = async (fake) => {
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1.5 });
  if (fake) await context.addInitScript((f) => (window.__GITTOR_FAKE_UPDATE__ = f), fake);
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push("pageerror: " + e));
  page.on("console", (m) => m.type() === "error" && errors.push("console: " + m.text()));
  await page.goto(url);
  await page.waitForSelector(".log-row", { timeout: 30000 });
  return page;
};
const check = (what, ok) => { console.log(ok ? "ok  " : "FAIL", what); if (!ok) errors.push("check: " + what); };
const within = async (page, what, fn, ms = 6000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return check(what, true);
    await page.waitForTimeout(200);
  }
  check(what, false);
};
const shot = async (page, name) => { await page.waitForTimeout(400); await page.screenshot({ path: `${outDir}/${name}.png` }); console.log("shot", name); };
const toastWith = (page, text) => page.$(`.toast:has-text("${text}")`);

// A build with updates: the check runs a few seconds after the start.
const page = await open({ version: "9.9.9", notes: "Better reviews." });
await within(page, "the notification offers the new version", async () => (await toastWith(page, "Gittor 9.9.9 is available.")) !== null, 15000);
check("the notification has the release notes", ((await page.textContent(".toast:has-text('9.9.9')")) ?? "").includes("Better reviews."));
await shot(page, "up1-available");
await page.click(".toast:has-text('9.9.9 is available') .toast-action:has-text('Update')");
await within(page, "the update is ready", async () => (await toastWith(page, "Gittor 9.9.9 is ready")) !== null);
check("the status bar says that the update is ready", ((await page.textContent(".sb-activity")) ?? "").includes("Gittor 9.9.9 is ready"));
await shot(page, "up2-ready");
await page.click(".toast:has-text('is ready') .toast-action:has-text('Restart')");
check("Restart starts the app again", await page.evaluate(() => window.__GITTOR_FAKE_UPDATE__.restarted === true));

// Settings › General: the version, Check Now, and the switch for the automatic check.
await page.click("button[title='Settings']");
await page.waitForSelector(".settings-update");
await within(page, "Settings shows the version", async () => ((await page.textContent(".settings-update-version")) ?? "").startsWith("Version "));
check("the automatic check is on by default", await page.isChecked(".settings-update input[type=checkbox]"));
await page.click(".settings-update-check");
await within(page, "Check Now says that the update is ready", async () => ((await page.textContent(".settings-update .settings-hint")) ?? "").includes("ready"));
await shot(page, "up3-settings");

// A build without updates (a local build): no notification, and Check Now is off.
const local = await open(null);
await local.click("button[title='Settings']");
await local.waitForSelector(".settings-update");
await within(local, "Check Now is off in a build without updates", async () => await local.isDisabled(".settings-update-check"));
check("Settings says why", ((await local.textContent(".settings-update")) ?? "").includes("only a release build"));
await local.keyboard.press("Escape");
await local.waitForTimeout(11000);
check("a build without updates shows no notification", (await toastWith(local, "is available")) === null);

console.log("errors:", JSON.stringify(errors));
await browser.close();
if (errors.length) process.exit(1);
