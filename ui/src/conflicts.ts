// Merge conflicts and the merge window.

import { api, type Op } from "./api";
import { confirmDialog, conflictsDialog } from "./dialogs";
import { openMergeTool } from "./merge-view";
import { toast } from "./notify";
import { runOp } from "./operations";
import { banner } from "./shell";

/** Opens the merge window for one file. Returns true when the file was resolved. */
export async function mergeFile(path: string): Promise<boolean> {
  let sides;
  try {
    sides = await api.mergeSides(path);
  } catch (e) {
    toast(String(e).replace(/^Error: /, ""), "error");
    return false;
  }
  if (sides.binary || sides.ours.text === null || sides.theirs.text === null) {
    const why = sides.binary ? "is binary" : sides.ours.text === null ? "was deleted in yours" : "was deleted in theirs";
    const r = await conflictsDialog([path], sides.ours.label, sides.theirs.label);
    if (!r || r.action === "merge") {
      if (r) toast(`${path} ${why}. Take one whole side.`, "info");
      return false;
    }
    return !!(await runOp({ op: "resolveSide", paths: [path], side: r.action }, "Resolving"))?.result.ok;
  }
  const outcome = await openMergeTool({
    path,
    base: sides.base.text,
    ours: sides.ours.text,
    theirs: sides.theirs.text,
    oursLabel: sides.ours.label,
    theirsLabel: sides.theirs.label,
  });
  if (outcome.kind === "cancel") return false;
  const op: Op = outcome.kind === "save" ? { op: "resolveText", path, text: outcome.text } : { op: "resolveSide", paths: [path], side: outcome.side };
  return !!(await runOp(op, "Resolving"))?.result.ok;
}

let resolving = false;

/** The Conflicts dialog. After a file is merged in the merge window, the next file opens in the window
 * at once. The dialog shows again when the user cancels the window. It repeats until no conflict is
 * left or the user closes it. */
export async function resolveConflicts() {
  if (resolving) return;
  resolving = true;
  try {
    let next = false;
    for (;;) {
      const st = await api.repoState().catch(() => null);
      if (!st?.conflicts.length) return;
      if (next) {
        next = await mergeFile(st.conflicts[0]);
        continue;
      }
      const labels = await api.mergeSides(st.conflicts[0]).then((s) => [s.ours.label, s.theirs.label]).catch(() => ["yours", "theirs"]);
      const r = await conflictsDialog(st.conflicts, labels[0], labels[1]);
      if (!r) return;
      if (r.action === "merge") {
        next = await mergeFile(r.paths[0]);
      } else {
        await runOp({ op: "resolveSide", paths: r.paths, side: r.action }, "Resolving");
      }
    }
  } finally {
    resolving = false;
  }
}

let asking = false;

/** After the last conflict is resolved, offers to continue the operation that waits for it. */
export async function offerContinue() {
  if (asking) return;
  const st = await api.repoState().catch(() => null);
  if (!st || st.conflicts.length || st.operation === "none" || st.editing) return;
  const name = { merge: "merge", rebase: "rebase", "cherry-pick": "cherry-pick", revert: "revert" }[st.operation];
  asking = true;
  try {
    if (await confirmDialog("All Conflicts Are Resolved", `No conflicts are left. Continue the ${name}?`, "Continue")) {
      await runOp({ op: "continue" }, "Continuing");
    }
  } finally {
    asking = false;
  }
}

banner.onResolve = () => void resolveConflicts();
