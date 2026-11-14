#!/usr/bin/env bash
# Builds the repository for the short videos in <work-dir>: rustcalc, the demo repository of the e2e
# tests without its local changes. shorts-record.mjs adds the work of the agent to it.
# Usage: scripts/video/make-shorts-repo.sh <work-dir>
set -euo pipefail
work=${1:?usage: make-shorts-repo.sh <work-dir>}
here=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$here/../.." && pwd)
mkdir -p "$work"
work=$(cd "$work" && pwd)
repo=$work/rustcalc
"$root/ui/e2e/make-demo-repo.sh" "$repo" > /dev/null
cd "$repo"
git config commit.gpgsign false
git checkout -q -- .
rm -f NOTES.txt
echo "$repo"
