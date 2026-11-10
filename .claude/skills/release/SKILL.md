---
name: release
description: Make a release of Gittor. Write the release notes for the users in docs/releases/v<version>.md, check them, run scripts/release.sh, and tell the owner how to push the tag. Use it when the owner asks for a release ("壓 release", "發布 0.1.4", "release a new version").
---

# Make a release of Gittor

The release page and the update notification show the release notes, not the commit messages. The
notes are for the users of the app. Commit messages are for developers. Do not copy them.

## 1. Check the state

1. `git fetch origin --tags`, then `git checkout -B main origin/main`. The working tree must be clean.
2. Make sure that CI is green on the head of `main` (`mcp__github__actions_list`, workflow `CI`). When it
   is red or still runs, stop and tell the owner.
3. Find the version: `node scripts/version.mjs next [patch|minor|major]`. Use `patch` when the owner
   names no version. Use `minor` only when the owner asks for it.
4. Find the last release tag: `git describe --tags --abbrev=0`.

## 2. Collect the changes

1. `git log --no-merges --format='%h %s%n%b%n---' <last tag>..origin/main`.
2. When a subject is not clear, read the commit body and its diff (`git show --stat <sha>`).
3. Sort each commit into one of these groups:
   - **New**: a feature that the user did not have before.
   - **Improved**: a feature that the user had, and that now works better or looks better.
   - **Fixed**: a bug that the user could see.
   - **Leave out**: tests, CI, workflows, scripts, AGENTS.md, README, refactors, code style, the
     release commit, and updates of dependencies. Keep an update of a dependency only when it fixes a
     security problem that the user can have; put it in Fixed.
4. Put commits for one change into one item. Example: a feature, and a fix of that feature before the
   release, are one New item.

## 3. Write the notes

Write `docs/releases/v<version>.md` in English. The format:

```md
One summary line: the most important one or two changes.

## New
- Alt+1 to Alt+9 show the project tab at that place.

## Improved
- The update notification shows the progress of the download.

## Fixed
- The Markdown preview no longer changes the theme of the editors.
```

Rules (`node scripts/release-notes.mjs check <file>` checks the marked ones):

- (checked) A summary line first. Then the sections `## New`, `## Improved`, `## Fixed`, in this order.
  Leave out a section without items. At least one item.
- (checked) No commit hashes, no file names of the source code, no prefixes such as `feat:`.
- (checked) ASD-STE100: 25 words at most in a sentence.
- One item for each change. One or two sentences. Start with the thing that the user sees or does.
- Tell what the user can do now, not how the code does it. Bad: "toast() returns a handle".
  Good: "The update notification shows the progress of the download."
- Use the names of the user interface as the app shows them: "Settings › Keymap", "the Changes tab",
  "Update", "Compare". Give keys as the keymap writes them on Linux and Windows: `Ctrl+K`, `Alt+1`.
  On macOS, `Ctrl` of a default key is `⌘`; say so only when it is not clear.
- Use the present tense and the active voice.
- A fix tells what was wrong as the user saw it. Bad: "Fix colorizeElement". Good: "The Markdown preview
  no longer changes the theme of the editors."
- No internal names (functions, settings keys, crates), no names of people, no links to commits.
- The update notification shows the summary and the first two items only. Put the most important item
  first in its section.

Then run `node scripts/release-notes.mjs check docs/releases/v<version>.md` and fix all errors.
`node scripts/release-notes.mjs update <file>` shows the text of the update notification.

Do not commit the notes alone. `release.sh` adds them to the release commit.

## 4. Release

1. Run `scripts/release.sh [patch|minor|major|<version>]`. It checks the notes again, sets the
   version, commits "Release v<version>" with the notes, makes the tag, and pushes.
2. The push of the tag fails with HTTP 403 in a cloud session: a ruleset lets only the owner make `v*`
   tags. Then push the branch alone: `git push origin main`, and also the session branch when the
   session has one.
3. Give the owner, in Traditional Chinese, the notes and these commands for their Mac:

   ```sh
   git fetch origin
   git tag -a v<version> <sha of the release commit> -m "Gittor <version>"
   git push origin v<version>
   ```

   Then the owner approves the deployment: Actions › Release › Review deployments › release.
4. The workflow stops early when the notes are missing or break a rule. Then fix the notes on `main`,
   delete the tag on the Mac (`git push --delete origin v<version>` and `git tag -d v<version>`), and
   make the tag again on the new commit.

## 5. After the release

When the owner says that the workflow finished, read the release (`mcp__github__get_release_by_tag`)
and check that its body is the notes. A release is immutable: it cannot change after it is published.
