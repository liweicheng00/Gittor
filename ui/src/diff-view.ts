// Monaco diff of one file, with a toolbar for navigation and diff options.

import { revertChange } from "./revert-change";
import * as monaco from "./monaco";
import "monaco-editor/esm/vs/basic-languages/monaco.contribution";
import EditorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import { api, type Blame, type Change, type FileContent, type MermaidSvg, type RevSpec } from "./api";
import { statusName } from "./changes-panel";
import { copyText, h, icon } from "./dom";
import { markBlocks, removedAnchors } from "./markdown-model";
import { blocksOf, renderMarkdown } from "./markdown-preview";
import { NoteLayer, type NoteHandlers, type NoteItem } from "./note-layer";
import { save, settings } from "./settings";

(self as unknown as { MonacoEnvironment: object }).MonacoEnvironment = { getWorker: () => new EditorWorker() };

export function setMonacoTheme(dark: boolean) {
  monaco.editor.setTheme(dark ? "vs-dark" : "vs");
  // The Mermaid diagrams of a preview have the colors of the theme.
  for (const v of views) v.refreshPreview();
}

/** Mermaid diagrams as SVG, by theme and source, so a preview that draws again does not ask again. */
const mermaidCache = new Map<string, Promise<MermaidSvg>>();
function mermaidSvg(source: string): Promise<MermaidSvg> {
  const dark = document.documentElement.dataset.theme === "dark";
  const bg = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim();
  const key = `${dark}\0${bg}\0${source}`;
  let svg = mermaidCache.get(key);
  if (!svg) {
    if (mermaidCache.size > 100) mermaidCache.delete(mermaidCache.keys().next().value!);
    svg = api.mermaidSvg(source, dark, bg);
    mermaidCache.set(key, svg);
  }
  return svg;
}

/** The editor font of the diff and merge views, from the settings. */
export function editorFont(): { fontSize: number; fontFamily?: string } {
  return { fontSize: settings.diffFontSize, ...(settings.diffFontFamily.trim() ? { fontFamily: settings.diffFontFamily.trim() } : {}) };
}

const views = new Set<DiffView>();

/** Applies the diff settings (font, layout options) to every diff view. */
export function applyDiffSettings() {
  for (const v of views) v.applySettings();
}

export class DiffView {
  readonly el: HTMLElement;
  private title: HTMLElement;
  private sides: HTMLElement;
  private stats: HTMLElement;
  private notice: HTMLElement;
  private host: HTMLElement;
  private editor: monaco.editor.IStandaloneDiffEditor;
  /** Shows an added or deleted file: one side has no content. */
  /** Created on first use: most files are shown in the diff editor. */
  private singleEditor: monaco.editor.IStandaloneCodeEditor | null = null;
  private singleHost: HTMLElement;
  /** The rendered Markdown in place of the editors, and its toggle. */
  private previewHost: HTMLElement;
  private previewBtn: HTMLButtonElement;
  /** The texts of a Markdown file on show; null for other files. */
  private markdown: { left: string; right: string; kind: "diff" | "added" | "deleted" } | null = null;
  /** The editor that shows the file when the preview is off. */
  private editorMode: "diff" | "single" = "diff";
  /** In one column: the blocks of the old text, which a diff puts between the new blocks. */
  private oldBlocks: { el: HTMLElement; block: [number, number] }[] = [];
  private path = "";
  /** The file and revision that Annotate shows: the right side, or the left side of a deleted file. */
  private source: { path: string; rev: RevSpec } | null = null;
  private annotateBox: HTMLInputElement;
  private historyBtn: HTMLButtonElement;
  private blameDeco: string[] = [];
  private blameEditor: monaco.editor.IStandaloneCodeEditor | null = null;
  private blameRequest = 0;
  onPrevFile: () => void = () => {};
  onNextFile: () => void = () => {};
  onBlame: (path: string, rev: RevSpec) => Promise<Blame> = () => Promise.reject(new Error("no blame"));
  onBlameClick: (oid: string) => void = () => {};
  onHistory: (path: string) => void = () => {};
  onHide: () => void = () => {};
  /** Open in Editor: the file of the right side, at a line and a column. */
  onOpenInEditor: (path: string, line: number, column: number) => void = () => {};
  /** The place of the cursor after the user moved it in the file. Null until then. */
  private userPos: { line: number; column: number } | null = null;
  /** Local changes only: which changes go into the next commit. */
  private selectable: { excluded: Set<string>; onChange: (excluded: Set<string>, content: string | null) => void } | null = null;
  private hunkDeco: string[] = [];
  /** A file in more than one changelist: the changes of the other changelists, marked in the diff. */
  private listHunks: { start: number; lines: number; label: string }[] = [];
  private listDeco: string[] = [];
  /** Review notes: marked lines of the right side, and their cards. */
  private notes: NoteItem[] = [];
  private readonly noteLayer = new NoteLayer(() => this.rightEditor());
  private noteDeco: string[] = [];
  private singleNoteDeco: string[] = [];
  private menuAt = { x: 0, y: 0 };
  private moveKey: monaco.editor.IContextKey<boolean>;
  /** Local changes only: move the change at a working-tree line to another changelist. */
  onMoveChange: ((line: number, at: { x: number; y: number }) => void) | null = null;
  private hunks: { id: string; glyphLine: number; change: monaco.editor.ILineChange }[] = [];
  /** The texts of the two sides as they came, for Revert This Change. */
  private texts = { left: "", right: "" };
  /** The right side is the working tree: Revert This Change writes the file. Null turns it off. */
  private onRevert: ((path: string, text: string, expected: string) => void) | null = null;
  private revertKey: monaco.editor.IContextKey<boolean>;
  private revertDeco: string[] = [];
  private revertGlyphs: { line: number; change: monaco.editor.ILineChange }[] = [];

