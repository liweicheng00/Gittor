// UI scenario for Agent mode: the agent button turns the window around, and the back side shows the mods
// of the agent-mode folder as cards on a canvas, with edges between them, and the agent window at the
// bottom left. The user folds the window, zooms and drags a card. A small fake agent speaks ACP: it streams a reply, asks for permission, and
// writes a new mod and a new layout through the client. The window loads them at once. A broken mod keeps
// the last version that worked and shows the error. Ctrl+Shift+A turns back.
// Start the dev server first (see README). Build a fresh repository with make-demo-repo.sh, then:
// node e2e/agent-mode.mjs <repo> <screenshot-dir>.
// Set CHROMIUM to a Chromium binary when Playwright has no downloaded browser.
import { chromium } from "playwright";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const [,, repo, outDir] = process.argv;

// The fake agent: JSON-RPC lines on stdin and stdout, as ACP defines.
const agentScript = `${repo}-agent.mjs`;
writeFileSync(
  agentScript,
  String.raw`
import { createInterface } from "node:readline";
const send = (m) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...m }) + "\n");
const waiting = new Map();
let next = 100, cwd = "";
const ask = (method, params) => new Promise((resolve) => { const id = next++; waiting.set(id, resolve); send({ id, method, params }); });
const update = (u) => send({ method: "session/update", params: { sessionId: "s1", update: u } });
createInterface({ input: process.stdin }).on("line", async (line) => {
  const m = JSON.parse(line);
  if (m.method === undefined) return waiting.get(m.id)?.(m.result ?? m.error);
  if (m.method === "initialize") return send({ id: m.id, result: { protocolVersion: 1, agentInfo: { name: "fake", title: "Fake Agent" }, agentCapabilities: {} } });
  if (m.method === "session/new") { cwd = m.params.cwd; return send({ id: m.id, result: { sessionId: "s1" } }); }
  if (m.method !== "session/prompt") return;
  update({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "I will add a " } });
  update({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "hello panel." } });
  update({ sessionUpdate: "tool_call", toolCallId: "t1", title: "Write mods/hello/main.js", kind: "edit", status: "pending" });
  const perm = await ask("session/request_permission", { sessionId: "s1", toolCall: { toolCallId: "t1", title: "Write mods/hello/main.js" },
    options: [{ optionId: "allow", name: "Allow", kind: "allow_once" }, { optionId: "reject", name: "Reject", kind: "reject_once" }] });
  if (perm.outcome?.optionId !== "allow") return send({ id: m.id, result: { stopReason: "cancelled" } });
  const code = 'export default function (root, g) { root.append(g.h("div", { class: "hello-panel" }, "Hello from the agent")); }';
  await ask("fs/write_text_file", { sessionId: "s1", path: cwd + "/mods/hello/main.js", content: code });
  const layout = JSON.parse((await ask("fs/read_text_file", { sessionId: "s1", path: cwd + "/layout.json" })).content);
  const flow = layout.children.find((n) => n.type === "canvas");
  flow.nodes.push({ id: "hello", mod: "hello", title: "Hello", x: 860, y: 250, w: 240 });
  flow.edges.push({ from: "remotes", to: "hello", label: "greets" });
  await ask("fs/write_text_file", { sessionId: "s1", path: cwd + "/layout.json", content: JSON.stringify(layout, null, 2) });
  update({ sessionUpdate: "tool_call_update", toolCallId: "t1", status: "completed" });
  update({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: " Done." } });
  send({ id: m.id, result: { stopReason: "end_turn" } });
});
`,
);

const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const page = await (await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1.5 })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push("pageerror: " + e));
page.on("console", (m) => m.type() === "error" && errors.push("console: " + m.text()));
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
const api = (cmd, body = {}) => page.evaluate(async ([c, b]) => (await fetch(`/api/${c}`, { method: "POST", body: JSON.stringify(b) })).json(), [cmd, body]);

await page.goto(`${process.env.GITTOR_E2E_URL ?? "http://127.0.0.1:5174"}/?repo=${encodeURIComponent(repo)}`);
await page.waitForSelector(".log-row", { timeout: 30000 });

