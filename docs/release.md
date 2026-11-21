# Unreleased — Agent discovery, technical design and output templates

- **Four skills.** `alice-think` agrees needs and scope, the new `alice-spec` produces technical design,
  `alice-plan` breaks settled work into tasks, and `alice` works on tasks. Stages recommend the next
  skill with input references; they do not invoke it automatically.
- **Technical design.** Relevant architecture, data models, contracts, migration/rollout and operational
  details live in a design separate from the requirements brief. Spec asks before every check execution
  and saves content only after approval. Missing main design choices are recommended back to spec
  before planning.
- **Output formats.** Think and spec now ship templates; all skills ship shared requirement-reference,
  Mermaid, small-task and spike conventions. Requirements retain ids such as `REQ-001`. Mermaid source
  is stored in Markdown; diagram rendering in Alice is future work. Unfinished think/spec work stays in
  chat, with no saved draft document.
- **After planning.** First confirm changing eligible tasks to `ready` (พร้อมทำ), then choose continuous
  execution, one task at a time with confirmation, selected tasks, or no start. An explicit execution
  choice authorizes `alice` within that plan/selection; claims remain one task at a time. Continuous
  execution can make the same plan's newly unblocked leaves ready. Checks still need approval for
  each execution, and failed/blocked work or scope/design changes stop the loop.
- **Upgrade.** Install skills from the updated CLI and restart the agent session. Automatic Local refresh
  compares version numbers only; run `alice install-skill --client codex` or `--client claude-code`
  explicitly to refresh content or supporting files at the same version. Preserve `--scope project`
  when that is how the skills were installed. No schema migration or MCP contract change is required.

Workflow and templates: [agents.md](agents.md). The versioned release notes below describe their
respective releases; current skill behaviour is documented in the agent guide.

# Unreleased — Agent-ready document knowledge

- Documents now have curated tags/keywords, owner, lifecycle and revision-specific review provenance.
- Lexical search explains whether title, keyword, tag, body or source URL matched and supports lifecycle,
  owner, tag and project filters across Web, CLI, Client API and MCP. No vector service is required.
- Typed `references`, symmetric `related` and confirmed `supersedes` relations form a navigable knowledge
  graph; supersedes atomically marks the target and never happens silently.
- Migration 16/17 preserves existing revisions and work links, backfills `unreviewed`, and rebuilds FTS.
  Rollback requires the verified pre-upgrade backup. Portable workspace exports are now format v2.

# Unreleased — Personal Task Pads

User guide: [task-pads.md](task-pads.md).

- **Task Pads.** Private, notes-style capture pads for humans. Task lines create real tasks immediately;
  Text and Heading lines stay private. Owner-only search, export, live updates across your own devices,
  a local outbox that survives reloads and outages, multiline paste with confirmation, and session Undo.
- **Client API.** New capability `task-pads` and routes under `/client/v1/pads` (no protocol version change).
  Private invalidations (`pad`, `pad_block`) reach only the owner's sessions; events may carry `origin`.
- **Alice Desktop.** Configurable global capture shortcuts (Option+Space / Option+Shift+Space on macOS,
  Ctrl+Alt+Space / Ctrl+Alt+Shift+Space elsewhere) and new commands `capture_take`, `shortcuts_get`,
  `shortcuts_set`, `shortcuts_reset`.
- **Upgrade.** Back up, deploy, and migration 11 runs at start-up. Agents, MCP, the CLI and older Desktop
  builds are unaffected: older clients never see Task Pads, and Web/Desktop hide the surface when a server
  lacks the capability. **Rollback** to a build without migration 11 needs the pre-upgrade backup (pads
  created since then are lost; export them first with *Export my pads*).
- **Operations.** Backups include pads; the workspace export does not (each human exports their own).
  `alice-server purge --archived` also removes pad lines of purged tasks.

# Alice 0.2.0 — Desktop and CLI clients

This release adds Alice Desktop and the `alice` CLI. The 0.1.0 notes follow below.

## Highlights

- **Client API v1 (`/client/v1`).** A supported, versioned API for human clients:
  - compatibility negotiation (`/client/v1/info`, `426 CLIENT_INCOMPATIBLE`);
  - idempotent retries;
  - a resumable live event stream with explicit `reset`.

  The Web dashboard now uses it through the shared `AliceClient`.
- **Desktop and CLI sign-in.** Uses a device flow approved in the browser, so no password is typed into a
  native client. Each session has its own name and can be revoked from **Devices** or **Admin**:
  - access credentials last 15 minutes;
  - refresh credentials rotate, and a replayed one revokes the session;
  - only hashes are stored.
