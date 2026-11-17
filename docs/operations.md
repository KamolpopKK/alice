# Operating Alice

Alice is one Node process and one SQLite database (`alice.db`, WAL mode) in the data directory
(`/data` in Docker, the `alice-data` volume in Compose). Run exactly one instance per data
directory — the server refuses to start if another one holds `alice.pid`.

All commands below run with the same environment as the server. In Compose, prefix them with
`docker compose exec alice` (server running) or `docker compose run --rm alice` (server stopped).

## First-time setup

1. Start Alice and open `ALICE_PUBLIC_URL/setup`.
2. Enter the bootstrap token: the value of `ALICE_BOOTSTRAP_TOKEN`, or, if unset, the contents of
   `<data dir>/bootstrap-token` (written with mode `0600`; inside Docker:
   `docker compose exec alice cat /data/bootstrap-token`). The file is deleted once the owner exists.
3. Create the owner account. Bootstrap can only happen once.
4. From **Admin**, create one-time invite links for teammates (no email server needed) and create
   agent identities. Each agent token is shown exactly once; only its hash is stored. Tokens can be
   rotated or revoked at any time, and their last-used time is shown.

All members can read and write the whole workspace; only the owner manages invites, agents and
maintenance operations.

## Configuration

| Variable | Default | Notes |
|---|---|---|
| `ALICE_PUBLIC_URL` | `http://<host>:<port>` | **Required in production.** External origin users open. Must be `https://` unless it is localhost or `ALICE_ALLOW_INSECURE_HTTP=true`. |
| `ALICE_BOOTSTRAP_TOKEN` | generated | One-time secret for creating the owner account (≥ 24 chars). |
| `ALICE_DATA_DIR` | `./data` (`/data` in Docker) | Database and backups live here. |
| `ALICE_HOST` / `ALICE_PORT` | `127.0.0.1` / `8080` | Listen address. |
| `ALICE_TRUST_PROXY` | `false` | Set when behind a reverse proxy that sets `X-Forwarded-*`. |
| `ALICE_ALLOW_INSECURE_HTTP` | `false` | Permit a plain-http public URL in production on a private network. |
| `ALICE_LOG_LEVEL` | `info` | Secrets are redacted from logs. |
| `ALICE_AUTH_RATE_LIMIT` | `20` | Sign-in/bootstrap/invite attempts per IP per minute. |
| `ALICE_MCP_RATE_LIMIT` | `600` | MCP requests per token per minute. |
| `ALICE_CLIENT_RATE_LIMIT` | `1200` | Client API requests per session (Web, Desktop, CLI) per minute. |
| `ALICE_DEVICE_RATE_LIMIT` | `60` | Device sign-in requests, polls and code checks per address per minute. |
| `ALICE_CLIENT_EVENT_RETENTION_HOURS` | `24` | How long live-update positions can be resumed. |
| `ALICE_IDEMPOTENCY_RETENTION_HOURS` | `24` | How long retried mutations are recognised. |
| `ALICE_DOWNLOADS_DIR` | `dist/downloads` | Standalone `alice.js` and `alice-mcp-stdio.js` served under `/downloads/`. |

Invalid security-sensitive configuration stops startup with a message naming the variable (values are
never printed).

`compose.yaml` also reads these from `.env`:

| Variable | Default | Notes |
|---|---|---|
| `ALICE_VERSION` | the release it came with | Server image tag; change it to upgrade or roll back. |
| `ALICE_BIND` / `ALICE_HTTP_PORT` | `127.0.0.1` / `8080` | Host address and port for Alice itself. |
| `ALICE_DOMAIN` | — | Domain for the `https` profile (Caddy). |
| `ALICE_HTTPS_PORT` / `ALICE_HTTPS_REDIRECT_PORT` | `443` / `80` | Host ports Caddy publishes. Keep the defaults for Let's Encrypt. |

## Server image

Releases publish `ghcr.io/kamolpopkk/alice` for `linux/amd64` and `linux/arm64`:

