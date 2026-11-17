# Local workspaces

Install: follow [Get started → Use Alice on your Mac](../README.md#1-use-alice-on-your-mac-no-server) (one command, or the DMG with a one-time approval).

A Local workspace is a private Alice workspace on this computer account. It needs no server, URL,
password or sign-in. Alice Desktop creates `Personal` on first launch. The `alice` CLI and your agents
work in the same workspace, even while Desktop is closed.

Each Local workspace has its own database under the application-data folder:

| Platform | Folder |
|---|---|
| macOS | `~/Library/Application Support/Alice` |
| Linux | `$XDG_DATA_HOME/alice` (`~/.local/share/alice`) |
| Windows | `%APPDATA%\Alice` |

`ALICE_HOME` overrides the folder.

A hidden Alice daemon serves one Local workspace. It is the only process that opens that workspace's
database. Desktop or the CLI starts it on demand. A daemon started only by the CLI stops after ten idle
minutes.

The daemon is not a web server you browse to:
- it listens on a random loopback port;
- it rejects browser requests;
- every call needs a capability that Alice keeps in the OS credential store (Keychain on macOS).

See [CLI → Workspaces](cli.md#workspaces) for choosing workspaces from the terminal.

## Backups

Alice backs up every Local workspace on its own:

- **Before every schema migration.** If this backup cannot be made and verified, the workspace stays
  closed. A failed migration rolls back its transaction and leaves a recovery record.
- **Once a day.** On the first opening of a calendar day after the data changed.

Each backup is a SQLite copy with a `manifest.json` (checksum, schema and versions). Every backup is
verified before it counts. Alice keeps 7 daily and 3 pre-migration backups per workspace, and never
removes a backup that a restore is using.

```bash
alice workspace backup                       # one more, now
alice workspace backups                      # list them
alice workspace restore --from BACKUP_DIR    # restore as a NEW workspace (new id and alias)
alice workspace restore wsp_… --latest --replace --confirm "Personal"
```

- **Replace restore** needs the exact id and the typed name. It stops the daemon, backs up the current
  data (`pre-restore-…`), and keeps the old files aside.
- **Restore checks the backup first.** A corrupt, newer-schema or modified backup is refused before
  anything changes.
- **Workspaces are never merged.**

## Deleting a workspace

```bash
alice workspace delete side --confirm "Side projects"
```

Delete needs the workspace as an argument and the typed name. It stops the daemon, takes the lock and
moves the whole folder to the OS Trash (macOS and Linux). Emptying the Trash is up to you.

## Doctor and repair

`alice doctor` changes nothing. It checks:

- the runtime and launcher;
- versions and agent skills;
- the registry and aliases;
- file permissions and the credential store;
- each workspace's daemon, health, SQLite integrity and schema;
- integrations and backup recency.

`alice doctor --repair` lists what it would fix and applies the fixes after you confirm. It can tighten
permissions, remove stale daemon files, reinstall the launcher and refresh skills. It never restores a
database.

`alice doctor --bundle DIR` shows the files it will write, then writes redacted diagnostics: the doctor
report, versions and daemon logs. The bundle contains no database, task text, credentials or
home-folder paths.

If a workspace cannot open, Alice Desktop shows a recovery screen with these actions:
- Try again
- Diagnostics
- Restore latest backup (after confirmation)
- Open data folder
- Switch workspace

## The Local runtime and the `alice` launcher

Alice Desktop carries a **Local runtime**: the official Node.js binary pinned in `package.json`
(`alice.runtimeNode`), the bundled `alice-server.js` and `alice.js`, the matching `better_sqlite3.node`,
and a `manifest.json` with the SHA-256 of every file. Local workspaces need no system Node.js.

```
<app data>/runtime/0.3.0/      node, alice.js, alice-server.js, better_sqlite3.node, manifest.json
<app data>/runtime/current  -> 0.3.0   (switched atomically with rename)
<app data>/runtime/previous -> 0.2.0   (kept for rollback)
~/.local/bin/alice                     small shell launcher that runs runtime/current
```

On startup Alice Desktop installs and activates the runtime it carries:

1. **Copy.** It copies the runtime into a new version folder and checks every checksum before the folder
   becomes visible.
2. **Wait for work.** If a Local workspace is running a CLI command, a backup or a migration, the switch
   waits. Running work is never cut off.
3. **Switch.** It stops idle daemons gracefully and moves `current` atomically.
4. **Check.** It reopens the workspaces that were open. Each one gets a pre-migration backup and a
   migration under the new runtime, then a health check.
5. **Roll back on failure.** If a workspace fails to open, `current` goes back to the previous runtime.
   If the database moved past what the previous runtime understands, Alice restores the pre-migration
   backup. The workspace then reopens on the previous runtime.

Desktop and runtime versions must match exactly. A mismatch shows Repair/Update instead of opening the
workspace.

The launcher never needs rewriting when the runtime updates. If Alice Desktop is removed, the launcher
and the installed runtime keep working. `alice workspace status` and `alice doctor` then explain that
updates are no longer managed.

Build a runtime yourself:

```bash
npm run build:runtime                                    # downloads the pinned Node.js and checks SHASUMS256.txt
node scripts/runtime-build.mjs --node "$(which node)"    # development: use the Node you have
```

## What protects a Local workspace

- **Your operating-system account.** Only your account can read the files (owner-only permissions) or
  use the credentials (Keychain). Turn on FileVault (or your platform's disk encryption) to protect the
  data at rest; Alice adds no database encryption of its own.
- **Network.** The daemon listens on a random `127.0.0.1` port. It answers health checks without a
  credential and with no data. Everything else needs a capability that only Alice Desktop, your
  `alice` command and your enabled agents can read.
- **Browsers.** Requests with an `Origin` header or a non-loopback `Host` are refused, and there is no
  CORS. Login, device sign-in, invitations, downloads and MCP do not exist on a Local daemon.
- **Agents.** Each agent acts under its own name with agent rules:
  - claim before working;
  - complete with a summary;
  - no owner settings.

  Disabling an agent revokes it at once.
- **Privacy.** Alice sends no telemetry. Logs keep seven days and record only request metadata.
  Diagnostic bundles leave out databases, task text, credentials and home-folder paths.

## Troubleshooting

| Symptom | What to do |
|---|---|
| "Several workspaces exist and none is selected" | Pass `--workspace ALIAS`, run `alice workspace use ALIAS`, or bind the project with `alice workspace bind ALIAS`. |
| A workspace "could not open" in Desktop | **Try again**, then **Diagnostics**. If the database is damaged or an upgrade failed, use **Restore latest backup**; current data is backed up first. |
| `CLIENT_INCOMPATIBLE` / "runs Alice X but Desktop is Y" | Desktop, runtime and CLI must be the same release. Update or reinstall Alice Desktop, then `alice doctor`. |
| An agent gets `UNAUTHENTICATED` | Its integration is disabled or its credential is missing. Re-enable it with `alice integration enable codex`. |
| "the Alice runtime is missing" from `alice` | Reinstall Alice Desktop, then `alice doctor --repair`. |
| Stale lock or locator after a crash | Usually cleaned automatically. Otherwise `alice doctor --repair` removes them after a preview. |
| Something else | `alice doctor`, then share `alice doctor --bundle DIR` if you need help. |

## Not part of Local workspaces

These are intentionally out of scope:
- synchronisation with Remote servers;
- sharing a Local workspace with other people or computers;
- browser access;
- MCP setup for Local agents;
- Windows, Linux or Intel Mac installers;
- application-level database encryption;
- merge restore;
- cloud backup;
- telemetry.

Use a Remote Alice server for teamwork.