// The button turns the window: the Git side goes away and the back side comes.
// Each half of the turn stops for a moment at 60% of its time, for a screenshot.
const halfTurn = async (name) => {
  await page.waitForFunction(() => document.getAnimations().some((a) => a.playState === "running"));
  await page.evaluate(() => document.getAnimations().forEach((a) => { a.pause(); a.currentTime = 216; }));
  await page.screenshot({ path: `${outDir}/${name}.png` });
  console.log("shot", name);
  await page.evaluate(() => document.getAnimations().forEach((a) => a.play()));
};
await page.click(".tb-agent");
await halfTurn("am1-turning-away");
await page.waitForFunction(() => !document.querySelector(".agent-mode").hidden);
await halfTurn("am1-turning-in");
await page.waitForSelector(".agent-mode:not([hidden]) .x-chat");
await within("the turn ends", async () => !(await page.$("body.am-turning")));
check("the Git side is hidden", await page.$eval("#app", (e) => e.style.opacity === "0" && e.inert));
// A fixed panel at the left, the canvas in the rest of the window, and the agent button at the bottom left.
check("the left column has the Branches panel", (await page.$$eval(".am-panel-title", (els) => els.map((e) => e.textContent))).join(",") === "Branches");
const pillBox = await page.locator(".am-dock-pill").boundingBox();
check("the agent button is small and at the bottom left", pillBox.width < 50 && pillBox.x < 30 && pillBox.y + pillBox.height > 1000 - 30);
const dockBox = await page.locator(".am-dock").boundingBox();
check("the agent window opens above its button", dockBox.x < 30 && dockBox.y + dockBox.height < pillBox.y + 4 && (await page.isVisible(".am-dock .x-chat")));
check("the canvas shows three cards", (await page.$$(".am-card")).length === 3);
check("the card with cards inside looks like a stack", !!(await page.$(".am-card.am-stack[data-node='work']")));
check("the edge has its label", (await page.textContent(".am-edge-label")) === "commit, push");
await within("the panels and cards load their content", async () => (await page.$$(".x-branches-row")).length > 0 && (await page.$$(".x-remotes-row")).length > 0 && !!(await page.$(".x-work-stat")));
await shot("am2-back-side");

// The round button closes and opens the agent window; the fold button of the window closes it too.
await page.click(".am-dock-pill");
check("the button closes the agent window", (await page.isHidden(".am-dock")) && (await page.isVisible(".am-dock-pill")) && !(await page.$(".am-dock-pill.active")));
await shot("am2b-folded");
await page.click(".am-dock-pill");
check("the button opens the agent window again", (await page.isVisible(".am-dock .x-chat")) && !!(await page.$(".am-dock-pill.active")));
await page.click(".am-dock-fold");
check("the fold button closes the window", await page.isHidden(".am-dock"));
await page.click(".am-dock-pill");
check("the window stays open for the next steps", await page.isVisible(".am-dock .x-chat"));

// Ctrl+wheel zooms the canvas; Fit shows all cards again.
const zoomText = () => page.textContent(".am-zoom-label");
const zoomBefore = await zoomText();
const canvasBox = await page.locator(".am-canvas").boundingBox();
await page.mouse.move(canvasBox.x + canvasBox.width - 60, canvasBox.y + canvasBox.height - 120);
await page.keyboard.down("Control");
await page.mouse.wheel(0, -300);
await page.keyboard.up("Control");
await within("Ctrl+wheel zooms in", async () => parseInt(await zoomText()) > parseInt(zoomBefore));
await page.click(".am-fit");
check("Fit goes back", (await zoomText()) === zoomBefore);

// The open button of a card with cards inside flies into it; the trail goes back.
await page.click(".am-card[data-node='work'] .am-card-open");
await page.waitForTimeout(150);
await page.screenshot({ path: `${outDir}/am2c-flying-in.png` });
await page.waitForSelector(".am-card[data-node='changes'] .x-changes");
await within("the inner level shows its two cards", async () => (await page.$$(".am-card")).length === 2 && !(await page.$(".am-flying")));
check("the inner edge shows", (await page.textContent(".am-edge-label")) === "stash");
check("the trail names the open card", (await page.textContent(".am-crumbs")).replace(/\s/g, "") === "Flow›Workinprogress");
await shot("am2d-inside");
await page.click(".am-crumb:text-is('Flow')");
await within("the trail goes back to the top level", async () => (await page.$$(".am-card")).length === 3 && (await page.isHidden(".am-crumbs")) && !(await page.$(".am-flying")));

