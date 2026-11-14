// The stage of the videos: the page size, the overlay (cursor, click rings, fake windows, a fake terminal),
// the Director that moves the mouse, and the loop that records each scene with Playwright.
// record.mjs (the intro video) and shorts-record.mjs (the short videos) use it.
// Set CHROMIUM to a Chromium binary when Playwright has no downloaded browser.
import { createRequire } from "node:module";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const root = resolve(here, "../..");
const { chromium } = createRequire(join(root, "ui/package.json"))("playwright");
export const git = (dir, ...args) => execFileSync("git", ["-C", dir, "-c", "commit.gpgsign=false", ...args], { encoding: "utf8" }).trim();

// The page is 1600x900. The build scales the video to 1920x1080, so the text is larger than at 1920x1080.
// A larger device scale does not help: the video keeps the CSS pixels.
export const VIEW = { width: 1600, height: 900 };

/** A cursor and a ring on each click, because the video does not show the mouse. A fake window frame
 * for window.open, because a popup records to another file. */
export const overlayScript = () => {
  if (window.top !== window) return;
  const css = `
    #vid-cursor { position: fixed; left: 0; top: 0; width: 22px; height: 22px; z-index: 2147483647;
      pointer-events: none; transform: translate(-3px, -2px); filter: drop-shadow(0 1px 2px rgba(0,0,0,.6)); }
    .vid-ring { position: fixed; z-index: 2147483646; pointer-events: none; width: 44px; height: 44px;
      margin: -22px 0 0 -22px; border-radius: 50%; border: 3px solid #ffb02e; background: rgba(255,176,46,.25);
      animation: vid-ring .55s ease-out forwards; }
    .vid-ring.right { border-color: #4da3ff; background: rgba(77,163,255,.25); }
    @keyframes vid-ring { from { transform: scale(.3); opacity: 1; } to { transform: scale(1.4); opacity: 0; } }
    .vid-window { position: fixed; z-index: 2147483000; border-radius: 10px; overflow: hidden;
      box-shadow: 0 18px 60px rgba(0,0,0,.65); border: 1px solid #555; background: #1e1f22;
      animation: vid-open .25s ease-out; }
    @keyframes vid-open { from { transform: scale(.92); opacity: 0; } to { transform: none; opacity: 1; } }
    .vid-titlebar { height: 28px; display: flex; align-items: center; gap: 8px; padding: 0 12px;
      background: #2b2d30; color: #bbb; font: 12px system-ui; }
    .vid-titlebar i { width: 12px; height: 12px; border-radius: 50%; display: inline-block; }
    .vid-window iframe { border: 0; display: block; }
    .vid-clipboard { position: fixed; z-index: 2147483000; right: 24px; bottom: 110px; width: 360px;
      background: #1b1c1f; color: #ddd; border: 1px solid #4da3ff; border-radius: 8px; padding: 10px 14px;
      font: 12px/1.45 ui-monospace, monospace; white-space: pre-wrap; box-shadow: 0 10px 40px rgba(0,0,0,.6);
      animation: vid-open .25s ease-out; }
    .vid-keys { position: fixed; z-index: 2147483000; left: 50%; top: 38%; transform: translateX(-50%);
      padding: 14px 26px; border-radius: 14px; background: rgba(20, 22, 27, 0.92); color: #fff;
      border: 1px solid rgba(255, 255, 255, 0.18); font: 600 34px/1 system-ui; letter-spacing: .02em;
      box-shadow: 0 12px 40px rgba(0,0,0,.5); animation: vid-open .18s ease-out; pointer-events: none; }
    .vid-term { background: #0d1117; border-color: #3d444d; transition: transform .35s ease, opacity .35s ease; }
    .vid-term pre { margin: 0; padding: 14px 18px; height: calc(100% - 28px); box-sizing: border-box; overflow: hidden;
      color: #d1d7e0; font: 14px/1.5 ui-monospace, "DejaVu Sans Mono", monospace; white-space: pre-wrap; }
    .vid-term .dim { color: #7d8590; } .vid-term .ok { color: #3fb950; } .vid-term .add { color: #3fb950; }
    .vid-term .del { color: #f85149; } .vid-term .hi { color: #79c0ff; } .vid-term .you { color: #ffb02e; }
    .vid-term .caret { display: inline-block; width: 9px; height: 18px; background: #d1d7e0; vertical-align: -3px;
      animation: vid-blink 1s steps(1) infinite; }
    @keyframes vid-blink { 50% { opacity: 0; } }
    .vid-clipboard b { display: block; font: 600 11px system-ui; color: #4da3ff; margin-bottom: 6px;
      text-transform: uppercase; letter-spacing: .06em; }`;
  const arrow = `<svg viewBox="0 0 22 22" width="22" height="22"><path d="M3 2 L3 18 L7.5 14 L10.5 20.5 L13.5 19.2 L10.6 12.8 L16.5 12.8 Z" fill="#fff" stroke="#000" stroke-width="1.3" stroke-linejoin="round"/></svg>`;
  const install = () => {
    const style = document.createElement("style");
    style.textContent = css;
    document.head.append(style);
    const cursor = document.createElement("div");
    cursor.id = "vid-cursor";
    cursor.innerHTML = arrow;
    cursor.style.left = "720px";
    cursor.style.top = "420px";
    document.body.append(cursor);
    const at = (e) => { cursor.style.left = `${e.clientX}px`; cursor.style.top = `${e.clientY}px`; };
    for (const t of ["mousemove", "mousedown", "mouseup", "dragover"]) addEventListener(t, at, true);
    addEventListener("mousedown", (e) => {
      const ring = document.createElement("div");
      ring.className = e.button === 2 ? "vid-ring right" : "vid-ring";
      ring.style.left = `${e.clientX}px`;
      ring.style.top = `${e.clientY}px`;
      document.body.append(ring);
      setTimeout(() => ring.remove(), 700);
    }, true);
    // Keep the cursor last, above dialogs and menus that open later.
    new MutationObserver(() => { if (document.body.lastElementChild !== cursor) document.body.append(cursor); })
      .observe(document.body, { childList: true });
  };
  if (document.body) install();
  else addEventListener("DOMContentLoaded", install);
  window.open = (url) => {
    const box = document.createElement("div");
    box.className = "vid-window";
    const w = Math.round(innerWidth * 0.62);
    const h = Math.round(innerHeight * 0.66);
    const x = Math.min(Math.max(window.__vidMouse?.x ?? 300, 20), innerWidth - w - 20);
    const y = Math.min(Math.max(window.__vidMouse?.y ?? 200, 20), innerHeight - h - 20);
    Object.assign(box.style, { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h + 28}px` });
    const name = new URL(url, location.href).searchParams.get("repo")?.split("/").pop() ?? "Gittor";
    box.innerHTML = `<div class="vid-titlebar"><i style="background:#ff5f57"></i><i style="background:#febc2e"></i><i style="background:#28c840"></i><span style="margin-left:8px">${name} — Gittor</span></div>`;
    const frame = document.createElement("iframe");
    frame.src = url;
    frame.width = String(w);
    frame.height = String(h);
    box.append(frame);
    document.body.append(box);
    return null;
  };
  addEventListener("mousemove", (e) => { window.__vidMouse = { x: e.clientX, y: e.clientY }; }, true);
  // The video does not show the keyboard: a badge shows the keys that the director presses.
  window.__vidKeys = (text) => {
    document.querySelectorAll(".vid-keys").forEach((e) => e.remove());
    const box = document.createElement("div");
    box.className = "vid-keys";
    box.textContent = text;
    document.body.append(box);
    setTimeout(() => box.remove(), 1300);
  };
  // A fake terminal, for the scenes where the user gives notes to a coding agent. The lines are HTML.
  window.__vidTerm = {
    open({ x, y, w, h, title }) {
      const box = document.createElement("div");
      box.className = "vid-window vid-term";
      Object.assign(box.style, { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px` });
      box.innerHTML = `<div class="vid-titlebar"><i style="background:#ff5f57"></i><i style="background:#febc2e"></i><i style="background:#28c840"></i><span style="margin-left:8px">${title}</span></div><pre></pre>`;
      document.body.append(box);
      this.box = box;
      this.pre = box.querySelector("pre");
      this.caret = document.createElement("span");
      this.caret.className = "caret";
      this.pre.append(this.caret);
    },
    /** Adds HTML before the caret. */
    print(html) {
      this.caret.insertAdjacentHTML("beforebegin", html);
      this.pre.scrollTop = this.pre.scrollHeight;
    },
    close() { this.box?.remove(); },
  };
  window.__vidClipboard = (text) => {
    const box = document.createElement("div");
    box.className = "vid-clipboard";
    box.innerHTML = "<b>Clipboard</b>";
    box.append(text);
    document.body.append(box);
  };
};

