// The text of review notes for the clipboard: the file and the line, then the note. A note on the whole
// file has no line. A blank line separates two notes.

export interface NoteText {
  /** 0 is a note on the whole file. */
  line: number;
  text: string;
}

/** One note: "path:line" (or "path" for the whole file), then the text of the note. */
export function formatNote(path: string, note: NoteText): string {
  return `${note.line > 0 ? `${path}:${note.line}` : path}\n${note.text.trim()}`;
}

/** The notes of a file, the note on the whole file first, then by line. */
export function formatNotes(path: string, notes: NoteText[]): string {
  return [...notes]
    .sort((a, b) => a.line - b.line)
    .map((n) => formatNote(path, n))
    .join("\n\n");
}
