---
name: alice-curate
description: Inspect an Alice knowledge library on request — topics, reading starts, links, lifecycle status and, at the chosen depth, document content — then report evidence-based findings and proposals in chat and apply only the changes the person approves. Use to check or tidy existing project knowledge; not for understanding a codebase (use alice-understand), planning or working on tasks.
version: 0.2.11
---

# Curating project knowledge in Alice

Inspect a knowledge library when the person asks, report what you found with evidence, propose
changes, and apply only the ones they approve. Inspection is read-only: it ends with a chat report and
needs no saved report, new Document or task. Use the Alice MCP tools, the alice command or project
files under your own identity. Requires an Alice server speaking MCP contract v1; topics, outlines,
content windows and backlinks need its `project-knowledge` capability.

Read [DOCUMENT-KNOWLEDGE.md](DOCUMENT-KNOWLEDGE.md) before any discovery or change: its curation,
citation, revision and review rules apply throughout. Read [TEMPLATE.md](TEMPLATE.md) before writing
the report, proposal or apply summary.

## Safety

- Your token is a secret. Never print it, paste it into comments or documents, or commit it.
  It comes from the environment or a secret store configured by your operator.
- Inspection never writes. A request to inspect, check or find problems is not approval to change the
  library; write only the proposal items the person approves in chat.
- Never review, unreview, archive, restore or supersede a document, or archive a topic, as a side
  effect. Each needs its own explicit approval naming that action.
- Generation and curation never count as review. Do not mark anything current because you read it.
- Never copy secrets, credentials or raw environment values into findings, proposals or documents.
- Stay inside the selected workspace; never report content from another workspace.
- Archive instead of deleting; there is no permanent delete for agents.

## Naming tasks and documents

When you talk with the person (questions, approvals, progress, summaries, tables, dependency
explanations and handoffs), call tasks and documents by their titles, in quotes, never by a bare id or a
temporary code they would have to look up. When you only have an id, fetch the title; never invent one.
- When two items share a title, add readable context: the project, the parent task or the document type.
- Show an id only when the person asks for it or an exact command or technical diagnosis needs it, and
  keep the title next to it. A link's visible text is the title.
- Ids stay wherever tools and saved content need them: command and tool arguments, document references,
  relationships, `docs` and `blocked_by` fields, and source requirement ids such as `REQ-001`, which are
  part of the content rather than names.

## Choose where you work first

You can reach Alice in three ways, and they may point at different boards:
- the `alice` MCP tools, which talk to the one server in your MCP configuration;
- the `alice` command, which reaches Local workspaces that run privately on this computer;
- **project files**: a board kept as Markdown in this repository's `.alice/` folder, with no app at all.

Check this at the start of every conversation, before your first read, draft or change:

1. **List what you can reach.** If the `alice` command exists, run `alice --as <you> workspace list --json`;
   each entry is a workspace. If the `alice` MCP tools are available, they are one more (call `whoami` to
   name them), unless they are the same server as a Remote entry in that list. If this repository has
   `.alice/tasks/`, the project files are one more.
2. **None:** offer project files. Create `.alice/` only after the user agrees.
3. **One workspace:** use it, and tell the user its name and alias (or server) before your first change.
4. **Two or more:** ask the user which one to use before you read or change anything, even when one is
   active or this project has a binding file. List each one (name, alias, Local or Remote, the MCP server,
   or project files) and mention the active or bound one as a suggestion, not a decision. Skip the
   question only when the user already named the workspace in this conversation.
5. **Use the answer for the rest of the conversation.** For a workspace from the list, add
   `--workspace ALIAS` to every command; for the MCP server, use the MCP tools; for project files, read
   PROJECT-FILES.md and follow this skill's project files section. Ask again only when the user wants to
   switch.
6. **When the MCP tools fail.** If they cannot connect or return `UNAUTHENTICATED` while a Local workspace
   exists, tell the user and offer to continue there instead of stopping.

Never change the active workspace (`alice workspace use`) or write a binding file (`alice workspace
bind`) unless the user asks.

## Using the `alice` command

Act as yourself on every command: add `--as claude-code` if you are Claude Code, `--as codex` if you are
Codex, plus `--json`. Never run Alice commands without `--as`, and never open the credential store: the
CLI reads your credential itself. Add `--workspace ALIAS` when more than one workspace exists.

