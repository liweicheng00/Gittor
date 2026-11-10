#!/usr/bin/env bash
# Makes a release: sets the next version in all files, commits, tags and pushes. The release notes
# (docs/releases/v<version>.md, see scripts/release-notes.mjs) must exist; the release commit adds them. The tag starts the
# release workflow on GitHub, which builds, signs and publishes the app and its update.
# Usage: scripts/release.sh [patch|minor|major|<version>] [--no-push]
#   patch       the default: 0.2.0 -> 0.2.1. A version that has no release yet is released as it is.
#   minor       0.2.3 -> 0.3.0
#   major       0.2.3 -> 1.0.0
#   <version>   a version x.y.z that is greater than the last release
#   --no-push   commit and tag here only, for a check before the push.
set -euo pipefail
cd "$(dirname "$0")/.."
what=patch
push=1
for arg in "$@"; do
  case "$arg" in
    --no-push) push=0 ;;
    -*) echo "Usage: scripts/release.sh [patch|minor|major|<version>] [--no-push]" >&2; exit 1 ;;
    *) what=$arg ;;
  esac
done
current=$(node scripts/version.mjs current)
version=$(node scripts/version.mjs next "$what")
echo "Release $version (the version before: $current)."
notes="docs/releases/v$version.md"
node scripts/release-notes.mjs check "$notes"
# Only the release notes can have changes: the release commit adds them.
if [ -n "$(git status --porcelain -- . ":(exclude)$notes")" ]; then
  echo "The working tree has changes. Commit or stash them first." >&2
  exit 1
fi
branch=$(git symbolic-ref --short HEAD)
if [ "$branch" != main ]; then
  echo "Release from main, not from $branch." >&2
  exit 1
fi
if git rev-parse -q --verify "refs/tags/v$version" >/dev/null; then
  echo "The tag v$version exists already." >&2
  exit 1
fi
if [ "$push" = 1 ]; then
  git fetch -q origin main
  if [ "$(git rev-parse HEAD)" != "$(git rev-parse origin/main)" ]; then
    echo "main is not the same as origin/main. Pull or push first." >&2
    exit 1
  fi
fi

# The version is in tauri.conf.json (the app), the Cargo.toml of each crate, and the UI package.
node -e '
  const fs = require("fs");
  const file = "crates/app/tauri.conf.json";
  const text = fs.readFileSync(file, "utf8");
  fs.writeFileSync(file, text.replace(/"version": "[^"]*"/, `"version": "${process.argv[1]}"`));
' "$version"
for toml in crates/*/Cargo.toml; do
  # Only the version of the package: the first line that starts with "version =".
  node -e '
    const fs = require("fs");
    const [file, v] = process.argv.slice(1);
    fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace(/^version = "[^"]*"/m, `version = "${v}"`));
  ' "$toml" "$version"
done
(cd ui && npm version --no-git-tag-version --allow-same-version "$version" >/dev/null)
# Cargo writes the new versions of the crates into Cargo.lock.
cargo update --workspace --quiet

git add crates/app/tauri.conf.json crates/*/Cargo.toml Cargo.lock ui/package.json ui/package-lock.json "$notes"
# The first release of a version that is in the files already changes no file.
git diff --cached --quiet || git commit -q -m "Release v$version"
git tag -a "v$version" -m "Gittor $version"
echo "Committed and tagged v$version."
if [ "$push" = 1 ]; then
  git push -q origin main "v$version"
  echo "Pushed. The release workflow builds and publishes it:"
  echo "https://github.com/liweicheng00/Gittor/actions"
else
  echo "Not pushed. To publish: git push origin main v$version"
fi
