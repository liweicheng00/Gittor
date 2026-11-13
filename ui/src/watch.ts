// Credential prompts, and the reload when files or refs change outside the app.

import { notifyRepoChange } from "./windows";
import { api, type AskpassPrompt, onBackendEvent } from "./api";
import { refreshLocalDiff } from "./commit-flow";
import { credentialDialog } from "./dialogs";
import { userIsBusy } from "./interaction";
import { type RefreshKind, RefreshScheduler } from "./refresh-scheduler";
import { applyView, jumpToOid, loadLocalChanges, loadRefs, reloadView } from "./repo";
import { settings } from "./settings";
import { authors, banner, filterBar, log, updateStatus } from "./shell";
import { app } from "./state";

// Git can ask for a password through the askpass program of the app; the backend sends the prompts.
const askpassShown = new Set<number>();
let askpassBusy = false;
let askpassWaiting: AskpassPrompt[] = [];
async function showPrompts(prompts: AskpassPrompt[]) {
  askpassWaiting = prompts;
  if (askpassBusy) return;
  const next = askpassWaiting.find((p) => !askpassShown.has(p.id));
  if (!next) return;
  askpassShown.add(next.id);
  askpassBusy = true;
  try {
    const r = await credentialDialog(next);
    await api.askpassAnswer(next.id, r?.answer ?? null, r?.remember ?? false);
  } finally {
    askpassBusy = false;
  }
  void showPrompts(askpassWaiting);
}

/** Files changed in the quiet time after an operation of the app. They load after it. */
let filesChangedWhileQuiet = false;

/**
 * Loads what changed outside the app. Each part draws only what is new: a list keeps the rows that did
 * not change, and the diff keeps its place (see docs/refresh.md).
 */
async function reload(kind: RefreshKind) {
  // An operation of the app loads the view itself when it ends.
  if (!app.view || app.busy > 0) return;
  const root = app.view.root;
  notifyRepoChange(kind);
  if (kind === "repo") {
    const r = await api.refresh().catch(() => null);
    if (!r || app.view?.root !== root) return;
    await applyView(r, true, true);
    await loadRefs(true);
  } else {
    app.repoState = await api.repoState().catch(() => app.repoState);
    if (app.view?.root !== root) return;
    banner.update(app.repoState);
    updateStatus(true);
    await loadLocalChanges(true);
  }
  await refreshLocalDiff();
}

const scheduler = new RefreshScheduler({
  now: () => Date.now(),
  setTimer: (fn, ms) => window.setTimeout(fn, ms),
  clearTimer: (t) => clearTimeout(t as number),
  held: userIsBusy,
  visible: () => !document.hidden,
  run: reload,
});
// For the UI tests and for measurements: the number of requests, loads and holds.
(window as unknown as { __gittorRefresh?: unknown }).__gittorRefresh = scheduler.stats;

/** Asks for a load of what changed, from the counters of the watcher. */
function onCounters(c: { repo: number; files: number }) {
  if (!app.view || app.busy > 0 || !settings.autoRefresh) return;
  const before = app.watchSeen;
  app.watchSeen = c;
  if (!before) return;
  if (Date.now() < app.watchQuietUntil) {
    // The operation itself changed these files, but a file can also change on disk in this time. The
    // local changes load once more after the quiet time; that is cheap. Ref changes stay ignored here,
    // because a graph reload after each operation costs much on a large repository.
    if (c.files !== before.files) filesChangedWhileQuiet = true;
    return;
  }
  if (c.repo !== before.repo) scheduler.request("repo");
  else if (c.files !== before.files || filesChangedWhileQuiet) scheduler.request("files");
  filesChangedWhileQuiet = false;
}

void onBackendEvent((e) => {
  if (e.kind === "askpass") void showPrompts(e.prompts);
  else if (e.kind === "watch" && e.root === app.view?.root) onCounters(e);
});

// A slow poll covers two cases: an event that got lost, and the end of the quiet time after an
// operation, which no event marks.
setInterval(() => {
  if (app.view && !document.hidden) void api.watchState().then((c) => c && onCounters(c)).catch(() => {});
}, 3000);

// A load that waited for the window runs when the window shows again.
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) scheduler.poke();
});

// Files change outside the app; reload the local changes when the window gets the focus.
let focusTimer = 0;
window.addEventListener("focus", () => {
  if (!app.view || Date.now() - focusTimer < 1500) return;
  focusTimer = Date.now();
  scheduler.request("files");
});

filterBar.onChange = () => void reloadView();
filterBar.onJump = (q) => jumpToOid(q, true);
log.onRowsLoaded = (rows) => {
  const before = authors.size;
  for (const r of rows) if (r.author) authors.add(r.author);
  if (authors.size !== before) filterBar.setAuthors([...authors].sort());
};