// A double click on the title of a card without cards opens its detail view; Esc goes back.
await page.dblclick(".am-card[data-node='remotes'] .am-card-title");
await page.waitForSelector(".am-detail:not([hidden]) .x-remotes-detail .x-remotes-subject");
await shot("am2e-detail");
await page.keyboard.press("Escape");
await within("Esc goes back from the detail view", async () => (await page.$$(".am-card")).length === 3 && (await page.isHidden(".am-detail")) && !(await page.$(".am-flying")));

// A zoom past the largest size opens the card under the mouse; a zoom out past the smallest goes back.
const workHead = await page.locator(".am-card[data-node='work'] .am-card-head").boundingBox();
await page.mouse.move(workHead.x + 60, workHead.y + workHead.height + 20);
await page.keyboard.down("Control");
for (let i = 0; i < 12 && (await page.$$(".am-card[data-node='changes']")).length === 0; i++) {
  await page.mouse.wheel(0, -400);
  await page.waitForTimeout(120);
}
await within("a zoom in past 200% opens the card", async () => !!(await page.$(".am-card[data-node='changes']")));
await page.mouse.move(canvasBox.x + canvasBox.width / 2, canvasBox.y + canvasBox.height - 40);
for (let i = 0; i < 12 && (await page.$$(".am-card[data-node='work']")).length === 0; i++) {
  await page.mouse.wheel(0, 400);
  await page.waitForTimeout(120);
}
await page.keyboard.up("Control");
await within("a zoom out past 25% goes back up", async () => !!(await page.$(".am-card[data-node='work']")) && !(await page.$(".am-flying")));

// The fake agent goes into agents.json, next to the workflow folders; the folder of the workflow is in the bar.
const dir = await page.textContent(".am-dir");
const root = join(dir, "..");
check("the first workflow is Main, in its own folder", (await page.textContent(".am-wf-tab.active")).includes("Main") && existsSync(join(dir, "workflow.json")));
const saved = Object.fromEntries([join(root, "agents.json"), join(dir, "layout.json")].map((f) => [f, readFileSync(f, "utf8")]));
writeFileSync(join(root, "agents.json"), JSON.stringify([{ name: "Fake Agent", command: "node", args: [agentScript], env: {} }]));
await page.click(".am-bar button:has-text('Reload')");
await within("the picker lists the fake agent", async () => (await page.textContent(".x-chat-picker")) === "Fake Agent");

// A drag of a card by its title moves it, and its place goes into layout.json.
const hb = await page.locator(".am-card[data-node='intro'] .am-card-head").boundingBox();
await page.mouse.move(hb.x + 40, hb.y + 10);
await page.mouse.down();
await page.mouse.move(hb.x + 140, hb.y + 70, { steps: 6 });
await page.mouse.up();
const introX = () => JSON.parse(readFileSync(join(dir, "layout.json"), "utf8")).children[1].nodes.find((n) => n.id === "intro").x;
await within("the new place is in layout.json", async () => introX() > 40);
check("the canvas keeps its cards after the save", (await page.$$(".am-card")).length === 3);
await page.click(".x-chat-head button:has-text('Start')");
await within("the agent is ready", async () => (await page.textContent(".x-chat-state")).includes("ready"));

// A prompt: the reply streams, then the agent asks for permission.
await page.fill(".x-chat-input", "Add a hello panel");
await page.press(".x-chat-input", "Enter");
await page.waitForSelector(".x-chat-perm button:has-text('Allow')");
check("the reply streams into one message", (await page.textContent(".x-chat-agent")) === "I will add a hello panel.");
await shot("am3-permission");
await page.click(".x-chat-perm button:has-text('Allow')");

// The agent writes a mod and the layout: the window shows the new block, and the chat keeps its log.
await page.waitForSelector(".am-card[data-node='hello'] .hello-panel");
check("the agent connects the new card", (await page.$$(".am-edges g[data-edge]")).length === 2);
check("the agent keeps the place that the user gave", introX() > 40);
await within("the turn of the agent ends", async () => (await page.textContent(".x-chat-state")).includes("ready"));
check("the chat keeps the conversation", (await page.$$eval(".x-chat-agent", (els) => els.map((e) => e.textContent))).join("|") === "I will add a hello panel.| Done.");
check("the tool call is complete", !!(await page.$(".x-chat-tool-completed")));
await shot("am4-new-mod");

