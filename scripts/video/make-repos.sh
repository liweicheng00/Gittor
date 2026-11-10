#!/usr/bin/env bash
# Builds the repositories for the intro video in <work-dir>:
#   rustcalc (the e2e demo repository with more history), rustcalc-origin,
#   three worktrees of rustcalc in rustcalc-wt, and two other projects (website, infra).
# Usage: scripts/video/make-repos.sh <work-dir>
set -euo pipefail
work=${1:?usage: make-repos.sh <work-dir>}
here=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$here/../.." && pwd)
mkdir -p "$work"
work=$(cd "$work" && pwd)
repo=$work/rustcalc
rm -rf "$work/rustcalc-wt" "$work/website" "$work/infra" "$work/rustlib"
"$root/ui/e2e/make-demo-repo.sh" "$repo" > /dev/null

cd "$repo"
git config commit.gpgsign false
c() { GIT_AUTHOR_DATE="$1" GIT_COMMITTER_DATE="$1" git commit -qam "$2" ${3:+--author="$3"}; }
# Keep the local changes of the demo repository for later.
git stash -q -u
# More history on main: a feature branch that merges, and a fix branch that stays open.
git checkout -q -b feature/tokenizer main
printf 'pub enum Token { Num(i64), Op(char) }\n' > token.rs; git add token.rs; c 2026-09-12T09:00 "Add a token type" "Grace Hopper <grace@example.com>"
printf 'pub enum Token { Num(i64), Op(char), Paren(char) }\n' > token.rs; c 2026-09-12T15:00 "Tokenize parentheses" "Grace Hopper <grace@example.com>"
git checkout -q -b fix/overflow main
sed -i 's/wrapping_add/checked_add/; s/-> i32/-> Option<i32>/' arith.rs; c 2026-09-13T10:00 "Return None on overflow" "Linus T <linus@example.com>"
git checkout -q main
printf '[package]\nname = "rustcalc"\nversion = "0.3.0"\n' > Cargo.toml; git add Cargo.toml; c 2026-09-13T11:00 "Add Cargo.toml"
GIT_AUTHOR_DATE=2026-09-14T09:00 GIT_COMMITTER_DATE=2026-09-14T09:00 git merge -q --no-ff feature/tokenizer -m "Merge branch 'feature/tokenizer'"
printf 'fn main() {\n    println!("hello, world");\n    let args: Vec<String> = std::env::args().collect();\n}\n' > main.rs; c 2026-09-15T10:00 "Read the arguments"
git stash pop -q

# Worktrees of rustcalc.
git worktree add -q -b wt/parser-fix "$work/rustcalc-wt/parser-fix" origin/feature/parser
git worktree add -q -b wt/cli-flags "$work/rustcalc-wt/cli-flags" origin/feature/cli
git worktree add -q -b wt/release-0.3 "$work/rustcalc-wt/release-0.3" v0.2.0

# Two other projects.
for p in website infra; do
  mkdir -p "$work/$p" && cd "$work/$p"
  git init -q -b main && git config user.name "Ada Lovelace" && git config user.email ada@example.com && git config commit.gpgsign false
  echo "# $p" > README.md && git add . && c 2026-09-01T10:00 "Initial commit"
  echo "Notes for $p." >> README.md && c 2026-09-08T10:00 "Add notes"
  echo "More notes." >> README.md && c 2026-09-14T10:00 "Update notes"
done
echo "$repo"
