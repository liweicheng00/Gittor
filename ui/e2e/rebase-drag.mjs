// UI scenario for the interactive rebase editor: the live check of the plan, a drag that makes a conflict,
// Copy for an Agent, a clean reorder with the keyboard, Run, and Undo. rebase-drag.prep.sh builds the
// topic/plan branch first. Run: node e2e/rebase-drag.mjs <repo> <screenshot-dir>.
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
const [, , repo, outDir] = process.argv;
const git = (...args) => execFileSync("git", ["-C", repo, "-c", "commit.gpgsign=false", ...args], { encoding: "utf8" }).trim();

const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const page = await (await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1.5, permissions: ["clipboard-read", "clipboard-write"] })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push("pageerror: " + e));
const shot = async (name) => { await page.waitForTimeout(400); await page.screenshot({ path: `${outDir}/${name}.png` }); console.log("shot", name); };
const check = (what, ok) => { console.log(ok ? "ok  " : "FAIL", what); if (!ok) errors.push("check: " + what); };
const within = async (what, fn, ms = 10000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await fn()) return check(what, true); await page.waitForTimeout(150); }
  check(what, false);
};
const menu = async (label) => { await page.waitForTimeout(400); await page.click(`.menu-item:has-text("${label}")`); };
const row = (subject) => `.log-row:has(.subject-text:text-is("${subject}"))`;
const statuses = () => page.$$eval(".rebase-row .rebase-status", (els) => els.map((e) => e.textContent.trim()));

await page.goto(`${process.env.GITTOR_E2E_URL ?? "http://127.0.0.1:5174"}/?repo=${encodeURIComponent(repo)}`);
await page.waitForSelector(".log-row", { timeout: 30000 });

// Open the editor from the oldest commit of the branch.
await page.click(row("A add notes"), { button: "right" });
await menu("Interactively Rebase from Here");
await page.waitForSelector(".rebase-dialog .rebase-row");
await within("the check finds no conflict at the start", async () => (await statuses()).every((s) => s.includes("ok")));
check("the primary button is Run Rebase", (await page.textContent(".rebase-dialog .dialog-buttons .primary")) === "Run Rebase");
await shot("rebase1-editor");

// Drag B (row 3) to the bottom, below A (row 4): B before A conflicts on notes.md.
const bGrip = await page.locator(".rebase-row").nth(3).locator(".rebase-grip").boundingBox();
const aBox = await page.locator(".rebase-row").nth(4).boundingBox();
await page.mouse.move(bGrip.x + 5, bGrip.y + bGrip.height / 2);
await page.mouse.down();
await page.mouse.move(bGrip.x + 5, bGrip.y + bGrip.height / 2 + 10);
await page.mouse.move(aBox.x + 40, aBox.y + aBox.height - 3);
await page.mouse.up();
await within("the drag makes a conflict on notes.md", async () => (await statuses()).some((s) => s.includes("conflict") && s.includes("notes.md")));
check("the button becomes Run and Stop at the Conflict", (await page.textContent(".rebase-dialog .dialog-buttons .primary")) === "Run and Stop at the Conflict");
await shot("rebase2-conflict");

// Copy for an Agent writes the task to the clipboard.
await page.click(".rebase-dialog .dialog-buttons button:has-text('Copy for an Agent')");
await within("the clipboard holds the agent task", async () => (await page.evaluate(() => navigator.clipboard.readText())).includes("# Rebase task from Gittor"));
const text = await page.evaluate(() => navigator.clipboard.readText());
check("the task names the conflict file", text.includes("CONFLICT in notes.md"));
check("the task keeps empty commits", text.includes("--empty=keep"));

// Reset Plan brings the clean order back.
await page.click(".rebase-dialog .dialog-buttons button:has-text('Reset Plan')");
await within("the plan is clean again", async () => (await statuses()).every((s) => s.includes("ok")));

// A clean reorder with the keyboard: move D above E.
await page.locator(".rebase-row").nth(1).locator("select").focus();
await page.keyboard.press("Alt+ArrowUp");
await within("D is now the top row", async () => (await page.$$eval(".rebase-row .rebase-subject", (e) => e.map((x) => x.textContent)))[0].includes("louder greeting"));
await within("the reordered plan has no conflict", async () => (await statuses()).every((s) => /ok|empty/.test(s)));
await page.click(".rebase-dialog .dialog-buttons .primary");
await page.waitForSelector(".rebase-dialog", { state: "detached", timeout: 10000 });
await within("the rebase swapped D and E", async () => git("log", "--format=%s", "-2") === "D louder greeting\nE remove util again");

// Undo from the toast brings the old order back.
await page.click(".toast:has-text('Interactive rebase') button:has-text('Undo')");
await within("Undo restores the old order", async () => git("log", "--format=%s", "-2") === "E remove util again\nD louder greeting");

if (errors.length) { console.log("errors", errors); process.exit(1); }
console.log("done");
await browser.close();
