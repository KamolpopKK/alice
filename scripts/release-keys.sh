#!/usr/bin/env bash
# Generates Alice's release signing material ONCE, on the maintainer's machine:
#   - the Tauri updater key pair (every Desktop update is verified against its public key);
#   - a self-signed macOS code-signing certificate (.p12). It is not an Apple Developer ID; its stable
#     identity keeps Keychain access across updates.
# Nothing is uploaded and nothing is written inside the repository. Store the folder in a password
# manager. Losing the updater key means installed apps can never be updated again (docs/desktop-release.md).
#
#   scripts/release-keys.sh [OUTPUT_DIR]        (default: ~/alice-release-keys)
#   ALICE_REPO=owner/name to print commands for another repository
set -euo pipefail
umask 077

REPO_ROOT=$(cd "$(dirname "$0")/.." && pwd -P)
OUT=${1:-$HOME/alice-release-keys}
REPO=${ALICE_REPO:-KamolpopKK/alice}
CN=${ALICE_CERT_NAME:-Alice Release (self-signed)}

# ตรวจก่อนสร้างโฟลเดอร์ ห้ามเขียน key ลงใน repository (แม้แต่สร้างโฟลเดอร์เปล่า)
case "$OUT" in /*) ;; *) OUT="$(pwd -P)/$OUT" ;; esac
case "$OUT/" in
  "$REPO_ROOT"/*) echo "release-keys: choose a folder outside the repository (got $OUT)" >&2; exit 2 ;;
esac
mkdir -p "$OUT"
OUT=$(cd "$OUT" && pwd -P)
for f in updater.key updater.key.pub macos-release.p12; do
  [ -e "$OUT/$f" ] && { echo "release-keys: $OUT/$f already exists; refusing to overwrite release keys" >&2; exit 2; }
done

pw() { openssl rand -base64 33 | tr -d '\n/+=' | cut -c1-40; }

# 1. updater key pair (password-protected)
printf '%s' "$(pw)" > "$OUT/updater.password"
(cd "$REPO_ROOT" && npx --no-install tauri signer generate --ci -w "$OUT/updater.key" -p "$(cat "$OUT/updater.password")") >/dev/null

# 2. self-signed code-signing certificate, valid for 10 years, exported for the CI keychain
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
openssl req -x509 -newkey rsa:3072 -sha256 -days 3650 -nodes \
  -keyout "$WORK/key.pem" -out "$WORK/cert.pem" -subj "/CN=$CN" \
  -addext "basicConstraints=critical,CA:false" \
  -addext "keyUsage=critical,digitalSignature" \
  -addext "extendedKeyUsage=critical,codeSigning" 2>/dev/null
printf '%s' "$(pw)" > "$OUT/macos-release.password"
LEGACY=()
openssl version | grep -q '^OpenSSL 3' && LEGACY=(-legacy)   # macOS `security import` needs the older PKCS#12 ciphers
openssl pkcs12 -export ${LEGACY[@]+"${LEGACY[@]}"} -name "$CN" -inkey "$WORK/key.pem" -in "$WORK/cert.pem" \
  -out "$OUT/macos-release.p12" -passout "file:$OUT/macos-release.password"
cp "$WORK/cert.pem" "$OUT/macos-release.cert.pem"

cat <<EOF
Created in $OUT (owner-only):
  updater.key, updater.key.pub, updater.password
  macos-release.p12, macos-release.password, macos-release.cert.pem   (identity: "$CN")

Store this folder in your password manager now. Then set the repository secrets and variables:

  gh secret set TAURI_SIGNING_PRIVATE_KEY -R $REPO < "$OUT/updater.key"
  gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD -R $REPO < "$OUT/updater.password"
  base64 -i "$OUT/macos-release.p12" | gh secret set ALICE_MACOS_CERTIFICATE -R $REPO
  gh secret set ALICE_MACOS_CERTIFICATE_PASSWORD -R $REPO < "$OUT/macos-release.password"
  gh variable set ALICE_UPDATER_PUBKEY -R $REPO < "$OUT/updater.key.pub"
  gh variable set ALICE_UPDATE_URL -R $REPO --body "https://github.com/$REPO/releases/latest/download/latest.json"
  gh variable set ALICE_DOWNLOAD_BASE_URL -R $REPO --body "https://github.com/$REPO/releases/latest/download"
EOF