  constructor() {
    // `action` names the keymap action of the button, for the shortcut hint.
    const btn = (label: string | Node, title: string, fn: () => void, action?: string) => {
      const b = h("button", { class: "icon-button", title, "data-key-action": action }, label);
      b.addEventListener("click", fn);
      return b;
    };
    const toggle = (label: string, key: "sideBySide" | "ignoreWhitespace" | "collapseUnchanged", title: string) => {
      const input = h("input", { type: "checkbox", checked: settings[key], "data-key": key });
      input.addEventListener("change", () => {
        settings[key] = input.checked;
        save();
        this.applyOptions();
      });
      return h("label", { class: "diff-option", title }, input, label);
    };
    this.title = h("span", { class: "diff-title" });
    this.sides = h("span", { class: "diff-sides" });
    this.stats = h("span", { class: "diff-stats" });
    const copyPath = btn(icon("copy"), "Copy the file path", () => this.path && void copyText(this.path));
    this.annotateBox = h("input", { type: "checkbox" });
    this.annotateBox.addEventListener("change", () => void this.annotate());
    const annotate = h("label", { class: "diff-option", title: "Show the commit that last changed each line (git blame). Click an annotation to go to its commit." }, this.annotateBox, "Annotate");
    this.historyBtn = btn(icon("history"), "Show the history of this file", () => this.source && this.onHistory(this.source.path));
    const editBtn = btn(icon("edit"), "Open in the editor (F4)", () => this.openInEditor(), "openInEditor");
    editBtn.classList.add("diff-open-editor");
    this.previewBtn = h("button", { class: "tb-button diff-preview-toggle", hidden: true }, "Preview");
    this.previewBtn.addEventListener("click", () => {
      settings.markdownPreview = !settings.markdownPreview;
      save();
      this.renderPreview(true);
    });
    const toolbar = h(
      "div",
      { class: "diff-toolbar" },
      btn(icon("up"), "Previous change (Shift+F7)", () => this.goToDiff("previous"), "previousChange"),
      btn(icon("down"), "Next change (F7)", () => this.goToDiff("next"), "nextChange"),
      btn(icon("prev-file"), "Previous file (Alt+Up)", () => this.onPrevFile(), "previousFile"),
      btn(icon("next-file"), "Next file (Alt+Down)", () => this.onNextFile(), "nextFile"),
      this.title,
      copyPath,
      this.historyBtn,
      editBtn,
      this.stats,
      h("span", { class: "spacer" }),
      this.sides,
      this.previewBtn,
      annotate,
      toggle("Side by side", "sideBySide", "Show the two versions side by side, or in one column"),
      toggle("Ignore whitespace", "ignoreWhitespace", "Ignore leading and trailing whitespace changes"),
      toggle("Collapse unchanged", "collapseUnchanged", "Hide unchanged regions"),
      btn(icon("close"), "Hide the diff panel", () => this.onHide(), "hideDiff"),
    );
    this.notice = h("div", { class: "diff-notice" });
    this.host = h("div", { class: "diff-host" });
    this.singleHost = h("div", { class: "diff-host", hidden: true });
    this.previewHost = h("div", { class: "diff-host md-preview", hidden: true, tabIndex: 0 });
    this.el = h("section", { class: "diff" }, toolbar, h("div", { class: "diff-area" }, this.notice, this.host, this.singleHost, this.previewHost));
    this.editor = monaco.editor.createDiffEditor(this.host, {
      readOnly: true,
      originalEditable: false,
      automaticLayout: true,
      useInlineViewWhenSpaceIsLimited: false,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      renderOverviewRuler: true,
      ...editorFont(),
    });
    this.noteLayer.attach(this.editor.getModifiedEditor());
    views.add(this);
    this.applyOptions();
    this.editor.onDidUpdateDiff(() => {
      this.updateStats();
      this.renderHunks();
      this.renderListHunks();
      this.renderNotes();
      this.renderRevert();
      this.markPreview();
    });
    this.trackCursor(this.editor.getModifiedEditor());
    this.editor.getModifiedEditor().onMouseDown((ev) => {
      if (ev.target.type !== monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN) return;
      // The left lane has the revert buttons, the right lane the check boxes of a commit.
      const glyph = this.revertGlyphs.find((g) => g.line === ev.target.position?.lineNumber);
      const lane = (ev.target.detail as monaco.editor.IMouseTargetMarginData | undefined)?.glyphMarginLane;
      if (glyph && (!this.selectable || lane === monaco.editor.GlyphMarginLane.Left)) return this.revertChange(glyph.change);
      if (!this.selectable) return;
      const line = ev.target.position?.lineNumber;
      const hunk = this.hunks.find((x) => x.glyphLine === line);
      if (!hunk) return;
      const ex = this.selectable.excluded;
      if (ex.has(hunk.id)) ex.delete(hunk.id);
      else ex.add(hunk.id);
      this.renderHunks();
      this.selectable.onChange(ex, ex.size ? this.partialContent() : null);
    });
    this.listenForBlameClicks(this.editor.getModifiedEditor());
    const modified = this.editor.getModifiedEditor();
    this.moveKey = modified.createContextKey("gittorCanMoveChange", false);
    modified.onContextMenu((e) => (this.menuAt = { x: e.event.posx, y: e.event.posy }));
    modified.addAction({
      id: "gittor.moveChange",
      label: "Move Change to Another Changelist…",
      precondition: "gittorCanMoveChange",
      contextMenuGroupId: "0_changelist",
      run: (ed) => {
        const line = ed.getPosition()?.lineNumber;
        const fn = this.onMoveChange;
        // Open the menu after the click that chose this action, so that click does not close it.
        if (line && fn) setTimeout(() => fn(line, this.menuAt), 50);
      },
    });
    this.revertKey = modified.createContextKey("gittorCanRevert", false);
    modified.addAction({
      id: "gittor.revertChange",
      label: "Revert This Change",
      precondition: "gittorCanRevert",
      contextMenuGroupId: "0_changelist",
      contextMenuOrder: 0,
      run: (ed) => {
        const line = ed.getPosition()?.lineNumber ?? 0;
        const c = (this.editor.getLineChanges() ?? []).find((x) =>
          x.modifiedEndLineNumber === 0 ? line === x.modifiedStartLineNumber || line === x.modifiedStartLineNumber + 1 : line >= x.modifiedStartLineNumber && line <= x.modifiedEndLineNumber,
        );
        if (c) this.revertChange(c);
      },
    });
    this.message("Select a file to see the diff.");
  }