- **Alice Desktop (Tauri 2).** A remote-only native app around the same UI:
  - server profiles, with HTTPS required by default;
  - keyring-held credentials owned by Rust;
  - live updates that resume after a disconnect;
  - a clear disconnected state that never queues writes;
  - validated `alice://` deep links;
  - signed updates that check compatibility with your server first.
- **`alice` CLI.** One dependency-free file:
  - profiles and browser sign-in;
  - project, task, document, search, activity and actor commands;
  - tables, JSON and JSONL output, with stable exit codes;
  - Markdown input from files or stdin;
  - `alice open`.
- **`alice-server`.** Server administration has its own command. The old `alice serve` and similar commands
  still work until 0.4.0, with a deprecation notice.

## Compatibility matrix

| Component | Version | Talks to |
|---|---|---|
| Alice Server | 0.2.0 | Client API v1–v1, MCP contract v1, schema v10 |
| Web | ships with the server | Client API v1 (cookie) |
| Alice Desktop | 0.2.0 | Client API v1 (needs server ≥ 0.2.0) |
| `alice` CLI | 0.2.0 | Client API v1 (needs server ≥ 0.2.0) |
| `alice-mcp-stdio` | 0.2.0 | MCP contract v1 (server ≥ 0.1.0) |
| Agent skills (`alice`, `alice-plan`, `alice-think`) | 0.2.0 | MCP contract v1 (server ≥ 0.1.0) |

`alice version`, `alice-server version` and `alice-mcp-stdio --version` report these separately.

## Artifacts

The `Release clients` workflow (`.github/workflows/release.yml`) attaches the following to a draft
release for each tag:

