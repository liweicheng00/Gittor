#!/usr/bin/env bash
# Builds "Gittor.app" and a .dmg on macOS. Run it from any directory.
# Usage: scripts/build-dmg.sh [--universal] [--unsigned] [--updater]
#   --universal  one app for Apple silicon and Intel Macs.
#   --unsigned   a build without the Apple signature, for a test on this Mac. Other Macs block it.
#   --updater    a release build: the app checks for updates, and the build makes Gittor.app.tar.gz
#                and its .sig for the updater. The release workflow on GitHub uses it. It needs:
#                  TAURI_UPDATER_PUBKEY                the public key of the updater
#                  TAURI_SIGNING_PRIVATE_KEY           the private key (the text or the path of the file)
#                  TAURI_SIGNING_PRIVATE_KEY_PASSWORD  its password, when it has one
#                A build without --updater does not check for updates.
#
# The version: a build at a release tag without changes has the version of the release. Any other build
# is a test build: its version has the label "dev", for example 0.2.1-dev.5+a1b2c3d4 (5 commits after
# the release 0.2.0, at commit a1b2c3d4). The name of the .dmg and Settings › General show it. The
# CFBundleVersion of each build is the number of commits, so it grows. See scripts/version.mjs.
#
# A test build is the app "Gittor Dev" (identifier dev.gittor.app.dev, an icon with "DEV"). It runs next
# to the release Gittor, with its own settings in "gittor-dev". At its first start it copies the
# settings of the release.
#
# A signed build needs these variables (see README, "Sign and notarize"):
#   APPLE_SIGNING_IDENTITY  "Developer ID Application: Name (TEAMID)", from: security find-identity -v -p codesigning
#   APPLE_ID                the Apple ID of the developer account
#   APPLE_PASSWORD          an app-specific password of that Apple ID
#   APPLE_TEAM_ID           the 10-character Team ID
# Tauri signs and notarizes the app. This script then signs and notarizes the .dmg too, and checks both.
set -euo pipefail
cd "$(dirname "$0")/.."
if [ "$(uname)" != "Darwin" ]; then
  echo "Run this script on macOS." >&2
  exit 1
fi

universal=0
unsigned=0
updater=0
for arg in "$@"; do
  case "$arg" in
    --universal) universal=1 ;;
    --unsigned) unsigned=1 ;;
    --updater) updater=1 ;;
    *) echo "Unknown option: $arg. Usage: scripts/build-dmg.sh [--universal] [--unsigned] [--updater]" >&2; exit 1 ;;
  esac
done

version=$(node scripts/version.mjs build)
build_number=$(node scripts/version.mjs build-number)
if [ "$updater" = 1 ] && [ "$version" != "$(node scripts/version.mjs current)" ]; then
  echo "A release build needs a release tag and no changes. This is the test version $version." >&2
  echo "Make a release with scripts/release.sh." >&2
  exit 1
fi
echo "Version $version (build $build_number)."
[[ $version == *-* ]] && echo "A test build: the app is \"Gittor Dev\". It runs next to the release Gittor."

# The version, the build number and the updater settings go into a second config file that Tauri merges
# with tauri.conf.json.
mkdir -p target
build_config="$(pwd)/target/tauri.build.conf.json"
pubkey=""
if [ "$updater" = 1 ]; then
  for v in TAURI_UPDATER_PUBKEY TAURI_SIGNING_PRIVATE_KEY; do
    [ -n "${!v:-}" ] || { echo "--updater needs the variable $v (see the top of this script)." >&2; exit 1; }
  done
  pubkey=$TAURI_UPDATER_PUBKEY
fi
name=Gittor
[[ $version == *-* ]] && name="Gittor Dev"
node -e '
  const [file, version, build, key, repo] = process.argv.slice(1);
  const config = { version, bundle: { macOS: { bundleVersion: build } } };
  if (version.includes("-")) {
    // A test build: another app, next to the release.
    config.productName = "Gittor Dev";
    config.identifier = "dev.gittor.app.dev";
    config.bundle.icon = ["icons-dev/icon.png", "icons-dev/icon.icns"];
  }
  if (key) {
    config.bundle.createUpdaterArtifacts = true;
    config.plugins = { updater: { pubkey: key.trim(), endpoints: [`https://github.com/${repo}/releases/latest/download/latest.json`] } };
  }
  require("fs").writeFileSync(file, JSON.stringify(config, null, 2));
