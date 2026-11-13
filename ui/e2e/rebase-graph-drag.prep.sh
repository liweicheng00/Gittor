#!/usr/bin/env bash
# A branch topic/plan with five commits for the drag in the log graph. run-all.sh runs this in the
# fresh demo repository. A adds notes.md, B changes it, C adds util.rs, D changes main.rs, E removes util.rs.
# B before A conflicts; E before C makes E empty.
set -euo pipefail
git stash -q -u 2>/dev/null || true
git checkout -q -b topic/plan main
c() { git add -A; GIT_AUTHOR_DATE="$1" GIT_COMMITTER_DATE="$1" git commit -qm "$2"; }
printf 'one\n' > notes.md; c 2026-09-12T10:00 "A add notes"
printf 'two\n' > notes.md; c 2026-09-12T11:00 "B change notes"
printf 'pub fn util() {}\n' > util.rs; c 2026-09-12T12:00 "C add util"
printf 'fn main() {\n  println!("hi!");\n}\n' > main.rs; c 2026-09-12T13:00 "D louder greeting"
git rm -q util.rs; c 2026-09-12T14:00 "E remove util again"
