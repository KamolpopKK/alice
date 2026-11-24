# Project knowledge

Open a project's **Knowledge** tab to find reusable starting points. Ordinary **Documents** and lexical
search remain available. This is an additive `project-knowledge` capability in Client API v1/MCP v1;
older servers keep their existing Documents workflows and hide unsupported controls.

## Curate references, not copies

A flat topic has a name (trimmed, 1–200 characters), plain-text introduction (at most 2,000 characters)
and explicitly ordered reading list. Start with an existing overview when useful. Select an existing
Document, including one linked to another project in this workspace; the original body/history/review
are shared. A Document may belong to many topics. Membership does not create a project link or invent
one exclusive owner project. Source-project labels show actual links.

Add, remove or move reading references with the keyboard controls. Removing membership does not
archive/delete the Document. Archive/restore topics separately. Curation does not mean reviewed or
current. Draft/unreviewed sources need checking; superseded sources are historical context and their
relationships can lead to replacements. A recorded current review is not proof that today's code
still matches every statement.

## Link, preview and follow evidence

In the rich editor, open **Link**, search by document title, select a target and insert. Selected text
keeps its label; insertion at a cursor uses the target title. Stored links are standard Markdown:
`[Authentication overview](/documents/DOCUMENT_ID#heading)`. Renaming a target does not rewrite labels
or break its ID. Internal links stay in the active Web/Desktop workspace; external links keep the
existing safe handling. Heading fragments are derived from rendered headings, not permanent section
identities; changing a heading can change its fragment.

Backlinks combine incoming links in current content and manual `references`, showing both reasons
once per source. `related`/`supersedes` and **In topics** remain separately labelled. Removing an inline
link removes its derived backlink, not an independent manual reference.

The preview icon beside a content link, backlink or Knowledge result opens the same original
Document. Preview shows at most 2,000 characters plus actual lifecycle/revision/review metadata.
Archived/unavailable references expose no preview body. Refreshing and failed previews hide cached
body text; retry or open the source. Escape closes the dialog and returns focus. Preview content is
plain text, so linked images/HTML are not executed or fetched.

## Discover first; read selectively

`knowledgeProjectId` searches actual project links **union** active curated topic membership, including
cross-project sources. `topicId` narrows to that topic and must belong to the selected knowledge
project. `curatedOnly` requires active membership. Existing project/tag/status/owner filters remain
additional AND filters; `projectId` still means actual project links. Archived topics are excluded
from normal discovery. Search keeps lexical field/lifecycle priorities; curation is only a later tie
breaker, not a reason to promote superseded over current evidence.

Context discovery accepts `q?`, `topicId?`, `limit` 1–20 (default 10) and `cursor?`. Without a query,
topics sort by normalized name/ID, members by reading order/ID, and Documents are deduplicated by their
first position before pagination. With a query it returns lexical candidates. Empty curation returns
an empty result and normal Documents-search fallback. Search absence is not proof that knowledge does
not exist; no semantic answer/conflict detection, model summary or recursive crawl is provided.

Context descriptions/excerpts and topic/project metadata are bounded, with totals/cursors or explicit
continuations. Read selected outlines/content, not the entire vault. Cite title + Document ID + the
revision actually read + heading or offset range, separating source statements, current repository
evidence and inference. Only work dependent on an unresolved source conflict needs to stop.

## CLI example

For a Local workspace with an already-enabled Codex integration, set `PROJECT` to the intended project,
`DOCUMENT` to an existing overview and `TOPIC` to the ID returned by create. These variables stand for
IDs; no command switches the active workspace or enables an integration. Remote users select their
signed-in profile with `--workspace PROFILE` and omit `--as`; Remote agents use MCP.

```sh
alice --workspace personal --as codex knowledge topic create --project $PROJECT --name Authentication --mutation-id topic-auth-001 --json
alice --workspace personal --as codex knowledge topic list --project $PROJECT --limit 1 --json
alice --workspace personal --as codex knowledge member put $TOPIC $DOCUMENT --revision 1 --mutation-id member-auth-001 --json
alice --workspace personal --as codex knowledge member list $TOPIC --limit 1 --json
alice --workspace personal --as codex knowledge context --project $PROJECT --json
alice --workspace personal --as codex document outline $DOCUMENT --revision 1 --json
alice --workspace personal --as codex document content $DOCUMENT --revision 1 --offset 0 --max-chars 1000 --json
alice --workspace personal --as codex document backlinks $DOCUMENT --limit 10 --json
alice --workspace personal --as codex document search Authentication --knowledge-project $PROJECT --curated-only --json
```