  /**
   * The right side is the working tree: each change gets a revert button, and the menu gets Revert This
   * Change. `fn` writes the new text of the file when the text on disk is still `expected`. Null turns
   * it off. Call it before show().
   */
  setRevert(fn: ((path: string, text: string, expected: string) => void) | null) {
    this.onRevert = fn;
    this.renderRevert();
  }

  private revertChange(c: monaco.editor.ILineChange) {
    if (!this.onRevert || !this.path) return;
    this.onRevert(this.path, revertChange(this.texts.left, this.texts.right, c), this.texts.right);
  }

  /**
   * The revert buttons (») of the changes, in the middle as in IntelliJ: in the gutter of the right side,
   * at the line between the two sides. They take the left lane of the gutter; the commit check boxes of
   * the Changes tab take the right lane, so both show.
   */
  private renderRevert() {
    const right = this.editor.getModifiedEditor();
    const on = !!this.onRevert && this.notice.hidden && this.singleHost.hidden;
    this.revertKey?.set(on);
    const changes = on ? this.editor.getLineChanges() ?? [] : [];
    const last = right.getModel()?.getLineCount() ?? 1;
    // A change without lines on the right gets the button on the line after it.
    this.revertGlyphs = changes.map((c) => ({
      line: Math.min(last, Math.max(1, c.modifiedEndLineNumber === 0 ? c.modifiedStartLineNumber + 1 : c.modifiedStartLineNumber)),
      change: c,
    }));
    if (!this.selectable) right.updateOptions({ glyphMargin: changes.length > 0 });
    this.revertDeco = right.deltaDecorations(
      this.revertDeco,
      this.revertGlyphs.map((g) => ({
        range: new monaco.Range(g.line, 1, g.line, 1),
        options: {
          glyphMarginClassName: "revert-glyph",
          glyphMarginHoverMessage: { value: "Revert this change: the working tree gets the lines of the left side" },
          glyphMargin: { position: monaco.editor.GlyphMarginLane.Left, persistLane: true },
        },
      })),
    );
  }

  private listenForBlameClicks(e: monaco.editor.IStandaloneCodeEditor | monaco.editor.ICodeEditor) {
    e.onMouseDown((ev) => {
      if (!this.annotateBox.checked || this.blameEditor !== e || ev.target.type !== monaco.editor.MouseTargetType.GUTTER_LINE_NUMBERS) return;
      const oid = this.blameOids[(ev.target.position?.lineNumber ?? 0) - 1];
      if (oid) this.onBlameClick(oid);
    });
  }

