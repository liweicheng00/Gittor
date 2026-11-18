// The interactive rebase editor: a plan with drag and drop, a check of the plan before it runs, and
// "Copy for an Agent". The rows show newest first, like the log. The check runs in memory on the backend
// and changes nothing. Run moves the branch; with a conflict, Run runs a real rebase that stops at it.

import { api, type PlanAction, type RewriteCheck, type RewriteRange, type StepCheck } from "./api";
import { messageDialog } from "./dialogs";
import { copyText, h } from "./dom";
import { toast } from "./notify";
import { runOp } from "./operations";
import { dragRow } from "./rebase-drag";
import { agentText } from "./rebase-agent-text";
import { autosquash } from "./autosquash";
import { autosquashCount, linesOf, moveLine, planError, setAction, squashGroups, squashOnto, type PlanLine, toPlan } from "./rebase-plan";
import { short } from "./selection";

const ACTIONS: [PlanAction, string][] = [
  ["pick", "Pick"],
  ["reword", "Reword"],
  ["edit", "Edit"],
  ["squash", "Squash"],
  ["fixup", "Fixup"],
  ["drop", "Drop"],
];

const STATUS_TEXT: Record<StepCheck["status"], string> = {
  ok: "✓ ok",
  conflict: "✕ conflict",
  empty: "empty",
  dropped: "dropped",
  afterConflict: "? after a conflict",
};

/** Opens the editor for a range and runs the chosen plan. */
/** The start lines of a range, newest first, with autosquash applied to fixup!/squash! commits. */
function startLines(range: RewriteRange): PlanLine[] {
  const oldest = [...linesOf(range)].reverse();
  if (autosquashCount(range)) autosquash(oldest);
  return oldest.reverse();
}

