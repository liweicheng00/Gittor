#!/usr/bin/env bash
# Runs every UI scenario (each ui/e2e/*.mjs file) against a fresh demo repository. Start the dev server
# first (see README).
# Usage: e2e/run-all.sh <work-dir> [large-repo]
# - A new scenario needs no entry here: the script finds it by its file.
# - <name>.prep.sh, when it exists, runs in the fresh repository of <name>.mjs before the scenario.
# - A scenario with the line "// e2e: large repository" runs only when [large-repo] is given (for
#   example a clone of git/git).
# - GITTOR_E2E_ONLY is an extended regular expression: only the scenarios whose names match run.
# - GITTOR_E2E_URL is the address of the dev server (default http://127.0.0.1:5174). Several runs can
#   share one machine, each with its own dev server and work dir.
# Set CHROMIUM when Playwright has no downloaded browser.
set -uo pipefail
work=${1:?usage: run-all.sh <work-dir> [large-repo]}
large=${2:-}
only=${GITTOR_E2E_ONLY:-}
here=$(cd "$(dirname "$0")" && pwd)
mkdir -p "$work/shots"
failed=()
fresh() {
  rm -rf "$work/$1" "$work/$1-origin" "$work/$1-wt" "$work/$1-secure.git" "$work/$1-lib"
  "$here/make-demo-repo.sh" "$work/$1" >/dev/null
}
run() {
  local name=$1 repo=$2
  echo "== $name"
  if node "$here/$name.mjs" "$repo" "$work/shots" >"$work/$name.log" 2>&1; then
    grep -E "^(FAIL|errors)" "$work/$name.log" || true
  else
    failed+=("$name")
    tail -20 "$work/$name.log"
  fi
}
for file in "$here"/*.mjs; do
  name=$(basename "$file" .mjs)
  if [ -n "$only" ] && ! [[ $name =~ $only ]]; then continue; fi
  if grep -q '^// e2e: large repository' "$file"; then
    if [ -n "$large" ]; then run "$name" "$large"; fi
    continue
  fi
  fresh "$name" || { failed+=("$name"); continue; }
  if [ -f "$here/$name.prep.sh" ] && ! (cd "$work/$name" && "$here/$name.prep.sh"); then
    failed+=("$name")
    continue
  fi
  run "$name" "$work/$name"
done
if [ ${#failed[@]} -gt 0 ]; then
  echo "FAILED: ${failed[*]}"
  exit 1
fi
echo "All scenarios passed."
