// Joins the scenes of record.mjs into the intro video: a title card, a caption on each scene, and an end
// card. Makes an MP4 (1920x1080) with the music of music.py, and a short GIF for the README.
//   node scripts/video/build.mjs <rec-dir> <out-dir>
// <rec-dir> has the <scene>.webm files and scenes.json of record.mjs. ffmpeg, python3 and numpy
// must be on the PATH.
// Set CHROMIUM to a Chromium binary when Playwright has no downloaded browser.
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const { chromium } = createRequire(join(root, "ui/package.json"))("playwright");
const [, , recArg, outArg] = process.argv;
if (!recArg || !outArg) throw new Error("usage: build.mjs <rec-dir> <out-dir>");
const rec = resolve(recArg);
const out = resolve(outArg);
const tmp = join(rec, "build");
mkdirSync(tmp, { recursive: true });
mkdirSync(out, { recursive: true });
const meta = JSON.parse(readFileSync(join(rec, "scenes.json"), "utf8"));

/** The scenes in order, with their captions. */
const scenes = [
  ["log", "The log, with the commit graph of IntelliJ"],
  ["open", "Recent repositories, worktrees under their project"],
  ["changes", "Changelists: check the changes you want, then commit"],
  ["history", "Squash and reword in memory, then one click on Undo"],
  ["conflicts", "Conflicts: only the real conflict is left"],
  ["review", "A local review: notes on lines, then Copy All"],
  ["tools", "Shortcut hints, IDE, Terminal, tabs to new windows"],
];
const SPEED = 1.2; // The scenes play a little faster than they were recorded.
const TITLE = 1.6;
const END = 4;
const FADE = 0.4;
const FPS = 30;
// The caption is over the lower middle of the app, where the diff panel has no important content.
const CAPTION_Y = 760;

const ff = (...args) => execFileSync("ffmpeg", ["-loglevel", "error", "-y", ...args], { stdio: "inherit" });

// Cards and captions: HTML that Chromium renders to PNG.
const icon = readFileSync(join(root, "crates/app/icons/icon.png")).toString("base64");
const page = (body, transparent) => `<!doctype html><html><head><meta charset="utf-8"><style>
  html, body { margin: 0; width: 1920px; height: 1080px; overflow: hidden; font-family: Inter, system-ui, sans-serif; }
  body { background: ${transparent ? "transparent" : "radial-gradient(circle at 50% 38%, #2a2f3a 0%, #17191d 70%)"}; color: #e8eaed; }
  .card { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; gap: 26px; }
  .card img { width: 168px; height: 168px; }
  .name { font-size: 112px; font-weight: 700; letter-spacing: -0.02em; }
  .tag { font-size: 40px; color: #aab0ba; }
  .small { font-size: 30px; color: #7f8794; margin-top: 18px; }
  .cap { position: absolute; left: 50%; top: ${CAPTION_Y}px; transform: translate(-50%, -50%); width: max-content;
    max-width: 1500px; text-align: center; background: rgba(14, 16, 20, 0.9); border: 1px solid rgba(255, 255, 255, 0.16);
    border-radius: 22px; padding: 20px 44px; font-size: 54px; line-height: 1.25; font-weight: 600; color: #fff;
    box-shadow: 0 12px 44px rgba(0, 0, 0, 0.55); }
  .cap b { color: #ffb02e; font-weight: 700; margin-right: 18px; }
</style></head><body>${body}</body></html>`;
const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const tab = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const render = async (html, file, transparent = false) => {
  await tab.setContent(page(html, transparent));
  await tab.evaluate(() => document.fonts.ready);
  await tab.screenshot({ path: file, omitBackground: transparent });
};
await render(`<div class="card"><img src="data:image/png;base64,${icon}"><div class="name">Gittor</div>
  <div class="tag">A light desktop git client with the IntelliJ workflow</div></div>`, join(tmp, "title.png"));
await render(`<div class="card"><img src="data:image/png;base64,${icon}"><div class="name">Gittor</div>
  <div class="tag">The IntelliJ log, changelists and conflicts, without a JVM</div>
  <div class="small">github.com/liweicheng00/gittor</div></div>`, join(tmp, "end.png"));
for (const [i, [name, text]] of scenes.entries()) await render(`<div class="cap"><b>${i + 1}</b>${text}</div>`, join(tmp, `cap-${name}.png`), true);
await browser.close();

