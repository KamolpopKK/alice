# Alice Client API v1

The Client API is the supported contract for first-party human clients: the Web dashboard, Alice Desktop
and the `alice` CLI. AI agents keep using [MCP](mcp.md). Both interfaces call the same domain services, so
validation, actor attribution, activity history and live invalidation are identical.

- Base path: `/client/v1`
- Shared schemas: `src/shared/contracts.ts`
- Typed client: `src/client` (`AliceClient` plus a transport per surface)

## Discovery and compatibility

`GET /client/v1/info` needs no credentials and returns no workspace data:

```json
{
  "product": "alice",
  "name": "Alice",
  "serverVersion": "0.2.0",
  "publicUrl": "https://alice.example.com",
  "clientApi": { "current": 1, "minimum": 1, "prefix": "/client/v1" },
  "capabilities": ["projects", "tasks", "documents", "comments", "relationships", "activity", "search", "admin", "idempotency", "events.resume", "device-auth", "client-sessions", "task-pads", "saved-views", "project-planning", "approvals"],
  "events": { "retentionHours": 24, "maxReplay": 1000 }
}
```

Clients send these headers with every request:

| Header | Purpose |
|---|---|
| `Alice-Client-Api: 1` | The protocol version the client speaks. Outside `minimum..current` the server answers `426 CLIENT_INCOMPATIBLE` before running any handler. |
| `Alice-Client: alice-cli/0.2.0` | Product and version, for diagnostics only. |

`CLIENT_INCOMPATIBLE` details are `{ clientApiVersion, minimum, current, upgrade: "client" | "server" }`, so a client
can say which side needs an upgrade. Protocol versions are independent of application versions: a server upgrade
that keeps `minimum` unchanged does not require any client update.

## Authentication

| Client | Credential | CSRF |
|---|---|---|
| Web | `alice_session` HttpOnly cookie | Mutations require `x-csrf-token` from sign-in or `GET /auth/me`. A foreign `Origin` is rejected. |
| Desktop, CLI | `Authorization: Bearer <access credential>` from the device flow ([device-auth.md](device-auth.md)) | Not used. Bearer requests carry no cookies. |

Agent tokens (`alice_at_…`) are refused on the Client API with `401 UNAUTHENTICATED`. Agents use MCP.

## Resources

All routes are below `/client/v1`. Bodies and queries use the shared zod schemas.