' "$build_config" "$version" "$build_number" "$pubkey" "${GITTOR_RELEASE_REPO:-liweicheng00/Gittor}"
config=(--config "$build_config")

if [ "$unsigned" = 1 ]; then
  # Tauri signs when the identity is set; an unsigned build must not see it.
  unset APPLE_SIGNING_IDENTITY APPLE_ID APPLE_PASSWORD APPLE_TEAM_ID
  echo "An unsigned build: it opens on this Mac only. Other Macs block it."
else
  missing=()
  for v in APPLE_SIGNING_IDENTITY APPLE_ID APPLE_PASSWORD APPLE_TEAM_ID; do
    [ -n "${!v:-}" ] || missing+=("$v")
  done
  if [ ${#missing[@]} -gt 0 ]; then
    echo "These variables are not set: ${missing[*]}." >&2
    echo "Set them for a signed and notarized build (see the top of this script)," >&2
    echo "or use --unsigned for a test build on this Mac." >&2
    exit 1
  fi
  if ! security find-identity -v -p codesigning | grep -qF "\"$APPLE_SIGNING_IDENTITY\""; then
    echo "The keychain has no signing certificate \"$APPLE_SIGNING_IDENTITY\"." >&2
    echo "The certificates that it has:" >&2
    security find-identity -v -p codesigning >&2
    exit 1
  fi
fi

target=()
if [ "$universal" = 1 ]; then
  rustup target add aarch64-apple-darwin x86_64-apple-darwin
  target=(--target universal-apple-darwin)
fi
# The lock files only: a package that is not in them stops the build.
npm --prefix ui ci
# The Tauri CLI reads crates/app/tauri.conf.json, which builds the UI first. With the APPLE_ variables set,
# it signs the app with the hardened runtime, notarizes it, and staples the ticket to it.
(cd crates/app && ../../ui/node_modules/.bin/tauri build --bundles app,dmg ${target[@]+"${target[@]}"} ${config[@]+"${config[@]}"} -- --locked)

dir=target/release/bundle
[ "$universal" = 1 ] && dir=target/universal-apple-darwin/release/bundle
app="$dir/macos/$name.app"
dmg=$(ls -t "$dir"/dmg/*.dmg | head -n 1)

if [ "$unsigned" = 0 ]; then
  echo
  echo "Signing and notarizing the disk image…"
  # The app in the image is notarized. The image gets its own signature and ticket, so a browser
  # download of it passes Gatekeeper also without a network connection.
  codesign --force --sign "$APPLE_SIGNING_IDENTITY" --timestamp "$dmg"
  xcrun notarytool submit "$dmg" --apple-id "$APPLE_ID" --password "$APPLE_PASSWORD" --team-id "$APPLE_TEAM_ID" --wait
  xcrun stapler staple "$dmg"

  echo
  echo "Checking the signatures…"
  failed=0
  codesign --verify --deep --strict "$app" || { echo "FAIL: the signature of the app is not valid." >&2; failed=1; }
  verdict=$(spctl --assess --type execute -vv "$app" 2>&1 || true)
  echo "$verdict"
  echo "$verdict" | grep -q "source=Notarized Developer ID" || { echo "FAIL: Gatekeeper does not accept the app as notarized." >&2; failed=1; }
  xcrun stapler validate "$app" || { echo "FAIL: the app has no stapled ticket." >&2; failed=1; }
  xcrun stapler validate "$dmg" || { echo "FAIL: the disk image has no stapled ticket." >&2; failed=1; }
  if [ "$failed" = 1 ]; then
    echo "The build is not ready to share. See the messages above." >&2
    exit 1
  fi
  echo "OK: the app and the disk image are signed and notarized."
fi

echo
echo "App: $(pwd)/$app"
echo "DMG: $(pwd)/$dmg"
if [ "$updater" = 1 ]; then
  echo "Update: $(pwd)/$app.tar.gz"
  echo "Signature: $(pwd)/$app.tar.gz.sig"
fi
