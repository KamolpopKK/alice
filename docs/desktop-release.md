# Releasing Alice Desktop and the CLI

Desktop releases are independent of server releases. A Desktop build installs an update only when all of
these hold:

1. The update is signed with the Alice updater key. The public key is compiled into the app, and the Tauri
   updater checks every download against it.
2. Its version is newer than the running one. Downgrades are refused.
3. Its Client API version (`aliceClientApi` in `latest.json`) is supported by the active server.

## Supported targets

| Platform | Runner | Installers | Updater artifact |
|---|---|---|---|
| macOS arm64 | macos-15 | `.dmg`, `.app` | `Alice_aarch64.app.tar.gz` + `.sig` |
| Windows x64 | windows-latest | NSIS `-setup.exe`, `.msi` | the NSIS installer + `.sig` |
| Linux x64 | ubuntu-22.04 | `.AppImage`, `.deb`, `.rpm` | the AppImage + `.sig` |
| Linux arm64 | ubuntu-22.04-arm | `.AppImage`, `.deb`, `.rpm` | the AppImage + `.sig` |

The CLI is released as a single file, `alice-cli-<tag>.js`, which needs only Node.js 22+. The same file is
also attached as `alice-cli.js`, so `releases/latest/download/alice-cli.js` always fetches the latest one. It is built
separately from the server and container image.

## Keys and secrets

| Name | Kind | Purpose |
|---|---|---|
| `ALICE_UPDATER_PUBKEY` | repository **variable** (public) | Updater public key, compiled into every Desktop build |
| `ALICE_UPDATE_URL` | variable | HTTPS URL of `latest.json` |
| `ALICE_DOWNLOAD_BASE_URL` | variable | Base URL that `latest.json` points at for the artifacts |
| `TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | **secrets** | Sign updater artifacts |
| `ALICE_MACOS_CERTIFICATE`, `ALICE_MACOS_CERTIFICATE_PASSWORD` | secrets | Self-signed macOS code-signing certificate (base64 `.p12`) for every macOS build (Apple Silicon only) |
| `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY` | secrets, optional | macOS Developer ID signing, if you add an Apple Developer account later |
| `APPLE_ID`, `APPLE_PASSWORD` (app-specific), `APPLE_TEAM_ID` | secrets, optional | macOS notarization, same |

Windows installers are not code-signed yet. Authenticode signing is a future upgrade.

Generate the updater key and the macOS release certificate **once**, offline, with
`scripts/release-keys.sh`. It writes them to a folder outside the repository and prints the `gh secret set`
and `gh variable set` commands. Keep that folder in a password manager. The full order of steps is in
[release-runbook.md](release-runbook.md).

The macOS certificate is self-signed, so macOS does not trust it as a CA-issued identity.
`scripts/macos-import-certificate.mjs` trusts it for code signing on the build runner only, then signs by
the certificate's SHA-1 hash. Keep the same certificate for every release: the app's designated
requirement names it, so Keychain access to Local workspaces survives updates.

Secrets reach only the build step as environment variables. `scripts/desktop-release-config.mjs` writes
only the public key and the manifest URL into `src-tauri/tauri.release.conf.json`, which git ignores.
`tests/unit/release-workflow.test.ts` checks that no workflow step prints a secret.

### Rotation and loss

- **The installed app trusts exactly one updater key.** Before rotating, ship a release signed with the
  *old* key that contains the *new* public key. Switch signing to the new key only after that release is
  widely installed. Clients that skip the bridge release must reinstall by hand.
- **If the private key is lost,** existing installs can never update automatically again. Publish a
  manual-download release with a new key and announce it.
- **If the private key leaks,** an attacker who can also serve `latest.json` can push updates. Rotate at
  once through a bridge release, take down the compromised manifest, and announce it.
- Apple and Windows certificates expire or can be revoked independently. Expired code signing does not
  affect updater signatures, but it does stop new installs from passing Gatekeeper or SmartScreen.

## Procedure

1. Update `CHANGELOG.md`. Set the version in `package.json`, `src-tauri/Cargo.toml` and
   `src-tauri/tauri.conf.json` (`src/shared/version.ts` follows `package.json`).
2. Run the full checklist in [release.md](release.md).
3. Tag and push: `git tag v0.2.0 && git push origin v0.2.0`. The `Release clients` workflow does the rest:
   - builds and signs every target;
   - collects installers and `.sig` files, failing if a signature is missing;
   - verifies bundle contents: no Node runtime, `better-sqlite3`, SQLite database, server code or extra
     executable;
   - launches every app headless in smoke mode. The production UI must load and reach Rust, and malformed
     or unknown-profile deep links must be refused;
   - builds the standalone CLI and checks it runs with no `node_modules`;
   - writes `latest.json` with `aliceClientApi` and `SHA256SUMS`, and attaches everything to a **draft**
     GitHub release.
4. On a clean machine for each OS family, install the previous release, add a profile, sign in, then let it
   update to the draft. Confirm that the profile and the signed-in session survive. Profiles live in the
   app config directory and the refresh credential in the OS keyring, and the update replaces neither.
5. Publish the release, then upload `latest.json` to `ALICE_UPDATE_URL` **last**, so clients only see the
   update once every artifact is downloadable.

## Verifying updates locally

```bash
npx tauri signer generate -w /tmp/test.key -p "" --ci
ALICE_UPDATER_PUBKEY="$(cat /tmp/test.key.pub)" ALICE_UPDATE_URL=http://127.0.0.1:9999/latest.json \
  node scripts/desktop-release-config.mjs /tmp/release.conf.json
TAURI_SIGNING_PRIVATE_KEY="$(cat /tmp/test.key)" TAURI_SIGNING_PRIVATE_KEY_PASSWORD="" \
  npx tauri build --bundles app --config /tmp/release.conf.json          # the "old" app (keep a copy)
# build again with --config '{"version":"0.2.1"}', serve the .app.tar.gz + latest.json on 127.0.0.1:9999, then:
ALICE_DESKTOP_SMOKE=update ./old/Alice.app/Contents/MacOS/alice-desktop
# → "alice-desktop: update installed 0.2.1"; a modified archive or a foreign signature → "update verify-failed";
#   an older version → "update not-newer"
```

`http://` endpoints are accepted only for `127.0.0.1`, and only in configs generated for local tests.
