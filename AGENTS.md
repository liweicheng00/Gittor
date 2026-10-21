# Gittor: notes for agents

Gittor is a light git client in the style of IntelliJ: Tauri 2, Rust crates, and a TypeScript UI with
Monaco. These notes hold what earlier sessions learned. Read them before you change code.

## Working rules of the owner

- Answer the owner in Traditional Chinese (繁體中文).
- Give no time estimates.
- After UI work, send screenshots of the result.
- Write commit messages, comments, KDoc-like doc comments and reports in ASD-STE100 Simplified
  Technical English: short sentences (25 words at most), active voice, one topic per sentence.
  Rationale goes in the commit message, not in a code comment.
- End each commit message with the attribution lines that the harness gives.
- Do not create a pull request unless the owner asks.
- `README.md` is short and has no feature list. Describe a new feature in its commit message. Keep
  the sections of the README (Keyboard, Where Gittor keeps its data, Build, Develop, Test) true when
  a change touches them.

## Layout

| Path | What it holds |
| --- | --- |
| `crates/graph` | The commit graph: a port of IntelliJ `platform/vcs-log/graph` (Apache-2.0, see `NOTICE`). Golden tests in `tests/data`. |
| `crates/git` | All git work: `Repo`, read queries, write operations, in-memory rewrites, Undo steps, changelists, reviews, global ignore. |
| `crates/service` | The command layer: `dispatch.rs` (command names), `ops.rs` (`Op` enum, Undo plan, Local History snapshots), `queries.rs`, `session.rs` (open repositories, settings), `watch.rs`, `config.rs`. |
| `crates/devserver` | An HTTP server for the UI in a browser: `POST /api/<command>`. The e2e tests use it. |
| `crates/app` | The Tauri app. `tauri.conf.json` builds `../../ui/dist`. |
| `ui/src` | The UI, plain TypeScript without a framework. `h()` in `dom.ts` makes elements. |
| `ui/src/bindings` | Types made by ts-rs from Rust. Do not edit them by hand. |
| `ui/e2e` | Playwright scenarios, one file each, and `run-all.sh`. |
| `ui/test` | Unit tests with `node --test` (pure modules only). |
| `docs/design-spec.md` | The design spec. |

### Work in parallel without conflicts

- A new UI feature goes in its own `<feature>-flow.ts`. `main.ts` loads each `*-flow.ts` by itself.
- In a list that every feature changes (`dispatch.rs`, the `Op` enum, `api.ts`, `Settings`,
  `keyboard.ts`, `style.css`), add the new entry at its place in alphabetical order or near related
  entries, not at the end. Two branches that both add at the end always conflict.
- `npm test` runs each `ui/test/*.test.ts` file; a new test needs no entry.
- `ui/test/keymap-defaults.test.ts` fails when two actions have the same default key. The Submodules
  e2e scenario fails when a left tab label is cut.
- Generated files (`ui/src/bindings`, `Cargo.lock`, `ui/package-lock.json`): after a merge conflict,
  take either side, then make them again (`cargo test -q export_bindings`, `cargo update -w`,
  `npm install`). Do not merge them by hand.

### How a feature goes through the layers

1. Rust: a function on `Repo` in `crates/git` (a write returns `OpResult` with `undo` steps).
2. Service: a variant of `Op` in `crates/service/src/ops.rs` (writes), or a query in `queries.rs`
   or `session.rs` plus a line in `dispatch.rs` (reads).
3. Types: a Rust type with `#[derive(ts_rs::TS)] #[ts(export)]` goes to `ui/src/bindings`. The
   `Op` union of TypeScript is written by hand in `ui/src/api.ts`. Add the new variant there.
4. UI: a method in the `api` object of `api.ts`, then the flow module (`operations.ts`,
   `menus.ts`, `sync.ts`, ...). Run writes with `runOp(op, label)`: it shows the toast with Undo
   and loads the view again.

### Patterns to reuse

