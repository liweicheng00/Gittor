#!/usr/bin/env bash
# Writes latest.json for the updater of the app to standard output.
# Usage: scripts/latest-json.sh <version> <url of Gittor.app.tar.gz> <file of its .sig> <file of the notes>
# The universal app serves Apple silicon and Intel Macs, so both platforms get the same file.
set -euo pipefail
[ $# -eq 4 ] || { echo "Usage: scripts/latest-json.sh <version> <url> <sig-file> <notes-file>" >&2; exit 1; }
node -e '
  const fs = require("fs");
  const [version, url, sigFile, notesFile] = process.argv.slice(1);
  const signature = fs.readFileSync(sigFile, "utf8").trim();
  if (!signature) throw new Error(`${sigFile} is empty`);
  const mac = { signature, url };
  const latest = {
    version,
    notes: fs.readFileSync(notesFile, "utf8").trim(),
    pub_date: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    platforms: { "darwin-aarch64": mac, "darwin-x86_64": mac },
  };
  process.stdout.write(JSON.stringify(latest, null, 2) + "\n");
' "$@"
