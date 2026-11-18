// The glass themes Plasma and Ember (glow.css): the contrast of the text on the worst background, and the
// rules of the file. The test reads the CSS as text and calculates the colors. It cannot measure pixels, so
// it takes the brightest place of the nebula: one light, or two lights that overlap.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../src/glow.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

const PREFIX = ':root[data-style="glow"]';
const SHARED = ':root[data-theme="dark"][data-style="glow"]';
const PALETTES = ["plasma", "ember"] as const;
const paletteSelector = (name: string) => `${SHARED}[data-glow="${name}"]`;

interface Rule { selectors: string[]; decls: [string, string][] }

/** Splits a text at the commas that are not in parentheses. */
function splitTop(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "(") depth++;
    else if (c === ")") depth--;
    else if (c === "," && depth === 0) {
      out.push(text.slice(start, i).trim());
      start = i + 1;
    }
  }
  out.push(text.slice(start).trim());
  return out;
}

function parseRules(text: string): Rule[] {
  const rules: Rule[] = [];
  for (const m of text.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const decls: [string, string][] = [];
    for (const d of m[2].split(";")) {
      const i = d.indexOf(":");
      if (i < 0) continue;
      decls.push([d.slice(0, i).trim().toLowerCase(), d.slice(i + 1).trim()]);
    }
    rules.push({ selectors: splitTop(m[1].trim().replace(/\s+/g, " ")), decls });
  }
  return rules;
}

const rules = parseRules(css);

function decl(selector: string, prop: string): string {
  const rule = rules.find((r) => r.selectors.includes(selector) && r.decls.some(([p]) => p === prop));
  assert.ok(rule, `no ${prop} for ${selector}`);
  return rule.decls.find(([p]) => p === prop)![1];
}

function vars(selector: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const r of rules.filter((r) => r.selectors.length === 1 && r.selectors[0] === selector)) {
    for (const [p, v] of r.decls) if (p.startsWith("--")) out.set(p, v);
  }
  return out;
}

/** The variables of a palette: the shared block and the palette block. */
function palette(name: string): Map<string, string> {
  return new Map([...vars(SHARED), ...vars(paletteSelector(name))]);
}

// Colors are premultiplied [r, g, b, a], with r, g, b from 0 to 255.
type Rgba = [number, number, number, number];
type Rgb = [number, number, number];

function substitute(expr: string, v: Map<string, string>): string {
  for (let i = 0; i < 20 && expr.includes("var("); i++) {
    expr = expr.replace(/var\((--[\w-]+)\)/g, (_, name: string) => {
      const value = v.get(name);
      assert.ok(value !== undefined, `the variable ${name} is not defined`);
      return value;
    });
  }
  return expr;
}

function parseColor(expr: string, current?: Rgb): Rgba {
  const e = expr.trim();
  if (e === "transparent") return [0, 0, 0, 0];
  if (e.toLowerCase() === "currentcolor") {
    assert.ok(current, "currentColor without a text color");
    return [...current, 1];
  }
  const hex = /^#([0-9a-f]{6})$/i.exec(e);
  if (hex) {
    const n = parseInt(hex[1], 16);
    return [n >> 16, (n >> 8) & 255, n & 255, 1];
  }
  const mix = /^color-mix\(in srgb,([\s\S]*)\)$/.exec(e);
  if (mix) {
    const [a, b] = splitTop(mix[1]).map((part) => {
      const m = /^([\s\S]*?)\s+([\d.]+)%$/.exec(part);
      return m ? { color: parseColor(m[1], current), p: Number(m[2]) / 100 } : { color: parseColor(part, current), p: NaN };
    });
    const pa = Number.isNaN(a.p) ? 1 - b.p : a.p;
    const pb = Number.isNaN(b.p) ? 1 - pa : b.p;
    assert.ok(Math.abs(pa + pb - 1) < 1e-9, `the parts of ${e} do not add up to 100%`);
    const pre = (c: Rgba) => [c[0] * c[3], c[1] * c[3], c[2] * c[3], c[3]];
    const [x, y] = [pre(a.color), pre(b.color)];
    const m = x.map((v, i) => v * pa + y[i] * pb);
    const alpha = m[3];
    return alpha === 0 ? [0, 0, 0, 0] : [m[0] / alpha, m[1] / alpha, m[2] / alpha, alpha];
  }
  throw new Error(`the test cannot read the color ${e}`);
}