New page commands preserve `nextCursor` in JSON. Pass it with `--cursor` for deliberate additional
reads. Content uses `nextOffset`; keep `--revision N` when continuing. Topic/member and outline cursors
reject changed revisions; discovery is live and is not an immutable snapshot of the whole library.
Use `knowledge help` / `document help` for update/archive/restore/remove/move, file/stdin and preview
options. `--description-file PATH|-` reads topic text from a file/stdin.

## Contracts and concurrency

| Client API v1 | MCP |
|---|---|
| `GET/POST /projects/:projectId/knowledge/topics` | `list_knowledge_topics`, `create_knowledge_topic` |
| `GET/PATCH /knowledge/topics/:topicId` | `get_knowledge_topic`, `update_knowledge_topic` |
| `POST /knowledge/topics/:topicId/archive` or `/restore` | `archive_knowledge_topic`, `restore_knowledge_topic` |
| `GET /knowledge/topics/:topicId/documents` | `list_topic_documents` |
| `PUT/DELETE /knowledge/topics/:topicId/documents/:documentId` | `put_topic_document`, `remove_topic_document` |
| `GET /projects/:projectId/knowledge/context` | `get_knowledge_context` |
| `GET /documents/:id/backlinks` or `/topics` | `list_document_backlinks`, `list_document_topics` |
| `GET /documents/:id/content` | `get_document` with optional `expectedRevision` |
| `GET /documents/:id/outline` or `/preview` | `get_document_outline`, `get_document_preview` |

Paths are relative to `/client/v1`; new Knowledge paths are not duplicated under legacy `/api`.
Content accepts `expectedRevision?`, offset ≥0 and maxChars 100–100,000/default20,000; outline cursors
carry revision. Existing full Document reads remain available. Clients use `AliceClient` transports,
not agent MCP bearer tokens against the human Client API.

Topic/member writes require `mutationId`; existing-topic writes also require `expectedRevision`.
`beforeDocumentId` must belong to that topic; omit it to place a member at the tail. Topic revision
covers metadata and reading order. Replay is workspace/actor scoped, checked before revision guard,
and payload mismatch fails. Reuse unchanged ID/payload after an uncertain response within
`ALICE_IDEMPOTENCY_RETENTION_HOURS` (default24h). After expiry or conflict, reload/reconcile instead of
blind retry. Writes, activity and replay state commit together. Existing event kinds refresh views;
events do not contain Document bodies.

Agents propose reviewable organization/content changes with target IDs/revisions, changes, reasons and
review consequences before applying them. To have an agent inspect a library on request and propose
those changes, use the `alice-curate` skill: see [Curating project knowledge](alice-curate.md). Reuse existing scoped approval; apply only the approved
subset. Read requests do not authorize library reorganization. Curation/content generation never
counts as review, and unrelated archive/supersedes is not implied. This does not gate ordinary tests
or implementation already authorized by the task.

## Operations and measured capacity

Schema migrations add authoritative topics/memberships; current-body inline edges/index state are
rebuildable. Preparation runs in resumable batches before Remote accepts requests/readyz and before
Local publishes its locator. Failures stay visible; restart resumes unfinished preparation without
rewriting source content/history/review. Do not bypass readiness or delete source Documents to repair
an index.

Verified SQLite backups preserve the whole source/history/review/order. Portable export **v3** adds
`knowledgeTopics` and `knowledgeTopicDocuments` references/order; derived edges/state and secrets are
not portable authority. Portable export is not a SQLite backup or a new importer. Keep a verified
pre-upgrade backup. Old binaries reject newer schemas; downgrade requires restoring that older backup,
which reverts all changes since it was taken. Keep the upgraded data aside before that decision.
See [operations](operations.md) for backup/restore procedures.

Capacity was measured on Apple M5/10cores/24GiB, Darwin25.6 arm64, Node24.18/SQLite3.54.1, not promised
for every machine. The unchanged100,000-task/2,000-document baseline passed. Extended10,000documents,
100,000distinct links,1,000topics/20,000memberships (5%50k-character bodies) passed50 warm samples per
read with p95≤400ms and10readers/5writers ×100operations with read/write p95≤800/1000ms. Observed mixed
p95 was approximately212/209ms with0unexpected errors; deliberate conflicts were separate. Re-run
`npm run test:scale` on your deployment hardware before extrapolating.

See [CLI](cli.md), [Client API](client-api.md), [MCP](mcp.md), [agent guidance](agents.md) and
[document authoring](document-authoring.md) for the corresponding interfaces.
