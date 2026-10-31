// Updates of the app: a check at the start and every few hours, a notification for a new version,
// the download with its progress in the status bar, and a restart when the user wants it. Only the main
// window checks. A build without the public key of the updater (a local build) does not check.

import { appVersion, checkForUpdate, restartApp, updatesEnabled, type UpdateInfo } from "./api";
import { toast } from "./notify";
import { settings, soloWindow } from "./settings";
import { statusActivity } from "./shell";

/** The first check waits for the app to load its repository. The updates scenario sets a shorter time
 * with `window.__GITTOR_FIRST_UPDATE_CHECK_MS__`. */
const FIRST_CHECK_MS = (window as unknown as { __GITTOR_FIRST_UPDATE_CHECK_MS__?: number }).__GITTOR_FIRST_UPDATE_CHECK_MS__ ?? 10_000;
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;
/** A notification that the user must answer stays for a day. */
const STAY_MS = 24 * 60 * 60 * 1000;

let state: "idle" | "checking" | "downloading" | "ready" = "idle";
/** The versions that a notification offered already: an automatic check offers each one once. */
const offered = new Set<string>();

/** The text for the Settings page: the version, and whether this build checks for updates. */
export async function updateStatus(): Promise<{ version: string; enabled: boolean }> {
  return { version: await appVersion(), enabled: await updatesEnabled() };
}

/** Checks for a new version. `manual` shows the result also when there is no update or an error.
 * It returns a short text for the Settings page. */
export async function checkNow(manual: boolean): Promise<string> {
  if (state === "downloading") return "The update downloads now.";
  if (state === "ready") return "The update is ready. Restart Gittor to use it.";
  if (state === "checking") return "Gittor checks for updates now.";
  state = "checking";
  let update: UpdateInfo | null;
  try {
    update = await checkForUpdate();
  } catch (e) {
    state = "idle";
    // An automatic check stays silent: for example, the computer has no network.
    return `The check failed: ${String(e).replace(/^Error: /, "")}`;
  }
  state = "idle";
  if (!update) return "Gittor is up to date.";
  if (manual || !offered.has(update.version)) offer(update);
  return `Gittor ${update.version} is available.`;
}

/** The notification shows this many lines of the release notes. Settings links to all of them. */
const NOTE_LINES = 3;

function offer(update: UpdateInfo) {
  offered.add(update.version);
  const lines = update.notes.split("\n").filter((l) => l.trim());
  const notes = lines.slice(0, NOTE_LINES).join("\n") + (lines.length > NOTE_LINES ? "\n…" : "");
  toast(`Gittor ${update.version} is available.${notes ? `\n${notes}` : ""}`, "info", { label: "Update", run: () => void install(update) }, STAY_MS);
}

async function install(update: UpdateInfo) {
  if (state !== "idle") return;
  state = "downloading";
  statusActivity.className = "sb-activity busy";
  try {
    await update.install((done, total) => {
      statusActivity.textContent = total ? `Downloading Gittor ${update.version}… ${Math.round((done / total) * 100)}%` : `Downloading Gittor ${update.version}…`;
    });
  } catch (e) {
    state = "idle";
    statusActivity.className = "sb-activity error";
    statusActivity.textContent = "";
    toast(`The update failed: ${String(e).replace(/^Error: /, "")}`, "error");
    return;
  }
  state = "ready";
  statusActivity.className = "sb-activity";
  statusActivity.textContent = `Gittor ${update.version} is ready`;
  toast(`Gittor ${update.version} is ready. Restart Gittor to use it.`, "success", { label: "Restart", run: () => void restartApp() }, STAY_MS);
}

async function start() {
  if (soloWindow || !(await updatesEnabled())) return;
  const auto = () => {
    if (settings.autoCheckUpdates) void checkNow(false);
  };
  setTimeout(auto, FIRST_CHECK_MS);
  setInterval(auto, CHECK_EVERY_MS);
}

void start();
