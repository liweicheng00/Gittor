// Notes on the local changes: the notes of a working-tree file, and the handlers that add, delete,
// resolve and copy them. The Compare window shows them while its right side is the working tree.

import { api, type LocalNoteEdit } from "./api";
import { copyText } from "./dom";
import type { NoteHandlers, NoteItem } from "./note-layer";
import { formatNote } from "./note-format";
import { toast } from "./notify";

/** The notes of a working-tree file. They go away when the file changes, so none is outdated. */
export async function listLocalNotes(path: string): Promise<NoteItem[]> {
  return (await api.localNotes(path).catch(() => [])).map((n) => ({ ...n, outdated: false }));
}

/** The handlers for the notes of a file. `reload` shows the notes again after a change. */
export function localNoteHandlers(path: string, reload: () => Promise<void>): NoteHandlers {
  const run = async (e: LocalNoteEdit) => {
    try {
      await api.localNoteEdit(e);
    } catch (err) {
      toast(String(err).replace(/^Error: /, ""), "error");
    }
    await reload();
  };
  return {
    add: (line, endLine, text) => run({ action: "add", path, line, endLine, text }),
    remove: (id) => run({ action: "delete", path, id }),
    resolve: (id, resolved) => run({ action: "resolve", path, id, resolved }),
    copy: (n) => void copyText(formatNote(path, n)),
  };
}