| Tag | Meaning |
|---|---|
| `:<version>` (e.g. `:0.2.0`) | That release. Pushed when the release is tagged; never changes afterwards. |
| `:latest` | The latest *published* release. Moves only when a release is published. |

`compose.yaml` runs `ghcr.io/kamolpopkk/alice:${ALICE_VERSION}`, so the version in `.env` decides what
runs. You need only `compose.yaml` and `.env`; no checkout. To build the image yourself from a checkout
instead, run `docker compose build` (or `docker compose up -d --build`).

## HTTPS

Desktop and the CLI sign in by opening `ALICE_PUBLIC_URL` in a browser, so a team server needs a trusted
`https://` address.

### Automatic HTTPS (bundled Caddy)

`compose.yaml` includes an optional Caddy proxy in the `https` profile. It gets and renews a Let's Encrypt
certificate on its own.

1. Point your domain's DNS at this host, and open ports **80** and **443** (TCP, and UDP 443 for HTTP/3).
2. In `.env`:

   ```bash
   ALICE_DOMAIN=alice.example.com
   ALICE_PUBLIC_URL=https://alice.example.com
   ALICE_TRUST_PROXY=true
   ```

3. Start both services:

   ```bash
   docker compose --profile https up -d
   docker compose logs -f caddy      # watch the certificate being issued
   ```

Certificates live in the `caddy-data` volume. Alice itself stays bound to `127.0.0.1`; only Caddy is
reachable from outside. Without `ALICE_DOMAIN` the proxy refuses to start and says so. Always pass
`--profile https` to later `up`, `pull` and `down` commands too.

### Your own reverse proxy

Skip the profile and point your proxy at `127.0.0.1:8080` (`ALICE_BIND`/`ALICE_HTTP_PORT` in `.env`).
Alice needs:

- `ALICE_PUBLIC_URL=https://<your domain>` and `ALICE_TRUST_PROXY=true`;
- `X-Forwarded-For`, `X-Forwarded-Proto` and `Host` passed through;
- **no buffering** of `text/event-stream` responses (live updates) and long read timeouts for them;
- request bodies up to 2 MiB.

nginx example:

```nginx
location / {
    proxy_pass http://127.0.0.1:8080;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_buffering off;          # live updates
    proxy_read_timeout 1h;
    client_max_body_size 2m;
}
```

## Health

| Endpoint | Meaning |
|---|---|
| `GET /livez` | Process is up. |
| `GET /readyz` | `200 {"status":"ready","schemaVersion":N}` when SQLite answers and every migration is applied; `503` otherwise. |

The Docker image's `HEALTHCHECK` uses `/readyz`.

## Backup

```bash
docker compose exec alice alice-server backup                     # -> /data/backups/alice-<time>/
docker compose exec alice alice-server backup --out /data/backups/before-upgrade
```

Backups are consistent while Alice runs (SQLite online backup API). Each backup directory holds
`alice.db` and `manifest.json` (app/schema version, SHA-256, row counts). Copy backup directories
off the host, e.g. `docker compose cp alice:/data/backups ./alice-backups`.

Backups contain every table, including private Task Pads (`pads`, `pad_blocks` and their private search
index). Treat backup files as installation-sensitive data: they hold personal notes that the application
shows only to their owner.

## Restore

Restore only into a stopped installation:

```bash
docker compose stop alice
docker compose run --rm alice alice-server restore --from /data/backups/alice-<time> --replace-existing
docker compose start alice
curl -fsS http://127.0.0.1:8080/readyz
```

Restore verifies the manifest checksum, schema compatibility and SQLite integrity *before* touching
anything. A corrupted/modified backup, a backup from a newer Alice, or a running server leaves the
target unchanged and prints what to do. The previous database is moved to
`/data/pre-restore-<time>/`, never deleted. Older backups are migrated to the current schema during
restore.

## Command surface

Server lifecycle and database operations belong to `alice-server`:

| Command | Purpose |
|---|---|
| `alice-server serve` | Run the web, Client API and MCP server |
| `alice-server migrate` | Apply pending migrations and exit |
| `alice-server version [--json]` | Server version, Client API range, MCP contract and schema version |
| `alice-server backup` / `restore` / `export` / `purge` | See the sections below |