export function openRebaseEditor(range: RewriteRange, repoPath: string, branch: string) {
  let lines = startLines(range);
  let check: RewriteCheck | null = null;
  let generation = 0;

  const prevFocus = document.activeElement as HTMLElement | null;
  const list = h("div", { class: "rebase-list", role: "list" });
  const error = h("div", { class: "dialog-error" });
  const summary = h("div", { class: "rebase-summary" });
  const runBtn = h("button", { class: "primary" }, "Run Rebase") as HTMLButtonElement;
  const copyBtn = h("button", {}, "Copy for an Agent") as HTMLButtonElement;
  const resetBtn = h("button", {}, "Reset Plan") as HTMLButtonElement;
  const cancelBtn = h("button", {}, "Cancel") as HTMLButtonElement;
  const spinner = h("span", { class: "rebase-checking" }, "");

  const close = () => {
    overlay.remove();
    document.removeEventListener("keydown", onKey, true);
    prevFocus?.focus();
  };

  const stepOf = (oid: string): StepCheck | undefined => check?.steps.find((s) => s.oid === oid);

  const render = () => {
    const err = planError(lines);
    error.textContent = err ?? "";
    list.replaceChildren(
      ...lines.map((l, i) => {
        const grip = h("span", { class: "rebase-grip", title: "Drag to reorder. Drop on a commit to squash; hold Alt for a fixup." }, "⋮⋮");
        grip.addEventListener("mousedown", (e) => {
          if ((e as MouseEvent).button !== 0) return;
          dragRow(e as MouseEvent, {
            list,
            from: i,
            onDrop: (r) => {
              lines = r.kind === "move" ? moveLine(lines, r.from, r.to) : squashOnto(lines, r.from, r.target, r.fixup);
              render();
              void recheck();
            },
          });
        });
        const select = h("select", { class: "rebase-action", title: "The action for this commit" }, ...ACTIONS.map(([v, label]) => h("option", { value: v, selected: v === l.action }, label))) as HTMLSelectElement;
        select.addEventListener("change", () => void changeAction(i, select.value as PlanAction));
        const step = stepOf(l.oid);
        const status = l.action === "drop" ? "dropped" : (step?.status ?? "");
        const files = step?.conflicts.length ? step.conflicts.map((c) => `${c.path} (${c.kind})`).join(", ") : "";
        const statusEl = h("span", { class: `rebase-status status-${status || "none"}`, title: files }, status ? (STATUS_TEXT[status as StepCheck["status"]] ?? "") + (files ? ` ${files}` : "") : "");
        const reword = l.message2 && (l.action === "reword" || l.action === "squash" || l.action === "fixup") ? h("span", { class: "rebase-reworded", title: l.message2 }, "✎") : "";
        return h(
          "div",
          { class: `rebase-row action-${l.action}`, role: "listitem", "data-oid": l.oid },
          grip,
          // The node of the commit in a small graph of the new order. The color shows the result of the check.
          h("span", { class: `rebase-node${status ? ` node-${status}` : ""}`, "aria-hidden": "true" }),
          select,
          h("code", { class: "rebase-hash" }, l.oid.slice(0, 8)),
          h("span", { class: "rebase-subject" }, reword, l.subject),
          h("span", { class: "rebase-author" }, l.author),
          statusEl,
        );
      }),
    );
  };

  const changeAction = async (index: number, action: PlanAction) => {
    if (action === "reword") {
      const m = await messageDialog(`Reword ${short(lines[index].oid)}`, lines[index].message2 ?? lines[index].message, "Save");
      if (!m) return render(); // Cancel: keep the old action in the select.
      lines = setAction(lines, index, "reword");
      lines[index] = { ...lines[index], message2: m };
    } else {
      lines = setAction(lines, index, action);
    }
    render();
    void recheck();
  };

  const paintCheck = () => {
    if (!check) {
      summary.replaceChildren();
      return;
    }
    const rows: HTMLElement[] = [];
    const line = (cls: string, text: string) => rows.push(h("div", { class: `rebase-sum ${cls}` }, text));
    const conflicts = check.steps.filter((s) => s.status === "conflict");
    if (conflicts.length) {
      const files = [...new Set(conflicts.flatMap((s) => s.conflicts.map((c) => c.path)))];
      line("bad", `✕ ${conflicts.length} step(s) have a conflict: ${files.join(", ")}.`);
    }
    if (check.blockingFiles.length) line("bad", `✕ Local changes would be lost: ${check.blockingFiles.join(", ")}. Commit or stash them first.`);
    for (const r of check.remotes) line("warn", `⚠ ${r.commits} commit(s) are on ${r.name}. After Run you must force-push.`);
    for (const r of check.otherRefs) line("warn", `⚠ The branch or tag ${r} keeps the old commits.`);
    if (check.changedFiles.length) line("warn", `⚠ The files at the end differ from now: ${check.changedFiles.join(", ")}.`);
    if (!conflicts.length && !check.blockingFiles.length) line("ok", "✓ No conflict. The rebase runs in memory.");
    summary.replaceChildren(...rows);

    const err = planError(lines);
    const blocked = !!err || check.blockingFiles.length > 0;
    const hasConflict = conflicts.length > 0;
    runBtn.textContent = hasConflict ? "Run and Stop at the Conflict" : "Run Rebase";
    runBtn.disabled = blocked;
    runBtn.classList.toggle("danger", hasConflict);
  };

  const recheck = async () => {
    const err = planError(lines);
    if (err) {
      check = null;
      paintCheck();
      runBtn.disabled = true;
      return;
    }
    const gen = ++generation;
    spinner.textContent = "Checking…";
    try {
      const result = await api.rewriteCheck(range.base, toPlan(lines));
      if (gen !== generation) return; // A newer check started.
      check = result;
    } catch (e) {
      if (gen !== generation) return;
      check = null;
      toast(String(e).replace(/^Error: /, ""), "error");
    } finally {
      if (gen === generation) {
        spinner.textContent = "";
      }
    }
    render();
    paintCheck();
  };

  const copyForAgent = async () => {
    if (!check) return;
    const text = agentText({ repoPath, branch, head: check.head, base: range.base, lines, check });
    await copyText(text);
    toast("Copied the plan for an agent. Paste it into your agent; Gittor shows the rebase while it runs.", "success");
  };

  // The messages of the squash groups, asked once before Run. A group of a commit and only fixups keeps
  // the commit message, so it is not asked. A group with a squash gets a joined message.
  const groupMessages = async (): Promise<boolean> => {
    const oldest = [...lines].reverse();
    const groups = squashGroups(oldest).filter((g) => g.length > 1 && g.slice(1).some((i) => oldest[i].action === "squash"));
    const joined = groups.filter((g) => !oldest[g[0]].message2);
    for (const [k, g] of joined.entries()) {
      // The fixup members add no text; the head and the squash members do.
      const text = g.filter((i, n) => n === 0 || oldest[i].action === "squash").map((i) => oldest[i].message).join("\n\n");
      const of = joined.length > 1 ? ` (${k + 1} of ${joined.length})` : "";
      const m = await messageDialog(`Message of the squashed commit${of}`, text, "Squash", `${g.length} commits become one commit. Edit the message, then Squash.`);
      if (!m) return false;
      // Store on the head line (newest-first index).
      const headOid = oldest[g[0]].oid;
      const idx = lines.findIndex((l) => l.oid === headOid);
      lines[idx] = { ...lines[idx], message2: m };
    }
    return true;
  };

  const run = async () => {
    if (!check || runBtn.disabled) return;
    const hasConflict = check.steps.some((s) => s.status === "conflict");
    if (!(await groupMessages())) return;
    const plan = toPlan(lines);
    close();
    await runOp({ op: "rewrite", base: range.base, plan, what: "Interactive rebase", expectedHead: check.head, stopAtConflict: hasConflict }, "Rebasing");
  };

  const reset = () => {
    lines = startLines(range);
    render();
    void recheck();
  };

  // Keyboard: Alt+Up/Down move the focused row; the action letters set the action. Enter runs.
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
      return;
    }
    const row = (e.target as HTMLElement)?.closest<HTMLElement>(".rebase-row");
    const tag = (e.target as HTMLElement)?.tagName;
    if (e.key === "Enter" && tag !== "SELECT" && tag !== "TEXTAREA") {
      e.preventDefault();
      void run();
      return;
    }
    if (!row) return;
    const i = lines.findIndex((l) => l.oid === row.dataset.oid);
    if (i < 0) return;
    if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      e.preventDefault();
      const to = e.key === "ArrowUp" ? i - 1 : i + 1;
      if (to < 0 || to >= lines.length) return;
      lines = moveLine(lines, i, to);
      render();
      void recheck();
      (list.querySelectorAll<HTMLElement>(".rebase-row")[to]?.querySelector("select") as HTMLElement | null)?.focus();
    } else if (!e.altKey && !e.metaKey && !e.ctrlKey) {
      const map: Record<string, PlanAction> = { p: "pick", r: "reword", e: "edit", s: "squash", f: "fixup", d: "drop" };
      const action = map[e.key.toLowerCase()];
      if (action) {
        e.preventDefault();
        void changeAction(i, action);
      }
    }
  };

  runBtn.addEventListener("click", () => void run());
  copyBtn.addEventListener("click", () => void copyForAgent());
  resetBtn.addEventListener("click", reset);
  cancelBtn.addEventListener("click", close);

  const squashes = autosquashCount(range);
  const noteText =
    "The top row is the newest commit. Drag a row to reorder it; drop it on a commit to squash, or hold Alt for a fixup. The check runs in memory and changes nothing until you Run.";
  const autoText = squashes ? ` Autosquash: ${squashes} fixup! or squash! commit(s) moved next to their commits.` : "";
  const note = h("p", { class: "dialog-note" }, noteText + autoText);
  const dialog = h(
    "div",
    { class: "dialog wide rebase-dialog", role: "dialog", "aria-modal": "true", "aria-label": "Interactive rebase" },
    h("div", { class: "dialog-title" }, `Interactively rebase ${range.entries.length} commits`),
    note,
    error,
    list,
    summary,
    h("div", { class: "dialog-buttons" }, spinner, resetBtn, copyBtn, cancelBtn, runBtn),
  );
  const overlay = h("div", { class: "overlay" }, dialog);
  overlay.addEventListener("mousedown", (e) => e.target === overlay && close());
  document.body.append(overlay);
  document.addEventListener("keydown", onKey, true);

  render();
  runBtn.disabled = true;
  void recheck();
}
