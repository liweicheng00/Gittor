# Refresh without flicker

Gittor loads its view again when files or refs change outside the app. Several coding agents that work
in one folder change files all the time. This document gives the causes of the flicker in that case,
the design that removes it, the numbers before and after, and the open points.

## The path of a change

1. `crates/service/src/watch.rs` gets the events of the file system. It collects them in a batch, drops
   the ignored paths, and adds 1 to one of two counters: `files` (the working tree or the index) or
   `repo` (HEAD, refs, the state files of an operation).
2. The backend sends the counters to the UI (`backend-event`, kind `watch`). The UI also asks for them
   each 3 s.
3. `ui/src/watch.ts` compares the counters with the last ones and asks `RefreshScheduler` for a load of
   kind `files` or `repo`.
4. The load gets the data and gives it to the parts of the view. `notifyRepoChange` tells the open
   windows (Compare, Review).

## Causes of the flicker

| Cause | Where |
| --- | --- |
| A batch went out after 300 ms without an event. Writes that came slower gave one load for each write. Writes that came faster held the batch back without a limit. | `watch.rs` |
| Each load made all rows of the Changes list again. The row under the mouse was a new element: a click or a drag on it was lost, and the hover color flashed. | `commit-panel.ts` |
| Each draw of the Changes list scrolled to the file of the open diff. The list jumped back while the user looked at other rows. | `commit-panel.ts` |
| A load after a change of refs cleared the log first. The rows came back when the backend answered. | `log-view.ts`, `applyView` |
| At the top of the log, the view moved down with the old first row. New commits were above the view. | `applyView` |
| The Branches list drew four times for one load (refs, recent branches, worktrees, favorites), also when nothing changed. | `sidebar.ts` |
| The status bar, the toolbar, the commit details and the operation banner made new elements for the same data. The text "loaded in N ms" changed with each load. | `shell.ts`, `details-panel.ts`, `op-banner.ts` |
| The diff replaced all text of its models when the file changed. A selection could go away. When lines came or went above the view, the text moved on the screen. | `diff-view.ts` |
| The Markdown preview made all blocks again. Images and diagrams loaded again. | `diff-view.ts` |
| The Compare window showed "Loading…" and cleared its lists for each change of refs. | `compare-view.ts` |
| A new list could put a new draft into the message field while the user wrote in it. | `commit-panel.ts` |
| Each load after a change of files also loaded the stashes, the reviews and the submodules. | `repo.ts` |

## Design

### 1. Fewer loads

- **The watcher** (`Coalescer` in `watch.rs`). A batch goes out after 300 ms without an event, or 1 s
  after its first event. Two batches are at least 1 s apart. So the first change after a pause shows
  fast, steady writes give one batch each second, and the data is never older than 1 s plus the time
  of the load.
- **The scheduler** (`ui/src/refresh-scheduler.ts`). One load runs at a time. Requests that come
  during a load give one more load after it, of the larger kind (`repo` includes `files`). A slow
  `git status` on a large repository thus sets the pace by itself.
- **Only what changed.** A `files` load gets the state, the local changes and the open local diff. It
  gets the submodules only when the repository has some. The stashes, the reviews, the log and the
  branches load only with `repo`.

### 2. No draw of the same data, and updates in place

- `reconcile()` in `ui/src/keyed.ts` updates a list in place. Each row has a key and a signature (all
  that it shows and all that its handlers use). A row with the same key and signature keeps its
  element. The Changes list, the Branches list, the files of the Compare window, the rows of the log
  and the blocks of the Markdown preview use it.
- The log loads the new rows first and draws once (`LogView.reload`). A row keeps its element when its
  commit shows in the same way, also at a new place.
- Texts and small parts are set only when they changed.

### 3. The diff that the user reads

- The same file with the same texts: nothing draws (`DiffView.shows`).
- The same file with new text: the edits of a line diff go into the models that show
  (`ui/src/text-edit.ts`). The lines that did not change, the cursor and the selection stay.
- The first line of the view stays at its place on the screen. `lineAfter` gives its new number when
  lines came or went above it. The diff of Monaco comes a little later and can add space; then the
  line goes back to its place, but not when the user scrolled in between.