- In-memory rewrites (`crates/git/src/rewrite.rs`): `git merge-tree --write-tree` and
  `git commit-tree`, then `update-ref` or `reset --keep`. A conflict stops before any ref changes.
  `rewrite_files` builds a tree in a temporary index (`GIT_INDEX_FILE`).
- Undo (`crates/git/src/undo.rs`): `Reset`, `Checkout`, `CreateRef`, `DeleteRef`, `MoveRef`,
  `RenameBranch`, `StashStore`, `SetConfig`. Each step checks that nothing moved since.
- Files of the app in a git dir: always `app_dir(git_dir)`.
- Submodules: `Repo::submodules` reads all of them with three git commands (`.gitmodules`, the index,
  `git status --porcelain=v2`). The Submodules tab is `submodule-panel.ts` and `submodule-flow.ts`;
  `loadSubmodules` in `repo.ts` loads it with the local changes, and hides the tab when there are none.
- App windows: a tab that the user drags out of the tab bar moves to a new window at the place of the
  mouse (`dragTab` in `tab-drag.ts`; `openWindow` in `api.ts`: the Tauri command `open_window`, or
  `window.open` with `?solo=1` in a browser). `window-roots.ts` keeps the repositories of each window.
  A drag in the tab bar changes the order of the tabs. A solo window does not save `tabs` and
  `activeTab`, because all windows share one settings key. A repository shows in one window only: each
  window writes its tabs to `gittor.windows` every 3 s, and `openRepo` brings the other window to the
  front (`inOtherWindow`, the Tauri command `focus_window`) instead. An entry older than 10 s belongs
  to a closed window.
- Windows (Compare, History, Review, Show Repository): `windows.ts`. A window calls
  `registerWindow(close, kind, show)`, and listens with `onRepoChange`. `watch.ts` calls
  `notifyRepoChange("files" | "repo")`.
- Back and Forward: `nav.ts`. Call `visit({ key, label, open, window })` when a file shows.
- Settings: `ui/src/settings.ts` (web view storage) for UI options; `crates/service/src/config.rs`
  (`settings.json`) for what the backend needs before the window opens (git program, editor,
  Local History limits).
- Keys: actions in `ui/src/keyboard.ts`; the keymap page lists them by themselves.
- Icons: add the Lucide file name to the glob and to `NAMES` in `ui/src/icons.ts`.
- Trees of files: `buildTree`, `treeOrder`, `walkTree` in `file-tree.ts`.
  Unique short names of folders: `pathLabels` in `path-labels.ts`.
- The git program: an empty setting takes the first git that works (`choose_git_program`), so the
  macOS stub that waits for the Xcode license is skipped.

## Build and test

Build the UI first. `tauri::generate_context!()` needs `ui/dist`, else `cargo test` fails with
"frontendDist ... doesn't exist".

```sh
npm --prefix ui ci            # once
npm --prefix ui run build
cargo test -q                 # also writes ui/src/bindings again
cargo clippy -q --all-targets # 2 old warnings in tests/ops.rs and tests/remote.rs are known
cd ui && npx tsc --noEmit -p . && npm test
```

New Rust types for the UI: run `cargo test -q -p gittor-git --lib export_bindings` and
`cargo test -q -p gittor-service --lib export_bindings`, then commit `ui/src/bindings`.

### End-to-end tests

```sh
GITTOR_CONFIG_DIR=<scratch>/cfg target/debug/gittor-devserver ui/dist 5174 &
CHROMIUM=/opt/pw-browsers/chromium ui/e2e/run-all.sh <scratch>/e2e
```

- Rebuild the dev server (`cargo build -p gittor-devserver`) and the UI (`npm run build`) after a
  change, then start the server again. It serves `ui/dist` as it was at the start.
- Stop it with `pkill -x gittor-devserve` (the process name has 15 characters). Never use
  `pkill -f gittor-devserver`: the pattern matches your own shell, and the shell dies.
