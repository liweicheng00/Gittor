// Renders Markdown for the preview of the diff panel: markdown-it makes the HTML, DOMPurify removes what
// could run code or load from the network, and Monaco colors the code blocks. A Mermaid block becomes
// the SVG of the backend (mmdflux) in an <img>. Each top-level block keeps its source lines in data-src
// ("start-end", 1-based), so a diff can mark the blocks that it changed.

import MarkdownIt from "markdown-it";
import DOMPurify from "dompurify";
import type { MermaidSvg } from "./api";
import * as monaco from "./monaco";
import { type KeyedItem, reconcile } from "./keyed";
import { h } from "./dom";
import { resolvePath, slug, type Block } from "./markdown-model";

/** What the preview needs from the app. */
export interface PreviewContext {
  /** The folder of the Markdown file in the repository, for relative image paths. */
  dir: string;
  /** An image of the repository as a data URL, or null. */
  loadImage: ((path: string) => Promise<string | null>) | null;
  /** The SVG of a Mermaid diagram, or why there is none. Null: Mermaid blocks stay code. */
  mermaid: ((source: string) => Promise<MermaidSvg>) | null;
  openUrl: (url: string) => void;
}

const md = new MarkdownIt({ html: true, linkify: true });

// The source lines of each top-level block.
md.core.ruler.push("gittor_source_lines", (state) => {
  for (const t of state.tokens) if (t.map && t.level === 0 && t.nesting !== -1) t.attrSet("data-src", `${t.map[0] + 1}-${t.map[1]}`);
});

// Anchors for the headings, with a prefix, so an id of the document cannot hide an id of the app.
md.core.ruler.push("gittor_heading_ids", (state) => {
  const seen = new Map<string, number>();
  state.tokens.forEach((t, i) => {
    if (t.type !== "heading_open") return;
    const base = slug(state.tokens[i + 1]?.content ?? "");
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    t.attrSet("id", `md-${n ? `${base}-${n}` : base}`);
  });
});

// Task lists: "- [ ] text" and "- [x] text" get a check box.
md.core.ruler.after("inline", "gittor_task_lists", (state) => {
  const tokens = state.tokens;
  for (let i = 2; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type !== "inline" || tokens[i - 1].type !== "paragraph_open" || tokens[i - 2].type !== "list_item_open") continue;
    const first = t.children?.[0];
    const m = first?.type === "text" ? /^\[([ xX])\]\s/.exec(first.content) : null;
    if (!first || !m) continue;
    first.content = first.content.slice(m[0].length);
    const box = new state.Token("html_inline", "", 0);
    box.content = `<input type="checkbox" disabled${m[1] === " " ? "" : " checked"}> `;
    t.children!.unshift(box);
    tokens[i - 2].attrJoin("class", "task-item");
  }
});

// An HTML block keeps its source lines in a wrapper.
md.renderer.rules.html_block = (tokens, i) => {
  const src = tokens[i].attrGet("data-src");
  return src ? `<div data-src="${src}">${tokens[i].content}</div>` : tokens[i].content;
};

const PURIFY = {
  // No styles, forms, frames or media: they could change the app or load from the network.
  FORBID_TAGS: ["style", "form", "iframe", "object", "embed", "video", "audio", "source", "track"],
  FORBID_ATTR: ["style", "srcset"],
  RETURN_DOM_FRAGMENT: true as const,
};

// Images: a data: image stays; a URL is blocked; a relative path loads from the repository later.
DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  if (node.nodeName === "IMG") {
    const src = node.getAttribute("src") ?? "";
    if (/^data:image\//i.test(src)) return;
    node.removeAttribute("src");
    if (/^([a-z][a-z0-9+.-]*:|\/\/)/i.test(src)) node.setAttribute("data-blocked", src);
    else if (src) node.setAttribute("data-path", src);
  } else if (node.nodeName === "A") {
    node.removeAttribute("target");
  }
});

/** The Monaco language of the info string of a code block: an id, an alias or an extension. */
function languageOf(info: string): string | undefined {
  const name = info.toLowerCase();
  if (!name) return undefined;
  for (const l of monaco.languages.getLanguages()) {
    if (l.id === name || l.aliases?.some((a) => a.toLowerCase() === name) || l.extensions?.includes(`.${name}`)) return l.id;
  }
  return undefined;
}

/** A note in place of an image that the preview does not show. */
const imageNote = (text: string, title: string) => h("span", { class: "md-image-note", title }, text);