**Compatibility period.** `alice serve`, `alice migrate`, `alice backup`, `alice restore`, `alice export` and
`alice purge` (and `node dist/cli.js …`) still work in 0.2.x and 0.3.x. They forward unchanged to
`alice-server` and print a deprecation notice on stderr. **They will be removed in Alice 0.4.0.** Update
scripts, cron jobs and runbooks to `alice-server`. In the Docker image, both commands are on `PATH`.

## Upgrade

1. `docker compose exec alice alice-server backup --out /data/backups/before-<version>`
2. Set `ALICE_VERSION=<new version>` in `.env`, then `docker compose pull && docker compose up -d`.
   From a checkout that builds its own image: `git pull`, then `docker compose up -d --build`.
3. The new server applies pending migrations at startup (each migration is transactional and
   checksummed) and `/readyz` reports the new `schemaVersion`.

**0.1 → 0.2.** This upgrade applies migrations 9 and 10:

- the resumable client event feed and idempotency records;
- device authorizations and Desktop/CLI sessions.

Nothing else changes for existing users:
- web sessions stay valid;
- agent tokens, MCP clients (remote and stdio), installed skills, backups and exports keep working.

The web dashboard now uses `/client/v1`. The old `/api` routes still answer and carry a `Deprecation`
header naming their replacement (see [client-api.md](client-api.md#compatibility-and-deprecation-policy)).
To let people use Alice Desktop and the CLI, make sure `ALICE_PUBLIC_URL` is the `https://` origin people
open, so that device approval links work.

## Rollback

Migrations are forward-only. To roll back, set `ALICE_VERSION` back to the previous version and restore
the backup taken in step 1 of the upgrade:

```bash
docker compose stop alice
docker compose run --rm alice alice-server restore --from /data/backups/before-<version> --replace-existing
docker compose up -d
```

A newer database is refused by an older build (`schema vN is newer than this build`), so you cannot
accidentally run old code against upgraded data.

**Rolling back 0.2 → 0.1.** After restoring the pre-upgrade backup, Desktop and CLI sessions no longer
exist, because 0.1 has no Client API. Desktop and the CLI report the server as incompatible: Client API
missing. Web users are unaffected, apart from signing in again if their session was created after the
backup. Desktop and CLI users sign in again once you upgrade back.

## Export

```bash
docker compose exec alice alice-server export --out /data/exports/$(date +%F)
```

Produces `workspace.json` (all entities: actors, projects, tasks, relationships, comments,
documents, revisions, links, activity) and Markdown files under `documents/` and `tasks/` named
`<slug>--<id>.md` with JSON front matter. Passwords, sessions and token hashes are never exported.

Private Task Pads are not part of the workspace export. Each human exports their own Pads from the Web
dashboard (Task Pads → Export) or `GET /client/v1/pads/export`; tasks created from Pads are ordinary tasks and
are included here.

## Maintenance purge

Normal use never deletes data permanently. Old content can be removed only by the operator:

```bash
alice-server purge --before 2025-01-01 --revisions --archived --activity       # dry run: prints exact effects + a code
alice-server purge --before 2025-01-01 --revisions --archived --activity --execute --confirm <code>
```

- `--revisions`: superseded document revisions created before the cutoff (current revision kept).
- `--archived`: tasks, documents and empty projects archived before the cutoff, with their comments
  and links. Archived projects that still contain tasks are skipped. Task blocks in Task Pads that point
  at a purged task are removed, and Pad defaults that point at a purged project are cleared.
- `--activity`: activity events before the cutoff.

The confirmation code is a hash of the plan; if anything changed since the dry run, execution is
refused. The `Untitled` system project is never purged. The purge itself is recorded as a
`maintenance.purged` activity event attributed to the owner.

## Secrets

Configure secrets (`ALICE_BOOTSTRAP_TOKEN`) through `.env` or your orchestrator, never in committed
files. Logs redact authorization headers, cookies, CSRF tokens and invite tokens.
