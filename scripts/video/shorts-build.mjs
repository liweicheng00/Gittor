// Makes the short videos for social posts from the scenes of shorts-record.mjs. Each short is an MP4 for
// a phone (1080x1920) with sound: the name of the app, a caption, the app in a frame, and an end card.
// A camera shows all of the page or a part of it and moves between the places that the scene set.
//   node scripts/video/shorts-build.mjs <rec-dir> <out-dir> [style] [scene ...]
// <rec-dir> has the <scene>.webm files and scenes.json. The style of the music is pulse (the default),
// lofi or drive; another style than pulse goes into the file name. ffmpeg and python3 with numpy must be
// on the PATH. Set CHROMIUM to a Chromium binary when Playwright has no downloaded browser.
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const { chromium } = createRequire(join(root, "ui/package.json"))("playwright");
const [, , recArg, outArg, style = "pulse", ...only] = process.argv;
if (!recArg || !outArg) throw new Error("usage: shorts-build.mjs <rec-dir> <out-dir> [style] [scene ...]");
const rec = resolve(recArg);
const out = resolve(outArg);
const tmp = join(rec, "build");
mkdirSync(tmp, { recursive: true });
mkdirSync(out, { recursive: true });
const meta = JSON.parse(readFileSync(join(rec, "scenes.json"), "utf8"));

/** The shorts: the scene, and the captions. A caption starts at a mark of the scene (or at the start) and
 * stays until the next caption. */
const shorts = [
  { scene: "tour", captions: [[null, "A light git client.<br>The basics, fast."], ["log", "All the history,<br>as a graph"], ["diff", "One click<br>to the diff"], ["branches", "Switch branches"], ["changes", "Check, write, commit"], ["undo", "Changed your mind?<br>Undo."]] },
  { scene: "agent", captions: [[null, "Your agent wrote it.<br>Now review it."], ["note", "Leave a note<br>on the line"], ["copy", "Copy the notes"], ["term", "Paste them<br>to your agent"], ["fix", "The fix lands.<br>The note clears."], ["commit", "Then commit"]] },
  { scene: "review", captions: [[null, "A pull request that never<br>leaves your machine"], ["note", "Notes on lines"], ["viewed", "Mark files as viewed"], ["merge", "Squash and merge"], ["merged", "No remote.<br>Undo is one click."]] },
  { scene: "history", captions: [[null, "Rewrite history.<br>Break nothing."], ["squash", "Squash commits"], ["reword", "Fix a message"], ["drop", "Drop a commit"], ["undo", "Undo any of it"]] },
  { scene: "changes", captions: [[null, "Commit exactly<br>what you mean"], ["lists", "Group files<br>in changelists"], ["hunks", "Pick single changes"], ["commit", "Commit only<br>what is checked"], ["rest", "The rest waits<br>for later"]] },
  { scene: "worktrees", captions: [[null, "One repository.<br>Many worktrees."], ["add", "Add a worktree"], ["tab", "It opens<br>in its own tab"], ["window", "Drag a tab out<br>for a new window"]] },
  { scene: "inspect", captions: [[null, "Every line<br>has a story"], ["history", "File history,<br>across renames"], ["annotate", "Who changed<br>each line"], ["preview", "Markdown and<br>diagrams, rendered"], ["source", "The source is<br>one click away"]] },
];
const SPEED = 1.15; // The scenes play a little faster than they were recorded.
const END = 2.8; // The end card.
const FADE = 0.4; // The cross fade to the end card.
const FPS = 30;
const W = 1080;
const H = 1920;
// The place of the app in the video. It has the form of the page (4:5).
const SLOT = { x: 28, y: 540, w: 1024, h: 1280 };
const MOVE = 0.7; // The time of a move of the camera.
const MAX_ZOOM = 2.6;

const ff = (...args) => execFileSync("ffmpeg", ["-loglevel", "error", "-y", ...args], { stdio: "inherit" });

