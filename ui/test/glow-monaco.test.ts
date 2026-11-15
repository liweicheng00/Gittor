// The Monaco themes of Plasma and Ember: the base, the names, and the contrast of each text color on the
// brightest glass surface under the editor.
import { test } from "node:test";
import assert from "node:assert/strict";
import { GLOW_MONACO, emberMonacoTheme, plasmaMonacoTheme } from "../src/glow-monaco.ts";

// WCAG contrast (from ~/.cache/gittor-plasma/contrast.mjs).
const rgba = (c: string): number[] => [1, 3, 5, 7].map((i) => (i < c.length ? parseInt(c.slice(i, i + 2), 16) : 255));
const hex = (v: number[]) => "#" + v.map((x) => Math.round(x).toString(16).padStart(2, "0")).join("");
const lum = (c: string) => {
  const [r, g, b] = rgba(c).slice(0, 3).map((v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const cr = (a: string, b: string) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};
/** `a` at the opacity `t` over the opaque `b`. */
const over = (a: string, t: number, b: string) => {
  const [x, y] = [rgba(a), rgba(b)];
  return hex(x.slice(0, 3).map((v, i) => v * t + y[i] * (1 - t)));
};
/** A color with alpha (`#rrggbbaa`) over the opaque `b`. */
const paint = (a: string, b: string) => over(a.slice(0, 7), rgba(a)[3] / 255, b);

/** The approved opacity of the body tint (`--glass`). A higher value gives a darker surface. */
const GLASS = 0.55;
/** The opacity of each glow color in the background: a, b, c, d. */
const BLOB = [0.6, 0.45, 0.65, 0.55];
const THEMES = [
  { name: "plasma", theme: plasmaMonacoTheme, base: "#0d0f1a", bg: "#171b27", glow: ["#00ccff", "#6aa8ff", "#b07bff", "#ff73ff"] },
  { name: "ember", theme: emberMonacoTheme, base: "#120c0e", bg: "#1c1517", glow: ["#ffd25c", "#ff9a4d", "#ff5c6c", "#e04cd0"] },
];

/** The brightest place of the background: one glow color, or two that overlap. */
function brightest(base: string, glow: string[]): string {
  const all: string[] = [];
  glow.forEach((x, i) => all.push(over(x, BLOB[i], base)));
  glow.forEach((x, i) => glow.forEach((y, j) => i !== j && all.push(over(x, BLOB[i], over(y, BLOB[j], base)))));
  return all.sort((m, n) => lum(n) - lum(m))[0];
}

/** The surfaces under the text of the editor: the editor, an inserted line and a removed line. */
function surfaces(t: (typeof THEMES)[number]): string[] {
  const body = over(t.bg, GLASS, brightest(t.base, t.glow));
  const editor = paint(t.theme.colors["editor.background"], body);
  return [editor, paint(t.theme.colors["diffEditor.insertedLineBackground"], editor), paint(t.theme.colors["diffEditor.removedLineBackground"], editor)];
}

/** The color keys of the theme that color text in the editor. */
const TEXT_COLORS = [
  "editor.foreground",
  "editorLineNumber.foreground",
  "editorLineNumber.activeForeground",
  "diffEditor.unchangedRegionForeground",
  "editorBracketHighlight.foreground1",
  "editorBracketHighlight.foreground2",
  "editorBracketHighlight.foreground3",
  "editorBracketHighlight.unexpectedBracket.foreground",
];

test("the names of the themes", () => {
  assert.deepEqual(GLOW_MONACO, { plasma: "gittor-plasma", ember: "gittor-ember" });
});

for (const t of THEMES) {
  test(`${t.name}: the base is vs-dark and the editor shows the background`, () => {
    assert.equal(t.theme.base, "vs-dark");
    assert.equal(t.theme.inherit, true);
    const bg = t.theme.colors["editor.background"];
    assert.equal(bg.slice(0, 7), t.bg);
    assert.ok(rgba(bg)[3] < 255, "the editor background is translucent");
    assert.equal(t.theme.colors["editorGutter.background"], bg);
    assert.equal(t.theme.colors["minimap.background"], "#00000000");
    assert.equal(t.theme.colors["diffEditor.unchangedRegionBackground"], "#00000000");
  });

  test(`${t.name}: each rule has a foreground of six hex digits`, () => {
    assert.ok(t.theme.rules.length > 10);
    for (const r of t.theme.rules) assert.match(r.foreground ?? "", /^[0-9a-f]{6}$/, `rule "${r.token}"`);
    assert.ok(t.theme.rules.some((r) => r.token === ""), "a default rule");
  });

  test(`${t.name}: each text color has 4.5:1 on the brightest surface`, () => {
    const texts = [
      ...t.theme.rules.map((r) => [`rule "${r.token}"`, "#" + r.foreground]),
      ...TEXT_COLORS.map((k) => [k, t.theme.colors[k]]),
    ];
    for (const s of surfaces(t)) {
      for (const [what, color] of texts) {
        const c = cr(color, s);
        assert.ok(c >= 4.5, `${what} ${color} has ${c.toFixed(2)}:1 on ${s}`);
      }
    }
  });

  test(`${t.name}: menus have 4.5:1 for their text`, () => {
    const fg = t.theme.colors["menu.foreground"];
    for (const k of ["menu.background", "menu.selectionBackground", "editorWidget.background", "list.hoverBackground"]) {
      assert.ok(cr(fg, t.theme.colors[k]) >= 4.5, k);
    }
  });
}
