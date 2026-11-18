#!/usr/bin/env bash
# A branch topic/plan with five commits for the interactive rebase editor. run-all.sh runs this in the
# fresh demo repository. A adds notes.md, B changes it, C adds util.rs, D changes main.rs, E removes util.rs.
# B before A conflicts; E before C makes E empty.
set -euo pipefail
git stash -q -u 2>/dev/null || true
git checkout -q -b topic/plan main
# Recent dates, two days ago, as make-demo-repo.sh: old dates would put the branch in the Stale group.
base=$(( $(date +%s) / 86400 * 86400 - 2 * 86400 ))
t() { echo "$(( base + 10#$1 * 3600 )) +0000"; }
c() { git add -A; GIT_AUTHOR_DATE="$1" GIT_COMMITTER_DATE="$1" git commit -qm "$2"; }
printf 'one\n' > notes.md; c "$(t 10)" "A add notes"
printf 'two\n' > notes.md; c "$(t 11)" "B change notes"
printf 'pub fn util() {}\n' > util.rs; c "$(t 12)" "C add util"
printf 'fn main() {\n  println!("hi!");\n}\n' > main.rs; c "$(t 13)" "D louder greeting"
git rm -q util.rs; c "$(t 14)" "E remove util again"