  private get single(): monaco.editor.IStandaloneCodeEditor {
    if (!this.singleEditor) {
      this.singleEditor = monaco.editor.create(this.singleHost, {
        readOnly: true,
        automaticLayout: true,
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        ...editorFont(),
      });
      this.listenForBlameClicks(this.singleEditor);
      this.trackCursor(this.singleEditor);
      this.noteLayer.attach(this.singleEditor);
    }
    return this.singleEditor;
  }

  applySettings() {
    this.applyOptions();
    this.editor.updateOptions(editorFont());
    this.singleEditor?.updateOptions(editorFont());
    for (const box of this.el.querySelectorAll<HTMLInputElement>(".diff-option input[data-key]")) box.checked = !!settings[box.dataset.key as "sideBySide"];
  }

  private applyOptions() {
    this.editor.updateOptions({
      renderSideBySide: settings.sideBySide,
      ignoreTrimWhitespace: settings.ignoreWhitespace,
      hideUnchangedRegions: { enabled: settings.collapseUnchanged },
    });
    // The revert buttons move with the layout.
    if (this.revertKey) this.renderRevert();
    // Side by side also chooses one or two columns of the preview.
    if (this.previewHost && !this.previewHost.hidden) this.renderPreview(true);
  }

  goToDiff(target: "next" | "previous") {
    if (!this.previewHost.hidden) return this.previewGo(target);
    this.editor.goToDiff(target);
  }

  focus() {
    this.editor.getModifiedEditor().focus();
  }

  private updateStats() {
    if (!this.notice.hidden) return;
    const changes = this.editor.getLineChanges() ?? [];
    let add = 0;
    let del = 0;
    for (const c of changes) {
      if (c.modifiedEndLineNumber > 0) add += c.modifiedEndLineNumber - c.modifiedStartLineNumber + 1;
      if (c.originalEndLineNumber > 0) del += c.originalEndLineNumber - c.originalStartLineNumber + 1;
    }
    this.stats.replaceChildren(
      h("span", { class: "stat-add" }, `+${add}`),
      " ",
      h("span", { class: "stat-del" }, `−${del}`),
      h("span", { class: "muted-inline" }, ` · ${changes.length} change${changes.length === 1 ? "" : "s"}`),
    );
    if (this.keepScroll) {
      // The same file again: the new diff can move the view, so the old place comes back after it.
      const ed = this.editor.getModifiedEditor();
      ed.setScrollTop(this.keepScroll.top);
      ed.setScrollLeft(this.keepScroll.left);
      this.keepScroll = null;
      this.revealFirst = false;
    } else if (changes.length && this.revealFirst) {
      // Only once for a new file: a later update of the same diff keeps the place of the user.
      this.editor.revealLineInCenter(changes[0].modifiedStartLineNumber || 1);
      this.revealFirst = false;
    }
  }

  private blameOids: (string | null)[] = [];

  /**
   * Turns on the check boxes of the changes, for a local file. Unchecked changes stay out of the commit.
   * Call it before show().
   */
  setSelectable(sel: { excluded: Set<string>; onChange: (excluded: Set<string>, content: string | null) => void } | null) {
    this.selectable = sel;
    this.editor.getModifiedEditor().updateOptions({ glyphMargin: !!sel });
    this.renderHunks();
  }

  /** Local changes: allows "Move Change to Another Changelist". Null turns it off. */
  setMoveChange(fn: ((line: number, at: { x: number; y: number }) => void) | null) {
    this.onMoveChange = fn;
    this.moveKey.set(!!fn);
  }

  /** Marks the changes that are in other changelists. Call it before show(). */
  setListHunks(hunks: { start: number; lines: number; label: string }[]) {
    this.listHunks = hunks;
    this.renderListHunks();
  }

  private renderListHunks() {
    const ed = this.editor.getModifiedEditor();
    const lineCount = ed.getModel()?.getLineCount() ?? 0;
    const deco: monaco.editor.IModelDeltaDecoration[] = [];
    if (this.notice.hidden && this.singleHost.hidden) {
      for (const x of this.listHunks) {
        // A change that only removes lines shows on the line after the removal.
        const start = Math.max(1, Math.min(lineCount, x.lines ? x.start : x.start + 1));
        const end = Math.max(start, Math.min(lineCount, x.lines ? x.start + x.lines - 1 : start));
        deco.push({
          range: new monaco.Range(start, 1, end, 1),
          options: {
            isWholeLine: true,
            className: "hunk-other-list",
            linesDecorationsClassName: "hunk-other-list-bar",
            hoverMessage: { value: `This change is in the changelist ${x.label}` },
          },
        });
      }
    }
    this.listDeco = ed.deltaDecorations(this.listDeco, deco);
  }

  /** Shows review notes on the right side: a mark on each line and a card at its right. With handlers,
   * the user can add a note with the note icon in the gutter or with a double click on a line. show()
   * clears the notes and the handlers, so call it after show(). */
  setNotes(notes: NoteItem[], handlers: NoteHandlers | null = null) {
    this.notes = notes;
    this.renderNotes();
    this.noteLayer.set(notes, handlers);
  }

