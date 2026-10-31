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
# - GITTOR_E2E_SHARD=k/n runs part k of n parts, for parallel runs on n machines. The parts have about
#   the same run time: durations.txt has the seconds of each scenario (8 for a scenario that it does
#   not list). Each run writes the seconds to <work-dir>/durations.txt; copy that file over
#   ui/e2e/durations.txt when the times change much.
# Set CHROMIUM when Playwright has no downloaded browser.
set -uo pipefail
work=${1:?usage: run-all.sh <work-dir> [large-repo]}
large=${2:-}
only=${GITTOR_E2E_ONLY:-}
shard=${GITTOR_E2E_SHARD:-}
here=$(cd "$(dirname "$0")" && pwd)
mkdir -p "$work/shots"
failed=()
fresh() {
  rm -rf "$work/$1" "$work/$1-origin" "$work/$1-wt" "$work/$1-secure.git" "$work/$1-lib"
  "$here/make-demo-repo.sh" "$work/$1" >/dev/null
}
run() {
  local name=$1 repo=$2 start=$SECONDS
  echo "== $name"
  if node "$here/$name.mjs" "$repo" "$work/shots" >"$work/$name.log" 2>&1; then
    grep -E "^(FAIL|errors)" "$work/$name.log" || true
  else
    failed+=("$name")
    tail -20 "$work/$name.log"
  fi
  echo "$name $((SECONDS - start))" >> "$work/durations.txt"
}

# The scenarios of this run: all, or one part of n parts. The longest scenario goes to the part
# with the least time so far.
scenarios=()
for file in "$here"/*.mjs; do
  name=$(basename "$file" .mjs)
  if [ -n "$only" ] && ! [[ $name =~ $only ]]; then continue; fi
  scenarios+=("$name")
done
if [ -n "$shard" ]; then
  part=$(node -e '
    const fs = require("fs");
    const [shard, file, ...names] = process.argv.slice(1);
    const [k, n] = shard.split("/").map(Number);
    if (!(k >= 1 && k <= n)) throw new Error(`GITTOR_E2E_SHARD must be k/n with 1 <= k <= n, not ${shard}`);
    const seconds = new Map();
    if (fs.existsSync(file)) for (const line of fs.readFileSync(file, "utf8").split("\n")) {
      const [name, s] = line.trim().split(/\s+/);
      if (name && Number(s) >= 0) seconds.set(name, Number(s));
    }
    const time = (name) => seconds.get(name) ?? 8;
    const parts = Array.from({ length: n }, () => ({ time: 0, names: [] }));
    for (const name of [...names].sort((a, b) => time(b) - time(a) || a.localeCompare(b))) {
      const part = parts.reduce((a, b) => (b.time < a.time ? b : a));
      part.time += time(name);
      part.names.push(name);
    }
    console.log(parts[k - 1].names.sort().join("\n"));
  ' "$shard" "$here/durations.txt" "${scenarios[@]}") || { echo "GITTOR_E2E_SHARD=$shard is not a part k/n." >&2; exit 2; }
  mapfile -t scenarios <<< "$part"
  echo "Part $shard: ${scenarios[*]}"
fi
rm -f "$work/durations.txt"
for name in "${scenarios[@]}"; do
  [ -n "$name" ] || continue
  file="$here/$name.mjs"
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
