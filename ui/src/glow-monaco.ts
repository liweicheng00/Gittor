// The Monaco themes of the glow themes Plasma and Ember. The colors are typed by hand: they do not read
// the CSS. This module has type imports only, so ui/test/glow-monaco.test.ts can load it with Node.

import type { editor } from "monaco-editor";

export type GlowName = "plasma" | "ember";

/** The name of the Monaco theme of each glow theme. */
export const GLOW_MONACO = { plasma: "gittor-plasma", ember: "gittor-ember" } as const;

/** The colors of one glow theme that the Monaco theme uses. Hex values without alpha, with `#`. */
interface GlowColors {
  /** The opaque `--bg` of the palette. */
  bg: string;
  /** The base of menus and widgets (`--panel-2` of the opaque palette). */
  panel2: string;
  border: string;
  accent: string;
  /** The accent at 24 % over `bg`, opaque: a selected item of a menu or a list. */
  selectStrong: string;
  /** The accent at 8 % over `bg`, opaque: an item under the mouse. */
  hover: string;
  indentGuide: string;
  whitespace: string;
  /** Line numbers and the text of hidden unchanged lines. */
  lineNumber: string;
}

/** The tint of the editor: `--bg` at 40 % (alpha 66). The glow background shows through it. */
const EDITOR_TINT = "66";

/** The colors of the text. Both themes use them. Each has 4.5:1 or more on the worst glass surface. */
export const GLOW_TOKENS = {
  text: "d3dae3",
  comment: "b7bed2",
  keyword: "ceafff",
  string: "2fd8ae",
  escape: "ffa0cc",
  number: "ffb380",
  type: "4dd2ff",
  key: "94c0ff",
  tag: "ffa2be",
  attribute: "ffdd55",
  delimiter: "b6bfd0",
} as const;

function rules(): editor.ITokenThemeRule[] {
  const t = GLOW_TOKENS;
  const r = (token: string, foreground: string, fontStyle?: string): editor.ITokenThemeRule =>
    fontStyle ? { token, foreground, fontStyle } : { token, foreground };
  return [
    r("", t.text),
    r("comment", t.comment, "italic"),
    r("keyword", t.keyword),
    r("keyword.flow", t.keyword),
    r("keyword.flow.scss", t.keyword),
    r("keyword.json", t.string),
    r("string", t.string),
    r("string.sql", t.string),
    r("attribute.value", t.string),
    r("string.value.json", t.string),
    r("meta.tag", t.string),
    r("string.escape", t.escape),
    r("regexp", t.escape),
    r("number", t.number),
    r("number.hex", t.number),
    r("constant", t.number),
    r("attribute.value.number.css", t.number),
    r("attribute.value.unit.css", t.number),
    r("type", t.type),
    r("type.identifier", t.type),
    r("namespace", t.type),
    r("predefined", t.key),
    r("predefined.sql", t.key),
    r("variable", t.key),
    r("variable.predefined", t.key),
    r("variable.parameter", t.key),
    r("key", t.key),
    r("string.key.json", t.key),
    r("metatag.content.html", t.key),
    r("tag", t.tag),
    r("tag.id.pug", t.tag),
    r("tag.class.pug", t.tag),
    r("metatag.html", t.tag),
    r("metatag.xml", t.tag),
    r("invalid", t.tag),
    r("attribute.name", t.attribute),
    r("annotation", t.attribute),
    r("metatag", t.attribute),
    r("meta.scss", t.attribute),
    r("delimiter", t.delimiter),
    r("delimiter.html", t.delimiter),
    r("delimiter.xml", t.delimiter),
    r("operator", t.delimiter),
    r("operators", t.delimiter),
    r("operator.scss", t.delimiter),
    r("operator.sql", t.delimiter),
    r("operator.swift", t.delimiter),
    r("attribute.value.hex.css", t.text),
  ];
}

