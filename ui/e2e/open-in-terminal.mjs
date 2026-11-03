// UI scenario for Open in Terminal: choose the terminal in the settings, then open it with the Terminal
// button and with Alt+F12. A small script stands in for the terminal and writes its folder and its
// arguments to a file. A missing program shows an error.
// Start the dev server first (see README). Build a fresh repository with make-demo-repo.sh, then:
// node e2e/open-in-terminal.mjs <repo> <screenshot-dir>.
// Set CHROMIUM to a Chromium binary when Playwright has no downloaded browser.
import { chromium } from "playwright";
import { chmodSync, existsSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
const [,, repo, outDir] = process.argv;
const script = `${repo}-terminal.sh`;
const log = `${repo}-terminal.log`;
writeFileSync(script, `#!/bin/sh\n{ pwd; printf '%s\\n' "$@"; } > '${log}'\n`);
chmodSync(script, 0o755);
const opened = () => (existsSync(log) ? readFileSync(log, "utf8").trim() : "");
const root = realpathSync(repo);

const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const page = await (await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1.5 })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push("pageerror: " + e));
// The missing program below fails on purpose.
page.on("console", (m) => m.type() === "error" && !m.text().includes("status of 400") && errors.push("console: " + m.text()));
const shot = async (name) => { await page.waitForTimeout(400); await page.screenshot({ path: `${outDir}/${name}.png` }); console.log("shot", name); };
const check = (what, ok) => { console.log(ok ? "ok  " : "FAIL", what); if (!ok) errors.push("check: " + what); };
const within = async (what, fn, ms = 8000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return check(what, true);
    await page.waitForTimeout(100);
  }
  check(what, false);
};
// The dialog closes before the backend saves the setting. Wait for the saved value.
const savedSetting = (key, value) =>
  within(`the backend keeps the ${key} command`, async () =>
    page.evaluate(async ([k, v]) => (await (await fetch("/api/backend_settings", { method: "POST", body: "{}" })).json())[k] === v, [key, value]));
const setTerminal = async (command) => {
  await page.click(".tb-button[title='Settings']");
  await page.waitForSelector(".settings-dialog");
  await page.click(".settings-page:has-text('Terminal')");
  if (command === null) return;
  await page.fill(".terminal-command", command);
  await page.click(".settings-dialog .dialog-buttons button:has-text('OK')");
  await page.waitForSelector(".settings-dialog", { state: "detached" });
  await savedSetting("terminal", command);
};

await page.goto(`${process.env.GITTOR_E2E_URL ?? "http://127.0.0.1:5174"}/?repo=${encodeURIComponent(repo)}`);
await page.waitForSelector(".log-row", { timeout: 30000 });
check("the toolbar has the Terminal button", await page.isEnabled(".tb-terminal"));

// The Terminal page: a preset fills the command.
await setTerminal(null);
await page.selectOption(".terminal-preset", { label: "iTerm2" });
check("the preset fills the command", (await page.inputValue(".terminal-command")) === "open -a iTerm {dir}");
await shot("ot1-settings");
await page.fill(".terminal-command", `${script} --cwd {dir}`);
check("another command shows as Other command", (await page.$eval(".terminal-preset", (e) => e.selectedOptions[0].textContent)) === "Other command");
await page.click(".settings-dialog .dialog-buttons button:has-text('OK')");
await page.waitForSelector(".settings-dialog", { state: "detached" });
await savedSetting("terminal", `${script} --cwd {dir}`);

// The button opens the terminal in the folder of the repository, and {dir} names the folder.
await page.click(".tb-terminal");
await within("the button opens the terminal in the repository", async () => opened() === `${root}\n--cwd\n${repo}`);
await within("the click shows the key of the button", async () => ((await page.textContent(".key-hint").catch(() => "")) ?? "").includes("Alt+F12"));
await shot("ot2-button");

// Alt+F12 does the same.
rmSync(log, { force: true });
await page.click(".log-row >> nth=1");
await page.keyboard.press("Alt+F12");
await within("Alt+F12 opens the terminal", async () => opened().startsWith(root));

// A program that does not exist shows an error.
await setTerminal("no-such-terminal-xyz");
await page.click(".tb-terminal");
await within("a missing program shows an error", async () => ((await page.textContent(".toasts").catch(() => "")) ?? "").includes("Cannot find the terminal program no-such-terminal-xyz"));
await setTerminal("");
rmSync(script, { force: true });
rmSync(log, { force: true });
console.log("errors:", JSON.stringify(errors));
await browser.close();
if (errors.length) process.exit(1);