/** Renders Markdown. The images and the colors of the code come a little later. */
export function renderMarkdown(text: string, ctx: PreviewContext): HTMLElement {
  const root = h("div", { class: "md-body" });
  root.append(DOMPurify.sanitize(md.render(text), PURIFY));
  // A fenced code block has its lines on <code>; the marks of a diff go on <pre>.
  for (const code of root.querySelectorAll<HTMLElement>("pre > code[data-src]")) {
    code.parentElement!.setAttribute("data-src", code.getAttribute("data-src")!);
    code.removeAttribute("data-src");
  }
  for (const img of root.querySelectorAll<HTMLImageElement>("img[data-blocked]")) {
    const url = img.dataset.blocked ?? "";
    let host = url;
    try {
      host = new URL(url, "https://x").host;
    } catch {}
    img.replaceWith(imageNote(`Image from ${host} is blocked`, `${img.alt ? `${img.alt}\n` : ""}${url}\nThe preview does not load images from the network.`));
  }
  for (const img of root.querySelectorAll<HTMLImageElement>("img[data-path]")) {
    const link = img.dataset.path ?? "";
    const path = resolvePath(ctx.dir, link);
    if (!path || !ctx.loadImage) {
      img.replaceWith(imageNote(`Image ${link} is not in the repository`, link));
      continue;
    }
    ctx
      .loadImage(path)
      .then((url) => (url ? (img.src = url) : img.replaceWith(imageNote(`Image ${path} is not found`, path))))
      .catch(() => img.replaceWith(imageNote(`Image ${path} is not found`, path)));
  }
  for (const code of root.querySelectorAll<HTMLElement>("pre > code.language-mermaid")) showMermaid(code.parentElement!, code.textContent ?? "", ctx);
  for (const code of root.querySelectorAll<HTMLElement>("pre > code")) {
    const info = /(?:^|\s)language-(\S+)/.exec(code.className)?.[1] ?? "";
    const lang = languageOf(info);
    if (!lang) continue;
    code.setAttribute("data-lang", lang);
    // colorize, not colorizeElement: colorizeElement sets the theme of all Monaco editors, to "vs" when
    // it gets no theme. colorize only gives the HTML of the tokens, with the text escaped.
    void monaco.editor.colorize(code.textContent ?? "", lang, {}).then(
      (html) => (code.innerHTML = html),
      () => {},
    );
  }
  root.addEventListener("click", (e) => {
    const a = (e.target as HTMLElement).closest("a");
    if (!a) return;
    e.preventDefault();
    const href = a.getAttribute("href") ?? "";
    if (href.startsWith("#")) {
      root.querySelector(`#md-${CSS.escape(decodeURIComponent(href.slice(1)).toLowerCase())}`)?.scrollIntoView({ block: "start" });
    } else if (/^(https?:|mailto:)/i.test(href)) {
      ctx.openUrl(href);
    }
  });
  return root;
}

/**
 * Puts the diagram of a Mermaid block in place of its code, when the backend can draw it. A diagram type
 * that it cannot draw, or a syntax error, keeps the code with a short note. The block keeps its source
 * lines, so the marks of a diff still find it.
 */
function showMermaid(pre: HTMLElement, source: string, ctx: PreviewContext) {
  if (!ctx.mermaid) return;
  // The block is a wrapper from the start, so the marks of a diff and the moves of one column keep it
  // when the diagram comes.
  const box = h("div", { class: "md-mermaid" });
  const src = pre.getAttribute("data-src");
  if (src) {
    box.setAttribute("data-src", src);
    pre.removeAttribute("data-src");
  }
  pre.replaceWith(box);
  box.append(pre);
  ctx
    .mermaid(source)
    .then((r) => {
      if (r.svg) {
        const img = h("img", { class: "md-mermaid-img", alt: "Mermaid diagram", title: "Mermaid diagram", src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(r.svg)}` });
        // The natural size of the diagram; a narrow column makes it smaller, never larger.
        const box = /<svg[^>]*\bviewBox="[\d.-]+[ ,]+[\d.-]+[ ,]+([\d.]+)[ ,]+([\d.]+)"/.exec(r.svg);
        const width = Number(/<svg[^>]*\swidth="([\d.]+)(?:px)?"/.exec(r.svg)?.[1] ?? box?.[1] ?? 0);
        if (width > 0) img.style.width = `${Math.round(width)}px`;
        pre.replaceWith(img);
      } else {
        const first = (r.error ?? "").split("\n")[0].slice(0, 160);
        box.prepend(h("div", { class: "md-image-note md-mermaid-note", title: r.error ?? "" }, `This Mermaid diagram is not shown: ${first}`));
      }
    })
    .catch(() => {});
}

/** The top-level blocks of a rendered document with their source lines. */
export function blocksOf(root: HTMLElement): { el: HTMLElement; block: Block }[] {
  return [...root.querySelectorAll<HTMLElement>(":scope > [data-src]")].map((el) => {
    const [s, e] = (el.dataset.src ?? "0-0").split("-").map(Number);
    return { el, block: [s, e] as Block };
  });
}

/** The rows of a rendered document for `reconcile`: each top-level element, with its source text as the key. */
function docItems(rendered: HTMLElement, source: string): KeyedItem<HTMLElement>[] {
  const lines = source.split("\n");
  const seen = new Map<string, number>();
  return [...rendered.children].map((child) => {
    const el = child as HTMLElement;
    const src = el.dataset.src;
    const [s, e] = (src ?? "0-0").split("-").map(Number);
    // A block without source lines, for example a rule: its HTML is its identity.
    const text = src ? `${el.tagName}\0${lines.slice(s - 1, e).join("\n")}` : `html\0${el.outerHTML}`;
    const n = seen.get(text) ?? 0;
    seen.set(text, n + 1);
    return {
      key: `${n}\0${text}`,
      sig: "",
      build: () => el,
      // The same source at other lines: the element stays, with its new lines.
      update: (old: HTMLElement) => {
        if (src && old.dataset.src !== src) old.dataset.src = src;
      },
    };
  });
}

/**
 * Makes the document `live` show the Markdown `source`, of which `rendered` is the new render. A
 * block with the same source text keeps its element, so its images and diagrams do not load again
 * and the preview does not flash. Call it with `live === rendered` for the first render.
 */
export function updateDoc(live: HTMLElement, rendered: HTMLElement, source: string) {
  reconcile(live, docItems(rendered, source));
}
