// Makes copies of the short videos that are not larger than a limit, for an upload with a size limit.
//   node scripts/video/shorts-fit.mjs <in-dir> <out-dir> <megabytes>
// A file under the limit is copied. A larger file is encoded again in two passes, with the bit rate
// that the limit and the length of the video allow. ffmpeg and ffprobe must be on the PATH.
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const [, , inArg, outArg, mbArg] = process.argv;
if (!inArg || !outArg || !mbArg) throw new Error("usage: shorts-fit.mjs <in-dir> <out-dir> <megabytes>");
const from = resolve(inArg);
const to = resolve(outArg);
const limit = Number(mbArg) * 1e6;
const AUDIO = 128; // kbit/s
mkdirSync(to, { recursive: true });
const ff = (...args) => execFileSync("ffmpeg", ["-loglevel", "error", "-y", ...args], { stdio: "inherit" });

for (const name of readdirSync(from).filter((n) => n.endsWith(".mp4")).sort()) {
  const src = join(from, name);
  const out = join(to, name);
  if (statSync(src).size <= limit) {
    copyFileSync(src, out);
  } else {
    const seconds = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", src], { encoding: "utf8" }));
    // 8% of the size is for the container and for the difference between the bit rate and the result.
    const video = Math.floor((limit * 8 * 0.92) / seconds / 1000 - AUDIO);
    const log = join(to, "pass");
    const enc = ["-c:v", "libx264", "-preset", "slow", "-b:v", `${video}k`, "-pix_fmt", "yuv420p", "-passlogfile", log];
    ff("-i", src, ...enc, "-pass", "1", "-an", "-f", "null", "/dev/null");
    ff("-i", src, ...enc, "-pass", "2", "-c:a", "aac", "-b:a", `${AUDIO}k`, "-movflags", "+faststart", out);
  }
  console.log(`${name}: ${(statSync(src).size / 1e6).toFixed(2)} MB -> ${(statSync(out).size / 1e6).toFixed(2)} MB`);
}
