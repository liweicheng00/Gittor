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

The defaults; change them in Settings › Keymap. A mouse click on a button that has a shortcut shows
the shortcut next to the mouse; Settings › General › Shortcut hints turns this off.

| Keys | Action |
|---|---|
| `Ctrl/Cmd+O` | Open a repository |
| `Ctrl/Cmd+Shift+A` | Agent mode: turn the window around (an experiment) |
| `Ctrl/Cmd+1` … `Ctrl/Cmd+5` | Branches, Changes, Stash and Reviews tabs; the submodules in the Changes tab |
| `Ctrl/Cmd+K`, `Ctrl/Cmd+Enter` | Commit (from the tab, from the message field) |
| `Ctrl/Cmd+Alt+K` | Commit and push |
| `Ctrl/Cmd+Shift+K` | Push |
| `Ctrl/Cmd+T` | Update |
| `Ctrl/Cmd+R`, `F5` | Refresh |
| `Ctrl/Cmd+F` | Filter the log |
| `Shift+F4` | Open the repository in the editor of Settings › Editor (the IDE button) |
| `Alt+F12` | Open a terminal in the folder of the repository (Settings › Terminal sets the app) |
| `Ctrl/Cmd+Z` | Undo the last operation (outside a text field) |
| `Ctrl/Cmd+C` | Copy the hash |
| `Ctrl/Cmd+M` | Recent commit messages (in the message field) |
| `F7`, `Shift+F7` | Next and previous change |
| `Alt+Down`, `Alt+Up` | Next and previous file |
| `Ctrl/Cmd+PageDown`, `Ctrl/Cmd+PageUp` | Next and previous tab |
| `Ctrl/Cmd+W` | Close the project tab (`Cmd+Shift+W` closes the window on macOS) |
| `Ctrl/Cmd+Alt+Left`, `Ctrl/Cmd+Alt+Right` | Back and Forward (also `Cmd+[` and `Cmd+]` on macOS) |
| `Esc` | Hide the diff panel |
| `Alt+Left`, `Alt+Right`, `Alt+Down` | In the merge window: take yours, theirs, or both for the current conflict |

## Where Gittor keeps its data

| Data | Place |
|---|---|
| Changelists, Local History, temporary files | `<git dir>/gittor/` of each worktree |
| Reviews and favorite branches | `<common git dir>/gittor/`, shared by all worktrees |
| Git program, Local History limits, editor, terminal | `settings.json` in `~/.config/gittor` (Linux), `~/Library/Application Support/gittor` (macOS) or `%APPDATA%\gittor` (Windows) |
| A copy of the UI settings, for Gittor Dev | `ui-settings.json` in the same folder |
| The settings of Gittor Dev (a test build) | the folder `gittor-dev` next to it; the first start copies the folder `gittor` |
| Agent mode: the workflows (one folder each) and `agents.json` | `workflows/` in the same folder as `settings.json`, or `workflowsDir` of `settings.json` |
| Other settings and recent repositories | The storage of the window |

Gittor sends nothing to a remote. An agent that you start in Agent mode talks to its own provider.

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

An app that starts from Finder does not get the `PATH` of your shell. It takes the first git that
works, for example Homebrew git or the git of the Command Line Tools. Settings › Git can set another one.

A local build does not check for updates. Only a release build does.

### Release

```sh
scripts/release.sh          # the next patch version: 0.2.0 -> 0.2.1
scripts/release.sh minor    # 0.2.1 -> 0.3.0; also "major", or a version such as 1.0.0
```

The script finds the next version, sets it in all files, commits, tags it (for example `v0.2.1`) and
pushes. A build that is not at a release tag, or that has changes, is a test build: its version has a
label, for example `0.2.2-dev.5+a1b2c3d4` (5 commits after 0.2.1, at commit `a1b2c3d4`). The name of
the `.dmg` and Settings › General show it. A test build is the app "Gittor Dev", with its own
identifier, icon and settings, so it runs next to the release Gittor. The tag starts the
`Release` workflow on GitHub (`.github/workflows/release.yml`). It builds the universal app with
`scripts/build-dmg.sh --universal --updater`, signs and notarizes it, and publishes a release with the
`.dmg`, `Gittor.app.tar.gz`, its `.sig` and `latest.json`. The apps that run find the update at their
next check: a few seconds after the start, then every 6 hours, or with Settings › General › Check Now.

The workflow needs these repository settings (Settings › Secrets and variables › Actions):

| Name | Kind | Value |
|---|---|---|
| `TAURI_UPDATER_PUBKEY` | variable | the public key from `tauri signer generate` |
| `TAURI_SIGNING_PRIVATE_KEY` | secret | the private key |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | secret | its password |
| `APPLE_CERTIFICATE` | secret | the Developer ID Application certificate as a `.p12`, in base64 |
| `APPLE_CERTIFICATE_PASSWORD` | secret | the password of the `.p12` |
| `APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID` | secrets | as for a signed build above |

Keep a copy of the private key. Without it, no update can reach the apps that users have now.

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
- `GITTOR_E2E_SHARD=k/n` runs part k of n parts of about the same time (from
  `ui/e2e/durations.txt`). CI runs the scenarios in 4 parts on 4 machines.

## License

Apache-2.0, see [`LICENSE`](LICENSE). Gittor ports code from IntelliJ Community and uses icons of
Material Icon Theme and Lucide; see [`NOTICE`](NOTICE).
