# Builds and releases of Gittor

Notes for the maintainer: the kinds of macOS build, the Apple signature, the release, and the settings
that protect the releases. The release skill (`SKILL.md` in this folder) tells an agent how to make a
release.

## macOS: two kinds of build

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

### Test build

```sh
git pull
scripts/build-dmg.sh --unsigned      # for this Mac
```

Drag "Gittor Dev" from the `.dmg` to Applications. The release Gittor stays.

### Release build

Usually GitHub makes it (see Release below). A local release build without updates:

```sh
git checkout v0.2.1                  # a release tag, without changes
scripts/build-dmg.sh
```

### Signature

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


## Release

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

### Protection of the releases

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
