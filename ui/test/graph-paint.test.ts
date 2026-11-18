// The colors of the commit graph: the default tone, the tone of the CSS variables, and the contrast of the
// glow tone on the glass surface of the themes Plasma and Ember.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { DEFAULT_TONE, graphColor, type GraphTone } from "../src/graph-paint.ts";

test("color id 0 is the text color", () => {
  assert.equal(graphColor(0, "#123456"), "#123456");
  assert.equal(graphColor(0, "#123456", { s: 0.5, v: 0.95, glow: 4 }), "#123456");
});

test("the default tone gives the colors of before", () => {
  assert.equal(graphColor(1, "#000"), "rgb(99, 155, 166)");
  assert.equal(graphColor(1, "#000", DEFAULT_TONE), "rgb(99, 155, 166)");
});

test("another tone gives other colors", () => {
  assert.equal(graphColor(1, "#000", { s: 0.5, v: 0.95, glow: 4 }), "rgb(121, 222, 242)");
});

test("the cache keeps the colors of each tone apart", () => {
  graphColor(2, "#000", { s: 0.5, v: 0.95, glow: 0 });
  const before = graphColor(3, "#000");
  graphColor(3, "#000", { s: 0.9, v: 0.3, glow: 0 });
  assert.equal(graphColor(3, "#000"), before);
  assert.equal(graphColor(1, "#000"), "rgb(99, 155, 166)");
});

// WCAG contrast (from ~/.cache/gittor-plasma/contrast.mjs).
const rgb = (c: string): number[] => {
  const m = /^rgb\((\d+), (\d+), (\d+)\)$/.exec(c);
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3])];
  return [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
};
const hex = (v: number[]) => "#" + v.map((x) => Math.round(x).toString(16).padStart(2, "0")).join("");
const lum = (c: string) => {
  const [r, g, b] = rgb(c).map((v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const cr = (a: string, b: string) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};
/** `a` at the opacity `t` over `b`. */
const over = (a: string, t: number, b: string) => {
  const [x, y] = [rgb(a), rgb(b)];
  return hex(x.map((v, i) => v * t + y[i] * (1 - t)));
};

/** The inputs of the glass surface (amendment v2 of the plan). */
const PALETTES = {
  plasma: { base: "#0d0f1a", bg: "#171b27", glow: ["#00ccff", "#6aa8ff", "#b07bff", "#ff73ff"] },
  ember: { base: "#120c0e", bg: "#1c1517", glow: ["#ffd25c", "#ff9a4d", "#ff5c6c", "#e04cd0"] },
};
/** The opacity of each glow color in the background: a, b, c, d. */
const BLOB = [0.6, 0.45, 0.65, 0.55];

/** The brightest place of the background: one glow color, or two that overlap. */
function brightest(p: { base: string; glow: string[] }): string {
  const all: string[] = [];
  p.glow.forEach((x, i) => all.push(over(x, BLOB[i], p.base)));
  p.glow.forEach((x, i) => p.glow.forEach((y, j) => i !== j && all.push(over(x, BLOB[i], over(y, BLOB[j], p.base)))));
  return all.sort((m, n) => lum(n) - lum(m))[0];
}

/** The colors of the ids 1 to 400. The hue generator gives only a few hues. */
function minContrast(tone: GraphTone, surface: string): number {
  let min = Infinity;
  for (let id = 1; id <= 400; id++) min = Math.min(min, cr(graphColor(id, "#000", tone), surface));
  return min;
}

// The tone and the opacity of the body tint come from glow.css when the file is there. Without it, the test
// takes the tone that the glow themes need at the approved tint of 55 %.
const css = new URL("../src/glow.css", import.meta.url);
function glowTones(): { name: keyof typeof PALETTES; tone: GraphTone; glass: number }[] {
  const fallback: GraphTone = { s: 0.35, v: 1, glow: 4 };
  if (!existsSync(css)) return (["plasma", "ember"] as const).map((name) => ({ name, tone: fallback, glass: 0.55 }));
  const text = readFileSync(css, "utf8");
  const glasses = [...text.matchAll(/--glass:\s*([\d.]+)%/g)].map((m) => Number(m[1]) / 100);
  const glass = glasses.length ? Math.min(...glasses) : 0.55;
  return (["plasma", "ember"] as const).map((name) => {
    const block = new RegExp(`\\[data-glow="${name}"\\]\\s*\\{([^}]*)\\}`).exec(text)?.[1] ?? "";
    const num = (v: string) => Number(new RegExp(`--${v}:\\s*([\\d.]+)`).exec(block)?.[1]);
    const tone = { s: num("graph-s"), v: num("graph-v"), glow: num("graph-glow") };
    assert.ok(Object.values(tone).every(Number.isFinite), `glow.css: the palette ${name} must set --graph-s, --graph-v and --graph-glow`);
    return { name, tone, glass };
  });
}

test("the graph colors of the glow themes have 3:1 on the brightest glass surface", () => {
  for (const { name, tone, glass } of glowTones()) {
    const p = PALETTES[name];
    const surface = over(p.bg, glass, brightest(p));
    const c = minContrast(tone, surface);
    assert.ok(c >= 3, `${name}: tone ${tone.s}/${tone.v} has ${c.toFixed(2)}:1 on ${surface}`);
  }
});
