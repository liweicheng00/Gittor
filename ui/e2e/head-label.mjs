// UI scenario for the node of the commit that is checked out: a ring with an "H" in the graph, on a branch
// and on a detached HEAD.
// Start the dev server first (see README). Build a fresh repository with make-demo-repo.sh, then:
// node e2e/head-label.mjs <repo> <screenshot-dir>. Set CHROMIUM to a Chromium binary when Playwright has
// no downloaded browser.
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
const [,, repo, outDir] = process.argv;
const git = (...args) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" }).trim();

const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const page = await (await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1.5 })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push("pageerror: " + e));
page.on("console", (m) => m.type() === "error" && errors.push("console: " + m.text()));
const shot = async (name) => { await page.waitForTimeout(300); await page.screenshot({ path: `${outDir}/${name}.png` }); console.log("shot", name); };
const check = (what, ok) => { console.log(ok ? "ok  " : "FAIL", what); if (!ok) errors.push("check: " + what); };
const within = async (what, fn, ms = 6000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return check(what, true);
    await page.waitForTimeout(100);
  }
  check(what, false);
};
// The ring of HEAD in the canvas of its row: the line of the ring has paint, and the inside above the
// "H" is clear, so no edge goes through it. Null when not exactly one row has the ring.
const ring = () =>
  page.evaluate(() => {
    const c = document.querySelector(".log-row.head canvas[data-head]");
    if (!c || document.querySelectorAll("canvas[data-head]").length !== 1) return null;
    const scale = c.width / c.clientWidth;
    const cx = Number(c.dataset.head) * 15 + 7.5;
    const alpha = (x, y) => c.getContext("2d").getImageData(Math.round(x * scale), Math.round(y * scale), 1, 1).data[3];
    return { line: alpha(cx + 6.5, 11), inside: alpha(cx, 6) };
  });

await page.goto(`${process.env.GITTOR_E2E_URL ?? "http://127.0.0.1:5174"}/?repo=${encodeURIComponent(repo)}`);
await page.waitForSelector(".log-row", { timeout: 30000 });

// On a branch: one ring, on the row of main.
await within("the node of HEAD is a ring with a clear inside", async () => {
  const r = await ring();
  return !!r && r.line > 0 && r.inside === 0;
});
check("the row of the ring has main", ((await page.textContent(".log-row.head .subject")) ?? "").includes("main"));
await shot("hl1-branch");

// A detached HEAD: the ring moves to the commit, which also has the label "detached".
const parent = git("rev-parse", "HEAD~1");
git("checkout", "-q", "--detach", parent);
await page.keyboard.press("F5");
await within("the ring moves to the detached commit", async () => {
  const oid = await page.$eval(".log-row.head .hash", (e) => e.textContent).catch(() => "");
  const r = await ring();
  return parent.startsWith(oid || "-") && !!r && r.line > 0;
});
check("the detached commit has the label detached", ((await page.textContent(".log-row.head .ref-head").catch(() => "")) ?? "") === "detached");
await page.click(".log-row.head .subject-text");
await within("the details say detached too", async () => ((await page.textContent(".details-refs").catch(() => "")) ?? "").includes("detached"));
await shot("hl2-detached");

git("checkout", "-q", "main");
console.log("errors:", JSON.stringify(errors));
await browser.close();
if (errors.length) process.exit(1);