When the selected workspace is **Local** and the agent runtime sandboxes shell commands, run every
`alice` command outside that sandbox (request the runtime's normal command escalation from the first
command). The Local CLI must reach the Alice daemon and the operating-system credential store; a
sandboxed invocation can misleadingly report that the workspace did not become ready or that an
enabled integration has no credential. If either symptom appears, retry the same command outside the
sandbox before diagnosing Alice, changing integration settings or asking the person to reconnect.

Every result is `{ "ok", "workspace", "data" }` or `{ "ok": false, "error": { "code", "message" } }` with
the codes in "Recovering from errors", and the exit status is non-zero on errors. `UNAUTHENTICATED` from
the command means the person disabled your integration: stop and tell them. `alice --help` and
`alice <group> help` list every command and option.

## 1. Agree scope and depth

Reuse the workspace already chosen in this conversation. Then settle two things before inspecting:

- **Scope.** One project by default: the project the person named, or ask which one, recommending the
  project the conversation is about. Inspect the whole workspace only when the person asks for it.
  Following a reference from an in-scope document lets you read that referenced document, never
  inspect the rest of its project; offer that as a separate scope instead.
- **Depth.** If the person has not chosen, ask once:
  - **A — Focused inspection** (recommended): inspect the structure, then read content only where a
    structural finding or the person's goal gives a reason.
  - **B — Full content comparison**: read and compare the content of every document in scope. Say that
    B takes noticeably more time and tokens.

  Wait for the answer; your recommendation is not the person's choice. Do not ask again when the
  request already states scope and depth (for example "inspect alice dev, full comparison").

State the agreed workspace, scope and depth in one line, then start.

## 2. Inspect the structure

Build the inventory from existing tools; there is no scanner to call.

1. **Documents in scope.** For a project, list `search_documents` with `knowledgeProjectId` (actual
   project links union active topic membership) and page with `nextCursor` until it ends; deduplicate
   by document id. For a workspace, list `search_documents` without a project filter. CLI:
   `document list --knowledge-project ID --all`. Record the total you actually listed.
2. **Topics.** `list_knowledge_topics` for the project, then `get_knowledge_topic` and
   `list_topic_documents` for each, paging to the end. Note introductions, reading order and members.
   `get_knowledge_context` without a query shows the reading starts people see. CLI: `knowledge topic
   list`, `knowledge member list`, `knowledge context`.
3. **Per document.** From the listing and `get_document_preview`: lifecycle status, owner, review
   revision, archived state and source URL. Then `list_document_topics`, `list_document_relations` and
   `list_document_backlinks` (CLI: `document topics`, `document relations`, `document backlinks`).
4. **Inline links.** Read outgoing `/documents/ID` links from content at a known revision
   (`get_document` with `expectedRevision`), not from search excerpts. In A, read only the documents
   chosen in step 3; in B the full read covers them.

Look for, and record as findings:
- documents in scope that no topic includes, and topics with no clear reading start;
- links, references or reading-list members that point to archived, unavailable or superseded
  documents; follow `supersedes` to name the replacement when one exists;
- `draft` or `unreviewed` documents that a topic presents as a starting point;
- topic introductions or reading order that no longer match their members.

Missing topics, backlinks or an owner are information to weigh, not errors on their own. Do not
call a document stale because of its age, or a duplicate because titles look alike: those are at most
reasons to read the content.

## 3. Read content at the chosen depth

Read with `get_document_outline`, then `get_document` at the returned `expectedRevision` with `offset`
and `maxChars` windows (CLI: `document outline` and `document content --revision N --offset N`).
If a read returns `CONFLICT`, the document changed: restart that document's read and do not combine
windows from different revisions.

- **A — Focused.** Read only documents with a reason: a structural finding, a suspected duplicate or
  conflict, a stale-looking reference or the person's stated concern. Record the reason for each read.
- **B — Full.** Read every document in the inventory to its end, window by window. If the budget runs
  out, stop and report progress: which documents and windows are read, which remain, and how to
  continue. Never fall back to A without saying so, and never call the comparison complete while any
  document in scope is unread.

Compare what you read: statements that contradict each other, documents that cover the same scope,
instructions that point at replaced documents. A content finding cites the title, Document ID, the
revision actually read and the heading or offset range. Content comparison is best effort; never
claim that every duplicate or conflict was found.

