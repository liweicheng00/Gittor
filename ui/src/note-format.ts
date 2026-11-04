// The text of review notes for the clipboard: the file and the lines, then the note. A note on the whole
// file has no line. A blank line separates two notes.

export interface NoteText {
  /** 0 is a note on the whole file. */
  line: number;
  /** The last line of a note on more than one line; 0 or missing is a note on one line. */
  endLine?: number;
  text: string;
}

/** "12" for one line, "12-15" for lines 12 to 15. */
export function lineRange(note: { line: number; endLine?: number }): string {
  return note.endLine && note.endLine > note.line ? `${note.line}-${note.endLine}` : String(note.line);
}

/** One note: "path:line" or "path:first-last" (or "path" for the whole file), then the text of the note. */
export function formatNote(path: string, note: NoteText): string {
  return `${note.line > 0 ? `${path}:${lineRange(note)}` : path}\n${note.text.trim()}`;
}

/** The notes of a file, the note on the whole file first, then by line. */
export function formatNotes(path: string, notes: NoteText[]): string {
  return [...notes]
    .sort((a, b) => a.line - b.line)
    .map((n) => formatNote(path, n))
    .join("\n\n");
}
