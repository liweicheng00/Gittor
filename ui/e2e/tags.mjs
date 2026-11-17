// UI scenario for tags: the Tags group sorts by version, marks the tags that the remote does not have (at
// the open, in the background, and after a fetch), the log marks them too and its menu pushes one, the
// commit details show the tag message, and Push All Tags sends the local tags.
// Start the dev server first (see README). Build a fresh repository with make-demo-repo.sh, then:
// node e2e/tags.mjs <repo> <screenshot-dir>.
// Set CHROMIUM to a Chromium binary when Playwright has no downloaded browser.
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
const [,, repo, outDir] = process.argv;
const git = (...args) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" }).replace(/\s+$/, "");
git("config", "tag.gpgSign", "false");
git("tag", "-a", "v0.10.0", "-m", "Release 0.10.0\n\nThe tenth minor release.", "main");
git("tag", "v0.9.0", "main~1");

const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const page = await (await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1.5 })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push("pageerror: " + e));
const shot = async (name) => { await page.waitForTimeout(500); await page.screenshot({ path: `${outDir}/${name}.png` }); console.log("shot", name); };
const check = (what, ok) => { console.log(ok ? "ok  " : "FAIL", what); if (!ok) errors.push("check: " + what); };
const within = async (what, fn, ms = 10000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return check(what, true);
    await page.waitForTimeout(200);
  }
  check(what, false);
};
const tagRows = () => page.$$eval(".sidebar .branch-tag", (els) => els.map((e) => e.querySelector(".branch-name").textContent + (e.querySelector(".tag-local") ? " local" : "")));

await page.goto(`${process.env.GITTOR_E2E_URL ?? "http://127.0.0.1:5174"}/?repo=${encodeURIComponent(repo)}`);
await page.waitForSelector(".sidebar .branch", { timeout: 30000 });
await page.click(".group-header:has-text('Tags')");

// Newest version first: v0.10.0 before v0.9.0. The open checks origin in the background and marks the
// tags that origin does not have.
await within("the tags sort by version, and the local tags are marked at the open", async () => (await tagRows()).join(",") === "v0.10.0 local,v0.9.0 local,v0.2.0,v0.1.0");

// The log marks them too: a dashed label with an arrow up.
const logTag = (name) => page.$eval(`.log-row .ref-tag[data-ref='${name}']`, (e) => e.classList.contains("ref-unpushed")).catch(() => null);
await within("the log marks the tags that origin does not have", async () => (await logTag("v0.10.0")) === true && (await logTag("v0.9.0")) === true && (await logTag("v0.2.0")) === false);
check("the tooltip of the label says so", ((await page.getAttribute(".log-row .ref-tag[data-ref='v0.10.0']", "title")) ?? "").includes("Not on origin"));
await shot("tag0-log-marks");

// A fetch checks again, and the marks stay.
await page.click(".tb-split-menu");
await page.click(".menu-item:has-text('Fetch All Remotes')");
await within("the local tags are marked after a fetch", async () => (await tagRows()).join(",") === "v0.10.0 local,v0.9.0 local,v0.2.0,v0.1.0");

// The menu of the commit pushes its tag.
await page.click(".log-row:has(.ref-tag[data-ref='v0.9.0'])", { button: "right" });
await page.waitForTimeout(400);
await page.click(".menu-item:has-text('Push Tag v0.9.0 to origin')");
await within("the pushed tag has no mark", async () => (await logTag("v0.9.0")) === false && (await logTag("v0.10.0")) === true);
check("origin has v0.9.0", git("ls-remote", "--tags", "--refs", "origin").includes("refs/tags/v0.9.0"));

// The details of an annotated tag and of a lightweight tag.
await page.click(".sidebar .branch-tag:has-text('v0.10.0')");
await within("the tag card shows the message", async () => ((await page.textContent(".tag-cards").catch(() => "")) ?? "").includes("The tenth minor release."));
check("the card shows the tagger", ((await page.textContent(".tag-card-meta")) ?? "").includes("Ada Lovelace"));
await shot("tag1-card");
await page.click(".sidebar .branch-tag:has-text('v0.9.0')");
await within("a lightweight tag says so", async () => ((await page.textContent(".tag-cards").catch(() => "")) ?? "").includes("lightweight tag"));

// Push All Tags from the menu of the Tags group.
await page.click(".group-header:has-text('Tags')", { button: "right" });
await page.click(".menu-item:has-text('Push All Tags to origin')");
await within("no tag is local after the push", async () => !(await tagRows()).some((t) => t.endsWith("local")) && (await logTag("v0.10.0")) === false);
const remote = git("ls-remote", "--tags", "--refs", "origin");
check("origin has the new tags", remote.includes("refs/tags/v0.10.0") && remote.includes("refs/tags/v0.9.0"));
console.log("errors:", JSON.stringify(errors));
await browser.close();
if (errors.length) process.exit(1);
