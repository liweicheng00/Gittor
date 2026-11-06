// Open in Editor: opens the file of a diff or a list in the editor of the settings, at the line of the cursor.

import { api } from "./api";
import type { DiffView } from "./diff-view";
import { sharedDiff } from "./history-view";
import { toast } from "./notify";
import { settings } from "./settings";
import { commitPanel, diff, ideBtn, statusActivity } from "./shell";

export async function openInEditor(path: string, line = 1, column = 1) {
  try {
    await api.openInEditor(path, line, column);
    statusActivity.textContent = `Opened ${path.split("/").pop()}:${line} in the editor`;
  } catch (e) {
    toast(String(e).replace(/^Error: /, ""), "error");
  }
}

for (const d of [diff, sharedDiff()]) d.onOpenInEditor = (path, line, column) => void openInEditor(path, line, column);

/** A file of a list: at the cursor when the diff shows that file, else at its first line. */
function fromList(path: string, view: DiffView) {
  const p = view.currentPath === path ? view.editorPosition() : { line: 1, column: 1 };
  void openInEditor(path, p.line, p.column);
}

/** The key of Open in Editor. A window over the main view has its own diff. In the Changes tab it is the
 * selected file. Else it is the file of the diff panel, which also shows the file of a commit list. */
export function openInEditorHere(target: HTMLElement) {
  const windows = document.querySelectorAll(".merge-overlay");
  if (windows.length) {
    // The merge tool has no DiffView. The key does nothing there.
    if (windows[windows.length - 1].contains(sharedDiff().el)) sharedDiff().openInEditor();
    return;
  }
  if (target.closest(".commit-tree")) {
    const f = commitPanel.selectedFiles()[0];
    if (f) return fromList(f.change.path, diff);
  }
  diff.openInEditor();
}

/** The file that Open in IDE shows, at the cursor: the file of a window over the main view (for example a
 * review), else the file of the diff panel when it shows. */
function ideFile(): { path: string; line: number; column: number } | undefined {
  const at = (view: DiffView) => (view.currentPath ? { path: view.currentPath, ...view.editorPosition() } : undefined);
  const windows = document.querySelectorAll(".merge-overlay");
  if (windows.length) return windows[windows.length - 1].contains(sharedDiff().el) ? at(sharedDiff()) : undefined;
  return settings.showDiff ? at(diff) : undefined;
}

/** Opens the working tree of the repository in the editor, as a project, and shows the file in view at
 * the cursor. A file that is not in the working tree opens the project only. */
export async function openProjectInEditor() {
  const file = ideFile();
  try {
    await api.openProjectInEditor(file);
    statusActivity.textContent = file ? `Opened the repository in the editor at ${file.path.split("/").pop()}:${file.line}` : "Opened the repository in the editor";
  } catch (e) {
    toast(String(e).replace(/^Error: /, ""), "error");
  }
}

ideBtn.dataset.keyAction = "openProjectInEditor";
ideBtn.addEventListener("click", () => void openProjectInEditor());