// A broken edit keeps the last good version and shows why; the error file is for the agent.
const hello = join(dir, "mods/hello/main.js");
const good = readFileSync(hello, "utf8");
writeFileSync(hello, "export default function (root, g) { root.append(g.h('div', {}, 'broken' }");
await page.waitForSelector(".am-errors:not([hidden])");
check("the error names the mod", (await page.textContent(".am-errors")).includes("mods/hello/main.js"));
check("the last good version stays", !!(await page.$(".hello-panel")));
await within("the error file is written", async () => existsSync(join(dir, "mods/hello/main.error")));
await shot("am5-error");
writeFileSync(hello, good.replace("Hello from the agent", "Hello again"));
await within("a good edit loads at once", async () => (await page.textContent(".hello-panel").catch(() => "")) === "Hello again");
check("the error goes away", await page.$eval(".am-errors", (e) => e.hidden));
await within("the error file goes away", async () => !existsSync(join(dir, "mods/hello/main.error")));

// A new workflow opens in a new tab, in its own folder, with the repository of the Git side as its project.
await page.click(".am-wf-add");
await page.waitForTimeout(400);
await page.click(".menu-item:has-text('New Workflow')");
await page.fill(".overlay .dialog-input >> nth=0", "Release");
await page.click(".overlay button:has-text('Create')");
await within("the new workflow opens in the active tab", async () => ((await page.textContent(".am-wf-tab.active").catch(() => "")) ?? "").includes("Release"));
await page.waitForSelector(".am-card[data-node='work']");
const release = JSON.parse(readFileSync(join(root, "release", "workflow.json"), "utf8"));
check("the workflow keeps its name and project", release.name === "Release" && release.projects.length === 1 && release.projects[0].endsWith(repo.split("/").pop()));
await within("the panels of the new workflow work on its project", async () => (await page.$$(".x-branches-row")).length > 0);
check("the new workflow has its own view: all cards fit", parseInt(await page.textContent(".am-zoom-label")) <= 100);
check("the new workflow has its own agent", !(await page.$(".x-chat-agent")));
await shot("am7-new-workflow");

// Back in Main, a workflow card links to Release: it shows the project, and a click opens the workflow.
await page.click(".am-wf-tab:has-text('Main')");
await page.waitForSelector(".am-card[data-node='hello']");
check("Main keeps its conversation", (await page.$$(".x-chat-agent")).length === 2);
const mainLayout = JSON.parse(readFileSync(join(dir, "layout.json"), "utf8"));
mainLayout.children[1].nodes.push({ id: "to-release", workflow: "release", x: 860, y: 600, w: 260 });
mainLayout.children[1].edges.push({ from: "remotes", to: "to-release", label: "release" });
writeFileSync(join(dir, "layout.json"), JSON.stringify(mainLayout, null, 2));
await page.waitForSelector(".am-card.am-wf-card[data-node='to-release'] .am-wf-chip");
check("the workflow card shows the name and the project", (await page.textContent(".am-wf-card .am-card-title")) === "Release" && (await page.textContent(".am-wf-chip")) === repo.split("/").pop());
await page.click(".am-fit");
await shot("am8-workflow-card");
await page.click(".am-wf-card .am-card-open");
await within("the card opens the workflow", async () => ((await page.textContent(".am-wf-tab.active").catch(() => "")) ?? "").includes("Release") && !(await page.$(".am-card[data-node='hello']")));
await page.click(".am-wf-tab:has-text('Main')");
await page.waitForSelector(".am-card[data-node='to-release']");
await within("the camera is still", async () => !(await page.$(".am-flying")));

// Edit the canvas in the window. A point of the empty canvas, out of the cards and the agent window:
const emptyPoint = () =>
  page.evaluate(() => {
    const r = document.querySelector(".am-canvas").getBoundingClientRect();
    for (let y = r.top + 60; y < r.bottom - 60; y += 30)
      for (let x = r.left + 60; x < r.right - 60; x += 30) {
        const el = document.elementFromPoint(x, y);
        if (el && !el.closest(".am-card, .am-canvas-controls, .am-crumbs, .am-dock, .am-dock-pill, .am-edge-hit")) return { x, y };
      }
    return null;
  });
