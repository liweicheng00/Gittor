#!/usr/bin/env bash
# Makes a release: sets the version in all files, commits, tags and pushes. The tag starts the
# release workflow on GitHub, which builds, signs and publishes the app and its update.
# Usage: scripts/release.sh <version> [--no-push]
#   <version>   for example 0.2.0. It must be greater than the current version.
#   --no-push   commit and tag here only, for a check before the push.
set -euo pipefail
cd "$(dirname "$0")/.."
version=${1:-}
push=1
[ "${2:-}" = "--no-push" ] && push=0
if ! [[ $version =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Usage: scripts/release.sh <version> [--no-push], for example scripts/release.sh 0.2.0" >&2
  exit 1
fi
current=$(node -p 'require("./crates/app/tauri.conf.json").version')
newer=$(node -e '
  const [a, b] = process.argv.slice(1).map((v) => v.split(".").map(Number));
  const d = a.map((x, i) => x - b[i]).find((x) => x !== 0) ?? 0;
  console.log(d > 0 ? "yes" : "no");
' "$version" "$current")
if [ "$newer" != yes ]; then
  echo "The version $version is not greater than the current version $current." >&2
  exit 1
fi
if [ -n "$(git status --porcelain)" ]; then
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

git add crates/app/tauri.conf.json crates/*/Cargo.toml Cargo.lock ui/package.json ui/package-lock.json
git commit -q -m "Release v$version"
git tag -a "v$version" -m "Gittor $version"
echo "Committed and tagged v$version."
if [ "$push" = 1 ]; then
  git push -q origin main "v$version"
  echo "Pushed. The release workflow builds and publishes it:"
  echo "https://github.com/liweicheng00/Gittor/actions"
else
  echo "Not pushed. To publish: git push origin main v$version"
fi
