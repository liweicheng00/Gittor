// A popup that picks a branch from groups (for example Recent, Local and Remote), with a search field.
// It looks like the branch switcher of the toolbar. It works over a dialog too: it handles its keys
// before the dialog does.

import { h, icon } from "./dom";

export interface PickerItem {
  value: string;
  /** The text of the row; the value when it is missing. */
  label?: string;
  /** The item that is chosen now. */
  current?: boolean;
}

export type PickerSection = [title: string, items: PickerItem[]];

let open: (() => void) | null = null;

/** Shows the picker under `anchor`. `onPick` gets the value of the chosen row. */
export function showBranchPicker(anchor: HTMLElement, sections: PickerSection[], onPick: (value: string) => void) {
  open?.();
  const search = h("input", { class: "switcher-search", placeholder: "Search branches", spellcheck: false });
  const list = h("div", { class: "switcher-list" });
  const pop = h("div", { class: "switcher branch-picker menu" }, search, list);
  const close = () => {
    pop.remove();
    window.removeEventListener("mousedown", outside, true);
    window.removeEventListener("keydown", onKey, true);
    open = null;
  };
  const pick = (value: string) => {
    close();
    onPick(value);
  };
  const outside = (e: MouseEvent) => !pop.contains(e.target as Node) && !anchor.contains(e.target as Node) && close();
  // The capture phase of the window comes before the key handlers of a dialog or a window.
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopImmediatePropagation();
      close();
      anchor.focus();
    } else if (e.key === "Enter" && e.target === search) {
      e.preventDefault();
      e.stopImmediatePropagation();
      (list.querySelector(".menu-item") as HTMLElement | null)?.click();
    }
  };
  const render = () => {
    const q = search.value.trim().toLowerCase();
    const match = (i: PickerItem) => !q || (i.label ?? i.value).toLowerCase().includes(q);
    const frag = document.createDocumentFragment();
    for (const [title, items] of sections) {
      const shown = items.filter(match);
      if (!shown.length) continue;
      frag.append(h("div", { class: "menu-header" }, title));
      for (const item of shown.slice(0, 80)) {
        const el = h(
          "button",
          { class: "menu-item" + (item.current ? " current" : ""), title: item.value },
          h("span", { class: "menu-check" }, item.current ? icon("current") : ""),
          h("span", { class: "menu-label" }, item.label ?? item.value),
        );
        el.addEventListener("click", () => pick(item.value));
        frag.append(el);
      }
    }
    if (!frag.childNodes.length) frag.append(h("div", { class: "muted" }, "No branches match."));
    list.replaceChildren(frag);
  };
  search.addEventListener("input", render);
  render();
  document.body.append(pop);
  const r = anchor.getBoundingClientRect();
  pop.style.left = `${Math.max(4, Math.min(r.left, window.innerWidth - pop.offsetWidth - 4))}px`;
  pop.style.top = `${r.bottom + 2}px`;
  // A picker that does not fit under its button opens above it.
  if (r.bottom + 2 + pop.offsetHeight > window.innerHeight - 4) pop.style.top = `${Math.max(4, r.top - 2 - pop.offsetHeight)}px`;
  setTimeout(() => window.addEventListener("mousedown", outside, true));
  window.addEventListener("keydown", onKey, true);
  open = close;
  search.focus();
}

/** A button that shows a branch and opens the picker. `set` changes the branch that it shows. */
export function branchButton(cls: string, sections: () => PickerSection[], onPick: (value: string) => void) {
  const label = h("span", { class: "branch-button-label" });
  const el = h("button", { class: `branch-button ${cls}`, type: "button" }, icon("branch"), label, icon("chevron-down", "icon-caret"));
  el.addEventListener("click", (e) => {
    e.preventDefault();
    showBranchPicker(el, sections(), onPick);
  });
  return { el, set: (text: string) => (label.textContent = text) };
}
