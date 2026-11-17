# Architecture

```
          ┌──────────── people ────────────┐            ┌── agents ──┐
  Web (browser)     Alice Desktop (Tauri)     alice CLI      MCP clients / alice-mcp-stdio
   cookie+CSRF      Rust core: bearer, SSE     bearer          bearer agent token
        │                 │                      │                  │
        └────── /client/v1 (Human Client API) ───┘               /mcp/v1
                               │                                    │
                     ┌─────────┴────────── Alice Server ───────────┴──────────┐
                     │  Fastify routes → domain services (src/server/domain)   │
                     │  one transaction per mutation: change + activity event  │
                     │  + positioned client event; SSE fan-out after commit    │
                     └──────────────────────────┬──────────────────────────────┘
                                         SQLite (WAL), one instance
```

- **One source of truth.** Only Alice Server opens the database. Web, Desktop and the CLI are remote
  clients. They have no local database, offline queue or sync. Closing a client affects nothing else.
- **Two protocols, one domain.** People use the [Client API](client-api.md). Agents use
  [MCP](mcp.md). Both call the same domain services, so validation, attribution and history are
  identical. Human credentials are not accepted on MCP, and agent tokens are not accepted on the Client
  API.
- **Shared client core.** `src/client` holds the typed operations, error classes, retry and idempotency
  policy, and event semantics. The Web uses it with a cookie transport, the CLI with a Node bearer
  transport, and Desktop with a transport that forwards each call to Rust.
- **Desktop boundary.** The Rust core in `src-tauri` keeps profiles, keyring credentials, every HTTP
  request and the event stream. The WebView can call only the commands listed in the capability file. See
  [desktop.md](desktop.md).
- **Live updates.** Each mutation writes one `client_events` row per affected resource, inside its own
  transaction. Streams resume from those positions with `Last-Event-ID`. When a position has expired they
  send a `reset`. Clients always refetch rather than trust event payloads.
- **Sign-in for native clients.** A device flow approved in the web dashboard. Credentials are 15-minute
  access credentials plus rotating refresh credentials, and only hashes are stored. Replaying a refresh
  credential revokes the session. See [device-auth.md](device-auth.md).
- **Versioning.** Server releases, the Client API protocol, the MCP contract and client releases are
  versioned independently. See the [compatibility policy](client-api.md#compatibility-and-deprecation-policy).

| Path | Contents |
|---|---|
| `src/shared` | zod contracts, error codes, versions, deep-link grammar |
| `src/server` | server, domain services, migrations, MCP, operations, `alice-server` |
| `src/client` | shared typed client |
| `src/web` | React UI, shared by Web and Desktop (desktop-only shell in `src/web/desktop`) |
| `src/cli` | `alice` CLI, bundled to a single dependency-free file |
| `src-tauri` | Alice Desktop native core |
| `src/stdio` | MCP stdio adapter |
