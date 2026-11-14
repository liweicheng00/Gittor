# Gittor

Gittor is a light desktop git client. It draws the commit graph with the rules of IntelliJ, has the
IntelliJ workflow for changelists, local history and conflicts, and runs without a JVM: a Rust
backend that calls the git CLI, and a TypeScript front end in a Tauri 2 window.

**Download for macOS** (Apple Silicon and Intel): <https://liweicheng00.github.io/Gittor/>

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
| `Ctrl/Cmd+1` … `Ctrl/Cmd+4`, `Ctrl/Cmd+6` | Branches, Changes, Stash, Reviews and Files tabs |
| `Ctrl/Cmd+5` | The submodules in the Changes tab |
| `Ctrl/Cmd+K`, `Ctrl/Cmd+Enter` | Commit (from the tab, from the message field) |
| `Ctrl/Cmd+Alt+K` | Commit and push |
| `Ctrl/Cmd+Shift+K` | Push |
| `Ctrl/Cmd+B` | New branch (from the current branch, or another one) |
| `Ctrl/Cmd+T` | Update |
| `Ctrl/Cmd+R`, `F5` | Refresh |
| `Ctrl/Cmd+F` | Filter the log |
| `Ctrl/Cmd+E`, `Shift+F4` | Open the repository in the editor of Settings › Editor, with the selected file or the file of the diff (the IDE button) |
| `Alt+F12` | Open a terminal in the folder of the repository (Settings › Terminal sets the app) |
| `Ctrl/Cmd+Z` | Undo the last operation (outside a text field) |
| `Ctrl/Cmd+C` | Copy the hash |
| `Ctrl/Cmd+M` | Recent commit messages (in the message field) |
| `F7`, `Shift+F7` | Next and previous change |
| `Alt+Down`, `Alt+Up` | Next and previous file |
| `Ctrl/Cmd+PageDown`, `Ctrl/Cmd+PageUp` | Next and previous tab |
| `Alt+1` … `Alt+9` | Project tab 1 to 8, and the last project tab |
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

### macOS: two kinds of build

`scripts/build-dmg.sh` makes the app and a `.dmg`. The commit decides the kind of build:

| | Test build | Release build |
|---|---|---|
| When | not at a release tag, or with changes | at a release tag `vX.Y.Z`, without changes |
| App | **Gittor Dev** (`dev.gittor.app.dev`, icon with "DEV") | **Gittor** (`dev.gittor.app`) |
| Version | `0.2.2-dev.5+a1b2c3d4`: 5 commits after 0.2.1, at commit `a1b2c3d4`; `.dirty` for changes | `0.2.1` |
| Settings | the folder `gittor-dev`; the first start copies the settings of Gittor | the folder `gittor` |
| Updates | none | only with `--updater` (the release workflow) |

The two apps can be on one Mac and run at the same time. Settings › General shows the version, and
"Test build" for a test build.

Options of `build-dmg.sh`:

| Option | What it does |
|---|---|
| `--unsigned` | No Apple signature. The app opens only on the Mac that built it. |
| `--universal` | One app for Apple silicon and Intel Macs. The build takes about two times longer. |
| `--updater` | A release with updates. The release workflow uses it. A test version stops it. |

The app is in `target/release/bundle/macos/`, and the `.dmg` in `target/release/bundle/dmg/`. With
`--universal`, they are in `target/universal-apple-darwin/release/bundle/`.

#### Test build

```sh
git pull
scripts/build-dmg.sh --unsigned      # for this Mac
```

Drag "Gittor Dev" from the `.dmg` to Applications. The release Gittor stays.

#### Release build

Usually GitHub makes it (see Release below). A local release build without updates:

```sh
git checkout v0.2.1                  # a release tag, without changes
scripts/build-dmg.sh
```

#### Signature

A build for other Macs needs a Developer ID Application certificate in the keychain and these
variables. Tauri signs and notarizes the app; the script then signs, notarizes and checks the `.dmg`.
Without them, use `--unsigned`.

```sh
export APPLE_SIGNING_IDENTITY="Developer ID Application: Your Name (TEAMID)"  # security find-identity -v -p codesigning
export APPLE_ID="you@example.com"
export APPLE_PASSWORD="…"   # an app-specific password
export APPLE_TEAM_ID="TEAMID"
scripts/build-dmg.sh --universal
```

An app that starts from Finder does not get the `PATH` of your shell. It takes the first git that
works, for example Homebrew git or the git of the Command Line Tools. Settings › Git can set another one.

### Release

```sh
git pull                    # on main, without changes
node scripts/version.mjs next          # the next version, for example 0.2.1
$EDITOR docs/releases/v0.2.1.md        # the release notes
scripts/release.sh          # the next patch version: 0.2.0 -> 0.2.1
scripts/release.sh minor    # 0.2.1 -> 0.3.0; also "major", or a version such as 1.0.0
```

The script finds the next version, sets it in all files, commits, tags it (for example `v0.2.1`) and
pushes. It stops when the release notes are missing or break a rule; `scripts/release-notes.mjs`
gives the format and the rules, and `.claude/skills/release/SKILL.md` tells how to write them. The
release page and the update notification show the notes, not the commit messages.
A version that has no release yet (now 0.1.0) is released as it is. The tag starts the
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

#### Protection of the releases

The app installs only an update that has a valid signature of the updater key, and only a newer
version. A changed file on GitHub cannot pass. The risk is the workflow that has the keys. These
parts of the repository protect it:

- Each action of the workflows is pinned to the commit of a release. Dependabot proposes new commits.
- The release workflow uses no cache. npm and cargo use the lock files only (`npm ci`, `--locked`).
- The Security workflow checks the npm packages and the crates for known vulnerabilities, and scans the
  code with CodeQL. It runs at each release tag and once a week.
- The release has a provenance record from GitHub. Check a file with
  `gh attestation verify <file> --repo liweicheng00/Gittor`.

Set these in the settings of the repository too:

1. Settings › Environments: make an environment `release` with you as the required reviewer, and
   move the secrets of the table above into it. Then each release waits for your approval before the
   workflow gets the keys.
2. Settings › Rules › Rulesets: only you can make tags `v*`.
3. Settings › General › Releases: turn on immutable releases.
4. Use two-factor authentication on the GitHub account, and keep the updater key also offline.

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