// The frame, the end card and the captions: HTML that Chromium renders to PNG.
const icon = readFileSync(join(root, "crates/app/icons/icon.png")).toString("base64");
const page = (body) => `<!doctype html><html><head><meta charset="utf-8"><style>
  html, body { margin: 0; width: ${W}px; height: ${H}px; overflow: hidden; font-family: Inter, system-ui, sans-serif; color: #e8eaed; }
  /* The frame is all of the picture but the place of the app: a large shadow fills the outside. */
  .hole { position: absolute; left: ${SLOT.x}px; top: ${SLOT.y}px; width: ${SLOT.w}px; height: ${SLOT.h}px; border-radius: 26px;
    box-shadow: 0 0 0 3000px #14161a; }
  .edge { position: absolute; left: ${SLOT.x}px; top: ${SLOT.y}px; width: ${SLOT.w}px; height: ${SLOT.h}px; border-radius: 26px;
    box-sizing: border-box; border: 2px solid rgba(255, 255, 255, 0.14); }
  .brand { position: absolute; left: 0; right: 0; top: 120px; display: flex; align-items: center; justify-content: center; gap: 18px;
    font-size: 46px; font-weight: 700; color: #c3c8d0; }
  .brand img { width: 64px; height: 64px; }
  .cap { position: absolute; left: 60px; right: 60px; top: 220px; height: 290px; display: flex; align-items: center; justify-content: center;
    text-align: center; font-size: 76px; line-height: 1.16; font-weight: 750; letter-spacing: -0.015em; color: #fff; }
  .card { position: absolute; inset: 0; background: radial-gradient(circle at 50% 42%, #2a2f3a 0%, #14161a 70%); display: flex;
    flex-direction: column; align-items: center; justify-content: center; gap: 30px; text-align: center; }
  .card img { width: 220px; height: 220px; }
  .name { font-size: 150px; font-weight: 750; letter-spacing: -0.02em; }
  .tag { font-size: 58px; line-height: 1.25; color: #c3c8d0; }
  .small { font-size: 38px; line-height: 1.5; color: #8a919d; margin-top: 30px; }
</style></head><body>${body}</body></html>`;
const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const tab = await browser.newPage({ viewport: { width: W, height: H } });
const render = async (html, file, transparent = true) => {
  await tab.setContent(page(html));
  await tab.evaluate(() => document.fonts.ready);
  await tab.screenshot({ path: file, omitBackground: transparent });
};
const img = `<img src="data:image/png;base64,${icon}">`;
await render(`<div class="hole"></div><div class="edge"></div><div class="brand">${img}Gittor</div>`, join(tmp, "frame.png"));
await render(`<div class="card">${img}<div class="name">Gittor</div><div class="tag">The git client for<br>reviewing your agents</div>
  <div class="small">Download for macOS<br>liweicheng00.github.io/Gittor</div></div>`, join(tmp, "short-end.png"), false);
for (const s of shorts) {
  for (const [i, [, text]] of s.captions.entries()) await render(`<div class="cap">${text}</div>`, join(tmp, `cap-${s.scene}-${i}.png`));
}
await browser.close();

/** An ffmpeg expression of a value that goes from one key to the next in MOVE seconds, slow at both ends. */
function eased(keys, pick, time) {
  let expr = pick(keys[0]).toFixed(3);
  for (let i = 1; i < keys.length; i++) {
    const step = pick(keys[i]) - pick(keys[i - 1]);
    if (Math.abs(step) < 0.001) continue;
    const u = `clip((${time}-${keys[i].t.toFixed(2)})/${MOVE},0,1)`;
    expr += `+(${step.toFixed(3)})*${u}*${u}*(3-2*${u})`;
  }
  return expr;
}