| Area | Routes |
|---|---|
| Auth | `GET /auth/state`, `POST /auth/bootstrap`, `POST /auth/login`, `POST /auth/logout`, `GET /auth/me` |
| Invites (owner) | `GET/POST /invites`, `POST /invites/:id/revoke`, `POST /invites/check`, `POST /invites/accept` |
| Actors and agents | `GET /actors`; owner only: `GET/POST /agents`, `POST /agents/:id/tokens`, `POST /agents/:id/deactivate`, `POST /agent-tokens/:id/rotate`, `POST /agent-tokens/:id/revoke` |
| Projects | `GET/POST /projects`, `GET/PATCH /projects/:id`, `POST /projects/:id/archive`, `POST /projects/:id/restore` |
| Approvals | `GET /approvals?status=&taskId=&for=me`, `GET /approvals/:id`, `POST /tasks/:id/approvals`, `POST /approvals/:id/approve\|reject\|cancel`; see [Approval requests](#approval-requests) |
| Project planning | `GET /projects/:id/members`, `PUT/DELETE /projects/:id/members/:actorId`, `GET/POST /projects/:id/milestones`, `PATCH/DELETE /milestones/:id`, `GET /projects/:id/progress`; see [Project planning](#project-planning) |
| Tasks | `GET/POST /tasks`, `GET/PATCH /tasks/:id`, `POST /tasks/:id/claim`, `POST /tasks/:id/archive`, `POST /tasks/:id/restore`, `GET /tasks/:id/activity` |
| Discussion | `GET/POST /tasks/:id/comments`, `POST /tasks/:id/complete`, `GET /tasks/:id/context` |
| Relationships | `GET /tasks/:id/relations`, `PUT /tasks/:id/parent`, `POST /tasks/:id/blockers`, `DELETE /tasks/:id/blockers/:blockerId` |
| Documents | `GET/POST /documents`, `GET/PATCH /documents/:id`, `POST/DELETE /documents/:id/review`, `GET/POST/DELETE /documents/:id/relations`, archive/restore, revisions, Task/Project links and activity |
| Workspace | `GET /board`, `GET /search`, `GET /activity`, `GET /events` |
| Task Pads (owner only) | See [Task Pads](#task-pads) |
| Saved views (owner only) | `GET/POST /saved-views`, `DELETE /saved-views/:id`; see [Saved views](#saved-views) |

Lists use keyset pagination: `{ items, nextCursor }`. Pass `cursor=<nextCursor>` until it is `null`. `limit`
is between 1 and 200. Resource ids are opaque server-generated strings; client-supplied ids are never accepted.

### Document knowledge

Documents expose `tags`, `searchKeywords`, `status`, `owner`, `reviewedAt`, `reviewedBy` and
`reviewedRevision`. List/search filters accept repeatable `tag`, `status`, `ownerId` (`none` means
unassigned) and `projectId`. A text query searches title, keywords, tags, body and source URL and returns
`match: { field, value?, excerpt }`; ranking prefers title/keyword/tag matches and current documents, but
explicit non-current matches are still returned. This is lexical trigram search, not semantic search.

Review mutations require `{ expectedRevision, markCurrent? }`; delete-review requires
`{ expectedRevision }`. A stale revision is `409 CONFLICT`. Typed relations use `{ targetId, type }` with
`references | related | supersedes`; supersedes additionally requires `acknowledgeSupersedes: true` and
atomically marks the target `superseded`. Removing that relation does not restore the target's old status.
Task/Project links under `/links` remain separate, untyped relationships.

## Errors

Every error is `{ "error": { "code", "message", "details?" } }` with a stable code from `src/shared/errors.ts`.
`src/client/errors.ts` groups the codes into recovery classes: `usage`, `auth`, `not_found`, `compatibility`,
`network` and `internal`. The CLI uses these classes as exit codes.

## Idempotency

Retryable mutations accept `Idempotency-Key: <8–128 chars of [A-Za-z0-9_.:-]>`. The server keeps the key for
24 hours by default (`ALICE_IDEMPOTENCY_RETENTION_HOURS`), scoped to the authenticated session.

- Same key, same method, same route and same body: the server returns the original status and body, with
  `Idempotent-Replayed: true`. No new activity is recorded.
- Same key with a different request: `409 IDEMPOTENCY_CONFLICT`.
- A failed request (non-2xx) is forgotten, so a retry with the same key runs again.

`AliceClient` adds a key to creates, archive/restore, comments, completion, links and blockers. It retries
those, and reads, on network failure. It never retries a mutation that has no key.

## Live invalidation events

`GET /client/v1/events` is a Server-Sent Events stream. It sends invalidations, never resource data:

```
id: 42
event: invalidate
data: {"position":42,"activityId":"act_…","kind":"task","id":"tsk_…","mutation":"task.updated"}
```

| Event | Meaning |
|---|---|
| `ready` | The stream is live. `data.position` is the current position. |
| `invalidate` | One affected resource. Refetch it, and any lists that contain its kind. |
| `reset` | The requested position cannot be replayed. Refetch everything shown, then continue from `data.position`. `reason` is `position_expired`, `position_ahead_of_server` (for example after a restore) or `too_many_events` (more than `maxReplay`). |
| `unauthorized` | The session was revoked or expired. The stream closes. |

Private Task Pad changes use the kinds `pad` and `pad_block`. They are delivered and replayed only to sessions of
the Pad's owner, carry `activityId: null`, and include `origin` (the client `mutationId` that caused the
change) when the writer sent one, so a client can tell its own acknowledgement from a write on another device.
Other actors never see these positions; their streams simply skip them.

Resume with `Last-Event-ID: <position>` (EventSource sends this automatically) or `?after=<position>`. The
header wins when both are present. Positions are kept for `ALICE_CLIENT_EVENT_RETENTION_HOURS` (default 24).
They live in the database, so they survive a server restart.

## Approval requests

Capability `approvals`. Before going on with a task, someone (usually an agent) can ask a person to approve
something.

- **Asking.** `POST /tasks/:id/approvals` takes `{ question, requestedOfId? }`.
  - `requestedOfId` names one active person.
  - Without it, anyone may decide.
  - Archived tasks answer `INVALID_STATE`.
- **Deciding.** `POST /approvals/:id/approve` and `POST /approvals/:id/reject` take an optional `{ note }`.
  - Only people decide.
  - The one who asked never decides.
  - A request that names a person can be decided by that person or the workspace owner.
- **Withdrawing.** `POST /approvals/:id/cancel` withdraws a pending request; only the one who asked can do this.
- **After a decision.** A decided request cannot change again (`INVALID_STATE`).
- **What waits for you.** `GET /approvals?for=me` lists the pending requests the signed-in person may decide.
  This is what Home shows under **Waiting for you**.
- **Activity.** Each step is recorded in the task's activity (`approval.requested`, `approval.approved`, …)
  under whoever took it.

## Project planning

Capability `project-planning`. These routes add planning to projects without changing access.

- **Dates.** `PATCH /projects/:id` also accepts `startDate` and `targetDate` as `YYYY-MM-DD`; `null` clears a
  date. The target cannot be before the start (`VALIDATION_ERROR`).
- **Members.** `PUT` and `DELETE /projects/:id/members/:actorId` add or remove a person or an agent. Membership
  is informational: every workspace member can still see and change every project. Both answer `{ members,
  changed }`, with `changed: false` when nothing needed to change. A deactivated account cannot be added.
- **Milestones.**
  - `POST /projects/:id/milestones` takes `{ title, dueDate? }`.
  - `PATCH /milestones/:id` takes `{ title?, dueDate?, completed? }`; `completed: false` reopens.
  - Lists come in date order, with undated milestones last.
- **Progress.** `GET /projects/:id/progress` returns `{ total, done, canceled, open }` for tasks that are not
  archived.
- **Archived projects.** Changes to the members or milestones of an archived project answer `INVALID_STATE`.

Every change is recorded in activity on the project (`project.member_added`, `project.milestone_completed`, …)
with the person or agent who made it. Agents read the plan with the MCP tool `get_project_plan` and set
dates with `update_project`.

## Saved views

Capability `saved-views`. A saved view is one person's named Tasks view: the view (`my-work`, `board` or
`list`) and the rest of the Tasks query string (filters, search, sort). Views are private to the human who
saved them and exist only under `/client/v1`; agents cannot use them, and they never appear in activity or
search. Changes notify only the owner's own sessions (`saved_view` events).

| Route | Purpose |
|---|---|
| `GET /saved-views` | The signed-in person's views, sorted by name. |
| `POST /saved-views` | `{ name, view, query? }`. A view with the same name is replaced, so a name always means one view. |
| `DELETE /saved-views/:id` | Removes one of your views. Another person's id answers exactly like an unknown id (`404 NOT_FOUND`). |

Older servers without the capability keep saved views in the browser instead; the web app moves them to the
server the first time it connects to one that supports them.

## Task Pads

Capability `task-pads`. Pads are private capture spaces of one human. Every route resolves the owner from the
session; another human's Pad id answers exactly like an unknown id (`404 NOT_FOUND`). Pads exist only under
`/client/v1` (there is no `/api` route, MCP tool, CLI command or agent access), and Pad changes never appear in
workspace activity or workspace search.

| Route | Purpose |
|---|---|
| `GET /pads?archived=active\|archived\|all` | Pinned Pads first, then most recently updated (archived listing: newest archived first). Paginated. |
| `POST /pads` | `{ name, defaultProjectId?, defaultStatus?, defaultAssigneeId? }`. Names are non-empty, up to 200 characters and need not be unique. |
| `GET/PATCH /pads/:padId` | Read; rename, `pinned`, defaults (`null` clears). Defaults only affect tasks created later. |
| `POST /pads/:padId/archive`, `POST /pads/:padId/restore` | Archive is the normal way to retire a Pad. Archived Pads reject block edits. |
| `DELETE /pads/:padId` | Body `{ "confirm": true }`. Permanently deletes the Pad and its private blocks; referenced tasks are untouched. |
| `GET /pads/:padId/blocks` | Blocks in document order with `depth`, plus `mentions` (current title/status of mentioned tasks). Paginated (default 200). |
| `POST /pads/:padId/blocks` | `{ type: "text"\|"heading"\|"task", parentId?, afterId?, content? }`. `afterId` is the sibling to insert after; omitted = first child. |
| `PATCH /pads/:padId/blocks/:blockId` | `content` (Text/Heading), `collapsed` (Heading). |
| `POST /pads/:padId/blocks/:blockId/move` | `{ parentId?, afterId? }`. Moves the block with everything nested in it. |
| `POST /pads/:padId/blocks/:blockId/convert` | `{ type }`. |
| `DELETE /pads/:padId/blocks/:blockId` | `{ mode: "promote" }` (default) lifts children one level; `{ mode: "subtree" }` removes nested blocks too. |
| `POST /pads/:padId/blocks` with `type: "task"` | `{ title }` creates a task with the Pad defaults (otherwise Untitled, Backlog, unassigned, no priority) and its Task block in one transaction. `{ taskId }` places an existing task; if it already has a Task block anywhere, a Text block with a mention is created instead. |
| `PATCH /pads/:padId/blocks/:blockId` (Task) | `{ title?, description? }` update the authoritative task (normal `task.updated` activity). |
| `POST /pads/:padId/blocks/:blockId/complete`, `/reopen` | Done from the Pad remembers the previous status; Reopen restores it (Backlog when none is valid). |
| `POST /pads/:padId/blocks/:blockId/turn-into-description` | `{ targetTaskId }`. Appends `- <title>` to the target's description and removes the source Task block. The source task is not archived. |
| `POST /pads/:padId/blocks/bulk` | `{ titles: string[], mutationId, parentId?, afterId? }`. Blank lines are ignored; every title is validated first (`details: [{ line, message }]`); all tasks and blocks commit together or not at all. |
| `POST /pads/:padId/undo-task-capture` | `{ blockIds }`. Archives those blocks' tasks and removes the blocks atomically (Undo of capture). |
| `POST /pads/:padId/remove-completed` | Removes Task blocks whose task is Done; the tasks are unchanged. |
| `GET /pad-task-search?q=` | Active tasks by title or id prefix for `@`. `placed` tells whether a Task block exists; `placement` is filled only for the requester's own Pads. |
| `GET /pad-search?q=` | Owner-only search of Pad names, Text, Heading and Task titles. Results carry `ancestorIds` to expand collapsed sections. |
| `GET /pads/export` | The requesting human's Pads (hierarchy, segments, task references) as `alice-pad-export` v1 JSON. |

Text and Heading content is an array of segments: `{ "type": "text", "text": "…" }` and
`{ "type": "mention", "taskId": "tsk_…" }`. Mentions store the immutable task id; labels come from current task
data. Control characters are removed and Heading text is a single line.

Hierarchy rules, enforced on every write: at most four levels; a parent must be in the same Pad; no cycles; Task
blocks are leaves (nothing nests under a Task, so a Task can never sit under a Task — group tasks under a Heading
or Text instead). Violations answer `409 INVALID_RELATIONSHIP` or `409 RELATIONSHIP_CYCLE`.

Task blocks reference one authoritative task (a task has at most one Task block across all Pads). Converting a
Task block to Text or Heading keeps its visible title and leaves the task untouched; converting Text or Heading to
Task creates a new task with the Pad defaults. Task changes made from a Pad record ordinary task activity with
`data.source = "task_pad"` and `data.padId`; private Text and Heading content never appears in activity.

Pad mutations accept an optional `mutationId` (8–128 characters of `[A-Za-z0-9_.:-]`). The first accepted result
is stored for the owner for at least seven days; an identical retry returns it unchanged and a different request
with the same id answers `409 IDEMPOTENCY_CONFLICT`. Concurrent edits of one block are last-write-wins in server
arrival order; each block carries `revision` and `lastMutationId`.

## Rate limits

Client API requests are limited per session, or per address when anonymous, by `ALICE_CLIENT_RATE_LIMIT`
(default 1200 per minute). This is separate from the password limit (`ALICE_AUTH_RATE_LIMIT`), the device
authorization limit and the MCP limit (`ALICE_MCP_RATE_LIMIT`).

## Compatibility and deprecation policy

| Component | Versioned by | Compatibility rule |
|---|---|---|
| Server | Release (`0.2.0`) | Serves Client API `minimum..current` and MCP contract v1 |
| Web | Ships inside the server | Always matches its server |
| Desktop, CLI | Their own release | Speak one Client API version. They work with any server whose range includes it. |
| MCP adapter, Agent skill | Their own release | Need MCP contract v1 |

- **Additive changes** (new routes, fields, capabilities, error codes) ship within `v1` at any time.
  Clients ignore what they do not know. `tests/fixtures/client-v1-contract.json` freezes the fields
  released v1 clients rely on, and `tests/system/client-compat.test.ts` fails if any is removed or renamed.
- **Breaking changes** need `/client/v2`. A server then serves `v1` and `v2` side by side. It raises
  `minimum` to 2 no earlier than **two minor releases** after shipping `v2`, and announces the date in the
  changelog. Until then, old clients keep working. Clients that are too old or too new get
  `426 CLIENT_INCOMPATIBLE` with `upgrade: "client" | "server"`.
- **Diagnostics.** `alice version` prints the CLI, Client API, server, Desktop, adapter and skill
  versions. `alice-server version` prints the server, Client API range, MCP contract and schema.
  `alice-mcp-stdio --version` prints the adapter and its MCP contract. Desktop shows its own version on the
  server screen and the server's version under **Test**. None of these print credentials.

## Compatibility window for `/api`

The legacy internal routes under `/api/*` and the `/api/events` stream still serve the same handlers.
Every response carries:

```
Deprecation: true
Link: </client/v1/<same path>>; rel="successor-version"
Alice-Removal: 0.4.0
```

First-party clients no longer use `/api`: the Web moved in 0.2.0, and Desktop and the CLI never used it.
**`/api` will be removed in Alice 0.4.0.** New integrations must use `/client/v1` (humans) or MCP
(agents).
