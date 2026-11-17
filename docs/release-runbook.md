# Release runbook

How to publish a release of Alice, from tag to the public download links. Steps marked **once** are
done only before the first public release (v0.2.0). Everything else is repeated for every release.

Nothing reaches users until you press **Publish**: the download links, the Desktop updater, the
install script and the `:latest` image all follow the latest *published* release.

## 1. Signing keys (once)

```bash
scripts/release-keys.sh ~/alice-release-keys
```

The script creates:

- the Tauri updater key;
- a self-signed macOS code-signing certificate;
- their passwords.

Move the folder into your password manager. **Never regenerate these keys**: a new updater key cannot
update apps already installed, and a new certificate makes every Mac user approve Keychain access again.

## 2. Secrets and variables (once)

Run the `gh secret set` and `gh variable set` commands that the script printed. They set:

| Name | Kind |
|---|---|
| `TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | secret |
| `ALICE_MACOS_CERTIFICATE`, `ALICE_MACOS_CERTIFICATE_PASSWORD` | secret |
| `ALICE_UPDATER_PUBKEY` | variable |
| `ALICE_UPDATE_URL` = `https://github.com/KamolpopKK/alice/releases/latest/download/latest.json` | variable |
| `ALICE_DOWNLOAD_BASE_URL` = `https://github.com/KamolpopKK/alice/releases/latest/download` | variable |

Check them:

```bash
gh secret list -R KamolpopKK/alice
gh variable list -R KamolpopKK/alice
```

## 3. Dry run of the release workflow (once, and whenever signing changes)

Run **Release clients** by hand on `main`. It builds and checks every installer with the real certificate,
but creates no release and pushes no image:

```bash
gh workflow run release.yml -R KamolpopKK/alice --ref main
gh run watch -R KamolpopKK/alice
```

The macOS arm64 job must print `Imported the release signing identity "Alice Release (self-signed)"`, and
its bundle verification must pass.

## 4. Make the repository public (once)

```bash
gh repo edit KamolpopKK/alice --visibility public --accept-visibility-change-consequences
gh repo edit KamolpopKK/alice --description "Self-hosted taskboard for humans and AI agents" \
  --add-topic taskboard --add-topic ai-agents --add-topic mcp --add-topic self-hosted --add-topic tauri
```

After the first image push (step 6), open the `alice` package under
**github.com/KamolpopKK → Packages → alice → Package settings**. Make sure that:

- it is linked to the repository;
- its visibility is **Public**, so that `docker compose pull` works without signing in.

## 5. Prepare the version

On a branch, merged to `main` before tagging:

1. Set the version in `package.json` (and `npm install` to update the lockfile), `src-tauri/Cargo.toml`
   and `src-tauri/tauri.conf.json`.
2. Set the image default in `compose.yaml` (`${ALICE_VERSION:-<version>}`) and `ALICE_VERSION` in
   `.env.example`.
3. Turn the CHANGELOG's notes into a `## <version> — <date>` section.

`node scripts/release-preflight.mjs --dry-run` (also run in CI) must pass.

## 6. Tag

```bash
git switch main && git pull
git tag v0.2.0
git push origin v0.2.0
```

The workflow first runs the preflight. A wrong tag, a missing CHANGELOG section or a missing secret
stops it before any build. When it finishes, you have:

- a **draft** release with every installer, `install-macos.sh`, `latest.json`, `SHA256SUMS`, and notes
  taken from that version's CHANGELOG section;
- `ghcr.io/kamolpopkk/alice:0.2.0` for amd64 and arm64. `:latest` has not moved.

## 7. Check the draft

Download from the draft (not from `latest`, which still points at the previous release):

- [ ] [macOS clean-machine checklist](release-checklist-local-macos.md) with the arm64 DMG and with
      `install-macos.sh`. To run the script before publishing, use
      `ALICE_DOWNLOAD_BASE=https://github.com/KamolpopKK/alice/releases/download/v0.2.0`.
- [ ] Windows: the installer runs after **More info → Run anyway**, and the app signs in to a server.
- [ ] Self-hosting from the README in a fresh folder, with `ALICE_VERSION=0.2.0`. Check the HTTPS profile on
      a real domain: the certificate is issued, and Desktop and CLI sign-in work.
- [ ] Release notes contain only this version.

## 8. Publish

Press **Publish release** on the draft (or `gh release edit v0.2.0 --draft=false -R KamolpopKK/alice`).
Publishing:

- moves `releases/latest` for the download links, the install script and the Desktop updater;
- runs **Promote server image**, which tags the same digest as `ghcr.io/kamolpopkk/alice:latest`.

Confirm:

```bash
curl -fsSI https://github.com/KamolpopKK/alice/releases/latest/download/install-macos.sh | head -1
curl -fsSL https://github.com/KamolpopKK/alice/releases/latest/download/latest.json | head -5
docker buildx imagetools inspect ghcr.io/kamolpopkk/alice:latest
```

## Rollback

- **Before publishing:** delete the draft and the tag, and fix forward. The version image stays but is
  unused: `gh release delete v0.2.0 --cleanup-tag -R KamolpopKK/alice`.
- **After publishing:** mark the release as a pre-release, so `latest` falls back to the previous one.
  Point `:latest` back with
  `docker buildx imagetools create -t ghcr.io/kamolpopkk/alice:latest ghcr.io/kamolpopkk/alice:<previous>`.
  Installed Desktop apps never downgrade, so ship a fixed version instead of relying on rollback.
