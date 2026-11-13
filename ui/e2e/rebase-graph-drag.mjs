// UI scenario for the drag of a commit node in the log graph: a drop between rows opens the rebase editor
// with the move done, a drop on a row opens it with a squash, and a drop on a merge or a protected commit
// opens nothing. rebase-graph-drag.prep.sh builds the topic/plan branch first.
// Run: node e2e/rebase-graph-drag.mjs <repo> <screenshot-dir>.
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
const [, , repo, outDir] = process.argv;
const git = (...args) => execFileSync("git", ["-C", repo, "-c", "commit.gpgsign=false", ...args], { encoding: "utf8" }).trim();

const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const page = await (await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1.5 })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push("pageerror: " + e));
const shot = async (name) => { await page.waitForTimeout(300); await page.screenshot({ path: `${outDir}/${name}.png` }); console.log("shot", name); };
const check = (what, ok) => { console.log(ok ? "ok  " : "FAIL", what); if (!ok) errors.push("check: " + what); };
const within = async (what, fn, ms = 10000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await fn()) return check(what, true); await page.waitForTimeout(150); }
  check(what, false);
};
const row = (subject) => `.log-row:has(.subject-text:text-is("${subject}"))`;
const editorOrder = () => page.$$eval(".rebase-row", (els) => els.map((e) => `${e.querySelector("select").value} ${e.querySelector(".rebase-subject").textContent}`));

/** The center of the node of a row: its lane is in `data-node` of the graph canvas. */
async function nodeOf(subject) {
  const canvas = page.locator(`${row(subject)} canvas`);
  const box = await boxOf(`${row(subject)} canvas`);
  const lane = Number(await canvas.getAttribute("data-node"));
  return { x: box.x + lane * 15 + 7.5, y: box.y + box.height / 2 };
}
/** The box of an element. A row can be drawn again while it is measured: try again. */
async function boxOf(selector) {
  for (let i = 0; i < 20; i++) {
    const b = await page.locator(selector).boundingBox().catch(() => null);
    if (b) return b;
    await page.waitForTimeout(100);
  }
  throw new Error(`no box for ${selector}`);
}
/** Drags the node of `from` to a place in the row of `to`: "above", "below" or "onto" (the middle). */
async function dragNode(from, to, where, { alt = false, hold } = {}) {
  const a = await nodeOf(from);
  const box = await boxOf(row(to));
  const y = where === "onto" ? box.y + box.height / 2 : where === "above" ? box.y + 3 : box.y + box.height - 3;
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(a.x + 4, a.y + 8);
  await page.mouse.move(box.x + 200, y, { steps: 4 });
  if (alt) await page.keyboard.down("Alt");
  if (hold) await hold();
  await page.mouse.up();
  if (alt) await page.keyboard.up("Alt");
}

await page.goto(`${process.env.GITTOR_E2E_URL ?? "http://127.0.0.1:5174"}/?repo=${encodeURIComponent(repo)}`);
await page.waitForSelector(".log-row", { timeout: 30000 });
// The head commit is selected when the repository has loaded.
await page.waitForSelector(".log-row.selected");
const before = git("rev-parse", "HEAD");

// Move C above E: the editor opens with C on top, and the log does not change.
await dragNode("C add util", "E remove util again", "above", { hold: () => shot("graph1-drag-move") });
await page.waitForSelector(".rebase-dialog .rebase-row");
check("the editor shows the move", JSON.stringify((await editorOrder()).slice(0, 3)) === JSON.stringify(["pick C add util", "pick E remove util again", "pick D louder greeting"]));
await within("the editor checked the moved plan", async () => (await page.$$eval(".rebase-status", (e) => e.map((x) => x.textContent))).some((t) => /ok|empty/.test(t)));
await shot("graph2-editor-move");
check("nothing changed before Run", git("rev-parse", "HEAD") === before);
await page.click(".rebase-dialog .dialog-buttons button:has-text('Cancel')");
await page.waitForSelector(".rebase-dialog", { state: "detached" });

// A drop on the middle of a row joins the commit into it: E becomes a fixup of C with Alt.
await dragNode("E remove util again", "C add util", "onto", { alt: true });
await page.waitForSelector(".rebase-dialog .rebase-row");
// The range starts at the older commit of the two, C.
check("the editor shows E as a fixup above C", JSON.stringify(await editorOrder()) === JSON.stringify(["pick D louder greeting", "fixup E remove util again", "pick C add util"]));
await within("the check marks the joined commit empty", async () => (await page.$$eval(".rebase-status", (e) => e.map((x) => x.textContent))).some((t) => t.includes("empty")));
await page.click(".rebase-dialog .dialog-buttons .primary");
await page.waitForSelector(".rebase-dialog", { state: "detached", timeout: 10000 });
await within("the fixup ran: E is gone and C stays", async () => git("log", "--format=%s", "-4") === "D louder greeting\nC add util\nB change notes\nA add notes");

// A drop on a merge commit opens nothing.
await dragNode("D louder greeting", "Merge branch 'fix/readme'", "onto");
await page.waitForTimeout(800);
check("a drop on a merge opens no editor", !(await page.$(".rebase-dialog")));

// A drop on a commit of the protected main opens nothing: a toast says why.
await dragNode("D louder greeting", "Add a binary logo", "below");
await within("a drop on a protected commit says so", async () => ((await page.textContent(".toasts").catch(() => "")) ?? "").includes("protected branch"));
check("a drop on a protected commit opens no editor", !(await page.$(".rebase-dialog")));

if (errors.length) { console.log("errors", errors); process.exit(1); }
console.log("done");
await browser.close();
