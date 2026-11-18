// The text of "Copy for an Agent": the plan, the result of the check, and the rules as one Markdown task.
// A coding agent runs the rebase and resolves the conflicts. The function is pure, so
// ui/test/rebase-agent-text.test.ts can check it. It does not touch the clipboard or the app.

import type { PlanAction, RewriteCheck, StepCheck } from "./api";
import type { PlanLine } from "./rebase-plan";

/** The groups of a kept commit and the squashes above it, oldest first (indexes into the oldest-first list). */
function squashGroups(oldestFirst: PlanLine[]): number[][] {
  const groups: number[][] = [];
  oldestFirst.forEach((l, i) => {
    if (l.action === "drop") return;
    if (l.action === "squash" || l.action === "fixup") groups[groups.length - 1]?.push(i);
    else groups.push([i]);
  });
  return groups;
}

export interface AgentTextInput {
  repoPath: string;
  branch: string;
  /** The full oid of HEAD, and of the base ("" for the root commit). */
  head: string;
  base: string;
  /** The lines of the plan, newest first (display order). */
  lines: PlanLine[];
  check: RewriteCheck;
}

const word: Record<PlanAction, string> = {
  pick: "pick",
  reword: "reword",
  edit: "edit",
  squash: "squash",
  fixup: "fixup",
  drop: "drop",
};

/** "notes.md (modify/delete), a.txt (contents)" for a step, or "" when it has none. */
function conflictText(step: StepCheck): string {
  return step.conflicts.map((c) => `${c.path} (${c.kind})`).join(", ");
}

export function agentText({ repoPath, branch, head, base, lines, check }: AgentTextInput): string {
  const oldest = [...lines].reverse();
  const byOid = new Map(check.steps.map((s) => [s.oid, s]));
  const todo = oldest.map((l) => `${word[l.action]} ${l.oid} ${l.subject}`).join("\n");

  // The messages of the reworded commits and the squash groups.
  const groups = squashGroups(oldest);
  const messages: string[] = [];
  for (const g of groups) {
    const head = oldest[g[0]];
    if (g.length > 1 && head.message2) {
      messages.push(`### ${head.oid} (squash of ${g.length} commits)\n\n${head.message2}`);
    } else if (head.action === "reword" && head.message2) {
      messages.push(`### ${head.oid} (reword)\n\n${head.message2}`);
    }
  }

  // The result of the check, step by step.
  const findings: string[] = [];
  for (const l of oldest) {
    const step = byOid.get(l.oid);
    if (!step) continue;
    if (step.status === "conflict") findings.push(`- ${l.oid} "${l.subject}": CONFLICT in ${conflictText(step)}.`);
    else if (step.status === "empty") findings.push(`- ${l.oid} "${l.subject}": becomes empty (no change).`);
    else if (step.status === "afterConflict") findings.push(`- ${l.oid} "${l.subject}": after a conflict, so this is a guess.`);
  }
  if (!findings.length) findings.push("- No conflict or empty commit found.");

  const warnings: string[] = [];
  for (const r of check.remotes) warnings.push(`- ${r.commits} commit(s) are on ${r.name}. Do not force-push.`);
  for (const r of check.otherRefs) warnings.push(`- The branch or tag ${r} keeps the old commits.`);
  if (check.changedFiles.length) warnings.push(`- The files at the end differ from now: ${check.changedFiles.join(", ")}.`);

  const baseArg = base ? base : "--root";
  const sections = [
    `# Rebase task from Gittor`,
    `Repository: ${repoPath}\nBranch: ${branch}\nHEAD must be: ${head}  (stop if it is not)\nBase: ${base || "(root commit)"}`,
    `## Todo (oldest first)\n\n\`\`\`\n${todo}\n\`\`\``,
  ];
  if (messages.length) sections.push(`## Messages\n\n${messages.join("\n\n")}`);
  sections.push(`## Check of Gittor (nothing changed yet)\n\n${findings.join("\n")}`);
  if (warnings.length) sections.push(`## Warnings\n\n${warnings.join("\n")}`);
  sections.push(
    [
      `## Rules`,
      ``,
      `- Write the todo to a file, then run:`,
      `  \`GIT_SEQUENCE_EDITOR="cp <todo file>" git -C ${repoPath} rebase -i --empty=keep ${baseArg}\``,
      `- At each conflict, resolve it so that the commit keeps its intent on the new history. Then \`git add\` the files and \`git rebase --continue\`.`,
      `- Keep empty commits. Do not skip or drop a commit. Do not push. Do not change other branches.`,
      `- At the end, list each conflict and how you resolved it, then show \`git log --oneline ${base || "--root"}..HEAD\`.`,
    ].join("\n"),
  );
  sections.push(`## Undo\n\n\`git rebase --abort\` during the rebase, or \`git reset --keep ${head}\` after it.`);
  return sections.join("\n\n") + "\n";
}
