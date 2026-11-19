// UI scenario for the reset buttons of Settings › Keymap. A reset shows the default keys at once, also
// while a key waits for a press. A key recorded after a reset keeps the other default keys of the action,
// not the old keys of the user. A reset button without a change is disabled.
// Start the dev server first (see README). Build a fresh repository with make-demo-repo.sh, then:
// node e2e/keymap-reset.mjs <repo> <screenshot-dir>.
// Set CHROMIUM to a Chromium binary when Playwright has no downloaded browser.
import { chromium } from "playwright";
const [,, repo, outDir] = process.argv;

const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1.5 });
// Keys of the user before the start: Refresh and Stash have their own keys.
await context.addInitScript(() => {
  if (sessionStorage.getItem("keymap-seeded")) return;
  sessionStorage.setItem("keymap-seeded", "1");
  const s = JSON.parse(localStorage.getItem("gittor.settings.v1") ?? "{}");
  s.keymap = { refresh: ["Mod+Shift+R"], stash: ["Mod+9"] };
  localStorage.setItem("gittor.settings.v1", JSON.stringify(s));
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push("pageerror: " + e));
page.on("console", (m) => m.type() === "error" && errors.push("console: " + m.text()));
const shot = async (name) => { await page.screenshot({ path: `${outDir}/${name}.png` }); console.log("shot", name); };
const check = (what, ok) => { console.log(ok ? "ok  " : "FAIL", what); if (!ok) errors.push("check: " + what); };
const within = async (what, fn, ms = 5000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return check(what, true);
    await page.waitForTimeout(100);
  }
  check(what, false);
};
const row = (label) => page.locator(".keymap-row", { has: page.locator(`.keymap-label:text-is('${label}')`) });
const chips = (label) => row(label).locator(".key-chip").allTextContents();
const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem("gittor.settings.v1") ?? "{}").keymap);
const openKeymap = async () => {
  await page.click("button[title^='Settings']");
  await page.click(".settings-page:has-text('Keymap')");
  await page.waitForSelector(".keymap-row");
};
const ok = async () => {
  await page.click(".dialog-buttons button:has-text('OK'), .settings-buttons button:has-text('OK')");
  await page.waitForSelector(".keymap-row", { state: "detached" });
};

await page.goto(`${process.env.GITTOR_E2E_URL ?? "http://127.0.0.1:5174"}/?repo=${encodeURIComponent(repo)}`);
await page.waitForSelector(".log-row", { timeout: 30000 });
await openKeymap();
check("the page shows the keys of the user", JSON.stringify(await chips("Refresh")) === JSON.stringify(["Ctrl+Shift+R"]));
check("a row without a change has a disabled reset", await row("Fetch All Remotes").locator("button[title='Use the default keys']").isDisabled().catch(() => true));

// A key waits for a press; the reset of its row shows the default keys at once.
await row("Refresh").locator(".key-chip").first().click();
await within("the chip waits for a key", async () => (await chips("Refresh"))[0] === "Press a key…");
await row("Refresh").locator("button[title='Use the default keys']").click();
await within("the reset shows the default keys of Refresh", async () => JSON.stringify(await chips("Refresh")) === JSON.stringify(["Ctrl+R", "F5"]));
await shot("kr1-reset-row");

// Reset All, then a new second key for Stash: its first key is the default, not the old key of the user.
await page.click("button:has-text('Reset All Keys')");
await within("Reset All shows the default key of Stash", async () => JSON.stringify(await chips("Stash Tab")) === JSON.stringify(["Ctrl+4"]));
await row("Stash Tab").locator("button[title='Add a key']").click();
await page.keyboard.press("Control+Shift+9");
await within("the new key comes after the default key", async () => JSON.stringify(await chips("Stash Tab")) === JSON.stringify(["Ctrl+4", "Ctrl+Shift+9"]));
await ok();
const keys = await saved();
check("the saved keymap has only the new keys of Stash", JSON.stringify(keys) === JSON.stringify({ stash: ["Mod+4", "Mod+Shift+9"] }));

// Reset All again and save: no key of the user stays.
await openKeymap();
await page.click("button:has-text('Reset All Keys')");
await ok();
check("Reset All saves no key of the user", JSON.stringify(await saved()) === "{}");

console.log("errors:", JSON.stringify(errors));
await browser.close();
if (errors.length) process.exit(1);
