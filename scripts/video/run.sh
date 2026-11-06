#!/usr/bin/env bash
# Makes the intro video from the start: builds the UI and the dev server, records the scenes, and
# writes docs/video/gittor-intro.mp4 and docs/video/gittor-intro.gif.
# Usage: scripts/video/run.sh <scratch-dir>
# <scratch-dir> gets the repositories, the scene recordings and the clips. Set CHROMIUM to a Chromium
# binary when Playwright has no downloaded browser. ffmpeg, python3 and numpy must be on the PATH.
set -euo pipefail
scratch=${1:?usage: run.sh <scratch-dir>}
here=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$here/../.." && pwd)
mkdir -p "$scratch"
[ -d "$root/ui/node_modules" ] || npm --prefix "$root/ui" ci
npm --prefix "$root/ui" run build
(cd "$root" && cargo build -q -p gittor-devserver)
node "$here/record.mjs" "$scratch/work" "$scratch/rec"
node "$here/build.mjs" "$scratch/rec" "$root/docs/video"
