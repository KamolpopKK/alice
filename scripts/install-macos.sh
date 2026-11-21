#!/bin/sh
# Alice installer for macOS on Apple Silicon.
#
# Alice is code-signed but not notarized (no Apple Developer ID). This script downloads the app archive
# with curl, which does not set the quarantine attribute, checks the complete archive against
# SHA256SUMS from the same release, confirms that the app carries an embedded code signature, and
# installs Alice.app. It never uses sudo and never changes Gatekeeper settings.
#
#   curl -fsSL <release>/install-macos.sh | sh
#
# ALICE_DOWNLOAD_BASE  release download folder (set when the release is published)
# ALICE_INSTALL_DIR    target folder (default: /Applications if writable, else ~/Applications)
set -eu

BASE="${ALICE_DOWNLOAD_BASE:-__ALICE_DOWNLOAD_BASE__}"
ARCHIVE="Alice_aarch64.app.tar.gz"

fail() { echo "alice-install: $*" >&2; exit 1; }

[ "$(uname -s)" = "Darwin" ] || fail "this installer is for macOS"
[ "$(uname -m)" = "arm64" ] || [ -n "${ALICE_INSTALL_ANY_ARCH:-}" ] || fail "Alice's Local release supports Apple Silicon (arm64) Macs only"
case "$BASE" in
  https://*|http://127.0.0.1*) ;;
  *) fail "no download location; set ALICE_DOWNLOAD_BASE to the release folder" ;;
esac

if [ -n "${ALICE_INSTALL_DIR:-}" ]; then
  DEST="$ALICE_INSTALL_DIR"
elif [ -w /Applications ]; then
  DEST=/Applications
else
  DEST="$HOME/Applications"
fi
mkdir -p "$DEST"

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT INT TERM

echo "Downloading Alice…"
curl -fsSL "$BASE/$ARCHIVE" -o "$WORK/$ARCHIVE"
curl -fsSL "$BASE/SHA256SUMS" -o "$WORK/SHA256SUMS"

EXPECTED=$(awk -v f="$ARCHIVE" '$2 == f || $2 == "*"f { print $1 }' "$WORK/SHA256SUMS")
[ -n "$EXPECTED" ] || fail "SHA256SUMS does not list $ARCHIVE; nothing was installed"
ACTUAL=$(shasum -a 256 "$WORK/$ARCHIVE" | awk '{ print $1 }')
[ "$EXPECTED" = "$ACTUAL" ] || fail "checksum mismatch for $ARCHIVE; nothing was installed"

mkdir "$WORK/app"
tar -xzf "$WORK/$ARCHIVE" -C "$WORK/app"
[ -d "$WORK/app/Alice.app" ] || fail "the archive does not contain Alice.app; nothing was installed"
# The release certificate is deliberately self-signed, so `codesign --verify` rejects it as an
# untrusted chain on a clean Mac even when every sealed byte is intact. CI performs the full
# signature/seal verification while that certificate is trusted. Here the archive checksum protects
# those exact verified bytes; this check also prevents an accidentally unsigned app from installing.
codesign --display "$WORK/app/Alice.app" >/dev/null 2>&1 || fail "Alice.app has no embedded code signature; nothing was installed"

if [ -d "$DEST/Alice.app" ]; then
  mv "$DEST/Alice.app" "$WORK/previous-Alice.app"
fi
if ! mv "$WORK/app/Alice.app" "$DEST/Alice.app"; then
  [ -d "$WORK/previous-Alice.app" ] && mv "$WORK/previous-Alice.app" "$DEST/Alice.app"
  fail "could not write to $DEST"
fi

echo "Installed Alice in $DEST/Alice.app"
echo "Open it from $DEST; your Local workspaces stay in ~/Library/Application Support/Alice."
