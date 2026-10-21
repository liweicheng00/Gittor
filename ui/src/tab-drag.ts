// Drag of a tab in the tab bar, as in a browser.

import type { WindowPlace } from "./api";
import { h } from "./dom";
import { settings } from "./settings";
import { tabBar } from "./shell";

/** What happens at the end of a drag. */
export interface DragHandlers {
  /** The tab left the tab bar: it goes to a new window at this place. */
  detach: (place: WindowPlace) => void;
  /** The tab has a new place in the tab bar: the new order of all tabs. */
  reorder: (tabs: string[]) => void;
  /** The drag ended in the tab bar. */
  done: () => void;
}

/** A tab that is dragged out of the tab bar by more than this distance goes to a new window. */
const DETACH_PX = 40;

/** Drags a tab, as in a browser. In the tab bar, the tab changes its place. Out of the tab bar, the tab
 * goes to a new window at the place of the mouse. The tab bar can draw again during the drag, so the
 * drag finds the tab by its root each time. */
export function dragTab(root: string, down: MouseEvent, on: DragHandlers) {
  const tabOf = (r: string) => tabBar.querySelector<HTMLElement>(`.tab[data-root="${CSS.escape(r)}"]`);
  const startX = down.clientX;
  const startY = down.clientY;
  let dragging = false;
  let detach = false;
  const hint = h("div", { class: "tab-detach-hint" }, "Release to open in a new window");
  const move = (e: MouseEvent) => {
    if (!dragging && Math.hypot(e.clientX - startX, e.clientY - startY) < 6) return;
    dragging = true;
    const tab = tabOf(root);
    if (!tab) return;
    const bar = tabBar.getBoundingClientRect();
    detach = settings.tabs.length > 1 && (e.clientY > bar.bottom + DETACH_PX || e.clientY < bar.top - DETACH_PX);
    tab.classList.add("dragging");
    tab.classList.toggle("detaching", detach);
    tab.style.transform = detach ? "" : `translateX(${e.clientX - startX}px)`;
    if (detach) {
      hint.style.left = `${e.clientX + 12}px`;
      hint.style.top = `${e.clientY + 12}px`;
      if (!hint.isConnected) document.body.append(hint);
    } else hint.remove();
  };
  const up = (e: MouseEvent) => {
    document.removeEventListener("mousemove", move);
    document.removeEventListener("mouseup", up);
    hint.remove();
    const tab = tabOf(root);
    if (!dragging || !tab) return;
    tab.classList.remove("dragging", "detaching");
    tab.style.transform = "";
    if (detach) {
      on.detach({ x: e.screenX - 40, y: e.screenY - 20, width: window.outerWidth, height: window.outerHeight });
      return;
    }
    // The new place: before the first other tab whose middle is right of the mouse.
    const others = settings.tabs.filter((t) => t !== root);
    const i = others.findIndex((t) => {
      const r = tabOf(t)?.getBoundingClientRect();
      return r && e.clientX < r.left + r.width / 2;
    });
    others.splice(i < 0 ? others.length : i, 0, root);
    if (others.join("\n") !== settings.tabs.join("\n")) on.reorder(others);
    on.done();
  };
  document.addEventListener("mousemove", move);
  document.addEventListener("mouseup", up);
}
