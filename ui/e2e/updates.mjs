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
  // The first check comes 1 s after the start, not 10 s.
  await context.addInitScript(() => (window.__GITTOR_FIRST_UPDATE_CHECK_MS__ = 1000));
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
// The fake download has 4 steps of 600 ms, and the first download fails at half.
const page = await open({ version: "9.9.9", notes: "Better reviews.", stepMs: 600, failures: 1 });
await within(page, "the notification offers the new version", async () => (await toastWith(page, "Gittor 9.9.9 is available.")) !== null, 15000);
check("the notification has the release notes", ((await page.textContent(".toast:has-text('9.9.9')")) ?? "").includes("Better reviews."));
await shot(page, "up1-available");
// The card of the offer shows the download: the text with the percent, and a bar.
const card = await toastWith(page, "Gittor 9.9.9 is available.");
await page.click(".toast:has-text('9.9.9 is available') .toast-action:has-text('Update')");
const bar = () =>
  card.evaluate((el) => {
    const p = el.querySelector(".toast-progress");
    return p && !p.hidden ? Number(p.getAttribute("aria-valuenow") ?? -1) : null;
  });
const cardText = async () => (await card.textContent()) ?? "";
await within(page, "the card shows the download with its progress", async () => {
  const v = await bar();
  return v !== null && v > 0 && v < 100 && /Downloading Gittor 9\.9\.9… \d+%/.test(await cardText());
});
check("the card has no button while it downloads", (await card.$(".toast-action")) === null);
await shot(page, "up1b-progress");
// The download fails: the same card says so, and offers Try Again.
await within(page, "the same card shows the error", async () => (await cardText()).includes("The update failed: The connection was lost"));
check("the error card has Try Again and no bar", (await card.$(".toast-action:has-text('Try Again')")) !== null && (await bar()) === null);
await shot(page, "up1c-failed");
await (await card.$(".toast-action:has-text('Try Again')")).click();
// The second download works: the same card says that the update is ready, with Restart.
await within(page, "the same card says that the update is ready", async () => (await cardText()).includes("Gittor 9.9.9 is ready"), 8000);
check("only one card for the update", (await page.$$(".toast:has-text('9.9.9')")).length === 1);
check("the status bar says that the update is ready", ((await page.textContent(".sb-activity")) ?? "").includes("Gittor 9.9.9 is ready"));
await shot(page, "up2-ready");
await (await card.$(".toast-action:has-text('Restart')")).click();
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
// The first check of a build with updates comes after 1 s: wait longer than that.
await local.waitForTimeout(2500);
check("a build without updates shows no notification", (await toastWith(local, "is available")) === null);

console.log("errors:", JSON.stringify(errors));
await browser.close();
if (errors.length) process.exit(1);
