// UI scenario for Agent mode: the agent button turns the window around, and the back side shows the mods
// of the agent-mode folder. A small fake agent speaks ACP: it streams a reply, asks for permission, and
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
  layout.children.push({ mod: "hello", size: 220 });
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
check("the back side shows the three default mods", (await page.$$(".am-block[data-mod]")).length === 3);
await shot("am2-back-side");

// The fake agent goes into agents.json; the folder name is in the bar.
const dir = await page.textContent(".am-dir");
const saved = Object.fromEntries(["agents.json", "layout.json"].map((f) => [f, readFileSync(join(dir, f), "utf8")]));
writeFileSync(join(dir, "agents.json"), JSON.stringify([{ name: "Fake Agent", command: "node", args: [agentScript], env: {} }]));
await page.click(".am-bar button:has-text('Reload')");
await within("the picker lists the fake agent", async () => (await page.textContent(".x-chat-picker")) === "Fake Agent");
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
await page.waitForSelector(".hello-panel");
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

// The keys of the Git side do not work on the back side; Ctrl+Shift+A turns back.
await page.click(".x-chat-input");
await page.keyboard.press("Control+3");
await page.keyboard.press("Control+Shift+A");
await within("the key turns the window back", async () => (await page.$eval(".agent-mode", (e) => e.hidden)) && !(await page.$("body.am-turning")));
check("the Git side shows again", await page.$eval("#app", (e) => e.style.opacity === "" && !e.inert));
check("Ctrl+3 did not change the left tab", !(await page.$(".lp-tab.active:text-is('Stash')")));
await shot("am6-git-side");

// Clean up: the agent stops and the folder gets its files back.
await api("agent_stop");
for (const [f, text] of Object.entries(saved)) writeFileSync(join(dir, f), text);
rmSync(join(dir, "mods/hello"), { recursive: true, force: true });
rmSync(agentScript, { force: true });

await browser.close();
if (errors.length) {
  console.log(errors.join("\n"));
  process.exit(1);
}
console.log("agent-mode: all checks passed");
