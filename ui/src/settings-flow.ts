// The Settings dialog and the settings that the backend needs.

import { api, type BackendSettings, pickFile } from "./api";
import { applyDiffSettings } from "./diff-view";
import { keymap } from "./keyboard";
import { toast } from "./notify";
import { fetchAll, refresh } from "./repo";
import { save, settings } from "./settings";
import { checkNow, updateStatus } from "./update-flow";
import { openSettingsDialog, type Page } from "./settings-dialog";
import { applyTheme, settingsBtn, statusActivity } from "./shell";
import { app } from "./state";

let autoFetchTimer = 0;
export function scheduleAutoFetch() {
  clearInterval(autoFetchTimer);
  if (settings.autoFetchMinutes > 0) {
    autoFetchTimer = window.setInterval(() => {
      if (app.view && app.busy === 0 && !document.hidden) void fetchAll();
    }, settings.autoFetchMinutes * 60_000);
  }
}

/** The settings that the backend keeps in its settings file. The front end keeps a copy for the dialog.
 * An old front end kept them in the browser storage; the first start moves them to the backend. */
export async function applyBackendSettings() {
  let b: BackendSettings;
  try {
    b = await api.backendSettings();
  } catch {
    return;
  }
  const local = { gitPath: settings.gitPath, editor: settings.editor, terminal: settings.terminal, history: { days: settings.historyDays, maxMb: settings.historyMaxMb } };
  const changedLocally = local.gitPath !== "" || local.history.days !== b.history.days || local.history.maxMb !== b.history.maxMb;
  if (!b.stored && changedLocally) {
    try {
      await api.setBackendSettings({ ...local, stored: true });
      b = { ...local, stored: true };
    } catch (e) {
      toast(`The git program of the old settings does not work; git from PATH runs instead. ${String(e).replace(/^Error: /, "")}`, "error");
    }
  }
  settings.gitPath = b.gitPath;
  settings.editor = b.editor;
  settings.terminal = b.terminal;
  settings.historyDays = b.history.days;
  settings.historyMaxMb = b.history.maxMb;
  save();
}

/** Opens the Settings dialog, on `page` when it is given. `ignoreAdd` goes into the global ignore file
 * when the user saves it. */
/** The releases of Gittor on GitHub: the downloads and the release notes. */
const RELEASES_URL = "https://github.com/liweicheng00/Gittor/releases";

export async function openSettings(page?: Page, ignoreAdd?: string[]) {
  const root = app.view?.root ?? null;
  const next = await openSettingsDialog({
    keymap,
    testGit: (p) => api.gitVersion(p),
    preview: (editor, terminal) => api.commandPreview(editor, terminal),
    pickFile: () => pickFile("Git executable"),
    ignore: {
      load: () => api.globalIgnore(),
      save: (text, expected) => api.saveGlobalIgnore(text, expected),
      check: root ? (path) => api.checkIgnore(path) : null,
      repoName: root?.split(/[\\/]/).pop() ?? "",
      add: ignoreAdd,
      saved: () => app.view && void refresh(),
    },
    page,
    updates: {
      status: updateStatus,
      check: () => checkNow(true),
      releasesUrl: RELEASES_URL,
      openUrl: (url) => void api.openUrl(url),
    },
  });
  if (!next) return;
  const gitChanged = next.gitPath !== settings.gitPath;
  const backendChanged = gitChanged || next.editor !== settings.editor || next.terminal !== settings.terminal || next.historyDays !== settings.historyDays || next.historyMaxMb !== settings.historyMaxMb;
  if (backendChanged) {
    try {
      const version = await api.setBackendSettings({ gitPath: next.gitPath, editor: next.editor, terminal: next.terminal, history: { days: next.historyDays, maxMb: next.historyMaxMb }, stored: true });
      statusActivity.textContent = `git ${version}`;
    } catch (e) {
      toast(String(e).replace(/^Error: /, ""), "error");
      next.gitPath = settings.gitPath;
      next.editor = settings.editor;
      next.terminal = settings.terminal;
      next.historyDays = settings.historyDays;
      next.historyMaxMb = settings.historyMaxMb;
    }
  }
  Object.assign(settings, next);
  save();
  applyTheme();
  applyDiffSettings();
  scheduleAutoFetch();
  if (gitChanged && app.view) void refresh();
}

settingsBtn.addEventListener("click", () => void openSettings());
