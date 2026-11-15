// UI scenario for the glass themes Plasma and Ember: the root attributes, the palette, the Monaco theme,
// the graph tone, no change of layout, no blur on rows, the backdrop blur on overlays only, and the
// contrast of gray text on a selected row over the pixels that the browser really draws.
// Start the dev server first (see README). Build a fresh repository with make-demo-repo.sh, then:
// node e2e/glow-theme.mjs <repo> <screenshot-dir>.
// Set CHROMIUM to a Chromium binary when Playwright has no downloaded browser.
import { chromium } from "playwright";
const [,, repo, outDir] = process.argv;

const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const page = await (await browser.newContext({ viewport: { width: 1500, height: 940 }, deviceScaleFactor: 2 })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push("pageerror: " + e));
page.on("console", (m) => m.type() === "error" && errors.push("console: " + m.text()));
const shot = async (name) => { await page.waitForTimeout(300); await page.screenshot({ path: `${outDir}/${name}.png` }); console.log("shot", name); };
const check = (what, ok) => { console.log(ok ? "ok  " : "FAIL", what); if (!ok) errors.push("check: " + what); };
const within = async (what, fn, ms = 6000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return check(what, true);
    await page.waitForTimeout(100);
  }
  check(what, false);
};

// The values of glow.css and glow-monaco.ts.
const THEMES = {
  plasma: { label: "Plasma", bg: "#171b27", editor: "rgba(23, 27, 39, 0.4)" },
  ember: { label: "Ember", bg: "#1c1517", editor: "rgba(28, 21, 23, 0.4)" },
};
const OVERLAYS = ["menu", "dialog", "toast", "merge-window", "history-window", "copy-hint", "tab-detach-hint", "rebase-drag-tip"];
const ROWS = ".log-row, .change, .cl-file, .files-row, .branch, .stash-row, .sm-row, .history-row, .local-history-row, .menu-item";

const theme = async (label) => {
  await page.click(".tb-button[title='Theme']");
  await page.waitForTimeout(400);
  await page.click(`.menu-item:has-text('${label}')`);
};
const root = () => page.evaluate(() => {
  const d = document.documentElement.dataset;
  const css = getComputedStyle(document.documentElement);
  return { theme: d.theme, style: d.style, glow: d.glow, bg: css.getPropertyValue("--bg").trim(), glass: css.getPropertyValue("--glass").trim() };
});
// The visible editors of the diff. An editor without its background layer is not ready yet.
const editors = () => page.evaluate(() => [...document.querySelectorAll(".diff .monaco-editor")].filter((e) => e.offsetParent).map((e) => {
  const back = e.querySelector(".monaco-editor-background");
  return { dark: e.classList.contains("vs-dark"), light: e.classList.contains("vs"), bg: back ? getComputedStyle(back).backgroundColor : "" };
}));
const editorsAre = async (fn) => { const list = await editors(); return list.length > 0 && list.every(fn); };
// The boxes of the main parts. A theme must not change them.
const probe = () => page.evaluate(() => [".toolbar", ".tabbar", ".statusbar", ".lp-tab", ".log-row", ".log-header", ".filter-bar", ".sidebar .branch", ".ref", ".tb-button", ".diff-toolbar", ".commit-button"].map((s) =>
  [...document.querySelectorAll(s)].slice(0, 12).map((e) => {
    const r = e.getBoundingClientRect();
    return [s, Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height), e.scrollWidth, e.clientWidth].join(",");
  }).join(";")).join("|"));
// The color at the center of the plain node of each row that is not HEAD and not selected, by hash. The
// node is the widest run of opaque pixels on the middle line of the canvas.
const nodes = () => page.evaluate(() => {
  const out = {};
  for (const row of document.querySelectorAll(".log-row:not(.head):not(.selected)")) {
    const c = row.querySelector("canvas");
    const hash = row.querySelector(".hash")?.textContent;
    if (!c || !hash) continue;
    const scale = c.width / c.clientWidth;
    const y = Math.round(11 * scale);
    const line = c.getContext("2d").getImageData(0, y, c.width, 1).data;
    let best = null;
    for (let x = 0, start = -1; x <= c.width; x++) {
      const opaque = x < c.width && line[x * 4 + 3] === 255;
      if (opaque && start < 0) start = x;
      if (!opaque && start >= 0) {
        if (!best || x - start > best.w) best = { x: Math.floor((start + x) / 2), w: x - start };
        start = -1;
      }
    }
    if (best && best.w >= 5 * scale) out[hash] = [...line.slice(best.x * 4, best.x * 4 + 3)];
  }
  return out;
});
// Shadows with a blur on rows, and elements with a backdrop filter.
const blurredRows = () => page.evaluate((sel) => [...document.querySelectorAll(sel)].filter((e) => {
  const s = getComputedStyle(e).boxShadow;
  if (s === "none") return false;
  return s.split(/,(?![^(]*\))/).some((one) => {
    const lengths = one.replace(/(rgba?|color)\([^)]*\)/g, "").trim().split(/\s+/).filter((t) => /^-?[\d.]+px$|^0$/.test(t));
    return !/inset/.test(one) || parseFloat(lengths[2] ?? "0") > 0;
  });
}).length, ROWS);
const backdrops = () => page.evaluate(() => [...document.querySelectorAll("*")]
  .filter((e) => { const b = getComputedStyle(e).backdropFilter; return b && b !== "none"; })
  .map((e) => [...e.classList].join(".") || e.tagName));
