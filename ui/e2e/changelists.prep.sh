#!/usr/bin/env bash
# Local changes for the changelists scenario. run-all.sh runs this in the fresh demo repository.
set -euo pipefail
echo "More docs" >> README.md
sed -i.bak 's/wrapping_add/saturating_add/' arith.rs && rm -f arith.rs.bak
echo 'pub fn sub(a: i32, b: i32) -> i32 { a - b }' > sub.rs
git add sub.rs