// One clip for each part, all with the same size, rate and format.
const enc = ["-c:v", "libx264", "-preset", "slow", "-crf", "20", "-pix_fmt", "yuv420p", "-r", String(FPS)];
const card = (png, seconds, file) => ff("-loop", "1", "-t", String(seconds), "-i", png, "-vf", `fps=${FPS},format=yuv420p`, ...enc, file);
card(join(tmp, "title.png"), TITLE, join(tmp, "0-title.mp4"));
card(join(tmp, "end.png"), END, join(tmp, "9-end.mp4"));
const clips = [{ file: join(tmp, "0-title.mp4"), len: TITLE }];
for (const [i, [name]] of scenes.entries()) {
  const { start, duration } = meta[name];
  const len = duration / SPEED;
  const file = join(tmp, `${i + 1}-${name}.mp4`);
  ff(
    "-ss", String(start), "-t", String(duration), "-i", join(rec, `${name}.webm`),
    "-loop", "1", "-i", join(tmp, `cap-${name}.png`),
    "-filter_complex",
    `[0:v]setpts=PTS/${SPEED},fps=${FPS},scale=1920:1080:flags=lanczos,setsar=1[v];` +
      `[1:v]format=rgba,fade=in:st=0.3:d=0.35:alpha=1,fade=out:st=${(len - 0.6).toFixed(2)}:d=0.35:alpha=1[c];` +
      `[v][c]overlay=0:0:shortest=1,format=yuv420p`,
    "-t", len.toFixed(2), ...enc, file,
  );
  clips.push({ file, len, name });
}
clips.push({ file: join(tmp, "9-end.mp4"), len: END });

// The MP4: a cross fade between all clips.
const inputs = clips.flatMap((c) => ["-i", c.file]);
let chain = "";
let offset = 0;
let last = "[0:v]";
for (let i = 1; i < clips.length; i++) {
  offset += clips[i - 1].len - FADE;
  const label = i === clips.length - 1 ? "[vout]" : `[x${i}]`;
  chain += `${last}[${i}:v]xfade=transition=fade:duration=${FADE}:offset=${offset.toFixed(3)}${label};`;
  last = label;
}
const silent = join(tmp, "video.mp4");
ff(...inputs, "-filter_complex", chain.replace(/;$/, ""), "-map", "[vout]", ...enc, silent);

// The music: music.py makes it for the length of the video. The loudness suits a web video.
const seconds = clips.reduce((sum, c) => sum + c.len, 0) - FADE * (clips.length - 1);
const music = join(tmp, "music.wav");
execFileSync("python3", [join(here, "music.py"), seconds.toFixed(2), music], { stdio: "inherit" });
const mp4 = join(out, "gittor-intro.mp4");
ff("-i", silent, "-i", music, "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-af", "loudnorm=I=-18:TP=-2:LRA=11",
  "-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-shortest", "-movflags", "+faststart", mp4);

// The GIF: short parts of some scenes, faster, at 800 pixels wide.
const gifParts = [
  ["log", 0.4, 6.5],
  ["history", 0.6, 11.5],
  ["conflicts", 4.2, 13.6],
  ["review", 6.4, 15.2],
];
const parts = [];
for (const [name, from, to] of gifParts) {
  const clip = clips.find((c) => c.name === name);
  const file = join(tmp, `gif-${name}.mp4`);
  ff("-ss", String(from), "-t", String(Math.min(to, clip.len) - from), "-i", clip.file, "-vf", "setpts=PTS/1.35,fps=10,scale=800:-2:flags=lanczos", "-an", "-c:v", "libx264", "-crf", "16", "-pix_fmt", "yuv420p", file);
  parts.push(file);
}
const list = join(tmp, "gif-parts.txt");
writeFileSync(list, parts.map((p) => `file '${p}'`).join("\n"));
const palette = join(tmp, "palette.png");
ff("-f", "concat", "-safe", "0", "-i", list, "-vf", "palettegen=max_colors=96:stats_mode=diff", palette);
const gif = join(out, "gittor-intro.gif");
ff("-f", "concat", "-safe", "0", "-i", list, "-i", palette, "-lavfi", "paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle", "-loop", "0", gif);
console.log(mp4);
console.log(gif);