/** Mouse moves that a viewer can follow. */
export class Director {
  constructor(page, view = VIEW) {
    this.page = page;
    this.x = view.width / 2;
    this.y = view.height / 2;
    this.t0 = Date.now();
    /** Seconds from the start of the scene, by name. The build places captions and music on them. */
    this.marks = {};
    /** The places of the camera, in order. */
    this.cams = [];
  }
  mark(name) { this.marks[name] = (Date.now() - this.t0) / 1000; }
  /**
   * Points the camera of the build at the page ("full") or at the box around some elements. The build
   * moves from the last place to this one. `zoom` sets the scale; without it the box fills the frame.
   * `align` ("top", "left" or "top left") puts that edge of the box at the edge of the frame; without it
   * the middle of the box is in the middle.
   */
  async cam(target = "full", { pad = 16, zoom, align = "" } = {}) {
    let box = null;
    if (target !== "full") {
      for (const sel of [].concat(target)) {
        const b = await this.page.locator(sel).first().boundingBox();
        if (!b) continue;
        const u = box ?? { x1: b.x, y1: b.y, x2: b.x + b.width, y2: b.y + b.height };
        box = { x1: Math.min(u.x1, b.x), y1: Math.min(u.y1, b.y), x2: Math.max(u.x2, b.x + b.width), y2: Math.max(u.y2, b.y + b.height) };
      }
    }
    const round = (v) => Math.round(v);
    this.cams.push({ t: +((Date.now() - this.t0) / 1000).toFixed(2), zoom, align, box: box && { x: round(box.x1 - pad), y: round(box.y1 - pad), w: round(box.x2 - box.x1 + 2 * pad), h: round(box.y2 - box.y1 + 2 * pad) } });
  }
  wait(ms) { return this.page.waitForTimeout(ms); }
  async point(target, dx = 0, dy = 0) {
    if (typeof target !== "string") return target;
    const loc = this.page.locator(target).first();
    await loc.waitFor({ state: "visible", timeout: 15000 });
    await loc.scrollIntoViewIfNeeded();
    const b = await loc.boundingBox();
    return { x: b.x + b.width / 2 + dx, y: b.y + b.height / 2 + dy };
  }
  async move(target, { dx = 0, dy = 0, ms } = {}) {
    const p = await this.point(target, dx, dy);
    const dist = Math.hypot(p.x - this.x, p.y - this.y);
    const time = ms ?? Math.min(900, Math.max(300, dist * 1.1));
    const steps = Math.max(8, Math.round(time / 16));
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
      await this.page.mouse.move(this.x + (p.x - this.x) * e, this.y + (p.y - this.y) * e);
      await this.page.waitForTimeout(time / steps / 2);
    }
    this.x = p.x;
    this.y = p.y;
    return p;
  }
  async click(target, opts = {}) {
    await this.move(target, opts);
    await this.wait(opts.before ?? 250);
    const button = opts.button ?? "left";
    if (opts.modifiers) for (const m of opts.modifiers) await this.page.keyboard.down(m);
    if (opts.double) await this.page.mouse.dblclick(this.x, this.y, { button });
    else await this.page.mouse.click(this.x, this.y, { button });
    if (opts.modifiers) for (const m of opts.modifiers) await this.page.keyboard.up(m);
    await this.wait(opts.after ?? 450);
  }
  /** Clicks a menu item. A menu ignores a click right after it opens. */
  async menu(label) {
    await this.wait(450);
    await this.click(`.menu-item:has-text("${label}")`);
  }
  /** Presses keys and shows them in a badge, for example keys("Alt+2"). */
  async keys(combo, label = combo) {
    await this.page.evaluate((t) => window.__vidKeys(t), label);
    await this.wait(250);
    await this.page.keyboard.press(combo);
  }
  async type(text, delay = 55) {
    await this.page.keyboard.type(text, { delay });
  }
  async drag(from, to, { ms = 1200 } = {}) {
    await this.move(from);
    await this.wait(250);
    await this.page.mouse.down();
    await this.move(to, { ms });
    await this.wait(250);
    await this.page.mouse.up();
  }
}

