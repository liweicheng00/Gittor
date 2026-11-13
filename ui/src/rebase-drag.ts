// A custom mouse drag of the rows of the rebase editor, like tab-drag.ts. A drop between two rows moves
// the commit; a drop on the middle of a row joins the commit into it (squash), or with Alt a fixup.
// WebKitGTK needs preventDefault on mousedown, or it starts a native text drag and the page gets no move.

import { h } from "./dom";

export type DropResult = { kind: "move"; from: number; to: number } | { kind: "squash"; from: number; target: number; fixup: boolean };

interface DragOptions {
  /** The list element that holds the `.rebase-row` elements. */
  list: HTMLElement;
  /** The display index of the row that the drag started on. */
  from: number;
  /** The end of a drag that moved. A click (no move), Esc and a drop at the start place call nothing. */
  onDrop: (r: DropResult) => void;
}

/** Starts a drag from a mousedown on a row. */
export function dragRow(down: MouseEvent, opts: DragOptions) {
  const { list, from } = opts;
  down.preventDefault();
  const rows = () => Array.from(list.querySelectorAll<HTMLElement>(".rebase-row"));
  const subject = (i: number) => {
    const s = rows()[i]?.querySelector(".rebase-subject")?.textContent?.replace(/^↳ /, "") ?? "";
    return s.length > 36 ? `${s.slice(0, 36)}…` : s;
  };
  const startY = down.clientY;
  let dragging = false;
  let fixup = false;
  const ghost = h("div", { class: "rebase-drag-ghost" }, subject(from));
  const tip = h("div", { class: "rebase-drag-tip" });
  let lastX = down.clientX;
  let lastY = down.clientY;
  // The current decision, so mouseup can act on it.
  let decision: DropResult | null = null;

  const clear = () => {
    for (const r of rows()) r.classList.remove("drop-squash", "drop-above", "drop-below");
  };

  const update = () => {
    clear();
    decision = null;
    ghost.classList.toggle("fixup", fixup);
    const rs = rows();
    rs[from]?.classList.add("drag-source");
    let text = "Drop on a commit to squash it, or between two commits to move it";
    for (let i = 0; i < rs.length; i++) {
      const box = rs[i].getBoundingClientRect();
      if (lastY < box.top || lastY > box.bottom) continue;
      const third = box.height / 3;
      if (i !== from && lastY > box.top + third && lastY < box.bottom - third) {
        // The middle third of another row: squash into it.
        rs[i].classList.add("drop-squash");
        decision = { kind: "squash", from, target: i, fixup };
        text = fixup ? `Fixup "${subject(from)}" into "${subject(i)}"` : `Squash "${subject(from)}" into "${subject(i)}" · Alt: fixup`;
      } else {
        // The top or bottom edge: move to before or after this row.
        const after = lastY >= box.top + box.height / 2;
        rs[i].classList.add(after ? "drop-below" : "drop-above");
        let to = after ? i + 1 : i;
        if (from < to) to -= 1; // the row leaves its place first
        decision = { kind: "move", from, to };
        text = to === from ? "Release to keep the place" : `Move "${subject(from)}" ${after ? "below" : "above"} "${subject(i)}"`;
      }
      break;
    }
    tip.textContent = `${text} · Esc: cancel`;
    ghost.style.left = `${lastX + 12}px`;
    ghost.style.top = `${lastY - 12}px`;
    // The hint stays in the window: near the right edge it goes to the left of the mouse.
    const width = tip.offsetWidth;
    tip.style.left = `${Math.max(4, lastX + 12 + width > window.innerWidth - 4 ? lastX - 12 - width : lastX + 12)}px`;
    tip.style.top = `${lastY + 16}px`;
  };

  const move = (e: MouseEvent) => {
    if (!dragging && Math.abs(e.clientY - startY) < 6) return;
    if (!dragging) {
      dragging = true;
      list.classList.add("dragging");
      document.body.append(ghost, tip);
    }
    lastX = e.clientX;
    lastY = e.clientY;
    fixup = e.altKey;
    update();
  };

  const end = () => {
    document.removeEventListener("mousemove", move);
    document.removeEventListener("mouseup", up);
    window.removeEventListener("keydown", onKey, true);
    window.removeEventListener("keyup", onKey, true);
    ghost.remove();
    tip.remove();
    list.classList.remove("dragging");
    clear();
    rows()[from]?.classList.remove("drag-source");
  };

  const up = () => {
    const d = decision;
    end();
    if (dragging && d && !(d.kind === "move" && d.from === d.to)) opts.onDrop(d);
  };

  // Alt changes a squash into a fixup while the mouse holds still. Esc cancels the drag, not the dialog:
  // this listener is on the window, so it runs before the key listener of the dialog on the document.
  const onKey = (e: KeyboardEvent) => {
    if (!dragging) return;
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.type === "keydown") end();
    } else if (e.key === "Alt") {
      fixup = e.type === "keydown";
      update();
    }
  };

  document.addEventListener("mousemove", move);
  document.addEventListener("mouseup", up);
  window.addEventListener("keydown", onKey, true);
  window.addEventListener("keyup", onKey, true);
}
