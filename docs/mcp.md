# Alice MCP contract (v1)

Agents use Alice through a versioned [Model Context Protocol](https://modelcontextprotocol.io) endpoint.

| | |
|---|---|
| Endpoint | `POST <ALICE_PUBLIC_URL>/mcp/v1` (Streamable HTTP, stateless, JSON responses) |
| Auth | `Authorization: Bearer <agent token>` — create agents and tokens in **Admin** |
| Discovery | `GET <ALICE_PUBLIC_URL>/mcp` returns the endpoint and contract version |
| Rate limit | `ALICE_MCP_RATE_LIMIT` requests per token per minute (default 600) |

Every mutation is attributed to the agent identity behind the token. Mutation tools return the
complete, authoritative resource plus the `activityId` of the activity event they recorded.

## Errors

Tool failures are returned as MCP tool results with `isError: true` and a JSON body:

```json
{ "error": { "code": "CLAIM_FAILED", "message": "Task tsk_… cannot be claimed because it is already assigned to someone else", "details": { "status": "in_progress" } } }
```

| Code | Meaning | Typical recovery |
|---|---|---|
| `VALIDATION_ERROR` | Input failed schema validation (`details` lists fields) | Fix the arguments |
| `UNAUTHENTICATED` | Missing, invalid or revoked token (HTTP 401) | Ask the owner for a new token |
| `FORBIDDEN` | Operation is owner-only | Do not retry |
| `NOT_FOUND` | Resource or tool does not exist | Re-list and pick a valid id |
| `INVALID_STATE` | Operation not valid in the current state (archived task, archived destination project, agent marking done without `complete_task`) | Change state first or use the right tool |
| `CLAIM_FAILED` | Task is not `ready`, already assigned, or archived | Choose other work |
| `RELATIONSHIP_CYCLE` / `INVALID_RELATIONSHIP` | Parent/blocker change would create a cycle, self-link or duplicate | Pick another relationship |
| `PROTECTED_RESOURCE` | The `Untitled` system project cannot be renamed or archived | Do not retry |
| `RATE_LIMITED` | Too many requests (HTTP 429) | Back off |
| `INTERNAL_ERROR` | Unexpected server failure | Retry later |

## Tools

Pagination: list and search tools return `{ items, nextCursor }`; pass `nextCursor` back as `cursor`.
Ordering is deterministic.

### Identity
- `whoami` — the agent identity of the token.
- `list_actors { kind? }` — active humans and agents (for assignment).

### Projects
- `list_projects { archived? }`, `get_project { id }`
- `get_project_plan { id }` — start and target dates, members, milestones (date order) and task progress
  counts `{ total, done, canceled, open }`. Members are informational and grant no access.
- `create_project { name, description?, labels? }`, `update_project { id, name?, description?, labels?, startDate?, targetDate? }`
  — dates are `YYYY-MM-DD`; `null` clears; the target cannot be before the start.
- `archive_project { id }`, `restore_project { id }`

### Tasks
- `list_tasks { projectId?, status?, priority?, assigneeId?, label?, dueBefore?, dueAfter?, archived?, q?, sort?, order?, cursor?, limit? }`
  — array filters match any value; `assigneeId` accepts `"me"` and `"none"`. Relationship filters: `parentId` (children),
  `blockersOf` (tasks blocking the given task), `dependentsOf` (tasks the given task blocks).
- `get_task { id }`
- `create_task { title, description?, projectId?, status?, priority?, dueAt?, assigneeId?, labels?, parentId? }` — without
  `projectId` the task goes to `Untitled`.
- `update_task { id, ...fields }` — last write wins; `null` clears `assigneeId`/`dueAt`. Agents cannot set `done`.
- `archive_task { id }`, `restore_task { id }`
- `claim_task { id }` — atomic: only an unarchived, unassigned `ready` task; assigns the caller and moves it to `in_progress`.

### Documents
- `search_documents { q?, taskId?, projectId?, tag?, status?, ownerId?, archived?, cursor?, limit? }` — paginated
  summaries. With `q`, each result includes the best lexical `match` (`field`, optional exact `value`,
  highlighted `excerpt`). Search covers title, keywords, tags, body and source URL; it is not semantic/vector search.
- `get_document { id, offset?, maxChars? }` — body is windowed; `bodyWindow` reports `totalChars`,
  `truncated` and `nextOffset` for continuation.
- `create_document { title, body?, sourceUrl?, tags?, searchKeywords?, status?, ownerId? }` — needs a body or a source URL.
- `update_document { id, title?, body?, sourceUrl?, tags?, searchKeywords?, status?, ownerId? }` — content changes
  create a full immutable revision and clear a current review; metadata-only changes preserve both.
- `review_document { id, expectedRevision, markCurrent? }`, `clear_document_review { id, expectedRevision }` —
  stale revisions return `CONFLICT`. Status is `unreviewed | draft | current | superseded`; only review marks `current`.
- `list_document_relations { id, direction?, type?, cursor?, limit? }` — `references | related | supersedes`.
- `link_document_relation { id, targetId, type, acknowledgeSupersedes? }`,
  `unlink_document_relation { id, targetId, type }` — `related` is symmetric. `supersedes` requires
  `acknowledgeSupersedes: true` and marks the target superseded; unlinking does not restore its status.
- `archive_document { id }`, `restore_document { id }`
- `list_document_revisions { id, cursor?, limit? }`, `restore_document_revision { id, revision }` — restore creates a new revision.
- `link_document { id, taskId | projectId }`, `unlink_document { id, taskId | projectId }` — untyped many-to-many links;
  `changed: false` when nothing needed to change.

### Collaboration
- `get_task_context { id, maxChars?, commentLimit?, documentLimit?, relationLimit? }` — one bounded aggregate:
  task, project, parent, children, blockers, blocking, linked documents (with bodies) and the most recent comments.
  Shares of `maxChars` (default 40 000) are deterministic: task description ≤ 30 %, project description ≤ 10 %,
  comments ≤ 20 % (≤ 2 000 chars each), documents split the remainder. Every cut text or omitted item appears in
  `budget.truncations` as `{ path, kind, total, returned, continuation: { tool, args } }`.
- `add_comment { taskId, body }` — immutable, attributed; `@mentions` are plain text.
- `list_comments { taskId, order?, cursor?, limit? }`
- `complete_task { id, summary }` — summary required for agents; becomes a `completion_summary` comment referenced by
  the `task.completed` activity event. Status, completion time, comment and activity commit atomically.
- `request_approval { taskId, question, requestedOfId? }` — ask a person to approve before going on (a risky
  change, a spend, a decision not yours to make). Without `requestedOfId` anyone may decide. It shows under
  **Waiting for you** on Home. Only people decide, never the one who asked.
- `get_approval { id }`, `list_approvals { taskId?, status?, limit? }` — check the status (`pending`, `approved`,
  `rejected`, `canceled`), who decided and their `note`, and follow it.
- `cancel_approval { id }` — withdraw your own pending request.

### Relationships
- `get_task_relations { id }` — parent, children, blockers, blocking (archived tasks included with `archivedAt`).
- `set_task_parent { id, parentId | null }`
- `add_task_blocker { id, blockerId }` — `id` is blocked by `blockerId`.
- `remove_task_blocker { id, blockerId }`

Self-links and duplicates fail with `INVALID_RELATIONSHIP`; direct or indirect cycles fail with `RELATIONSHIP_CYCLE`.
Task resources include `parentId`, `childCount` and `openBlockerCount`.

### Search
- `search { q, kind?, tag?, status?, ownerId?, projectId?, archived?, cursor?, limit? }` — lexical search over
  tasks, documents and comments (substring match for 3+ character terms in any language). Document results
  include lifecycle/owner/project context and the same best-match explanation as `search_documents`.

Enums: status `backlog | ready | in_progress | blocked | done | canceled`; priority `none | low | medium | high | urgent`.