const enc = ["-c:v", "libx264", "-preset", "slow", "-crf", "19", "-pix_fmt", "yuv420p", "-r", String(FPS)];
for (const [n, s] of shorts.entries()) {
  if (only.length && !only.includes(s.scene)) continue;
  const { start, duration, marks, cams, view } = meta[s.scene];
  const len = duration / SPEED;
  const total = len + END - FADE;
  // The camera: the zoom and the middle of each place, in the pixels of the page.
  const keys = [{ t: 0, z: 1, cx: view.width / 2, cy: view.height / 2 }];
  for (const c of cams) {
    const fit = c.box ? Math.min(view.width / c.box.w, view.height / c.box.h) : 1;
    const z = Math.min(MAX_ZOOM, Math.max(1, c.zoom ?? fit));
    // The middle of the box, or its edge at the edge of the frame; the frame stays in the page.
    const mid = (from, size, all, edge) => Math.min(all - all / z / 2, Math.max(all / z / 2, edge ? from + all / z / 2 : from + size / 2));
    const align = c.align ?? "";
    const key = {
      t: c.t / SPEED, z,
      cx: c.box ? mid(c.box.x, c.box.w, view.width, align.includes("left")) : view.width / 2,
      cy: c.box ? mid(c.box.y, c.box.h, view.height, align.includes("top")) : view.height / 2,
    };
    if (key.t < 0.05) keys[0] = { ...key, t: 0 };
    else keys.push(key);
  }
  const zoom = eased(keys, (k) => k.z, "it");
  const cx = eased(keys, (k) => k.cx, "it");
  const cy = eased(keys, (k) => k.cy, "it");
  // The time of each caption in the video.
  const at = s.captions.map(([mark]) => (mark ? marks[mark] / SPEED : 0));
  const inputs = ["-ss", String(start), "-t", String(duration), "-i", join(rec, `${s.scene}.webm`), "-loop", "1", "-t", total.toFixed(2), "-i", join(tmp, "frame.png")];
  // The page at two times its size, so the camera moves in steps of half a pixel.
  let chain = `[0:v]setpts=PTS/${SPEED},fps=${FPS},scale=${view.width * 2}:${view.height * 2}:flags=lanczos,` +
    `zoompan=z='${zoom}':x='(${cx})*2-iw/zoom/2':y='(${cy})*2-ih/zoom/2':d=1:s=${SLOT.w}x${SLOT.h}:fps=${FPS},` +
    `pad=${W}:${H}:${SLOT.x}:${SLOT.y}:color=0x14161a,setsar=1[app];[app][1:v]overlay=0:0[v0];`;
  for (const [i] of s.captions.entries()) {
    const from = at[i];
    const to = i + 1 < at.length ? at[i + 1] - 0.05 : len;
    inputs.push("-loop", "1", "-t", total.toFixed(2), "-i", join(tmp, `cap-${s.scene}-${i}.png`));
    // A caption comes up from 36 pixels lower while it fades in.
    const rise = `36*pow(1-clip((t-${from.toFixed(2)})/0.3,0,1),2)`;
    chain += `[${i + 2}:v]format=rgba,fade=in:st=${from.toFixed(2)}:d=0.3:alpha=1,fade=out:st=${(to - 0.2).toFixed(2)}:d=0.2:alpha=1[c${i}];` +
      `[v${i}][c${i}]overlay=x=0:y='${rise}':enable='between(t,${from.toFixed(2)},${to.toFixed(2)})'[v${i + 1}];`;
  }
  const k = s.captions.length;
  inputs.push("-loop", "1", "-t", String(END), "-i", join(tmp, "short-end.png"));
  chain += `[${k + 2}:v]fps=${FPS},format=yuv420p,setsar=1[e];[v${k}]fade=in:st=0:d=0.3,format=yuv420p[m];` +
    `[m][e]xfade=transition=fade:duration=${FADE}:offset=${(len - FADE).toFixed(3)}[vout]`;
  // The music: a soft note at each caption, and the last chord with the end card.
  const spec = join(tmp, `music-${s.scene}.json`);
  const wav = join(tmp, `music-${s.scene}-${style}.wav`);
  writeFileSync(spec, JSON.stringify({ duration: +total.toFixed(2), end: +(len - FADE).toFixed(2), accents: at.slice(1).map((t) => +t.toFixed(2)), style }));
  execFileSync("python3", [join(here, "music.py"), spec, wav], { stdio: "inherit" });
  const file = join(out, `gittor-short-${n + 1}-${s.scene}${style === "pulse" ? "" : `-${style}`}.mp4`);
  ff(...inputs, "-i", wav, "-filter_complex", chain, "-map", "[vout]", "-map", `${k + 3}:a`, "-af", "volume=-3.5dB",
    "-t", total.toFixed(2), ...enc, "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", file);
  console.log(`${file} (${total.toFixed(1)} s)`);
}
