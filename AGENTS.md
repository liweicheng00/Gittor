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
- Changelists (`crates/git/src/changelist.rs`): ".ignore" (`IGNORE_ID`) and "Changes" (`DEFAULT_ID`) are
  always the first two and cannot be removed or renamed. Every new change goes to "Changes"; there is
  no active changelist. The UI never checks a file in ".ignore", so no commit takes it.
- Submodules: `Repo::submodules` reads all of them with three git commands (`.gitmodules`, the index,
  `git status --porcelain=v2`). The Submodules section is `submodule-panel.ts` and `submodule-flow.ts`.
  It is under the commit message of the Changes tab (`shell.ts` puts it there); `Mod+5` opens it.
  `loadSubmodules` in `repo.ts` loads it with the local changes. It hides when there are none.
- App windows: a tab that the user drags out of the tab bar moves to a new window at the place of the
  mouse (`dragTab` in `tab-drag.ts`; `openWindow` in `api.ts`: the Tauri command `open_window`, or
  `window.open` with `?solo=1` in a browser). `window-roots.ts` keeps the repositories of each window.
  A drag in the tab bar changes the order of the tabs. A solo window does not save `tabs` and
  `activeTab`, because all windows share one settings key. A repository shows in one window only: each
  window writes its tabs to `gittor.windows` every 3 s, and `openRepo` brings the other window to the
  front (`inOtherWindow`, the Tauri command `focus_window`) instead. An entry older than 10 s belongs
  to a closed window.
- Review notes in a diff: `note-layer.ts` (cards at the right of their lines in an overlay widget, the
  note icon in the gutter, a double click adds a note). `DiffView.setNotes(notes, handlers)` turns it
  on; without handlers it is off, so the History window does not get it. Line 0 is a note on the whole
  file; its field is under the list of notes. `note-format.ts` makes the text for the clipboard.
  A resolved note (`resolved`) shows as an icon only (`.note-chip`); a click opens it. Copy All skips it.
