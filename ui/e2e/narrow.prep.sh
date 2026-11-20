#!/usr/bin/env bash
# A local change for the narrow scenario. run-all.sh runs this in the fresh demo repository.
set -euo pipefail
sed -i.bak 's/wrapping_add/saturating_add/' arith.rs && rm -f arith.rs.bak