Classify every finding as one of four:
- **Fact**: directly shown by metadata or the text you read.
- **Suspicion**: a likely problem the evidence does not prove.
- **Conflict**: two sources disagree; name both.
- **Unknown**: something you could not check, and why (archived, unavailable, error, out of budget).

## 4. Report in chat

Write the report with the template in TEMPLATE.md:
- the workspace, scope, depth, what was inspected and what was not (with counts and reasons);
- each finding as what was found → evidence → impact → proposal;
- proposals the person can approve now, separate from items that need a decision or more checking;
- read errors, unread windows and continuations exactly as they happened.

When nothing turned up, say no issues were found within the inspected scope and depth; never certify
the whole library. Do not save the report as a Document or create tasks unless the person asks.

The person can stop here. Without approval nothing changes.

## 5. Propose and apply approved changes

A proposal lists numbered items. Each names the target (document or topic title and id), the revision
it is based on, the exact change (topic add/remove/move with position, introduction text, link or
relation change, or a content diff), the reason and its effect on revision and review: a content edit
creates a revision and clears a current review; topic and metadata changes do not touch content
revision or review.

The person may approve all, some or none of the items, or adjust them. Only approved items are applied.
An approval to curate or edit does not approve review, archive, restore or supersedes.

Immediately before writing each approved item:
1. Re-read the latest document (`get_document`) or topic (`get_knowledge_topic`, `list_topic_documents`).
2. If the target changed so that the item no longer fits, do not apply it: propose the revised item and
   wait for approval of that change. Other approved items continue.
3. For content edits, merge your change into the latest body so other people's edits survive.
   `update_document` has no compare-and-swap; say so rather than promising atomic edits.
4. For topic changes, pass the current topic `expectedRevision` and a new `mutationId`
   (`put_topic_document`, `remove_topic_document`, `update_knowledge_topic`; CLI `knowledge member
   put|remove`, `knowledge topic update`). After an uncertain response, retry with the same
   `mutationId` and payload; after a conflict, reload and reconcile instead.
5. For links between documents use `link_document_relation` or `unlink_document_relation`; for
   project or task links use `link_document` or `unlink_document`.

Finish with the apply summary from TEMPLATE.md: applied, failed (with the error), not applied and why,
and items waiting for re-approval. Report each result as it actually happened.

## Curating project files

For a board kept in `.alice/`, read [PROJECT-FILES.md](PROJECT-FILES.md) first. Project files have only
`id`, `title` and optional `source_url` front matter plus Markdown body links: there are no topics,
lifecycle status, review, backlinks or typed relations. Inspect `.alice/docs/` with the same scope,
depth, evidence and report rules, using body links and `docs` fields in tasks. Do not invent topics or
status fields; propose reading order or links as Markdown edits. Apply approved edits as file changes
and commit them on their own.

## When to use another skill

- Understanding a codebase or system, or refreshing project understanding from code: `alice-understand`.
- A finding that needs new work: describe it, and recommend `alice-think` if the person wants it
  tracked. Never invoke another skill automatically.

## Recovering from errors

The MCP tools return `{ "error": { "code", "message" } }` and the `alice` command returns
`{ "ok": false, "error": { "code", "message" } }`, with the same stable codes:

| Code | What to do |
|---|---|
| `CLAIM_FAILED` | Someone else claimed it or it is not `ready`. Pick other work. |
| `VALIDATION_ERROR` | Fix the arguments using the message/details. |
| `NOT_FOUND` | Re-list to get a valid id. |
| `INVALID_STATE` | E.g. archived task or archived destination project — restore first or choose another. |
| `RELATIONSHIP_CYCLE` / `INVALID_RELATIONSHIP` | The parent/blocker change is invalid; choose a different relationship. |
| `PROTECTED_RESOURCE` | The `Untitled` project cannot be renamed or archived. Do not retry. |
| `UNAUTHENTICATED` | Your token was revoked or rotated, or the person disabled your integration. Stop and tell them. |
| `RATE_LIMITED` | Wait before retrying. |

## Quick reference

- Statuses: `backlog`, `ready`, `in_progress`, `blocked`, `done`, `canceled` (any → any, except that agents finish work only with a completion summary, never by setting `done`).
- Priorities: `none`, `low`, `medium`, `high`, `urgent`.
- Tasks without a project go to the protected `Untitled` project.
- Edits are last-write-wins; re-read the task before large changes to avoid overwriting a teammate.
- `search { q }` or `alice search QUERY` finds tasks, documents and comments (3+ character substrings, any language).