const layoutNow = () => JSON.parse(readFileSync(join(dir, "layout.json"), "utf8")).children[1];
// A double click on the empty canvas adds a note; Ctrl+Enter saves its text.
const spot = await emptyPoint();
await page.mouse.dblclick(spot.x, spot.y);
await page.waitForSelector(".am-card[data-node='note'] .am-note-edit");
await page.keyboard.type("Plan the release");
await page.keyboard.press("Control+Enter");
await page.waitForSelector(".am-card[data-node='note'] .am-note:text-is('Plan the release')");
await within("the note is in layout.json", async () => layoutNow().nodes.some((n) => n.id === "note" && n.note === "Plan the release"));
// The + button adds a card from a mod.
await page.click(".am-add-card");
await page.waitForTimeout(400);
await page.click(".menu-item:has-text('New Card from a Mod')");
await page.selectOption(".overlay select.dialog-input", "stashes");
await page.click(".overlay button:has-text('Add')");
await page.waitForSelector(".am-card[data-node='stashes'] .x-stashes");
check("the new card is in layout.json", layoutNow().nodes.some((n) => n.id === "stashes" && n.mod === "stashes"));
// A drag from a port of the note to the new card connects them.
await page.click(".am-fit");
const port = await page.locator(".am-card[data-node='note'] .am-port-right").boundingBox();
const target = await page.locator(".am-card[data-node='stashes'] .am-card-head").boundingBox();
await page.mouse.move(port.x + port.width / 2, port.y + port.height / 2);
await page.mouse.down();
await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 8 });
await page.screenshot({ path: `${outDir}/am9-connecting.png` });
await page.mouse.up();
await page.waitForSelector(".am-edges g[data-edge='note>stashes']");
check("the edge is in layout.json", layoutNow().edges.some((e) => e.from === "note" && e.to === "stashes"));
// A double click on the edge gives it a label.
// The edge runs under the cards: take a point of it that no card covers.
const mid = await page.evaluate(() => {
  const p = document.querySelector("g[data-edge='note>stashes'] .am-edge-hit");
  const m = p.getScreenCTM();
  for (let t = 0.5; t > 0.05; t -= 0.05)
    for (const u of [t, 1 - t]) {
      const pt = p.getPointAtLength(p.getTotalLength() * u);
      const at = { x: pt.x * m.a + m.e, y: pt.y * m.d + m.f };
      if (document.elementFromPoint(at.x, at.y) === p) return at;
    }
  return null;
});
await page.mouse.dblclick(mid.x, mid.y);
await page.fill(".overlay .dialog-input >> nth=0", "plan");
await page.click(".overlay button:has-text('Save')");
await page.waitForSelector("g[data-edge='note>stashes'] .am-edge-label");
check("the label is in layout.json", layoutNow().edges.find((e) => e.from === "note").label === "plan");
await shot("am10-edited-canvas");
// The context menu of a card changes its title, and deletes a card with its edges.
await page.click(".am-card[data-node='stashes'] .am-card-head", { button: "right" });
await page.waitForTimeout(400);
await page.click(".menu-item:has-text('Edit the Card')");
await page.fill(".overlay .dialog-input >> nth=0", "Stash list");
await page.click(".overlay button:has-text('Save')");
await page.waitForSelector(".am-card[data-node='stashes'] .am-card-title:text-is('Stash list')");
await page.click(".am-card[data-node='note'] .am-card-head", { button: "right" });
await page.waitForTimeout(400);
await page.click(".menu-item:has-text('Delete the Card')");
await page.click(".overlay button:has-text('Delete')");
await within("the note and its edge go away", async () => !(await page.$(".am-card[data-node='note']")) && !(await page.$("g[data-edge='note>stashes']")));
check("layout.json has no note and no edge of it", !layoutNow().nodes.some((n) => n.id === "note") && !layoutNow().edges.some((e) => e.from === "note"));

// The keys of the Git side do not work on the back side; Ctrl+Shift+A turns back.
await page.click(".x-chat-input");
await page.keyboard.press("Control+3");
await page.keyboard.press("Control+Shift+A");
await within("the key turns the window back", async () => (await page.$eval(".agent-mode", (e) => e.hidden)) && !(await page.$("body.am-turning")));
check("the Git side shows again", await page.$eval("#app", (e) => e.style.opacity === "" && !e.inert));
check("Ctrl+3 did not change the left tab", !(await page.$(".lp-tab.active:text-is('Stash')")));
await shot("am6-git-side");

// Clean up: the agent stops and the folder gets its files back.
await api("agent_stop", { workflow: "main" });
for (const [f, text] of Object.entries(saved)) writeFileSync(f, text);
rmSync(join(dir, "mods/hello"), { recursive: true, force: true });
rmSync(join(root, "release"), { recursive: true, force: true });
rmSync(agentScript, { force: true });

await browser.close();
if (errors.length) {
  console.log(errors.join("\n"));
  process.exit(1);
}
console.log("agent-mode: all checks passed");