  /** The editor of the right side: the modified side, or the one editor of an added file. */
  private rightEditor(): monaco.editor.ICodeEditor {
    return this.singleHost.hidden ? this.editor.getModifiedEditor() : this.single;
  }

  private trackCursor(e: monaco.editor.ICodeEditor) {
    e.onDidChangeCursorPosition((ev) => {
      if (ev.source === "mouse" || ev.source === "keyboard") this.userPos = { line: ev.position.lineNumber, column: ev.position.column };
    });
  }

  /** The file of the right side, or "" when the view shows no file. */
  get currentPath(): string {
    return this.path;
  }

  /** Where Open in Editor goes: the cursor after the user moved it, else the first change on the screen,
   * else the first line on the screen. */
  editorPosition(): { line: number; column: number } {
    if (this.userPos) return this.userPos;
    const ed = this.rightEditor();
    const top = ed.getVisibleRanges()[0];
    if (!top) return { line: 1, column: 1 };
    const changes = this.singleHost.hidden ? (this.editor.getLineChanges() ?? []) : [];
    const first = changes.map((c) => Math.max(1, c.modifiedStartLineNumber)).find((l) => l >= top.startLineNumber && l <= top.endLineNumber);
    return { line: first ?? top.startLineNumber, column: 1 };
  }

  openInEditor() {
    if (!this.path) return;
    const p = this.editorPosition();
    this.onOpenInEditor(this.path, p.line, p.column);
  }

  /** The line of the cursor on the right side, 1-based. */
  cursorLine(): number {
    return this.rightEditor().getPosition()?.lineNumber ?? 1;
  }

  revealLine(line: number) {
    const ed = this.rightEditor();
    ed.revealLineInCenter(line);
    ed.setPosition({ lineNumber: line, column: 1 });
    this.userPos = { line, column: 1 };
  }

  private renderNotes() {
    const deco = (ed: monaco.editor.ICodeEditor): monaco.editor.IModelDeltaDecoration[] => {
      const count = ed.getModel()?.getLineCount() ?? 0;
      return this.notes
        .filter((n) => n.line >= 1 && n.line <= count && !n.resolved)
        .map((n) => ({
          range: new monaco.Range(n.line, 1, Math.min(Math.max(n.endLine, n.line), count), 1),
          options: { isWholeLine: true, className: "review-note-line", linesDecorationsClassName: "review-note-bar" },
        }));
    };
    const onSingle = !this.singleHost.hidden;
    this.noteDeco = this.editor.getModifiedEditor().deltaDecorations(this.noteDeco, onSingle ? [] : deco(this.editor.getModifiedEditor()));
    if (this.singleEditor) this.singleNoteDeco = this.singleEditor.deltaDecorations(this.singleNoteDeco, onSingle ? deco(this.singleEditor) : []);
  }

  private renderHunks() {
    const ed = this.editor.getModifiedEditor();
    const changes = this.selectable && this.notice.hidden && this.singleHost.hidden ? this.editor.getLineChanges() ?? [] : [];
    this.hunks = changes.map((c) => ({
      id: `${c.originalStartLineNumber}:${c.originalEndLineNumber}:${c.modifiedStartLineNumber}:${c.modifiedEndLineNumber}`,
      glyphLine: Math.max(1, c.modifiedStartLineNumber),
      change: c,
    }));
    // Drop exclusions of changes that are gone.
    if (this.selectable && changes.length) {
      const ids = new Set(this.hunks.map((x) => x.id));
      let dropped = false;
      for (const id of [...this.selectable.excluded]) {
        if (!ids.has(id)) {
          this.selectable.excluded.delete(id);
          dropped = true;
        }
      }
      if (dropped) this.selectable.onChange(this.selectable.excluded, this.selectable.excluded.size ? this.partialContent() : null);
    }
    const deco: monaco.editor.IModelDeltaDecoration[] = [];
    for (const x of this.hunks) {
      const off = this.selectable!.excluded.has(x.id);
      deco.push({
        range: new monaco.Range(x.glyphLine, 1, x.glyphLine, 1),
        options: {
          glyphMarginClassName: off ? "hunk-off" : "hunk-on",
          glyphMargin: { position: monaco.editor.GlyphMarginLane.Right, persistLane: true },
          glyphMarginHoverMessage: { value: off ? "This change stays out of the commit. Click to include it." : "This change goes into the commit. Click to leave it out." },
        },
      });
      if (off && x.change.modifiedEndLineNumber > 0) {
        deco.push({
          range: new monaco.Range(x.change.modifiedStartLineNumber, 1, x.change.modifiedEndLineNumber, 1),
          options: { isWholeLine: true, className: "hunk-excluded" },
        });
      }
    }
    this.hunkDeco = ed.deltaDecorations(this.hunkDeco, deco);
  }