function theme(c: GlowColors): editor.IStandaloneThemeData {
  const tint = c.bg + EDITOR_TINT;
  return {
    base: "vs-dark",
    inherit: true,
    rules: rules(),
    colors: {
      "editor.background": tint,
      "editor.foreground": "#" + GLOW_TOKENS.text,
      "editorGutter.background": tint,
      "minimap.background": "#00000000",
      "editorCursor.foreground": c.accent,
      "editorLineNumber.foreground": c.lineNumber,
      "editorLineNumber.activeForeground": "#" + GLOW_TOKENS.text,
      "editor.selectionBackground": c.accent + "4d",
      "editor.inactiveSelectionBackground": c.accent + "26",
      "editor.lineHighlightBackground": c.accent + "0f",
      "editor.lineHighlightBorder": "#00000000",
      "editorBracketHighlight.foreground1": "#" + GLOW_TOKENS.attribute,
      "editorBracketHighlight.foreground2": "#" + GLOW_TOKENS.tag,
      "editorBracketHighlight.foreground3": "#" + GLOW_TOKENS.type,
      "editorBracketHighlight.unexpectedBracket.foreground": "#" + GLOW_TOKENS.tag,
      "editor.findMatchBackground": "#ffdd5566",
      "editor.findMatchHighlightBackground": "#ffdd5533",
      "editorIndentGuide.background1": c.indentGuide,
      "editorWhitespace.foreground": c.whitespace,
      "editorWidget.background": c.panel2,
      "editorWidget.border": c.border,
      "editorHoverWidget.background": c.panel2,
      "editorHoverWidget.border": c.border,
      "input.background": c.bg,
      "input.border": c.border,
      "focusBorder": c.accent,
      "menu.background": c.panel2,
      "menu.foreground": "#" + GLOW_TOKENS.text,
      "menu.border": c.border,
      "menu.selectionBackground": c.selectStrong,
      "menu.selectionForeground": "#" + GLOW_TOKENS.text,
      "menu.separatorBackground": c.border,
      "quickInput.background": c.panel2,
      "quickInputList.focusBackground": c.selectStrong,
      "list.hoverBackground": c.hover,
      "scrollbarSlider.background": "#a9b1c62e",
      "scrollbarSlider.hoverBackground": "#a9b1c64d",
      "scrollbarSlider.activeBackground": c.accent + "66",
      "scrollbar.shadow": "#00000000",
      "diffEditor.insertedLineBackground": "#2fd8ae1f",
      "diffEditor.insertedTextBackground": "#2fd8ae3d",
      "diffEditor.removedLineBackground": "#ff7aa21f",
      "diffEditor.removedTextBackground": "#ff7aa23d",
      "diffEditorGutter.insertedLineBackground": "#2fd8ae2e",
      "diffEditorGutter.removedLineBackground": "#ff7aa22e",
      "diffEditorOverview.insertedForeground": "#2fd8ae99",
      "diffEditorOverview.removedForeground": "#ff7aa299",
      "diffEditor.diagonalFill": "#a9b1c624",
      "diffEditor.unchangedRegionBackground": "#00000000",
      "diffEditor.unchangedRegionForeground": c.lineNumber,
      "diffEditor.unchangedCodeBackground": c.accent + "0f",
      "editorOverviewRuler.border": "#00000000",
    },
  };
}

export const plasmaMonacoTheme = theme({
  bg: "#171b27",
  panel2: "#1c202f",
  border: "#343b56",
  accent: "#6aa8ff",
  selectStrong: "#25395b",
  hover: "#242a3d",
  indentGuide: "#2c3249",
  whitespace: "#3b445f",
  lineNumber: "#b7bed2",
});

export const emberMonacoTheme = theme({
  bg: "#1c1517",
  panel2: "#22191c",
  border: "#45333a",
  accent: "#ff9a4d",
  selectStrong: "#523524",
  hover: "#2e201b",
  indentGuide: "#33262b",
  whitespace: "#4d3a41",
  lineNumber: "#c9b9bd",
});

export const glowMonacoThemes: Record<GlowName, editor.IStandaloneThemeData> = {
  plasma: plasmaMonacoTheme,
  ember: emberMonacoTheme,
};