The diff follows the file at once. A notice "this file changed, reload?" was the other option. It
keeps the text fully still, but the user then reads old text and must click for each change. With the
edits in place, the lines that the user reads do not move, so the notice is not necessary.

### 4. Not while the user interacts

`ui/src/interaction.ts` tells the scheduler when a draw would disturb: the mouse is down (a click, a
drag, a text selection), a drag of files or a menu is open, or the user scrolled in the last 250 ms.
The load waits, for 5 s at most. Then it runs anyway, so the data does not stay old. A load for a
hidden window waits until the window shows.

A text field with the focus does not hold a load: the lists update in place, so the field keeps its
focus and its text.

### What the design does not use

- **The changed paths.** The watcher knows them, but the UI asks git for the whole status. A status
  for some paths only would miss renames and changes of the index. The loads are few now, so the
  whole status is cheap enough.
- **`index.lock` as a signal.** A git command of an agent holds the lock for a short time. The quiet
  time of 300 ms already puts the events of one command into one batch.
- **A longer wait for many writes.** One load each second is the limit already. A longer wait makes
  the data older and does not make the view calmer, because the draws are in place.

## Numbers

The measurement: the demo repository with a file of 400 lines that the user reads in the middle, with
a selection of four lines, and 43 changed files. For 30 s, three simulated agents write, create and
delete files at random intervals of 80 ms to 700 ms, run `git status`, and commit (about 220 actions,
11 commits, 36 writes to the file that the user reads). A script counts the backend calls, the new DOM
nodes of each part, and samples the view each 100 ms. Chromium, one run each.

| Measure | Before | After |
| --- | --- | --- |
| File rows of the Changes list made again (same file, new element) | 1275 | 0 |
| New nodes in the Changes list | 1535 | 203 |
| New nodes in the Branches list | 648 | 30 |
| New nodes in the log | 196 | 21 |
| New nodes in the commit details | 45 | 5 |
| New nodes in the toolbar and the status bar | 245 | 35 |
| Samples in which the row under the mouse was a new element | 343 of 347 | 0 of 347 |
| Samples in which the text selection of the diff was gone | 229 of 347 | 0 of 347 |
| Times that the text of the diff moved on the screen | 6 | 1 (a line came in the view itself) |
| The Changes list jumped to the open file | yes (scroll 260 to 93) | no |
| Backend calls each second | 8.6 | 7.6 |
| Loads of stashes, reviews and submodules | 26 each | 10 each |
| Time until a new file shows, median | 1085 ms | 407 ms |
| Time until a new file shows, maximum | 1994 ms | 914 ms |

The number of loads of the local changes is the same (26 and 29 in 30 s): the old watcher was near one
load each second in this run already, because the writes held its batches back. Its loads were not
regular: a new file needed up to 2 s. In the scenario `refresh-quiet`, 12 writes at intervals of
350 ms give 5 loads. With the old quiet time of 300 ms alone, each of these writes is a batch of its
own.

The layout shift score of Chromium did not go down (0.06 before, 0.11 after). A new row in a list
moves the rows below it, and that counts as a shift.

## Tests

- `watch.rs`: the `Coalescer` (quiet time, longest wait, gap) and a burst of 40 writes on disk.
- `ui/test/keyed.test.ts`, `text-edit.test.ts`, `refresh-scheduler.test.ts`.
- `ui/e2e/refresh-quiet.mjs`: bursts of writes while the user reads a diff with a selection.

## Open points

- The Stash list, the Reviews list and the Submodules list still make all rows again when their data
  changes. Their data changes rarely, and each skips the draw of the same data.
- A header of a changelist or a folder row is a new element when a file comes or goes in it.
- The hunk check boxes and the marks of other changelists in the diff draw again when the file
  changes.
- The History window and the Review window do not follow changes of files. The Review window follows
  refs only.
- The Markdown preview marks changed blocks with the diff of Monaco, which comes about 200 ms after
  the text. In that time the marks can be those of the old diff.
- The hold while the user interacts is not tested in the real app (WKWebView, WebKitGTK). A mouse
  release outside the window can be missed there; the limit of 5 s ends the hold.
- The numbers are from one machine with a small repository. A repository with a slow `git status` has
  fewer loads, because one load runs at a time.
