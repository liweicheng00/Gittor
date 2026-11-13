// Tells when the user does something that a new draw of the view would disturb: the mouse is down (a
// click, a drag, a text selection), a drag of files is open, a menu is open, or the user scrolls. The
// reload after a change outside the app waits for the end of it (`RefreshScheduler`).

let mouseDown = false;
let dragging = false;
let lastScroll = 0;

/** How long after a scroll the user counts as busy, in ms. */
const SCROLL_REST = 250;

window.addEventListener("mousedown", () => (mouseDown = true), true);
window.addEventListener("mouseup", () => (mouseDown = false), true);
window.addEventListener("dragstart", () => (dragging = true), true);
// A native drag ends without a mouseup.
for (const type of ["dragend", "drop"]) {
  window.addEventListener(type, () => {
    dragging = false;
    mouseDown = false;
  }, true);
}
window.addEventListener("blur", () => (mouseDown = false));
window.addEventListener("wheel", () => (lastScroll = Date.now()), { capture: true, passive: true });
document.addEventListener("scroll", () => (lastScroll = Date.now()), { capture: true, passive: true });

/** True while a new draw would disturb the user. */
export function userIsBusy(): boolean {
  return mouseDown || dragging || Date.now() - lastScroll < SCROLL_REST || !!document.querySelector(".menu[role='menu'], .monaco-menu");
}