  /** The file content with only the checked changes applied to the left side. */
  private partialContent(): string {
    const model = this.editor.getModel()!;
    const a = model.original.getLinesContent();
    const b = model.modified.getLinesContent();
    const out: string[] = [];
    let pos = 1;
    for (const x of this.hunks) {
      const c = x.change;
      const oStart = c.originalEndLineNumber === 0 ? c.originalStartLineNumber + 1 : c.originalStartLineNumber;
      const oEnd = c.originalEndLineNumber === 0 ? c.originalStartLineNumber : c.originalEndLineNumber;
      out.push(...a.slice(pos - 1, oStart - 1));
      if (this.selectable!.excluded.has(x.id)) out.push(...a.slice(oStart - 1, oEnd));
      else if (c.modifiedEndLineNumber > 0) out.push(...b.slice(c.modifiedStartLineNumber - 1, c.modifiedEndLineNumber));
      pos = oEnd + 1;
    }
    out.push(...a.slice(pos - 1));
    return out.join(model.modified.getEOL());
  }

  /** Sets what Annotate and History use for the file on show. */
  setSource(source: { path: string; rev: RevSpec } | null) {
    this.source = source;
    this.historyBtn.disabled = !source;
  }

  private clearBlame() {
    this.blameRequest++;
    if (this.blameEditor) {
      this.blameEditor.updateOptions({ lineNumbers: "on", lineNumbersMinChars: 5 });
      this.blameDeco = this.blameEditor.deltaDecorations(this.blameDeco, []);
    }
    this.blameEditor = null;
    this.blameOids = [];
  }

  /** Shows the annotations of the source file in the gutter of the right editor. */
  private async annotate() {
    this.clearBlame();
    if (!this.annotateBox.checked || !this.source || !this.notice.hidden) return;
    const req = this.blameRequest;
    const editor = this.singleHost.hidden ? this.editor.getModifiedEditor() : this.single;
    let blame: Blame;
    try {
      blame = await this.onBlame(this.source.path, this.source.rev);
    } catch (e) {
      if (req === this.blameRequest) this.stats.append(h("span", { class: "muted-inline" }, ` · annotate: ${String(e).replace(/^Error: /, "")}`));
      return;
    }
    if (req !== this.blameRequest) return;
    const now = Date.now() / 1000;
    const times = blame.commits.filter((c) => !c.uncommitted).map((c) => c.time);
    const oldest = Math.min(now, ...times);
    const labels: string[] = [];
    const deco: monaco.editor.IModelDeltaDecoration[] = [];
    this.blameOids = [];
    blame.lines.forEach((ci, i) => {
      const c = blame.commits[ci];
      const first = i === 0 || blame.lines[i - 1] !== ci;
      this.blameOids.push(c.uncommitted ? null : c.oid);
      const date = new Date(c.time * 1000).toISOString().slice(0, 10);
      labels.push(!first ? "" : c.uncommitted ? "not committed" : `${date} ${c.author.length > 14 ? c.author.slice(0, 13) + "…" : c.author}`);
      // Newer lines get a stronger color, as in IntelliJ.
      const age = c.uncommitted ? 0 : Math.min(4, Math.floor(((now - c.time) / Math.max(1, now - oldest)) * 5));
      deco.push({
        range: new monaco.Range(i + 1, 1, i + 1, 1),
        options: {
          linesDecorationsClassName: `blame-age-${age}`,
          lineNumberClassName: first ? "blame-first" : "blame-rest",
          lineNumberHoverMessage: c.uncommitted ? { value: "Not committed yet" } : { value: `**${c.oid.slice(0, 8)}** ${c.author}, ${date}\n\n${c.summary}` },
        } as monaco.editor.IModelDecorationOptions,
      });
    });
    editor.updateOptions({ lineNumbers: (n: number) => labels[n - 1] ?? "", lineNumbersMinChars: 26 });
    this.blameDeco = editor.deltaDecorations([], deco);
    this.blameEditor = editor;
  }

  /** The names of the two sides, for the toolbar and the labels of the preview columns. */
  private sideNames: [string, string] = ["", ""];

  setSides(left: string, right: string) {
    this.sideNames = [left, right];
    this.sides.textContent = `${left}  ⟷  ${right}`;
  }

  message(text: string, title = "") {
    this.shownKey = "";
    this.clearBlame();
    this.noteLayer.clear();
    this.setSource(null);
    this.path = "";
    this.userPos = null;
    this.sides.textContent = "";
    this.title.textContent = title;
    this.stats.textContent = "";
    this.notice.textContent = text;
    this.notice.hidden = false;
    this.setModels("", "", undefined);
    this.markdown = null;
    this.renderPreview();
  }

