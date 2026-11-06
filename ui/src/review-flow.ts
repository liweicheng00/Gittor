// Review Branch: start a review, open it, switch between reviews, and merge a reviewed branch.

import { api, type ReviewDetail, type ReviewSummary } from "./api";
import { openProjectInEditor } from "./editor-flow";
import type { PickerItem, PickerSection } from "./branch-picker";
import { showMenu } from "./context-menu";
import { confirmDialog, finishReviewDialog, formDialog } from "./dialogs";
import { runOp } from "./operations";
import { jumpToOid, loadReviews } from "./repo";
import { openReview } from "./review-view";
import { toast } from "./notify";
import { reviewPanel, showLeftTab, task } from "./shell";
import { app } from "./state";

const locals = () => app.refs.filter((b) => b.kind === "local").map((b) => b.name);
const remotes = () => app.refs.filter((b) => b.kind === "remote" && !b.name.endsWith("/HEAD")).map((b) => b.name);

/** The groups of a branch picker, as in the branch switcher: Recent, Local and Remote. */
const branchSections = (skip?: string): PickerSection[] => {
  const cur = app.repoState?.branch;
  const author = new Map(app.refs.map((b) => [b.name, b.author]));
  const item = (n: string): PickerItem => ({ value: n, current: n === cur, detail: author.get(n) });
  const local = locals().filter((n) => n !== skip);
  return [
    ["Recent", app.recent.map((r) => r.name).filter((n) => local.includes(n)).map(item)],
    ["Local", local.map(item)],
    ["Remote", remotes().filter((n) => n !== skip).map(item)],
  ];
};

const BASES = ["main", "master", "develop"];
const baseName = (n: string) => n.slice(n.indexOf("/") + 1);

/** The base that a new review of `branch` likely wants: a local main, master or develop, then a remote one. */
function guessBase(branch: string): string {
  const names = locals().filter((n) => n !== branch);
  const remote = remotes().filter((n) => n !== branch);
  return BASES.find((n) => names.includes(n)) ?? remote.find((n) => BASES.includes(baseName(n))) ?? names[0] ?? remote[0] ?? "";
}

/** Fetches the remote branches among `names`, so that a review shows their newest state. A failed fetch
 * leaves the last fetched state and says so. */
async function fetchRemoteBranches(names: string[]) {
  const remote = new Set(remotes());
  for (const n of new Set(names.filter((n) => remote.has(n)))) {
    const out = await task(`Fetching ${n}`, () => api.runOp({ op: "fetchBranch", branch: n })).catch(() => undefined);
    if (!out?.result.ok) toast(`The fetch of ${n} failed. The review shows its last fetched state.`, "info");
  }
}

/** Asks for the branch and the base, starts the review, and opens it. */
export async function startReview(branch?: string) {
  const names = [...locals(), ...remotes()];
  if (names.length < 2) return void (await confirmDialog("Review Branch", "A review needs two branches: the branch and its base.", "OK"));
  const cur = app.repoState?.branch ?? names[0];
  // The current branch, or else a recent branch that is not a usual base.
  const recent = app.recent.map((r) => r.name).filter((n) => names.includes(n));
  const b = branch ?? (!BASES.includes(cur) ? cur : [...recent, ...names].find((n) => !BASES.includes(baseName(n)) && !BASES.includes(n)) ?? names[0]);
  const r = await formDialog(
    "Review Branch",
    [
      { key: "branch", label: "Branch", type: "branch", value: b, sections: () => branchSections() },
      { key: "base", label: "Into (base)", type: "branch", value: guessBase(b), sections: () => branchSections() },
    ],
    "Start Review",
    "The review shows the changes of the branch from the commit where it started, as a pull request does. A remote branch shows its last fetched state. Merge needs a local base. The notes and the viewed files stay in this repository only.",
  );
  if (!r) return;
  await fetchRemoteBranches([String(r.branch), String(r.base)]);
  try {
    await api.reviewEdit({ action: "start", branch: String(r.branch), base: String(r.base) });
  } catch (e) {
    return void (await confirmDialog("Review Branch", String(e).replace(/^Error: /, ""), "OK"));
  }
  await loadReviews();
  showLeftTab("reviews");
  await openReviewWindow(String(r.branch));
}

/** Opens the Merge dialog and merges. True when the branch was merged. */
async function finish(d: ReviewDetail): Promise<boolean> {
  const choice = await finishReviewDialog(d);
  if (!choice) return false;
  const out = await runOp({ op: "finishReview", branch: d.summary.branch, ...choice }, `Merging ${d.summary.branch} into ${d.summary.base}`);
  await loadReviews();
  return !!out?.result.ok;
}

export async function finishReview(branch: string) {
  try {
    await finish(await api.review(branch));
  } catch (e) {
    await confirmDialog("Merge", String(e).replace(/^Error: /, ""), "OK");
  }
}

export async function openReviewWindow(branch: string) {
  await openReview(branch, {
    list: () => reviewPanel.all,
    load: (b) => api.review(b),
    edit: async (e) => {
      await api.reviewEdit(e);
      void loadReviews();
    },
    changes: async (l, r) => (await api.compare(l, r)).changes,
    pair: (l, r, path, oldPath) => api.filePair(l, r, path, oldPath),
    finish,
    showInLog: (oid) => void jumpToOid(oid, true),
    branches: () => {
      const reviewed = new Set(reviewPanel.all.map((r) => r.branch));
      return branchSections().map(([title, items]): PickerSection => [title, items.filter((i) => !reviewed.has(i.value)).map((i) => ({ ...i, current: false }))]);
    },
    start: (b) => void startReview(b),
    openInIde: () => void openProjectInEditor(),
    fetch: (b) => fetchRemoteBranches([b, ...reviewPanel.all.filter((r) => r.branch === b).map((r) => r.base)]),
    authorOf: (b) => app.refs.find((r) => r.name === b)?.author,
  });
}

async function changeBase(r: ReviewSummary) {
  const f = await formDialog(`Base of ${r.branch}`, [{ key: "base", label: "Into (base)", type: "branch", value: r.base, sections: () => branchSections(r.branch) }], "Change");
  if (!f) return;
  await api.reviewEdit({ action: "start", branch: r.branch, base: String(f.base) });
  await loadReviews();
}

reviewPanel.onNew = () => void startReview();
reviewPanel.onOpen = (r) => void openReviewWindow(r.branch);
reviewPanel.onFinish = (r) => void finishReview(r.branch);
reviewPanel.onMenu = (r, e) =>
  showMenu(e.clientX, e.clientY, [
    { label: "Open Review", action: () => void openReviewWindow(r.branch) },
    { label: `Merge into ${r.base}…`, disabled: !r.exists || r.merged || r.baseIsRemote, action: () => void finishReview(r.branch) },
    { label: "Change the Base…", action: () => void changeBase(r) },
    { separator: true },
    {
      label: "Remove Review…",
      action: async () => {
        if (!(await confirmDialog("Remove review", `Remove the review of ${r.branch} and its notes? The branch stays.`, "Remove", true))) return;
        await api.reviewEdit({ action: "remove", branch: r.branch });
        await loadReviews();
      },
    },
  ]);
