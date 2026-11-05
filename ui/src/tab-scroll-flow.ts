// Many project tabs: the tabs scroll without a scroll bar. An edge fades where more tabs are, the wheel
// of a mouse scrolls the tabs to the side, and the active tab scrolls into view.

import { tabScroll } from "./shell";

/** Fades the left or the right edge when tabs are hidden there. */
function edges() {
  const max = tabScroll.scrollWidth - tabScroll.clientWidth;
  tabScroll.classList.toggle("more-left", tabScroll.scrollLeft > 1);
  tabScroll.classList.toggle("more-right", tabScroll.scrollLeft < max - 1);
}

tabScroll.addEventListener("scroll", edges, { passive: true });
new ResizeObserver(edges).observe(tabScroll);

// A mouse wheel turns up and down; a trackpad also gives side movements, which scroll by themselves.
tabScroll.addEventListener(
  "wheel",
  (e) => {
    if (Math.abs(e.deltaY) <= Math.abs(e.deltaX) || tabScroll.scrollWidth <= tabScroll.clientWidth) return;
    e.preventDefault();
    tabScroll.scrollLeft += e.deltaY;
  },
  { passive: false },
);

// After each draw of the tabs: the active tab in view, and the edges again.
new MutationObserver(() => {
  tabScroll.querySelector<HTMLElement>(".tab.on")?.scrollIntoView({ block: "nearest", inline: "nearest" });
  edges();
}).observe(tabScroll, { childList: true });
