// The parts of the Markdown preview that need no DOM: which blocks a diff changed, where a removed block
// shows in one column, the path of a relative image, and the anchors of the headings.

/** A change of lines, as Monaco gives it. An end of 0 means that side has no lines. */
export interface LineChange {
  originalStartLineNumber: number;
  originalEndLineNumber: number;
  modifiedStartLineNumber: number;
  modifiedEndLineNumber: number;
}

/** The lines of a block of the Markdown source, 1-based, both ends included. */
export type Block = [start: number, end: number];

export type BlockMark = "added" | "removed" | "changed";

/**
 * The mark of each block of one side of a diff. On the new side a block is "added" when its lines are
 * only new, and "changed" when the change also removed lines. On the old side it is "removed" or
 * "changed". Null: the change does not touch the block.
 */
export function markBlocks(blocks: Block[], changes: LineChange[], side: "original" | "modified"): (BlockMark | null)[] {
  return blocks.map(([start, end]) => {
    let mark: BlockMark | null = null;
    for (const c of changes) {
      const [s, e, other] =
        side === "modified"
          ? [c.modifiedStartLineNumber, c.modifiedEndLineNumber, c.originalEndLineNumber]
          : [c.originalStartLineNumber, c.originalEndLineNumber, c.modifiedEndLineNumber];
      if (e === 0 || e < start || s > end) continue;
      const m: BlockMark = other > 0 ? "changed" : side === "modified" ? "added" : "removed";
      if (mark === null || m === "changed") mark = m;
    }
    return mark;
  });
}

/**
 * For one column: the line of the new text before which each old block shows, for the old blocks that
 * a change removed or changed. Null for an old block that stays.
 */
export function removedAnchors(blocks: Block[], changes: LineChange[]): (number | null)[] {
  return blocks.map(([start, end]) => {
    const c = changes.find((x) => x.originalEndLineNumber > 0 && x.originalStartLineNumber <= end && x.originalEndLineNumber >= start);
    if (!c) return null;
    // A deletion names the line after which the lines went; a change names its first new line.
    return c.modifiedEndLineNumber === 0 ? c.modifiedStartLineNumber + 1 : c.modifiedStartLineNumber;
  });
}

/**
 * The repository path of a link in a Markdown file: relative to the folder of the file, or to the root
 * when it starts with "/". Null for a URL, an anchor, or a path that goes above the root.
 */
export function resolvePath(fileDir: string, link: string): string | null {
  const raw = link.split(/[?#]/)[0].trim();
  if (!raw || /^([a-z][a-z0-9+.-]*:|\/\/)/i.test(raw)) return null;
  let decoded: string;
  try {
    decoded = decodeURI(raw);
  } catch {
    return null;
  }
  const parts = decoded.startsWith("/") ? [] : fileDir.split("/").filter(Boolean);
  for (const p of decoded.split("/")) {
    if (p === "" || p === ".") continue;
    if (p === "..") {
      if (!parts.length) return null;
      parts.pop();
    } else parts.push(p);
  }
  return parts.length ? parts.join("/") : null;
}

/** The anchor of a heading, as GitHub makes it: lower case, no punctuation, spaces as "-". */
export function slug(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/\s/g, "-");
}
