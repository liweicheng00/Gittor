# Gittor

Gittor is a light desktop git client. It draws the commit graph with the rules of IntelliJ, has the
IntelliJ workflow for changelists, local history and conflicts, and runs without a JVM: a Rust
backend that calls the git CLI, and a TypeScript front end in a Tauri 2 window.

- **The IntelliJ log**: the same graph layout, IntelliSort, branch colors, long-edge arrows and
  collapsible linear branches. Large repositories scroll without a commit limit.
- **Safe history edits**: squash, drop, reword, reorder and fixups run in memory. A conflict stops
  them before a file or a ref changes, and almost every operation has Undo.
- **Changelists and partial commits**: group local changes, move single hunks between changelists,
  and commit only the checked changes.
- **Local pull requests**: review a branch against its base, mark files as viewed, add notes, and
  merge it, all without a remote.

The design notes (in Chinese) are in [`docs/design-spec.md`](docs/design-spec.md).

## Features

### Repositories

- Open from a welcome screen, a folder dialog, the recent list, or `gittor <path>`. Several
  repositories open in tabs, and the tabs come back at the next start.
- Clone a URL into a folder (Open › Clone Repository…).
- Worktrees: list, add, open, remove and prune. Submodules: state, update, and open as a repository.
- Auto refresh: changes from an editor or a terminal show within about a second. Ignored files do not
  cause a refresh.

### Log and branches

- Commit graph of all branches, remotes and tags, with a hash, message, user, path, date and branch
  filter (regex and match case). A filtered graph joins the visible commits with dashed edges.
- Branches panel: recent branches, local branches with ahead and behind counts, remotes, tags
  (sorted by version), worktrees and submodules. Favorites (☆) come first; main and master are
  favorites at first.
- Branch switcher in the toolbar, group branches by prefix, and highlight of your commits, merge
  commits and the current branch.
- Open a branch, a commit or a remote on GitHub, GitLab, Bitbucket, Azure DevOps or Gitea.

### Compare and diff

- Compare a commit with its parent, two commits (Ctrl/Cmd click), a commit with the working tree, or
  two branches (the commits of each side and the changed files, tip to tip or from the merge base).
- Monaco diff: side by side or unified, next and previous change or file, ignore whitespace, and
  collapse unchanged regions. Material Icon Theme icons in the file lists.
- File history across renames, annotate (blame) with an age color, and Show Repository at Revision.
- Back and Forward through the files you looked at, also across windows.

### Local changes and commits

- Changelists, as in IntelliJ: named groups with their own draft message, drag and drop, and hunks of
  one file in different changelists.
- Partial commit with a check box for each change; Gittor builds the commit in a temporary index.
- Amend, Rollback, Add to Git, delete of unversioned files, sign-off, the last 30 messages, and
  `commit.template`. Message checks warn about a long subject, a missing blank line and long lines.
- Commits that Gittor writes itself are signed when `commit.gpgsign` is on, and partial commits run
  the pre-commit, commit-msg and post-commit hooks. Git LFS files diff with their real content.

### Branch and history operations

- Checkout, new branch or tag, rename, delete, merge, rebase, cherry-pick, revert, reset (soft,
  mixed, keep, hard), and Update (Fast-Forward) of a branch that is not checked out.
- Edit a message or an author, squash, drop, fixup and squash-into, interactive rebase with
  autosquash, drop or extract the changes of some files of a commit. An Edit step runs
  `git rebase -i` and stops at the commit.
- Rebase options (`--onto`, `--update-refs`, `--rebase-merges`, …) and merge options (`--no-ff`,
  `--ff-only`, `--squash`, …).
- Delete Merged Branches, as `git branch --merged` or `git branch --delete-merged` (with the same
  rules on a git older than 2.56), with a preview.
- Protected branches (default `main master`): no force push to them, and no rewrite of their commits.

### Undo and Local History

- Undo (the notification button or `Ctrl/Cmd+Z`) for checkout, branch and tag changes, merge,
  rebase, cherry-pick, revert, update, reset, rewrites, commit and stash drop. Undo stops when HEAD
  moved after the operation.
- Local History keeps versions of changed files, and the content before Rollback, Get from
  Revision, a hard reset, a stash or a resolve. It keeps 5 days and at most 200 MB.

### Conflicts, stash and review

- A conflict opens the Conflicts dialog (Accept Yours, Accept Theirs, Merge…). The merge window
  shows yours, the result and theirs side by side, and the result stays editable. A banner shows a
  merge, rebase, cherry-pick or revert in progress with Abort and Continue.
- Stash all changes, some files or a changelist; apply, pop, branch from and drop a stash.
- Review Branch: the changes from the merge base and each commit, viewed marks, notes that show as
  outdated when the file changes, conflicts before the merge, and Merge (merge commit, squash, or
  rebase and fast-forward).

### Remotes

- Fetch (all or one remote, or every N minutes), push with a list of outgoing commits, force with
  lease and tags, and Update with merge or rebase. A rejected push offers Update.
- Manage remotes and tracked branches, delete remote branches, and push or delete tags on a remote.
- When git or ssh needs a password, a passphrase or a host key confirmation, Gittor asks in a dialog
  (it is the `GIT_ASKPASS` and `SSH_ASKPASS` program). The SSH prompt needs OpenSSH 8.4 or newer.

### Settings

Theme, Update mode, auto refresh and auto fetch, the git program (with a Test button; an empty field
takes the first git that works), diff font and options, commit message limits, protected branches,
Local History limits, and the keymap (⚙, `Ctrl+Alt+S`, or `Cmd+,` on macOS).