// The contrast of the author on the selected row, against the brightest pixel that the browser draws under
// it. The text is transparent for the screenshot, so only the background (glass over the nebula) shows.
const authorContrast = async () => {
  const el = await page.$(".log-row.selected .author");
  const box = await el.boundingBox();
  const fg = await el.evaluate((e) => { const c = getComputedStyle(e).color; e.style.color = "transparent"; return c; });
  await page.waitForTimeout(50);
  const png = (await page.screenshot({ clip: box })).toString("base64");
  await el.evaluate((e) => (e.style.color = ""));
  return page.evaluate(async ({ png, fg }) => {
    const img = new Image();
    img.src = `data:image/png;base64,${png}`;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.width;
    c.height = img.height;
    const g = c.getContext("2d");
    g.drawImage(img, 0, 0);
    const px = g.getImageData(0, 0, c.width, c.height).data;
    const lum = ([r, gr, b]) => {
      const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
      return 0.2126 * f(r) + 0.7152 * f(gr) + 0.0722 * f(b);
    };
    let worst = [0, 0, 0];
    for (let i = 0; i < px.length; i += 4) if (lum([px[i], px[i + 1], px[i + 2]]) > lum(worst)) worst = [px[i], px[i + 1], px[i + 2]];
    const text = fg.match(/[\d.]+/g).map(Number).slice(0, 3);
    const [hi, lo] = [lum(text), lum(worst)].sort((a, b) => b - a);
    return { text, background: worst, ratio: Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100 };
  }, { png, fg });
};

await page.goto(`${process.env.GITTOR_E2E_URL ?? "http://127.0.0.1:5174"}/?repo=${encodeURIComponent(repo)}`);
await page.waitForSelector(".log-row", { timeout: 30000 });
await page.click(".log-row:has-text('Greet the world')");
await within("the diff of main.rs shows", async () => ((await page.textContent(".diff-title")) ?? "").includes("main.rs") && (await editors()).length > 0);

// Dark: the reference for the layout and the graph.
await theme("Dark");
await within("Dark has no data-style", async () => { const r = await root(); return r.theme === "dark" && r.style === undefined && r.glow === undefined; });
await within("the editors of Dark are vs-dark", () => editorsAre((e) => e.dark && e.bg === "rgb(30, 30, 30)"));
const darkBoxes = await probe();
const darkNodes = await nodes();
const darkFg = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--fg").trim());
// A node with a lane color (not color 0, which is --fg).
const hash = Object.keys(darkNodes).find((k) => Math.max(...darkNodes[k]) < 200);
check("a plain node with a lane color is in the graph", !!hash);
await page.focus(".log-scroll");
await shot("glow-dark-log");

