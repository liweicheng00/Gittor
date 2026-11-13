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
  /** The end of a drag that moved. A click (no move) calls nothing. */
  onDrop: (r: DropResult) => void;
}

/** Starts a drag from a mousedown on a row. */
export function dragRow(down: MouseEvent, opts: DragOptions) {
  const { list, from } = opts;
  down.preventDefault();
  const rows = () => Array.from(list.querySelectorAll<HTMLElement>(".rebase-row"));
  const startY = down.clientY;
  let dragging = false;
  let fixup = false;
  const ghost = h("div", { class: "rebase-drag-ghost" }, rows()[from]?.querySelector(".rebase-subject")?.textContent ?? "");
  // A current decision, so mouseup can act on it.
  let decision: DropResult | null = null;

  const clear = () => {
    for (const r of rows()) r.classList.remove("drop-squash", "drop-above", "drop-below");
  };

  const move = (e: MouseEvent) => {
    if (!dragging && Math.abs(e.clientY - startY) < 6) return;
    dragging = true;
    fixup = e.altKey;
    list.classList.add("dragging");
    if (!ghost.isConnected) document.body.append(ghost);
    ghost.style.left = `${e.clientX + 12}px`;
    ghost.style.top = `${e.clientY + 8}px`;
    ghost.classList.toggle("fixup", fixup);
    clear();
    decision = null;
    const rs = rows();
    for (let i = 0; i < rs.length; i++) {
      const box = rs[i].getBoundingClientRect();
      if (e.clientY < box.top || e.clientY > box.bottom) continue;
      const third = box.height / 3;
      if (i !== from && e.clientY > box.top + third && e.clientY < box.bottom - third) {
        // The middle third of another row: squash into it.
        rs[i].classList.add("drop-squash");
        decision = { kind: "squash", from, target: i, fixup };
      } else {
        // The top or bottom edge: move to before or after this row.
        const after = e.clientY >= box.top + box.height / 2;
        rs[i].classList.add(after ? "drop-below" : "drop-above");
        let to = after ? i + 1 : i;
        if (from < to) to -= 1; // the row leaves its place first
        decision = { kind: "move", from, to };
      }
      break;
    }
  };

  const up = () => {
    document.removeEventListener("mousemove", move);
    document.removeEventListener("mouseup", up);
    document.removeEventListener("keydown", onKey, true);
    document.removeEventListener("keyup", onKey, true);
    ghost.remove();
    list.classList.remove("dragging");
    clear();
    if (dragging && decision && !(decision.kind === "move" && decision.from === decision.to)) opts.onDrop(decision);
  };

  // Alt changes a squash into a fixup while the mouse holds still.
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== "Alt") return;
    fixup = e.type === "keydown";
    if (decision?.kind === "squash") {
      decision = { ...decision, fixup };
      ghost.classList.toggle("fixup", fixup);
    }
  };

  document.addEventListener("mousemove", move);
  document.addEventListener("mouseup", up);
  document.addEventListener("keydown", onKey, true);
  document.addEventListener("keyup", onKey, true);
}