  show(change: Change, left: FileContent, right: FileContent) {
    // The same file with the same texts, for example after a change of another file on disk: the diff
    // stays as it is. A new diff would draw both editors again, and the view would flash.
    const key = JSON.stringify([change.path, change.old_path, change.status, left, right]);
    if (key === this.shownKey && this.notice.hidden) return;
    this.shownKey = key;
    this.clearBlame();
    this.notes = [];
    this.noteLayer.clear();
    queueMicrotask(() => void this.annotate());
    // The same file again (for example after it changed on disk): keep the scroll position.
    const same = change.path === this.path && this.notice.hidden && this.editorMode === "diff";
    this.keepView = same ? this.editor.getModifiedEditor().saveViewState() : null;
    const ed = this.editor.getModifiedEditor();
    this.keepScroll = same ? { top: ed.getScrollTop(), left: ed.getScrollLeft() } : null;
    this.revealFirst = !same;
    if (!same) this.userPos = null;
    this.path = change.path;
    this.title.replaceChildren(
      h("span", { class: `status status-${change.status}`, title: statusName(change.status) }, change.status),
      " ",
      change.old_path ? `${change.old_path} → ${change.path}` : change.path,
    );
    // A submodule, or a Git LFS object that is not downloaded.
    const note = left.note ?? right.note;
    if (note) this.title.append(h("span", { class: "muted-inline diff-note" }, ` · ${note}`));
    this.stats.textContent = "";
    const tooBig = (f: FileContent) => !f.binary && !f.missing && f.text === null && f.size > 0;
    if (left.binary || right.binary) return this.showNotice("Binary file. The contents cannot be compared as text.");
    if (tooBig(left) || tooBig(right)) return this.showNotice("The file is larger than 5 MB. The diff is not shown.");
    this.notice.hidden = true;
    const lang = languageFor(change.path);
    const kind = left.missing === right.missing ? "diff" : right.missing ? "deleted" : "added";
    this.markdown = lang === "markdown" ? { left: left.text ?? "", right: right.text ?? "", kind } : null;
    if (kind !== "diff") this.showSingle(kind === "deleted" ? left.text ?? "" : right.text ?? "", lang, kind);
    else this.setModels(left.text ?? "", right.text ?? "", lang);
    this.renderPreview(same);
  }

  /**
   * Shows the rendered Markdown in place of the editors when the file is Markdown and the preview is on;
   * else the editor of the file. `keep` keeps the scroll position, for the same file.
   */
  private renderPreview(keep = false) {
    const on = !!this.markdown && settings.markdownPreview;
    this.previewBtn.hidden = !this.markdown;
    this.previewBtn.classList.toggle("on", on);
    this.previewBtn.title = on ? "Show the Markdown source" : "Show the rendered Markdown";
    // Annotate needs the lines of the source.
    this.annotateBox.disabled = on;
    if (!on || !this.markdown) {
      const was = !this.previewHost.hidden;
      this.previewHost.hidden = true;
      this.previewHost.replaceChildren();
      this.oldBlocks = [];
      if (this.notice.hidden) {
        this.host.hidden = this.editorMode !== "diff";
        this.singleHost.hidden = this.editorMode !== "single";
        if (was && this.annotateBox.checked) void this.annotate();
      }
      return;
    }
    const top = keep ? this.previewHost.scrollTop : 0;
    this.host.hidden = true;
    this.singleHost.hidden = true;
    this.previewHost.hidden = false;
    const source = this.source;
    const ctx = {
      dir: this.path.includes("/") ? this.path.slice(0, this.path.lastIndexOf("/")) : "",
      loadImage: source ? (p: string) => api.imageData(source.rev, p) : null,
      mermaid: mermaidSvg,
      openUrl: (url: string) => void api.openUrl(url),
    };
    const m = this.markdown;
    const column = (text: string, label: string) => {
      const doc = renderMarkdown(text, ctx);
      return { doc, el: h("div", { class: "md-col" }, h("div", { class: "md-col-label" }, label), doc) };
    };
    this.oldBlocks = [];
    let cols: HTMLElement[];
    if (m.kind !== "diff") {
      cols = [column(m.kind === "deleted" ? m.left : m.right, m.kind === "deleted" ? "Deleted file" : "New file").el];
    } else if (settings.sideBySide) {
      cols = [column(m.left, this.sideNames[0] || "Before").el, column(m.right, this.sideNames[1] || "After").el];
    } else {
      // One column: the old blocks that a change removed show between the new blocks.
      this.oldBlocks = blocksOf(renderMarkdown(m.left, ctx));
      cols = [column(m.right, this.sideNames[1] || "After").el];
    }
    this.previewHost.replaceChildren(h("div", { class: `md-cols md-cols-${cols.length}` }, ...cols));
    this.previewHost.scrollTop = top;
    this.markPreview();
  }

  /** Draws the preview again, for example in the colors of a new theme. */
  refreshPreview() {
    if (!this.previewHost.hidden) this.renderPreview(true);
  }