- One scenario: `ui/e2e/make-demo-repo.sh <dir>` and then `node ui/e2e/<name>.mjs <dir> <shots>`.
- `run-all.sh` finds each `ui/e2e/*.mjs` file: a new scenario needs no entry there. Do not put a
  helper `.mjs` file in `ui/e2e`. `<name>.prep.sh` prepares the repository of a scenario. The line
  `// e2e: large repository` marks a scenario for a large repository.
- A scenario cleans the extra folders that it makes. A folder that an earlier run left (for example
  `<dir>-wt`) makes a worktree test fail. Do not depend on the name of the folder: it is the name of
  the scenario in `run-all.sh`, and any name in a run by hand.
- Parallel runs: start a dev server on another port, and set `GITTOR_E2E_URL=http://127.0.0.1:<port>`
  and another work dir. `GITTOR_E2E_ONLY=<regex>` runs some scenarios only.
- The full run takes longer than the 10-minute limit of one command. Run it in the background.
- `global-ignore.mjs` starts its own server from `target/debug` of the repository.

### Lessons from failing tests

- A context menu ignores a click right after it opens. Wait 400 ms before the click on a menu item.
- Monaco shows spaces as NBSP. Match text with `\s`, or remove all white space first.
- A browser console error (for example an HTTP 400) fails a scenario. A query for a path that may
  not exist returns `null`, not an error.
- Do not give a class such as `dialog-input` to a control outside a dialog. A hidden copy matches
  the selectors of other scenarios.
- For 1.5 s after an operation of the app, the watcher ignores changes of refs. A test that commits
  in a terminal right after an app operation must wait 2 s.
- Playwright clicks only three mouse buttons. Send mouse buttons 3 and 4 with
  `window.dispatchEvent(new MouseEvent("mouseup", { button: 3 }))`.
- `Control+1` toggles the Branches tab. Click `.lp-tab:text-is('Branches')` instead.
- Several toasts can have an Undo button. Pick the toast by its text.
- `main` and `master` are protected by default. The demo repository has commits on origin/main, so
  a rewrite of them stops. Start rewrites above origin/main.
- The origin of the demo repository has `main` checked out. A push test sets
  `receive.denyCurrentBranch ignore` on it.
- Do not draw a whole bar or list again when nothing changed. A new element under the mouse loses
  the click (this broke the tabs scenario).
- `delete-merged` failed once in a full run and passed alone. It is a known flaky case.
- A mouse drag in WebKitGTK (the Linux app) selects text and starts a native drag; then the page gets
  no `mousemove`. Call `preventDefault()` on `mousedown` for a custom drag. Chromium does not show this
  problem, so test a drag in the real app too.
- The left tabs share about 280 px at the default width. A new tab needs a short label; measure the
  `scrollWidth` of each `.lp-tab` against its `clientWidth`.

## Environment of the cloud sessions

- The writable disk is a small per-session allowance (about 2 GB free), and `target/` grows to
  more than 10 GB. Reuse one `CARGO_TARGET_DIR`, and delete build products that you do not need.
- Chromium is at `/opt/pw-browsers/chromium`. Do not run `playwright install`.
- `huggingface.co` is not in the network allowlist.
- `git filter-repo` is not installed.
- The Tauri app builds after `apt-get install libwebkit2gtk-4.1-dev libayatana-appindicator3-dev
  librsvg2-dev`. To run it, install `xvfb xdotool imagemagick`, start `Xvfb :99`, and run
  `DISPLAY=:99 target/debug/gittor <repo>`. Click with `xdotool mousemove X Y click 1` and take a
  screenshot with `import -window root shot.png`. Xvfb has no window manager: all windows open at
  0,0. `xwininfo -root -tree` lists them.

## Open points

- The mouse buttons Back and Forward are not tested in the macOS app (WKWebView).
- There is no CI yet. A workflow must build `ui/dist` before `cargo test`.
- `README.md` still says that an app from Finder uses `/usr/bin/git`; the app now chooses a git that
  works.
- The owner postponed: patches (create and apply) and automatic updates.
