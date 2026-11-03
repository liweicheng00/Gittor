// UI scenario for the shortcut hints: a mouse click on a button with a shortcut shows the keys next to
// the mouse. A click from the keyboard, a button without a shortcut, and the setting off show no hint.
// Start the dev server first (see README), then: node e2e/key-hints.mjs <repo> <screenshot-dir>
// Set CHROMIUM to a Chromium binary when Playwright has no downloaded browser.
import { chromium } from "playwright";
const [,, repo, outDir] = process.argv;
const url = `${process.env.GITTOR_E2E_URL ?? "http://127.0.0.1:5174"}/?repo=${encodeURIComponent(repo)}`;

const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const page = await (await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1.5 })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push("pageerror: " + e));
page.on("console", (m) => m.type() === "error" && errors.push("console: " + m.text()));
const shot = async (name) => { await page.screenshot({ path: `${outDir}/${name}.png` }); console.log("shot", name); };
const check = (what, ok) => { console.log(ok ? "ok  " : "FAIL", what); if (!ok) errors.push("check: " + what); };
const within = async (what, fn, ms = 4000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return check(what, true);
    await page.waitForTimeout(100);
  }
  check(what, false);
};
// The text of the hint: its parts with a space between them, or null without a hint.
const hint = () => page.evaluate(() => {
  const el = document.querySelector(".key-hint");
  return el ? [...el.children].map((c) => c.textContent.trim()).filter(Boolean).join(" ") : null;
});
const noHint = async (what) => {
  await page.waitForTimeout(400);
  check(what, (await hint()) === null);
};
// The hint goes away after about 2 s; the same hint shows once in 3 s.
const clearHint = async () => {
  await page.waitForSelector(".key-hint", { state: "detached", timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(1200);
};

await page.goto(url);
await page.waitForSelector(".log-row", { timeout: 30000 });

// A mouse click on Refresh: the hint shows its keys, without the name of the action, next to the mouse.
const refresh = page.locator(".tb-button:has-text('Refresh')");
await refresh.click();
await within("the hint shows only the keys of Refresh", async () => (await hint()) === "Ctrl+R or F5");
const box = await refresh.boundingBox();
const at = await page.evaluate(() => document.querySelector(".key-hint")?.getBoundingClientRect().toJSON());
check("the hint is next to the mouse", !!at && Math.abs(at.x - (box.x + box.width / 2 + 12)) < 4 && at.y > box.y);
await shot("kh1-refresh");
await clearHint();

// The keyboard clicks the button: the user knows the keys already, so no hint.
await refresh.focus();
await page.keyboard.press("Enter");
await noHint("a click from the keyboard shows no hint");

// A button without a shortcut: no hint. The menu part of Update opens the Fetch menu.
await page.click(".tb-split-menu");
await noHint("a button without a shortcut shows no hint");
await page.keyboard.press("Escape");

// A button of the diff: Next change is F7.
await page.click(".log-row >> nth=0");
await page.waitForSelector(".diff-toolbar button[data-key-action='nextChange']");
await page.click(".diff-toolbar button[data-key-action='nextChange']");
await within("the diff button shows F7", async () => (await hint()) === "F7");
await shot("kh2-next-change");
await clearHint();

// The keys that the user set show, not the default keys.
await page.evaluate(() => {
  const s = JSON.parse(localStorage.getItem("gittor.settings.v1") ?? "{}");
  s.keymap = { ...(s.keymap ?? {}), refresh: ["Mod+Shift+R"] };
  localStorage.setItem("gittor.settings.v1", JSON.stringify(s));
});
await page.reload();
await page.waitForSelector(".log-row", { timeout: 30000 });
await refresh.click();
await within("the hint shows the key of the keymap", async () => (await hint()) === "Ctrl+Shift+R");
await clearHint();

// Settings › General turns the hints off.
await page.click("button[title='Settings']");
await within("the Settings button shows its key too", async () => (await hint()) === "Ctrl+Alt+S");
await page.waitForSelector(".settings-row:has-text('Shortcut hints')");
check("the hints are on by default", await page.isChecked(".settings-row:has-text('Shortcut hints') input"));
await page.uncheck(".settings-row:has-text('Shortcut hints') input");
await page.click(".dialog-buttons button:has-text('OK'), .settings-buttons button:has-text('OK')");
await page.waitForSelector(".settings-row", { state: "detached" });
await clearHint();
await refresh.click();
await noHint("no hint when the setting is off");

console.log("errors:", JSON.stringify(errors));
await browser.close();
if (errors.length) process.exit(1);