- Markdown preview in `DiffView` (`renderPreview`, the toggle `.diff-preview-toggle`, the setting
  `markdownPreview`, on by default). `markdown-preview.ts` renders with markdown-it and DOMPurify: no
  styles, forms, frames or media, and no network images (the CSP allows only `'self'` and `data:`). An
  image of the repository loads with `api.imageData` (a `data:` URL; the backend refuses `..` and
  absolute paths). Each top-level block has `data-src="start-end"`; `markdown-model.ts` (unit tests)
  marks the blocks that Monaco's line changes touch, and places removed blocks in one column. Code
  blocks get the colors of `monaco.editor.colorize`. The note layer and Annotate need the source.
  A ```` ```mermaid ```` block becomes an `<img>` of the SVG that `crates/service/src/mermaid.rs` makes
  with mmdflux (flowchart, class, sequence, state; others keep their code with a note). The theme
  colors come from the app; `setMonacoTheme` draws open previews again.
- Notes on local changes: `crates/git/src/local_notes.rs` (`gittor/local-notes.json` of the worktree).
  The notes of a file keep the git hash of its content; when the file changes, they go away.
  `showLocalDiff` in `commit-flow.ts` gives them to the same note layer.
- Updates of the app: `update-flow.ts` (checks 10 s after the start and every 6 h, only in the main
  window). Only a build with the public key checks: `scripts/build-dmg.sh --updater` merges
  `target/tauri.build.conf.json`, and `main.rs` registers the updater plugin only then. A local
  build stays as before. In a browser, `window.__GITTOR_FAKE_UPDATE__` gives a fake update to the
  `updates` scenario. Releases: `scripts/release.sh [patch|minor|major|<version>]` and
  `.github/workflows/release.yml`. The owner checked on a Mac that 0.1.0 updated itself to 0.1.1
  and started again. The release notes are `docs/releases/v<version>.md`, for the users, not the
  commit messages: follow the `release` skill (`.claude/skills/release/SKILL.md`).
  `scripts/release-notes.mjs` checks them; `release.sh` and the workflow stop without them.
- Versions: `scripts/version.mjs` (tested in `ui/test/version.test.ts`). A build at a release tag
  without changes has the release version. Any other build is a test build, for example
  `0.2.1-dev.5+a1b2c3d4`; Settings › General marks it "Test build". `build-dmg.sh` writes the version
  and the build number (`CFBundleVersion`, the number of commits) into `target/tauri.build.conf.json`.
  A test build is the app "Gittor Dev": identifier `dev.gittor.app.dev`, the icons of
  `crates/app/icons-dev` (`source-1024.png` is the source for `tauri icon`). `main.rs` sees the
  identifier and calls `config::use_dev_dir`: the settings folder `gittor-dev`, a copy of `gittor` at
  the first start. The UI keeps a copy of its settings in `ui-settings.json` (`startSettingsCopy` in
  `main.ts`, only in the app); a first start with empty storage takes them from there and loads again.
- Videos: `scripts/video`. `stage.mjs` has the overlay (cursor, click rings, a fake window, a fake
  terminal), the `Director` and the loop that records a scene with Playwright. `run.sh` makes the intro
  video (`record.mjs`, `build.mjs`). `shorts.sh` makes the short videos for social posts
  (`shorts-record.mjs`, `shorts-build.mjs`): 1080x1920 for a phone, with the caption above the app.
  The page is 1000x1250 (4:5). A scene calls `d.cam(target, { zoom, align })` to point the camera at
  some elements, and `d.mark(name)` for a caption; the build moves the camera with `zoompan` and puts
  the captions and soft notes of the music on the marks. `music.py` computes the music with numpy
  (styles `pulse`, `lofi`, `drive`), with no samples and no service. An agent cannot hear it: check the
  loudness with the `ebur128` filter of ffmpeg, and let the owner listen. The owner wants slow, low
  music, and no effect sound at the end. Each short is a tour of one topic in four to six fast steps
  (`tour`, `agent`, `review`, `history`, `changes`, `worktrees`, `inspect`): the owner likes this
  rhythm. Give `shorts.sh` a work dir with a short path (`SHORTS_WORK`), because the worktree dialog
  shows it. Do not use a symbolic link: the tab then shows `work/rustcalc`, not `rustcalc`.
- CI: `.github/workflows/ci.yml` runs the tests, clippy, the types, the unit tests and all UI
  scenarios on each push to main, the scenarios in 4 parts on 4 machines. Failed scenarios run once
  more alone.
- Security checks: `.github/workflows/security.yml`, not CI. A tag `v<version>` and a weekly run start
  them; `workflow_dispatch` runs them by hand before `scripts/release.sh`. The `codeql` job scans
  `actions`, `javascript-typescript` and `rust` with no build (`build-mode: none`), and writes to the
  Security tab; it does not fail. The `deps` job runs `npm audit`, `cargo audit --deny warnings`
  (ignored advisories with their reasons in `.cargo/audit.toml`) and `cargo machete` (crates that no
  code uses), and it does fail. Remove a dependency when its last use goes.
  The workflow replaced the default setup of code scanning. GitHub turned the default setup off by
  itself, because the repository now holds a CodeQL workflow; no command was needed. Both setups find
  the same rules: 26 for rust, 87 for javascript-typescript, 17 for actions.
  A cache for the browser of Playwright is not worth it: `playwright install --with-deps` needs 19 s,
  of which the download is 5 s and `apt` is 13 s, which a cache cannot hold.
- Recent repositories: `settings.recent` and `settings.recentProjects` (the main repository of each path).
  `recent-groups.ts` puts them in groups by project and keeps 12 projects with 8 worktrees each, so many
  worktrees do not push other projects out. `recent.ts` gives the rows of the Open menu and the welcome
  screen, and reads the projects of old entries with `api.repoInfo`.
- Conflicts: `conflicts.ts` (`resolveConflicts`: the Conflicts dialog, then the next file in the merge
  window; `offerContinue` after the last file) and `merge-view.ts` (the merge window). `runOp` opens the
  dialog when an operation stops with conflicts. A bar of actions in a Monaco view zone gets the mouse
  only with `.view-zones { z-index: 1 }`, and it acts on `mousedown`: Monaco takes the mouse after a press.
  Each side of a change needs a decision: taken (`applied`) or not taken (`rejected`, the ✕ buttons). A
  change is resolved when each side has one; then the bar `.merge-done` shows.
- Windows (Compare, History, Review, Show Repository): `windows.ts`. A window calls
  `registerWindow(close, kind, show)`, and listens with `onRepoChange`. `watch.ts` calls
  `notifyRepoChange("files" | "repo")`.
- The first selection: `loadRepo` in `repo.ts` selects the head commit when the repository has loaded
  (`jumpToOid(target, true, true)`). The user can choose a commit or open a local change while it loads.
  The log marks that selection as `auto`, and `showSelection` drops it when the diff shows a local change
  (`app.diffSource === "local"`), so the choice of the user stays.
- Back and Forward: `nav.ts`. Call `visit({ key, label, open, window })` when a file shows.
- Settings: `ui/src/settings.ts` (web view storage) for UI options; `crates/service/src/config.rs`
  (`settings.json`) for what the backend needs before the window opens (git program, editor,
  Local History limits).
- Keys: actions in `ui/src/keyboard.ts`; the keymap page lists them by themselves. A button that
  does the same as a keymap action gets `data-key-action="<id>"`: a mouse click on it then shows the
  keys next to the mouse (`key-hint-flow.ts`, the setting `keyHints`). `keyWorksAt` applies the rules
  of the key handler, so no hint names a key that does nothing there.
- External apps: Open in Editor (`crates/service/src/editor.rs`, `editor-flow.ts`) and Open in Terminal
  (`terminal.rs`, `terminal-flow.ts`). Each runs a command of `settings.json` without a shell. The e2e
  scenarios use a small script in place of the app, and set the command back to empty at the end.
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
  and another work dir. `GITTOR_E2E_ONLY=<regex>` runs some scenarios only. `GITTOR_E2E_SHARD=k/n`
  runs part k of n: for example two dev servers (5174, 5180) with the parts 1/2 and 2/2. More parts
  on one machine make the known flaky cases fail more often.
- `ui/e2e/durations.txt` has the seconds of each scenario, for the parts. Each run writes
  `<work-dir>/durations.txt`; copy the file of a full run over it when the times change much. A
  scenario that it does not list counts 8 s.
- Do not wait for a fixed time when a condition can show the end of a step: use a `within(...)`
  check. Fixed waits are about 40% of the run time of the scenarios.
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
- Never call `monaco.editor.colorizeElement`: it sets the theme of all Monaco editors (to the light
  "vs" without a theme). Use `monaco.editor.colorize`, which only returns HTML.
- A Monaco menu item with a condition shows only after the diff loaded. A menu that opened before
  has no item: open it again (`clickMenuItem` in `compare-revert.mjs`).
- The Settings dialog closes before the backend saves `settings.json`. Wait for the saved value
  (`savedSetting` in `open-in-editor.mjs`) before a step that uses it.
- `delete-merged`, `remotes` (a click timeout) and `tabs` (the filter of the first tab) failed once
  in a full run and passed alone. They are known flaky cases. Run them again alone before you look
  for a bug.
- A mouse drag in WebKitGTK (the Linux app) selects text and starts a native drag; then the page gets
  no `mousemove`. Call `preventDefault()` on `mousedown` for a custom drag. Chromium does not show this
  problem, so test a drag in the real app too.
- The scenarios that measure text expect Inter for `system-ui`. This machine maps it in
  `/etc/fonts/conf.d/56-prefer-inter.conf`; the CI workflow writes the same file. With the wider
  default font of Ubuntu, all left tab labels are cut.
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

- The mouse buttons Back and Forward are not tested in the macOS app (WKWebView). The owner leaves this
  until a user reports a problem. Then the fix can catch the buttons in `main.rs` with a native event monitor.
- The owner does not want patches (create and apply). Do not propose them.
