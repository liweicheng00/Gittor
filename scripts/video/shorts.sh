#!/usr/bin/env bash
# Makes the short videos for social posts from the start: builds the UI and the dev server, records the
# scenes, and writes <scratch-dir>/out/gittor-short-<n>-<scene>.mp4.
# Usage: scripts/video/shorts.sh <scratch-dir> [style]
# The style of the music is pulse (the default), lofi or drive. Set CHROMIUM to a Chromium binary when
# Playwright has no downloaded browser. ffmpeg and python3 with numpy must be on the PATH.
set -euo pipefail
scratch=${1:?usage: shorts.sh <scratch-dir> [style]}
here=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$here/../.." && pwd)
mkdir -p "$scratch"
[ -d "$root/ui/node_modules" ] || npm --prefix "$root/ui" ci
npm --prefix "$root/ui" run build
(cd "$root" && cargo build -q -p gittor-devserver)
node "$here/shorts-record.mjs" "$scratch/work" "$scratch/rec"
node "$here/shorts-build.mjs" "$scratch/rec" "$scratch/out" ${2:+"$2"}