const color = (expr: string, v: Map<string, string>, current?: Rgb) => parseColor(substitute(expr, v), current);
const over = (c: Rgba, base: Rgb): Rgb => [0, 1, 2].map((i) => c[i] * c[3] + base[i] * (1 - c[3])) as Rgb;
const solid = (c: Rgba): Rgb => {
  assert.equal(c[3], 1, "a text color must be opaque");
  return [c[0], c[1], c[2]];
};

// WCAG 2 relative luminance and contrast ratio.
function lum(c: Rgb): number {
  const [r, g, b] = c.map((v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a: Rgb, b: Rgb): number {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

// java.awt.Color.HSBtoRGB, as in graph-paint.ts.
function hsbToRgb(h: number, s: number, v: number): Rgb {
  const hh = (h - Math.floor(h)) * 6;
  const f = hh - Math.floor(hh);
  const p = v * (1 - s);
  const q = v * (1 - s * f);
  const t = v * (1 - s * (1 - f));
  const rgb = [[v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]][Math.floor(hh)];
  return rgb.map((x) => Math.floor(x * 255 + 0.5)) as Rgb;
}

/** The lights of the nebula: the color-mix parts of the background of the fixed layer. */
function nebulaLights(v: Map<string, string>): Rgba[] {
  const bg = decl(`${PREFIX}::before`, "background");
  const parts = [...bg.matchAll(/color-mix\(in srgb, var\(--glow-[abcd]\) \d+%, transparent\)/g)].map((m) => m[0]);
  assert.equal(parts.length, 4, "the nebula has four lights");
  return parts.map((p) => color(p, v));
}

/** The brightest place of the nebula, the page tint over it, and all surfaces under text. */
function surfaces(name: string) {
  const v = palette(name);
  const base = solid(color("var(--nebula)", v));
  const lights = nebulaLights(v);
  let n = base;
  for (const a of lights) {
    for (const b of lights) {
      const c = a === b ? over(a, base) : over(b, over(a, base));
      if (lum(c) > lum(n)) n = c;
    }
  }
  const s = over(color(decl(`${PREFIX} body`, "background"), v), n);
  const list: [string, Rgb][] = [
    ["page", s],
    ["panel", over(color("var(--panel)", v), s)],
    ["panel-2", over(color("var(--panel-2)", v), s)],
    ["hover", over(color("var(--hover)", v), s)],
    ["select", over(color("var(--select)", v), s)],
    ["select-strong", over(color("var(--select-strong)", v), s)],
    ["field", over(color("var(--glass-field)", v), s)],
    ["op-banner", over(color(decl(`${PREFIX} .op-banner`, "background"), v), s)],
    ["overlay", over(color("var(--glass-overlay)", v), n)],
  ];
  return { v, s, list };
}

const TEXT = ["--fg", "--muted", "--accent", "--local", "--remote", "--tag", "--head", "--added", "--deleted", "--renamed", "--ok", "--warn", "--danger"];

for (const name of PALETTES) {
  test(`${name}: each text color has 4.5:1 on each surface over the brightest nebula`, () => {
    const { v, list } = surfaces(name);
    const fails: string[] = [];
    for (const t of TEXT) {
      const fg = solid(color(`var(${t})`, v));
      for (const [where, bg] of list) {
        const r = contrast(fg, bg);
        if (r < 4.5) fails.push(`${t} on ${where}: ${r.toFixed(2)}`);
      }
    }
    assert.deepEqual(fails, []);
  });

  test(`${name}: the text of a ref label has 4.5:1 on its own fill`, () => {
    const { v, s } = surfaces(name);
    for (const t of ["--local", "--remote", "--tag", "--head"]) {
      const fg = solid(color(`var(${t})`, v));
      const fill = over(color(decl(`${PREFIX} .ref`, "background"), v, fg), s);
      const r = contrast(fg, fill);
      assert.ok(r >= 4.5, `${t}: ${r.toFixed(2)}`);
    }
  });

  test(`${name}: text on a bright fill has 4.5:1`, () => {
    const v = palette(name);
    const fg = solid(color("var(--on-accent)", v));
    for (const fill of ["--accent", "--glow-a", "--glow-b", "--glow-c", "--added", "--deleted", "--warn"]) {
      const r = contrast(fg, solid(color(`var(${fill})`, v)));
      assert.ok(r >= 4.5, `--on-accent on ${fill}: ${r.toFixed(2)}`);
    }
  });

  test(`${name}: the graph has numbers for its colors, and each color has 3:1 on the page`, () => {
    const { v, s } = surfaces(name);
    const num = (n: string) => {
      const value = v.get(n);
      assert.ok(value !== undefined && /^-?[\d.]+$/.test(value) && Number.isFinite(Number(value)), `${n} is not a number`);
      return Number(value);
    };
    const [sat, val] = [num("--graph-s"), num("--graph-v")];
    num("--graph-glow");
    for (let i = 0; i < 360; i++) {
      const r = contrast(hsbToRgb(i / 360, sat, val), s);
      assert.ok(r >= 3, `hue ${i}: ${r.toFixed(2)}`);
    }
  });
}

test("both palettes define the same variables", () => {
  const [a, b] = PALETTES.map((p) => [...vars(paletteSelector(p)).keys()].sort());
  assert.deepEqual(a, b);
  assert.ok(a.includes("--nebula") && a.includes("--bg") && a.includes("--graph-s"));
});

test("each selector is in the scope of the skin", () => {
  const palette = /^:root\[data-theme="dark"\]\[data-style="glow"\](\[data-glow="(plasma|ember)"\])?$/;
  for (const r of rules) {
    for (const s of r.selectors) {
      assert.ok(s.startsWith(`${PREFIX} `) || s === `${PREFIX}::before` || palette.test(s), `selector out of scope: ${s}`);
    }
  }
});

test("the file has no layout property, animation or blur on a row", () => {
  assert.doesNotMatch(css, /@|url\(|::-webkit-scrollbar|scrollbar-/, "no at-rule, url, or scroll bar style");
  const layout = /^(font.*|padding.*|margin.*|width|height|min-.*|max-.*|display|position|gap|row-gap|column-gap|flex.*|grid.*|line-height|border|border-(top|right|bottom|left)|border(-(top|right|bottom|left))?-width|border-image.*|border-radius|overflow.*|inset|top|right|bottom|left|z-index|transform|filter|animation.*|transition.*|content|visibility|zoom)$/;
  // The fixed layer of the nebula is the only rule with a position.
  const nebula = new Set(["content", "position", "inset", "z-index", "pointer-events", "background"]);
  const overlays = new Set([".menu", ".dialog", ".toast", ".merge-window", ".history-window", ".copy-hint", ".tab-detach-hint", ".rebase-drag-tip"]);
  const rows = /\.(log-row|change|cl-file|files-row|branch|stash-row|sm-row|history-row|local-history-row|conflict-row|review-commit|review-file|menu-item)\b/;
  for (const r of rules) {
    const where = r.selectors.join(", ");
    if (where === `${PREFIX}::before`) {
      for (const [p] of r.decls) assert.ok(nebula.has(p), `${p} in the nebula layer`);
      continue;
    }
    for (const [p, value] of r.decls) {
      assert.doesNotMatch(p, layout, `${p} in ${where}`);
      if (/^(-webkit-)?backdrop-filter$/.test(p)) {
        const m = /^:root\[data-style="glow"\] :is\(([^)]*)\)$/.exec(where);
        assert.ok(m && m[1].split(",").every((s) => overlays.has(s.trim())), `${p} on something that is not an overlay: ${where}`);
      }
      if (p === "box-shadow" && rows.test(where)) {
        for (const shadow of splitTop(value)) {
          assert.match(shadow, /^inset -?\d+(px)? -?\d+(px)? 0(px)? /, `a blurred shadow on a row: ${where}`);
        }
      }
    }
  }
});