export const row = (subject) => `.log-row:has(.subject-text:text-is("${subject}"))`;

/**
 * Records the scenes. Each scene gets fresh repositories, a fresh dev server, a fresh browser context
 * and its own video file: the server keeps the data of an open repository.
 * `out` gets <scene>.webm and scenes.json (the start, the duration and the marks of each scene).
 * `prep` of a scene changes the repositories before the page opens. `setup` prepares the page.
 * `css` is a style sheet for the page of each scene. `view` is the size of the page.
 */
export async function recordScenes({ scenes, work, out, only = [], makeRepos, settings: preset, css = "", view = VIEW }) {
  mkdirSync(out, { recursive: true });
  const port = process.env.VIDEO_PORT ?? "5191";
  const base = `http://127.0.0.1:${port}`;
  const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
  const meta = existsSync(join(out, "scenes.json")) ? JSON.parse(readFileSync(join(out, "scenes.json"), "utf8")) : {};
  for (const scene of scenes) {
    if (only.length && !only.includes(scene.name)) continue;
    execFileSync(makeRepos, [work], { stdio: "ignore" });
    const cfg = join(out, "cfg");
    rmSync(cfg, { recursive: true, force: true });
    mkdirSync(cfg);
    const server = spawn(join(root, "target/debug/gittor-devserver"), [join(root, "ui/dist"), port], { env: { ...process.env, GITTOR_CONFIG_DIR: cfg }, stdio: "ignore" });
    for (let i = 0; ; i++) {
      if (await fetch(`${base}/`).then((r) => r.ok, () => false)) break;
      if (i > 100) throw new Error("the dev server does not start");
      await new Promise((r) => setTimeout(r, 100));
    }
    scene.prep?.();
    const tmp = join(out, `tmp-${scene.name}`);
    rmSync(tmp, { recursive: true, force: true });
    const context = await browser.newContext({ viewport: view, recordVideo: { dir: tmp, size: view } });
    await context.addInitScript((s) => {
      if (sessionStorage.getItem("vid-init")) return;
      sessionStorage.setItem("vid-init", "1");
      localStorage.setItem("gittor.settings.v1", JSON.stringify(s));
    }, preset(scene.settings?.() ?? {}));
    await context.addInitScript(overlayScript);
    if (css) {
      await context.addInitScript((text) => addEventListener("DOMContentLoaded", () => {
        const style = document.createElement("style");
        style.textContent = text;
        document.head.append(style);
      }), css);
    }
    const page = await context.newPage();
    const t0 = Date.now();
    page.on("pageerror", (e) => console.log(`[${scene.name}] pageerror: ${e}`));
    await page.goto(`${base}/`);
    await page.waitForSelector(".log-row", { timeout: 30000 });
    await page.waitForTimeout(1200);
    const d = new Director(page, view);
    await page.mouse.move(d.x, d.y);
    // `setup` runs before the part of the recording that the video shows.
    await scene.setup?.(d);
    const start = (Date.now() - t0) / 1000;
    d.t0 = Date.now();
    try {
      await scene.run(d);
    } catch (e) {
      await page.screenshot({ path: join(out, `${scene.name}-error.png`) });
      throw e;
    }
    const duration = (Date.now() - t0) / 1000 - start;
    const video = page.video();
    await context.close();
    renameSync(await video.path(), join(out, `${scene.name}.webm`));
    rmSync(tmp, { recursive: true, force: true });
    const exited = new Promise((r) => server.once("exit", r));
    server.kill("SIGKILL");
    await exited;
    const marks = Object.fromEntries(Object.entries(d.marks).map(([k, v]) => [k, +v.toFixed(2)]));
    meta[scene.name] = { start: +start.toFixed(2), duration: +duration.toFixed(2), marks, cams: d.cams, view };
    writeFileSync(join(out, "scenes.json"), JSON.stringify(meta, null, 2));
    console.log(`${scene.name}: start ${start.toFixed(1)} s, ${duration.toFixed(1)} s`);
  }
  await browser.close();
}
