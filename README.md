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

## Keyboard

The defaults; change them in Settings › Keymap.

| Keys | Action |
|---|---|
| `Ctrl/Cmd+O` | Open a repository |
| `Ctrl/Cmd+1` … `Ctrl/Cmd+5` | Branches, Changes, Stash, Reviews and Submodules tabs |
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

Nothing goes to a remote.

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
- Set `GITTOR_NEW_GIT` to a git 2.56 or later to also test against `git branch --delete-merged`.
- `ui/e2e/run-all.sh` runs each `ui/e2e/*.mjs` file. `ui/e2e/run-all.sh /tmp/e2e /path/to/git.git`
  also runs the large-repository scenarios. Each scenario takes screenshots and fails when the page
  logs an error; each file says how to run it alone.
- `GITTOR_E2E_ONLY=<regex>` runs only the matching scenarios. `GITTOR_E2E_URL` names another dev
  server, for example `http://127.0.0.1:5180`, so that several runs can share one machine.

## License

Apache-2.0, see [`LICENSE`](LICENSE). Gittor ports code from IntelliJ Community and uses icons of
Material Icon Theme and Lucide; see [`NOTICE`](NOTICE).