| Artifact | Signing |
|---|---|
| `Alice_<version>_aarch64.dmg` and `Alice_aarch64.app.tar.gz` (with the Local runtime) | Self-signed or ad-hoc code signature, **not notarized**, updater-signed. See [macOS Local release](#macos-local-release-apple-silicon). |
| `install-macos.sh` | Installs `Alice_aarch64.app.tar.gz` after checking `SHA256SUMS`; no quarantine and no sudo |
| `Alice_<version>_x64-setup.exe`, `Alice_<version>_x64_en-US.msi` | Not code-signed yet (SmartScreen warns on first run), updater-signed |
| `Alice_<version>_amd64.AppImage`, `.deb`, `.rpm` (x64 and arm64) | Updater-signed |
| `alice-cli-v<version>.js` and `alice-cli.js` | Standalone CLI (the same file; the second name is stable for `releases/latest/download/`), listed in `SHA256SUMS` |
| `latest.json` | Updater manifest with `aliceClientApi` |
| `SHA256SUMS` | SHA-256 of every file |

The server is deployed from the `ghcr.io/kamolpopkk/alice:<version>` image (amd64 and arm64), pushed by the same tag; `:latest` moves when the release is published. See [operations.md](operations.md#server-image). Verify a
download with `sha256sum -c SHA256SUMS --ignore-missing`. Signing keys and procedures are described in
[desktop-release.md](desktop-release.md). The step-by-step release procedure is [release-runbook.md](release-runbook.md).

## macOS Local release (Apple Silicon)

The macOS arm64 app carries the Local runtime, so it opens a private `Personal` workspace with no server.
It is released **without an Apple Developer ID**:

- **Code signature.** Every Mach-O is signed: the app, the runtime's Node.js and
  `better_sqlite3.node`. Release builds use the self-signed certificate in `ALICE_MACOS_CERTIFICATE`;
  without it they are signed ad-hoc.
- **Not notarized.** macOS therefore asks you to approve the first launch of a downloaded copy once.
- **Updates.** Updates are verified with the Tauri updater key. Files the app downloads or writes itself
  (updates, the runtime, the `alice` launcher) are not quarantined and need no new approval.
- **Keychain.** Local workspace capabilities are stored through the system `security` tool, so updates
  never trigger Keychain prompts for them. Remote sign-ins are stored by the app itself; with an ad-hoc
  signature macOS may ask once after an update, while the stable self-signed identity avoids that.

### Installing

1. **Install script (no approval needed).** Run:

   ```bash
   curl -fsSL https://<release folder>/install-macos.sh | sh
   ```

   The script downloads `Alice_aarch64.app.tar.gz` and checks it against `SHA256SUMS` and its code
   signature. It then installs `Alice.app` into `/Applications`, or into `~/Applications` if
   `/Applications` is not writable. It never uses sudo and never changes Gatekeeper settings.

2. **DMG.**
   1. Drag Alice to Applications and open it once. macOS says it cannot verify the developer.
   2. Open **System Settings → Privacy & Security** and choose **Open Anyway** next to the Alice
      message.
   3. Confirm with **Open**.

   Later launches and updates open normally.

3. **Already trust the download.** The documented fallback is:

   ```bash
   xattr -dr com.apple.quarantine /Applications/Alice.app
   ```

### Creating the release certificate (optional, once)

A stable self-signed certificate keeps the app's identity the same across releases. To create one:

1. Open Keychain Access → Certificate Assistant → Create a Certificate.
2. Name it, set Identity Type **Self Signed Root** and Certificate Type **Code Signing**.
3. Export it as `.p12` with a password.
4. Store `base64 -i cert.p12` as the secret `ALICE_MACOS_CERTIFICATE` and the password as
   `ALICE_MACOS_CERTIFICATE_PASSWORD`.

A Developer ID and notarization remain an optional later upgrade. The release does not need them.

### Compatibility policy

- **Local components** move together. Desktop, the Local runtime, the CLI behaviour, the embedded skills
  and the schema expectation are one exact version. A mismatch shows Repair or Update instead of opening
  the workspace.
- **Remote compatibility** is still negotiated through the Client API version range.
- **Other platforms.** Windows and Linux builds remain Remote-only. Local installers for them are future
  work. Macs with Intel processors are no longer built (the last build is 0.2.0).

Before publishing, run the clean-machine checks in
[release-checklist-local-macos.md](release-checklist-local-macos.md).

## Release checklist

Run all of these on the release commit. The client artifacts must come from the tagged workflow run.

| # | Check | Command |
|---|---|---|
| 1 | Types | `npm run typecheck` |
| 2 | Unit + system: server, Client API, device auth, CLI subprocess, compatibility fixtures, doc examples | `npm test` |
| 3 | Browser: Web, Desktop UI harness, cross-client story | `npm run build && npm run test:e2e` |
| 4 | Desktop Rust core against a real server | `npm run test:desktop` |
| 5 | Scale: 100 000 tasks, and 100 client sessions and streams | `npm run test:scale` |
| 6 | Container: image, readiness, persistence, `alice-server` backup and restore | `tests/compose/smoke.sh` |
| 6b | HTTPS profile: opt-in, refuses without a domain, Caddy config valid, journey and unbuffered live updates through the proxy | `tests/compose/smoke-https.sh` |
| 7 | Desktop bundles: contents, launch, deep links | CI: `desktop-verify-artifacts.mjs`, `desktop-launch-smoke.mjs` |
| 8 | Standalone CLI runs with no `node_modules` | CI `cli` job |
| 9 | Signed update from the previous release keeps profile and session | Manual, per [desktop-release.md](desktop-release.md) step 4 |
| 10 | Real `alice://` link from another app opens Desktop (macOS, Windows, Linux) | Manual |
| 11 | Linux Secret Service and Windows credential store sign-in for Desktop and CLI | Manual |
| 12 | Upload `latest.json` **after** publishing the release | Manual |

### Client load budgets

Added to `npm run test:scale` and measured on an Apple Silicon laptop:

| Measure | Result | Budget |
|---|---:|---:|
| Bearer `GET /client/v1/tasks`, 100 concurrent clients, p95 | 200 ms | 500 ms |
| Refresh-credential rotation, p95 | 3 ms | 150 ms |
| One change delivered to 100 open event streams | 10 ms | 1 500 ms |
| Server RSS with 100 sessions and streams | 250 MB | 512 MB |

## Upgrading from 0.1

1. Back up: `docker compose exec alice alice backup --out /data/backups/before-0.2.0`. This uses the 0.1
   command name, which still exists in 0.2.
2. Deploy 0.2.0. Migrations 9 and 10 run at startup.
3. Nothing is required of existing users. Web sessions, agent tokens, MCP configurations (remote and
   stdio), skills, backups and exports keep working.
4. Change scripts to use `alice-server …` before 0.4.0.
5. Make sure `ALICE_PUBLIC_URL` is the `https://` origin people use. Device approval links are built from
   it.

**Rollback.** Stop 0.2.0, start 0.1.0, and restore the backup from step 1 (see
[operations.md](operations.md#rollback)). Desktop and CLI sessions disappear with the rollback, and those
clients show the server as incompatible until you upgrade again. The Web keeps working.

## Known limitations

- Desktop and the CLI need a reachable server. There is no offline reading or editing, by design.
- Window size and position are restored, but the open page is not.
- `alice open` looks for Desktop in three ways: the registered `alice://` handler on Linux and Windows, and
  `/Applications` or `~/Applications` on macOS. `--desktop`, `--web` and `ALICE_DESKTOP=0|1` override
  this.
- The Windows CLI keeps its refresh credential DPAPI-encrypted in the config directory, not in Credential
  Manager. Desktop on Windows uses Credential Manager.
- Desktop updates install through the platform updater. Linux `.deb` and `.rpm` installs update through the
  AppImage channel only, or by reinstalling.
- There are no push notifications, terminal UI, multi-server combined view or third-party OAuth apps. These
  are out of scope for this release.
- All 0.1.0 limitations below still apply, except that the Client API is now supported for first-party
  human clients.

---

# Alice 0.1.0 — first release

Alice is a self-hosted taskboard shared by humans and AI agents.

## Highlights

- **One board for people and agents.** Projects, tasks with fixed statuses/priorities, labels, due
  dates, single assignee (human or agent), parent/child and blocker relationships, comments, and
  Markdown documents with full revision history and free links.
- **Agents as first-class actors.** Per-agent bearer tokens (hash-only storage, rotate/revoke,
  last-used), a versioned MCP endpoint (`/mcp/v1`, Streamable HTTP), a stdio adapter with identical
  behaviour, atomic `claim_task`, bounded `get_task_context` with explicit truncation/continuations,
  and `complete_task` that requires a summary.
- **Attribution everywhere.** Every mutation writes an activity event in the same transaction;
  browsers update live through SSE invalidation.
- **Simple to run.** One TypeScript process, SQLite (WAL), Docker Compose with one volume, online
  backup with checksummed manifests, verified restore, portable JSON + Markdown export, and a
  dry-run-first purge.

## Installing

Follow the [README](../README.md): `docker compose up -d`, open `/setup`, enter the bootstrap token,
invite teammates and create agents in **Admin**. Agent setup: [agents.md](agents.md). Operations:
[operations.md](operations.md).

## Verification

| Suite | Command | Scope |
|---|---|---|
| Unit + system | `npm test` | Real server on temporary SQLite via HTTP, MCP (remote and stdio), SSE, CLI |
| Browser | `npm run build && npm run test:e2e` | Desktop and mobile-sized Chromium, keyboard-only flows |
| Scale | `npm run test:scale` | 25 humans, 100 agents, 100 000 tasks, 20 000 comments, 2 000 documents |
| Compose | `tests/compose/smoke.sh` | Image build, web shell, readiness, persistence, backup/restore in container |
| Compose HTTPS | `tests/compose/smoke-https.sh` | Caddy profile: opt-in, domain required, config valid, sign-in and live updates over HTTPS |

### Performance budgets (100 000-task envelope)

p95 over 25 sequential requests on an Apple Silicon laptop (Node 24, release candidate build).
Budgets are enforced by `npm run test:scale`.

| Operation | p50 ms | p95 ms | Budget p95 ms |
|---|---:|---:|---:|
| List tasks (filtered, sorted) | 21 | 102 | 250 |
| List tasks, third page via cursor | 9 | 10 | 250 |
| Board (6 columns × 50) | 60 | 65 | 800 |
| My tasks | 24 | 25 | 250 |
| Full-text search | 7 | 17 | 400 |
| `get_task_context` (MCP) | 3 | 3 | 300 |
| `list_tasks` (MCP) | 12 | 18 | 300 |
| Recent activity | 2 | 2 | 150 |
| Create task | 3 | 7 | 150 |
| Update task | 3 | 3 | 150 |

Server RSS after the run: ~200 MB (limit 512 MB). Backup of the scale database: ~2 s; export
(100 000 Markdown task files): ~11 s; restore: ~6 s.

## Known limitations

- Single workspace and a single application instance per database; no replicas or HA.
- Last write wins on concurrent edits; there is no merge or conflict UI (activity history and
  document revisions show what changed).
- Full-text search is substring-based (trigram); terms shorter than three characters fall back to a
  slower scan. No semantic search.
- No notifications, webhooks or functional @mentions; no file attachments.
- The internal `/api` used by the web client is not a supported public API — integrate through MCP.
- Migrations are forward-only; roll back by restoring a backup taken before the upgrade.
- Comments cannot be edited or archived yet.

## Upgrade notes

First release — no upgrade path needed. Future upgrades: back up, deploy the new version, and the
server migrates at startup (see [operations.md](operations.md#upgrade)). The stdio adapter and the
skill must match the server's minor version while Alice is 0.x.
