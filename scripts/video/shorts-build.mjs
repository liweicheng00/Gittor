// Makes the short videos for social posts from the scenes of shorts-record.mjs: captions at the marks of
// each scene, an end card, and music from music.py. Each short is an MP4 (1920x1080) with sound.
//   node scripts/video/shorts-build.mjs <rec-dir> <out-dir> [style]
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
const [, , recArg, outArg, style = "pulse"] = process.argv;
if (!recArg || !outArg) throw new Error("usage: shorts-build.mjs <rec-dir> <out-dir> [style]");
const rec = resolve(recArg);
const out = resolve(outArg);
const tmp = join(rec, "build");
mkdirSync(tmp, { recursive: true });
mkdirSync(out, { recursive: true });
const meta = JSON.parse(readFileSync(join(rec, "scenes.json"), "utf8"));

/** The shorts: the scene, and the captions. A caption starts at a mark of the scene (or at the start) and
 * stays until the next caption. A third value is its height, when CAPTION_Y would hide something. */
const shorts = [
  { scene: "notes", captions: [[null, "Your agent wrote it. You review it."], ["note1", "Notes on any line, before any commit"], ["done", "No branch. No push. No pull request."]] },
  { scene: "paste", captions: [[null, "Copy your review notes"], ["term", "Paste them to your agent"], ["fix", "The fix lands. The notes clear."]] },
  { scene: "review", captions: [[null, "A pull request that never leaves your machine"], ["note", "Notes on lines"], ["viewed", "Mark files as viewed"], ["merge", "Squash and merge"], ["merged", "No remote. And Undo is one click.", 850]] },
];
const SPEED = 1.15; // The scenes play a little faster than they were recorded.
const END = 2.6; // The end card.
const FADE = 0.35; // The cross fade to the end card.
const FPS = 30;
const CAPTION_Y = 985; // Under the code of the diff, over the lower edge of the app.

const ff = (...args) => execFileSync("ffmpeg", ["-loglevel", "error", "-y", ...args], { stdio: "inherit" });

// The end card and the captions: HTML that Chromium renders to PNG.
const icon = readFileSync(join(root, "crates/app/icons/icon.png")).toString("base64");
const page = (body, transparent) => `<!doctype html><html><head><meta charset="utf-8"><style>
  html, body { margin: 0; width: 1920px; height: 1080px; overflow: hidden; font-family: Inter, system-ui, sans-serif; }
  body { background: ${transparent ? "transparent" : "radial-gradient(circle at 50% 38%, #2a2f3a 0%, #17191d 70%)"}; color: #e8eaed; }
  .card { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; gap: 22px; }
  .card img { width: 168px; height: 168px; }
  .name { font-size: 112px; font-weight: 700; letter-spacing: -0.02em; }
  .tag { font-size: 44px; color: #c3c8d0; }
  .small { font-size: 30px; color: #7f8794; margin-top: 18px; }
  .cap { position: absolute; left: 50%; top: ${CAPTION_Y}px; transform: translate(-50%, -50%); width: max-content;
    max-width: 1700px; text-align: center; background: rgba(14, 16, 20, 0.92); border: 1px solid rgba(255, 255, 255, 0.16);
    border-radius: 22px; padding: 18px 44px; font-size: 58px; line-height: 1.2; font-weight: 650; color: #fff;
    box-shadow: 0 12px 44px rgba(0, 0, 0, 0.55); }
</style></head><body>${body}</body></html>`;
const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const tab = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const render = async (html, file, transparent = false) => {
  await tab.setContent(page(html, transparent));
  await tab.evaluate(() => document.fonts.ready);
  await tab.screenshot({ path: file, omitBackground: transparent });
};
await render(`<div class="card"><img src="data:image/png;base64,${icon}"><div class="name">Gittor</div>
  <div class="tag">The git client for reviewing your agents</div>
  <div class="small">Download for macOS · liweicheng00.github.io/Gittor</div></div>`, join(tmp, "short-end.png"));
for (const s of shorts) {
  for (const [i, [, text, y]] of s.captions.entries()) await render(`<div class="cap"${y ? ` style="top: ${y}px"` : ""}>${text}</div>`, join(tmp, `cap-${s.scene}-${i}.png`), true);
}
await browser.close();

const enc = ["-c:v", "libx264", "-preset", "slow", "-crf", "19", "-pix_fmt", "yuv420p", "-r", String(FPS)];
for (const [n, s] of shorts.entries()) {
  const { start, duration, marks } = meta[s.scene];
  const len = duration / SPEED;
  const total = len + END - FADE;
  // The time of each caption in the video.
  const at = s.captions.map(([mark]) => (mark ? marks[mark] / SPEED : 0.15));
  const inputs = ["-ss", String(start), "-t", String(duration), "-i", join(rec, `${s.scene}.webm`)];
  let chain = `[0:v]setpts=PTS/${SPEED},fps=${FPS},scale=1920:1080:flags=lanczos,setsar=1[v0];`;
  for (const [i] of s.captions.entries()) {
    const from = at[i];
    const to = i + 1 < at.length ? at[i + 1] - 0.05 : len;
    inputs.push("-loop", "1", "-t", total.toFixed(2), "-i", join(tmp, `cap-${s.scene}-${i}.png`));
    chain += `[${i + 1}:v]format=rgba,fade=in:st=${from.toFixed(2)}:d=0.2:alpha=1,fade=out:st=${(to - 0.2).toFixed(2)}:d=0.2:alpha=1[c${i}];` +
      `[v${i}][c${i}]overlay=0:0:enable='between(t,${from.toFixed(2)},${to.toFixed(2)})'[v${i + 1}];`;
  }
  const k = s.captions.length;
  inputs.push("-loop", "1", "-t", String(END), "-i", join(tmp, "short-end.png"));
  chain += `[${k + 1}:v]fps=${FPS},format=yuv420p,setsar=1[e];[v${k}]format=yuv420p[m];` +
    `[m][e]xfade=transition=fade:duration=${FADE}:offset=${(len - FADE).toFixed(3)}[vout]`;
  // The music: a bell at each caption, and the last chord with the end card.
  const spec = join(tmp, `music-${s.scene}.json`);
  const wav = join(tmp, `music-${s.scene}-${style}.wav`);
  writeFileSync(spec, JSON.stringify({ duration: +total.toFixed(2), end: +(len - FADE).toFixed(2), accents: at.slice(1).map((t) => +t.toFixed(2)), style }));
  execFileSync("python3", [join(here, "music.py"), spec, wav], { stdio: "inherit" });
  const file = join(out, `gittor-short-${n + 1}-${s.scene}${style === "pulse" ? "" : `-${style}`}.mp4`);
  ff(...inputs, "-i", wav, "-filter_complex", chain, "-map", "[vout]", "-map", `${k + 2}:a`, "-af", "volume=-3.5dB",
    "-t", total.toFixed(2), ...enc, "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", file);
  console.log(`${file} (${total.toFixed(1)} s)`);
}