## Keyboard

The defaults; change them in Settings › Keymap.

| Keys | Action |
|---|---|
| `Ctrl/Cmd+O` | Open a repository |
| `Ctrl/Cmd+1` … `Ctrl/Cmd+4` | Branches, Changes, Stash and Reviews tabs |
| `Ctrl/Cmd+K`, `Ctrl/Cmd+Enter` | Commit (from the tab, from the message field) |
| `Ctrl/Cmd+Alt+K` | Commit and push |
| `Ctrl/Cmd+Shift+K` | Push |
| `Ctrl/Cmd+T` | Update |
| `Ctrl/Cmd+R`, `F5` | Refresh |
| `Ctrl/Cmd+F` | Filter the log |
| `Ctrl/Cmd+Z` | Undo the last operation (outside a text field) |
| `Ctrl/Cmd+C` | Copy the hash |
| `Ctrl/Cmd+M` | Recent commit messages (in the message field) |
| `F7`, `Shift+F7` | Next and previous change |
| `Alt+Down`, `Alt+Up` | Next and previous file |
| `Ctrl/Cmd+PageDown`, `Ctrl/Cmd+PageUp` | Next and previous tab |
| `Ctrl/Cmd+Alt+Left`, `Ctrl/Cmd+Alt+Right` | Back and Forward (also `Cmd+[` and `Cmd+]` on macOS) |
| `Esc` | Hide the diff panel |

## Where Gittor keeps its data

| Data | Place |
|---|---|
| Changelists, Local History, temporary files | `<git dir>/gittor/` of each worktree |
| Reviews and favorite branches | `<common git dir>/gittor/`, shared by all worktrees |
| Git program, Local History limits, editor | `settings.json` in `~/.config/gittor` (Linux), `~/Library/Application Support/gittor` (macOS) or `%APPDATA%\gittor` (Windows) |
| Other settings and recent repositories | The storage of the window |

Nothing goes to a remote. Gittor was named Rebased Lite before; folders named `rebased-lite` move to
`gittor` the first time Gittor needs them.

## Build

You need Rust, Node.js 20 or later, and git. On Linux, Tauri also needs WebKitGTK
(`libwebkit2gtk-4.1-dev`).

```sh
npm --prefix ui install
npm --prefix ui run build
cargo build --release -p gittor
./target/release/gittor /path/to/repo
```

### macOS app and disk image

`scripts/build-dmg.sh` builds `Gittor.app` and a `.dmg` in `target/release/bundle/`. Add
`--universal` for one app for Apple silicon and Intel, or `--unsigned` for a test build that opens
only on the Mac that built it.

A build for other Macs needs a Developer ID Application certificate in the keychain and these
variables. Tauri signs and notarizes the app; the script then signs, notarizes and checks the `.dmg`.

```sh
export APPLE_SIGNING_IDENTITY="Developer ID Application: Your Name (TEAMID)"  # security find-identity -v -p codesigning
export APPLE_ID="you@example.com"
export APPLE_PASSWORD="…"   # an app-specific password
export APPLE_TEAM_ID="TEAMID"
scripts/build-dmg.sh --universal
```

An app that starts from Finder does not get the `PATH` of your shell and uses `/usr/bin/git`. Set
another git, for example Homebrew git, in Settings.

## Develop

| Path | Contents |
|---|---|
| `crates/graph` | Graph layout and sort, ported from IntelliJ, with its golden test data |
| `crates/git` | Repository access through the git CLI |
| `crates/service` | App state and commands, shared by the app and the dev server |
| `crates/app` | The Tauri 2 desktop app |
| `crates/devserver` | An HTTP server for the UI in a browser, for development and UI tests |
| `ui` | The front end (TypeScript, Vite, Monaco) |

In `ui/src`, `main.ts` loads the modules, `state.ts` holds the shared state, and `shell.ts` builds
the layout. Each feature module (`repo`, `watch`, `operations`, `commit-flow`, `sync`, …) registers
its handlers when it loads and connects the components to `api.ts`. `bindings/` has the types of
the command results, generated from the Rust types.

Run the UI in a browser against the dev server:

```sh
cargo run -p gittor-devserver -- ui/dist 5174   # commands on 127.0.0.1:5174
npm --prefix ui run dev                          # UI on http://localhost:5173/?repo=/path/to/repo
```

Set `GITTOR_CONFIG_DIR` to a scratch directory so the dev server does not change your own
`settings.json`.

## Test

```sh
cargo test                       # also writes ui/src/bindings again
npm --prefix ui run typecheck
npm --prefix ui test
ui/e2e/run-all.sh /tmp/e2e       # UI scenarios in Chromium on fresh demo repositories
```

- Commit changed files in `ui/src/bindings/` with the Rust change. Check them with
  `cargo test -q export_bindings && git diff --exit-code ui/src/bindings`.
- `cargo test -p gittor-graph` compares the graph with the IntelliJ golden files.
- Set `REBASED_NEW_GIT` to a git 2.56 or later to also test against `git branch --delete-merged`.
- `ui/e2e/run-all.sh /tmp/e2e /path/to/git.git` also runs the large-repository scenarios. Each
  scenario takes screenshots and fails when the page logs an error; each file says how to run it
  alone.

## License

Apache-2.0, see [`LICENSE`](LICENSE). Gittor ports code from IntelliJ Community and uses icons of
Material Icon Theme and Lucide; see [`NOTICE`](NOTICE).
