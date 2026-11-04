// UI scenario for the marks of collapsed linear branches: each collapsed branch has a ring with a plus
// on its edge. A click on a commit selects it; only a click on the mark expands the branch.
// Start the dev server first (see README). Build a fresh repository with make-demo-repo.sh, then:
// node e2e/collapse-marks.mjs <repo> <screenshot-dir>. The scenario makes a repository next to <repo>.
// Set CHROMIUM to a Chromium binary when Playwright has no downloaded browser.
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
const [,, repo, outDir] = process.argv;

// A history with merged branches. Branches alpha and beta are gone, so their commits can collapse.
const dir = `${repo}-folds`;
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });
const git = (...args) => execFileSync("git", ["-C", dir, "-c", "user.name=Dev", "-c", "user.email=dev@example.com", "-c", "commit.gpgsign=false", ...args], { encoding: "utf8" });
const commit = (file, text, subject) => {
  writeFileSync(`${dir}/${file}`, text);
  git("add", file);
  git("commit", "-q", "-m", subject);
};
git("init", "-q", "-b", "main");
commit("f.txt", "start\n", "Start");
for (const b of ["alpha", "beta", "gamma"]) {
  git("checkout", "-q", "-b", b);
  for (let i = 1; i <= 4; i++) commit(`${b}.txt`, `${i}\n`, `${b} work ${i}`);
  git("checkout", "-q", "main");
  commit("f.txt", `before ${b}\n`, `Main before ${b}`);
  git("merge", "-q", "--no-ff", b, "-m", `Merge ${b}`);
}
git("branch", "-q", "-D", "alpha", "beta");

const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 2 })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push("pageerror: " + e));
page.on("console", (m) => m.type() === "error" && errors.push("console: " + m.text()));
const check = (what, ok) => { console.log(ok ? "ok  " : "FAIL", what); if (!ok) errors.push("check: " + what); };
const within = async (what, fn, ms = 8000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return check(what, true);
    await page.waitForTimeout(100);
  }
  check(what, false);
};
const rows = () => page.$$eval(".log-row", (rs) => rs.length);
const marks = () =>
  page.$$eval(".log-row canvas[data-folds]", (cs) =>
    cs.flatMap((c) => {
      const r = c.getBoundingClientRect();
      return JSON.parse(c.dataset.folds).map(([x, y]) => ({ x: r.x + x, y: r.y + y, row: Number(c.closest(".log-row").dataset.row) }));
    }),
  );

await page.goto(`${process.env.GITTOR_E2E_URL ?? "http://127.0.0.1:5174"}/?repo=${encodeURIComponent(dir)}`);
await page.waitForSelector(".log-row", { timeout: 30000 });
const all = await rows();
await page.click(".graph-tools button[title^='Collapse']");
await within("the linear branches collapse", async () => (await rows()) < all);
const collapsed = await rows();
await within("each collapsed branch has a mark", async () => (await marks()).length >= 2);

// A click on the commit of each row selects it, also where a collapsed edge starts.
let selects = true;
for (let i = 0; i < collapsed; i++) {
  const c = await page.locator(`.log-row[data-row='${i}'] canvas`).boundingBox();
  if (!c) continue;
  for (let lane = 0; lane < 3; lane++) {
    await page.mouse.click(c.x + 7.5 + 15 * lane, c.y + c.height / 2);
    if ((await rows()) !== collapsed) selects = false;
  }
  if ((await page.getAttribute(".log-row.selected", "data-row")) !== String(i)) selects = false;
}
check("a click on a commit selects its row and expands nothing", selects);
await page.mouse.move(0, 0);
const first = await page.locator(".log-row").first().boundingBox();
await page.screenshot({ path: `${outDir}/cm1-marks.png`, clip: { x: first.x, y: first.y, width: 420, height: collapsed * first.height } });

// A click on a mark expands its branch.
const m = (await marks())[0];
await page.mouse.click(m.x, m.y - 1);
await within("a click on the mark expands the branch", async () => (await rows()) > collapsed);

console.log("errors:", JSON.stringify(errors));
await browser.close();
rmSync(dir, { recursive: true, force: true });
if (errors.length) process.exit(1);