  /** Marks the blocks that the diff changed: green added, red removed, yellow changed. */
  private markPreview() {
    if (this.previewHost.hidden || this.markdown?.kind !== "diff") return;
    const changes = this.editor.getLineChanges() ?? [];
    const docs = [...this.previewHost.querySelectorAll<HTMLElement>(".md-col > .md-body")];
    const mark = (blocks: { el: HTMLElement; block: [number, number] }[], side: "original" | "modified") => {
      const marks = markBlocks(blocks.map((b) => b.block), changes, side);
      blocks.forEach((b, i) => {
        b.el.classList.remove("md-added", "md-removed", "md-changed");
        const m = marks[i];
        if (m) b.el.classList.add(`md-${m}`);
      });
    };
    if (docs.length === 2) {
      mark(blocksOf(docs[0]), "original");
      mark(blocksOf(docs[1]), "modified");
      return;
    }
    const doc = docs[0];
    for (const b of this.oldBlocks) b.el.remove();
    const blocks = blocksOf(doc);
    mark(blocks, "modified");
    const anchors = removedAnchors(this.oldBlocks.map((b) => b.block), changes);
    this.oldBlocks.forEach((b, i) => {
      const at = anchors[i];
      if (at === null) return;
      b.el.classList.remove("md-added", "md-changed");
      b.el.classList.add("md-removed");
      // Before the new block that holds the line, so the old text comes first, as in a diff.
      const before = blocks.find((x) => x.block[1] >= at)?.el;
      if (before) doc.insertBefore(b.el, before);
      else doc.append(b.el);
    });
  }

  /** Scrolls the preview to the next or the previous marked block (F7, Shift+F7). */
  private previewGo(target: "next" | "previous") {
    const box = this.previewHost.getBoundingClientRect();
    const tops = [...this.previewHost.querySelectorAll<HTMLElement>(".md-added, .md-removed, .md-changed")]
      .map((el) => el.getBoundingClientRect().top - box.top + this.previewHost.scrollTop)
      .sort((a, b) => a - b);
    const now = this.previewHost.scrollTop + 24;
    const to = target === "next" ? tops.find((t) => t > now + 4) : [...tops].reverse().find((t) => t < now - 4);
    if (to !== undefined) this.previewHost.scrollTop = Math.max(0, to - 24);
  }

  /** An added or deleted file: its whole content in one editor, marked as added or removed. */
  private showSingle(text: string, lang: string | undefined, kind: "added" | "deleted") {
    this.editorMode = "single";
    this.host.hidden = true;
    this.singleHost.hidden = false;
    const old = this.single.getModel();
    const model = monaco.editor.createModel(text, lang);
    this.single.setModel(model);
    old?.dispose();
    const lines = text.endsWith("\n") ? model.getLineCount() - 1 : model.getLineCount();
    this.single.createDecorationsCollection([
      {
        range: new monaco.Range(1, 1, Math.max(1, lines), 1),
        options: { isWholeLine: true, className: kind === "added" ? "line-added" : "line-deleted" },
      },
    ]);
    this.stats.replaceChildren(
      kind === "added" ? h("span", { class: "stat-add" }, `+${lines}`) : h("span", { class: "stat-del" }, `−${lines}`),
      h("span", { class: "muted-inline" }, kind === "added" ? " · new file" : " · deleted file"),
    );
  }

  private showNotice(text: string) {
    this.notice.textContent = text;
    this.notice.hidden = false;
    this.setModels("", "", undefined);
    this.markdown = null;
    this.renderPreview();
  }

  /** The file and the texts that the diff shows, to skip a show of the same diff. */
  private shownKey = "";
  private keepView: monaco.editor.ICodeEditorViewState | null = null;
  /** The scroll position of the same file, for after its new diff. */
  private keepScroll: { top: number; left: number } | null = null;
  /** Scroll to the first change when the diff is ready; not when the same file is shown again. */
  private revealFirst = true;

  private setModels(a: string, b: string, lang: string | undefined) {
    this.texts = { left: a, right: b };
    const old = this.editor.getModel();
    // The same file, changed on disk: new texts in the models that show now. The editors keep their
    // lines on the screen, so the view does not flash.
    if (this.keepView && old && !this.host.hidden && old.modified.getLanguageId() === (lang ?? "plaintext")) {
      for (const [m, t] of [[old.original, a], [old.modified, b]] as const) if (m.getValue() !== t) m.pushEditOperations([], [{ range: m.getFullModelRange(), text: t }], () => null);
      this.keepView = null;
      return;
    }
    this.editorMode = "diff";
    this.host.hidden = false;
    this.singleHost.hidden = true;
    this.editor.setModel({ original: monaco.editor.createModel(a, lang), modified: monaco.editor.createModel(b, lang) });
    // A diff of the old models can still run in the worker. It fails with "no diff result available"
    // when its models are gone, so they go a little later.
    if (old) setTimeout(() => {
      old.original.dispose();
      old.modified.dispose();
    }, 3000);
    if (this.keepView) {
      const ed = this.editor.getModifiedEditor();
      ed.restoreViewState(this.keepView);
      if (this.keepScroll) ed.setScrollTop(this.keepScroll.top);
      this.keepView = null;
    }
  }
}

export function languageFor(path: string): string | undefined {
  const name = path.slice(path.lastIndexOf("/") + 1).toLowerCase();
  const ext = name.includes(".") ? "." + name.split(".").pop() : name;
  for (const l of monaco.languages.getLanguages()) {
    if (l.extensions?.includes(ext) || l.filenames?.map((f) => f.toLowerCase()).includes(name)) return l.id;
  }
  return undefined;
}
