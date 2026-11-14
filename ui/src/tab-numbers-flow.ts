// While the user holds Alt alone, each project tab shows its number: Alt+1 to Alt+8, and Alt+9 for the
// last tab. A key other than a number with Alt (for example Alt+Down) hides the numbers again, so
// they do not flash during other keys.

import { tabBar } from "./shell";

const show = (on: boolean) => tabBar.classList.toggle("show-numbers", on);

window.addEventListener(
  "keydown",
  (e) => {
    if (e.key === "Alt") return show(!e.ctrlKey && !e.metaKey && !e.shiftKey);
    // The numbers stay for Alt+<n>, so the user can press more than one.
    if (!(e.altKey && /^Digit[1-9]$/.test(e.code))) show(false);
  },
  true,
);
window.addEventListener("keyup", (e) => e.key === "Alt" && show(false), true);
window.addEventListener("blur", () => show(false));
// The mouse also ends it: a click with Alt does not leave the numbers.
window.addEventListener("mousedown", () => show(false), true);
