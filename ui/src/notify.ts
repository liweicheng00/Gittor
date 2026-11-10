// Toast notifications in the lower-right corner, with an optional action such as Undo. A toast can
// change after it shows: its text, its kind, its action and a progress bar (the download of an update).

import { h, icon } from "./dom";

const host = h("div", { class: "toasts", role: "status", "aria-live": "polite" });
document.body.append(host);

/** An action button of a toast. `keyAction` names the keymap action that does the same, for the
 * shortcut hint. `keep`: the toast stays open after the click, for an action that changes it. */
export interface ToastAction {
  label: string;
  run: () => void;
  keyAction?: string;
  keep?: boolean;
}

export type ToastKind = "info" | "success" | "error";

/** A toast that shows: change it, or close it. */
export interface ToastHandle {
  readonly el: HTMLElement;
  /** False after the user or the timer closed it. */
  readonly open: boolean;
  setText(text: string): void;
  setKind(kind: ToastKind): void;
  /** The action button; null removes it. */
  setAction(action: ToastAction | null): void;
  /** A bar under the text: a fraction from 0 to 1, "busy" for a size that is not known, null for none. */
  setProgress(progress: number | "busy" | null): void;
  close(): void;
}

export function toast(message: string, kind: ToastKind = "info", action?: ToastAction, ms = 7000): ToastHandle {
  const close = h("button", { class: "icon-button", title: "Close" }, icon("close"));
  const text = h("span", { class: "toast-text" }, message);
  const bar = h("div", { class: "toast-progress-bar" });
  const progress = h("div", { class: "toast-progress", hidden: true, role: "progressbar", "aria-valuemin": "0", "aria-valuemax": "100" }, bar);
  const body = h("div", { class: "toast-body" }, text, progress);
  const el = h("div", { class: `toast toast-${kind}` }, body);
  let button: HTMLElement | null = null;
  const handle: ToastHandle = {
    el,
    get open() {
      return el.isConnected;
    },
    setText: (t) => (text.textContent = t),
    setKind: (k) => (el.className = `toast toast-${k}`),
    setAction(a) {
      button?.remove();
      button = null;
      if (!a) return;
      const b = h("button", { class: "toast-action", "data-key-action": a.keyAction }, a.label);
      b.addEventListener("click", () => {
        if (!a.keep) el.remove();
        a.run();
      });
      close.before(b);
      button = b;
    },
    setProgress(p) {
      progress.hidden = p === null;
      progress.classList.toggle("busy", p === "busy");
      const pct = typeof p === "number" ? Math.round(Math.max(0, Math.min(1, p)) * 100) : 0;
      bar.style.width = p === "busy" ? "" : `${pct}%`;
      if (typeof p === "number") progress.setAttribute("aria-valuenow", String(pct));
      else progress.removeAttribute("aria-valuenow");
    },
    close: () => el.remove(),
  };
  el.append(close);
  handle.setAction(action ?? null);
  close.addEventListener("click", () => el.remove());
  host.append(el);
  if (kind !== "error") setTimeout(() => el.remove(), action ? ms * 2 : ms);
  return handle;
}
