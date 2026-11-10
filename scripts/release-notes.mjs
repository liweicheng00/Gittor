// The release notes of a version: docs/releases/v<version>.md. The release workflow publishes them on
// the release page and in latest.json (the text of the update notification).
//
// The format:
//   One summary line for the users.
//
//   ## New
//   - A sentence on one feature.
//   ## Improved
//   - ...
//   ## Fixed
//   - ...
//
// The sections come in this order. Each one is optional, but the notes have at least one item.
//
// Usage: node scripts/release-notes.mjs check <file>    finds the errors
//        node scripts/release-notes.mjs github <file>   the text for the release page
//        node scripts/release-notes.mjs update <file>   the text for the update notification

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const SECTIONS = ["New", "Improved", "Fixed"];
/** ASD-STE100: a sentence of a procedure has 20 words at most, a sentence of a description 25. */
export const MAX_WORDS = 25;

/** The path of the notes of a version, from the root of the repository. */
export const notesPath = (version) => `docs/releases/v${version}.md`;

/** Reads the notes. It returns the summary, the sections with their items, and the errors. */
export function parseNotes(text) {
  const errors = [];
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  let summary = "";
  const sections = [];
  let current = null;
  lines.forEach((raw, i) => {
    const line = raw.trimEnd();
    const at = `line ${i + 1}`;
    if (!line.trim()) return;
    const heading = /^## (.+)$/.exec(line);
    if (heading) {
      const name = heading[1].trim();
      if (!SECTIONS.includes(name)) errors.push(`${at}: the section "${name}" is not one of ${SECTIONS.join(", ")}`);
      else if (sections.some((s) => s.name === name)) errors.push(`${at}: the section "${name}" is there two times`);
      else if (sections.length && SECTIONS.indexOf(name) < SECTIONS.indexOf(sections.at(-1).name))
        errors.push(`${at}: the sections must come in this order: ${SECTIONS.join(", ")}`);
      current = { name, items: [] };
      sections.push(current);
      return;
    }
    if (line.startsWith("- ")) {
      if (!current) errors.push(`${at}: an item before the first section`);
      else current.items.push(line.slice(2).trim());
      errors.push(...itemErrors(line.slice(2).trim()).map((e) => `${at}: ${e}`));
      return;
    }
    if (!current && !summary) {
      summary = line.trim();
      if (line.startsWith("#")) errors.push(`${at}: the summary is a plain line, not a heading`);
      errors.push(...itemErrors(summary).map((e) => `${at}: ${e}`));
      return;
    }
    errors.push(`${at}: only a summary line, "## " sections and "- " items are allowed`);
  });
  if (!summary) errors.push("the notes have no summary line");
  for (const s of sections) if (!s.items.length) errors.push(`the section "${s.name}" has no items`);
  if (!sections.some((s) => s.items.length)) errors.push("the notes have no items");
  return { summary, sections, errors };
}

/** The errors of one item or of the summary: words that are for developers, and long sentences. */
export function itemErrors(text) {
  const errors = [];
  if (/\b[0-9a-f]{7,40}\b/.test(text)) errors.push("no commit hashes");
  if (/\b[\w-]+\.(ts|mjs|js|rs|toml|json|yml|css|sh)\b|AGENTS\.md|README\.md/.test(text)) errors.push("no file names of the source code");
  if (/^(fix|feat|chore|refactor|docs|ci|test)(\(.*\))?:/i.test(text)) errors.push("no commit prefixes such as feat: or fix:");
  for (const sentence of text.split(/(?<=[.!?])\s+/)) {
    const words = sentence.split(/\s+/).filter(Boolean).length;
    if (words > MAX_WORDS) errors.push(`a sentence has ${words} words (${MAX_WORDS} at most)`);
  }
  return errors;
}

/** The text for the release page on GitHub: the summary and the sections. */
export function githubNotes({ summary, sections }) {
  const parts = [summary];
  for (const s of sections) parts.push(`## ${s.name}\n${s.items.map((i) => `- ${i}`).join("\n")}`);
  return parts.join("\n\n") + "\n";
}

/** The text for the update notification: the summary, then the items without headings. The notification
 * shows the first lines only, so the order of the sections puts the new features first. */
export function updateNotes({ summary, sections }) {
  return [summary, ...sections.flatMap((s) => s.items.map((i) => `- ${i}`))].join("\n") + "\n";
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [what, file] = process.argv.slice(2);
  if (!["check", "github", "update"].includes(what) || !file) {
    console.error("Usage: node scripts/release-notes.mjs check|github|update <file>");
    process.exit(1);
  }
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    console.error(`${file} does not exist. Write the release notes first (see .claude/skills/release/SKILL.md).`);
    process.exit(1);
  }
  const notes = parseNotes(text);
  if (notes.errors.length) {
    console.error(`${file}:\n${notes.errors.map((e) => `  ${e}`).join("\n")}`);
    process.exit(1);
  }
  if (what === "github") process.stdout.write(githubNotes(notes));
  if (what === "update") process.stdout.write(updateNotes(notes));
}
