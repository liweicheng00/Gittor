// Find in the rendered Markdown preview: a small bar over the preview, as the find widget of Monaco.
// The matches get the highlight "preview-find" of the CSS Custom Highlight API, and the current one
// "preview-find-current".

import { h, icon } from "./dom";

type Highlights = { set(name: string, h: unknown): void; delete(name: string): void };
const highlights = (): Highlights | null => ((globalThis as unknown as { CSS?: { highlights?: Highlights } }).CSS?.highlights ?? null);
const Highlight = (globalThis as unknown as { Highlight?: new (...r: Range[]) => unknown }).Highlight;

/** The places of `query` in `text`, without case. */
export function matchOffsets(text: string, query: string): number[] {
  const q = query.toLowerCase();
  if (!q) return [];
  const t = text.toLowerCase();
  const out: number[] = [];
  for (let at = t.indexOf(q); at >= 0; at = t.indexOf(q, at + q.length)) out.push(at);
  return out;
}

export class PreviewFind {
  readonly el: HTMLElement;
  private readonly input: HTMLInputElement;
  private readonly count: HTMLElement;
  private ranges: Range[] = [];
  private current = 0;

  constructor(private readonly host: HTMLElement) {
    this.input = h("input", { class: "preview-find-input", type: "search", placeholder: "Find", spellcheck: false });
    this.count = h("span", { class: "preview-find-count muted-inline" });
    const prev = h("button", { class: "icon-button", title: "Previous match (Shift+Enter)" }, icon("up"));
    const next = h("button", { class: "icon-button", title: "Next match (Enter)" }, icon("down"));
    const close = h("button", { class: "icon-button", title: "Close (Escape)" }, icon("close"));
    prev.addEventListener("click", () => this.step(-1));
    next.addEventListener("click", () => this.step(1));
    close.addEventListener("click", () => this.close());
    this.el = h("div", { class: "preview-find", hidden: true, role: "search" }, this.input, this.count, prev, next, close);
    this.input.addEventListener("input", () => this.search());
    this.input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        this.step(e.shiftKey ? -1 : 1);
      } else if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        this.close();
      }
    });
  }

  get open(): boolean {
    return !this.el.hidden;
  }

  /** Shows the bar with the selected text, or the last query, and searches. */
  show() {
    const sel = window.getSelection()?.toString().trim() ?? "";
    if (sel && !sel.includes("\n") && this.host.contains(window.getSelection()?.anchorNode ?? null)) this.input.value = sel;
    this.el.hidden = false;
    this.input.focus();
    this.input.select();
    this.search();
  }

  close() {
    this.el.hidden = true;
    this.clear();
    this.host.focus();
  }

  /** Searches again, for example after the preview drew new text. */
  refresh() {
    if (this.open) this.search(false);
  }

  private clear() {
    this.ranges = [];
    highlights()?.delete("preview-find");
    highlights()?.delete("preview-find-current");
  }

  private search(reveal = true) {
    this.clear();
    const query = this.input.value;
    if (query) {
      // The text of each text node, and its place in the whole text of the preview.
      const nodes: { node: Text; start: number }[] = [];
      let text = "";
      const walker = document.createTreeWalker(this.host, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        nodes.push({ node: n as Text, start: text.length });
        text += (n as Text).data;
      }
      const point = (offset: number): [Text, number] => {
        let i = nodes.length - 1;
        while (i > 0 && nodes[i].start > offset) i--;
        return [nodes[i].node, offset - nodes[i].start];
      };
      for (const at of matchOffsets(text, query)) {
        const r = document.createRange();
        r.setStart(...point(at));
        r.setEnd(...point(at + query.length));
        this.ranges.push(r);
      }
    }
    this.current = 0;
    if (Highlight && highlights() && this.ranges.length) highlights()!.set("preview-find", new Highlight(...this.ranges));
    this.showCurrent(reveal);
  }

  private step(by: number) {
    if (!this.ranges.length) return;
    this.current = (this.current + by + this.ranges.length) % this.ranges.length;
    this.showCurrent(true);
  }

  private showCurrent(reveal: boolean) {
    const n = this.ranges.length;
    this.count.textContent = this.input.value ? (n ? `${this.current + 1} of ${n}` : "No results") : "";
    const r = this.ranges[this.current];
    if (!r) return;
    if (Highlight && highlights()) highlights()!.set("preview-find-current", new Highlight(r));
    if (!reveal) return;
    const box = r.getBoundingClientRect();
    const view = this.host.getBoundingClientRect();
    if (box.top < view.top + 40 || box.bottom > view.bottom - 10) this.host.scrollTop += box.top - view.top - view.height / 3;
  }
}
