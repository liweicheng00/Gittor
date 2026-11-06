// Gittor: the start of the front end. The modules register their handlers when they load.

import "./style.css";
// Each module registers its handlers when it loads; the shell comes first.
import "./shell";
import "./repo";
import "./watch";
import "./selection";
import "./operations";
import "./sync";
import "./conflicts";
import "./menus";
import "./remotes";
import "./welcome";
import "./keyboard";
// Each feature module `*-flow.ts` loads here by itself: a new feature needs no line in this file. The
// modules import what they use, so the order of the files does not count.
import.meta.glob("./*-flow.ts", { eager: true });
import { api, initialPath, inTauri } from "./api";
import { openRepo, renderTabs, switchTab } from "./repo";
import { resetWindowRoots } from "./window-roots";
import { firstStart, restoreSettings, settings, soloWindow, startSettingsCopy } from "./settings";
import { applyBackendSettings, scheduleAutoFetch } from "./settings-flow";
import { applyLayout, applyTheme, showLeftTab } from "./shell";
import { showWorkspace } from "./welcome";
import { applyZoom } from "./zoom";

// No spell check, autocorrect or automatic capitals in the fields: branch names, paths and hashes are
// not prose. The attributes go on each field when it gets the focus, so fields made later get them too.
document.documentElement.spellcheck = false;
document.addEventListener(
  "focusin",
  (e) => {
    const t = e.target;
    if (!(t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement)) return;
    t.spellcheck = false;
    for (const a of ["autocorrect", "autocapitalize", "autocomplete"]) t.setAttribute(a, "off");
  },
  true,
);
// The app keeps a copy of the UI settings in the settings folder. A new app with empty storage, such
// as Gittor Dev at its first start, takes the settings from the copy and loads again. Only the app
// does this: the browser of the e2e scenarios starts empty each time.
if (inTauri && !soloWindow) {
  const copy = firstStart ? await api.uiSettings().catch(() => null) : null;
  if (copy) {
    restoreSettings(copy);
    location.reload();
    await new Promise(() => {});
  }
  let timer = 0;
  startSettingsCopy((text) => {
    clearTimeout(timer);
    timer = window.setTimeout(() => void api.saveUiSettings(text).catch(() => {}), 1000);
  });
}
applyLayout();
showLeftTab(settings.leftTab);
applyTheme();
applyZoom();
showWorkspace(false);
await applyBackendSettings();
scheduleAutoFetch();
// The tabs of the last session come back; only the active one loads now, the others on first use.
if (!soloWindow) resetWindowRoots();
const initial = new URLSearchParams(location.search).get("repo") ?? window.__GITTOR_WINDOW__?.repo ?? (await initialPath());
if (initial) void openRepo(initial);
else if (settings.activeTab && settings.tabs.includes(settings.activeTab)) void switchTab(settings.activeTab);
else settings.tabs = [];
renderTabs();