for (const [name, t] of Object.entries(THEMES)) {
  await theme(t.label);
  await within(`${t.label}: the root has data-theme=dark, data-style=glow, data-glow=${name}`, async () => {
    const r = await root();
    return r.theme === "dark" && r.style === "glow" && r.glow === name;
  });
  const r = await root();
  check(`${t.label}: --bg is ${t.bg} (${r.bg})`, r.bg === t.bg);
  check(`${t.label}: --glass is 65% (${r.glass})`, r.glass === "65%");
  await within(`${t.label}: each editor is vs-dark with the tint ${t.editor}`, () => editorsAre((e) => e.dark && e.bg === t.editor));
  // The nebula is a fixed layer, not a fixed background, so a scroll does not paint the whole page.
  const nebula = await page.evaluate(() => {
    const s = getComputedStyle(document.documentElement, "::before");
    const fixedBackground = [document.documentElement, document.body].some((e) => getComputedStyle(e).backgroundAttachment.includes("fixed"));
    return { position: s.position, z: s.zIndex, events: s.pointerEvents, radial: (s.backgroundImage.match(/radial-gradient/g) ?? []).length, fixedBackground };
  });
  check(`${t.label}: the nebula is a fixed layer behind the page with 4 lights (${JSON.stringify(nebula)})`,
    nebula.position === "fixed" && nebula.z === "-1" && nebula.events === "none" && nebula.radial === 4 && !nebula.fixedBackground);
  check(`${t.label}: the boxes are the same as in Dark`, (await probe()) === darkBoxes);
  const cut = await page.$$eval(".lp-tab", (tabs) => tabs.filter((e) => e.scrollWidth > e.clientWidth).map((e) => e.textContent));
  check(`${t.label}: no left tab label is cut (${cut.join(", ")})`, cut.length === 0);
  // The graph: a brighter tone than Dark.
  let node = null;
  await within(`${t.label}: the node has another color than in Dark, with a channel of 230 or more`, async () => {
    node = (await nodes())[hash];
    return !!node && node.join() !== darkNodes[hash].join() && Math.max(...node) >= 230;
  });
  console.log(`     node ${hash}: Dark ${darkNodes[hash]}, ${t.label} ${node}`);
  check(`${t.label}: --fg is not the --fg of Dark`, (await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--fg").trim())) !== darkFg);
  check(`${t.label}: no row has a blurred shadow`, (await blurredRows()) === 0);
  check(`${t.label}: no element has a backdrop filter without an overlay`, (await backdrops()).length === 0);
  // Gray text on the selected row, with the focus in the log and without it.
  await page.click(".log-row:has-text('Greet the world') .subject-text");
  await within(`${t.label}: the log has the focus`, () => page.evaluate(() => !!document.activeElement?.closest(".log-scroll")));
  const focused = await authorContrast();
  check(`${t.label}: the author on the selected row with the focus has 4.5:1 or more (${focused.ratio} on rgb(${focused.background}))`, focused.ratio >= 4.5);
  await page.evaluate(() => document.activeElement?.blur());
  const unfocused = await authorContrast();
  check(`${t.label}: the author on the selected row without the focus has 4.5:1 or more (${unfocused.ratio} on rgb(${unfocused.background}))`, unfocused.ratio >= 4.5);
  await page.focus(".log-scroll");
  await shot(`glow-${name}-1-log`);

  // The Changes tab with the focus in the commit message.
  await page.click(".lp-tab:has-text('Changes')");
  await page.click(".cl-file:has-text('main.rs')");
  await within(`${t.label}: the local diff of main.rs shows`, async () => ((await page.textContent(".diff-title")) ?? "").includes("main.rs"));
  await page.click(".commit-message");
  await page.keyboard.type("Add a helper");
  check(`${t.label}: the commit message has the glow ring`, (await page.$eval(".commit-message", (e) => getComputedStyle(e).boxShadow)) !== "none");
  check(`${t.label}: no row of the Changes tab has a blurred shadow`, (await blurredRows()) === 0);
  await shot(`glow-${name}-2-changes`);
  await page.fill(".commit-message", "");
  await page.click(".lp-tab:has-text('Branches')");

  // A context menu of a log row: it blurs the page behind it, and its items do not.
  await page.click(".log-row:has-text('Add math module')", { button: "right" });
  await page.waitForSelector(".menu .menu-item");
  await page.waitForTimeout(400);
  await page.hover(".menu .menu-item >> nth=1");
  const blurred = await backdrops();
  check(`${t.label}: only overlays have a backdrop filter (${blurred.join(", ")})`, blurred.length > 0 && blurred.every((c) => OVERLAYS.some((o) => c.split(".").includes(o))));
  check(`${t.label}: no menu item has a blurred shadow`, (await blurredRows()) === 0);
  await shot(`glow-${name}-3-menu`);
  await page.keyboard.press("Escape");
  await within(`${t.label}: the menu closes`, async () => (await page.$(".menu")) === null);

  // The Settings dialog shows the theme.
  await page.click(".tb-button[title='Settings']");
  await page.waitForSelector(".settings-dialog");
  await page.click(".settings-page:has-text('General')");
  const select = ".settings-row:has-text('Theme') select";
  check(`${t.label}: Settings › General shows the theme`, (await page.$eval(select, (e) => e.value)) === name);
  await shot(`glow-${name}-4-settings`);
  // Dark, then the theme again, by the dialog.
  await page.selectOption(select, "dark");
  await page.click(".settings-dialog .dialog-buttons button:has-text('OK')");
  await within(`${t.label}: Dark by the dialog removes data-style and data-glow`, async () => { const r = await root(); return r.theme === "dark" && r.style === undefined && r.glow === undefined; });
  await within(`${t.label}: Dark by the dialog gives the editor of Dark`, () => editorsAre((e) => e.dark && e.bg === "rgb(30, 30, 30)"));
  await page.click(".tb-button[title='Settings']");
  await page.waitForSelector(".settings-dialog");
  await page.click(".settings-page:has-text('General')");
  await page.selectOption(select, name);
  await page.click(".settings-dialog .dialog-buttons button:has-text('OK')");
  await within(`${t.label}: the dialog sets the theme again`, async () => (await root()).glow === name);

  // The theme stays after a reload.
  await page.reload();
  await page.waitForSelector(".log-row", { timeout: 30000 });
  await within(`${t.label}: the theme stays after a reload`, async () => { const r = await root(); return r.style === "glow" && r.glow === name && r.bg === t.bg; });
  await page.click(".log-row:has-text('Greet the world')");
  await within(`${t.label}: the editors have the tint after the reload`, () => editorsAre((e) => e.dark && e.bg === t.editor));
}

// Light: no skin, light editors.
await theme("Light");
await within("Light has no data-style and no data-glow", async () => { const r = await root(); return r.theme === "light" && r.style === undefined && r.glow === undefined; });
await within("the editors of Light are vs", () => editorsAre((e) => e.light && !e.dark));

console.log("errors:", JSON.stringify(errors));
await browser.close();
if (errors.length) process.exit(1);
