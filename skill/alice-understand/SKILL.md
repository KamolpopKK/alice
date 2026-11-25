---
name: alice-understand
description: Understand an existing project or a focused part of it, map business flows to code and services, and maintain reusable project knowledge with a Mermaid system graph. Use for onboarding or refreshing knowledge of existing systems, including multiple repositories; not for auditing, designing changes or planning implementation.
version: 0.2.10
---

# Understanding existing projects in Alice

Build knowledge that another person or agent can search and follow into code without rediscovering the
whole system. Support both a first overview and focused understanding for a particular question.
Use the Alice MCP tools, the alice command or project files under your own identity.
Requires an Alice server speaking MCP contract v1 for runtime Documents.

Read [DOCUMENT-KNOWLEDGE.md](DOCUMENT-KNOWLEDGE.md) before document discovery or changes.
Read [TEMPLATE.md](TEMPLATE.md) before drafting outputs. It links the shared format conventions.
Keep the source systems read-only; saving approved knowledge to Alice or project files is the output,
not permission to modify the systems being studied.

Propose reviewable updates to owning knowledge and graphs; apply only the authorized subset and preserve unrelated coverage. Follow the shared document-knowledge guide.

## Safety

- Your token is a secret. Never print it, paste it into comments or documents, or commit it.
  It comes from the environment or a secret store configured by your operator.
- Do not change source code, install project dependencies, run migrations, start deployments or call
  mutating application endpoints as part of discovery. Read configs without copying secret values.
- A command found in a script is not a command verified to work. Execute a build/test/run command only
  when within the user's authorized scope and its effects are understood; record what actually ran.
- Do not create implementation tasks, redesign the system or assign quality scores.
- Never save knowledge until the person approves its complete content, unless they already explicitly
  authorized saving that content or an ongoing knowledge-maintenance workflow covers the update.
- Do not mark a document reviewed/current merely because it was generated or the content was approved.
  Review is a separate action against the revision actually checked.
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

## 1. Establish the question and sources

Reuse the workspace choice for this conversation. Find the target project and existing knowledge
before asking what the code or documents can answer. Use search/search_documents (CLI: search and
document search), then open relevant documents and their relations, not only search excerpts.

Identify the system, repositories and desired depth:
- Overview: map every main part, then deepen where needed for the major business flows.
- Focused: start with the question or known code location, and trace related parts as needed.
- Refresh: find the previous coverage and baseline first; follow section 3.

Agree unclear scope, destination project or access boundaries before widening the investigation.
Repositories may be local paths or explicitly accessible remotes; do not assume that the repository
containing the Alice board is the system being studied. Ask for another source only when it is needed
to answer the goal. Otherwise record the gap and continue useful work. Never invent a repository,
owner, policy or production behavior to fill a blank.

For project files, read [PROJECT-FILES.md](PROJECT-FILES.md) before reading or writing the board.
Use the existing .alice/docs/ format; no runtime metadata in front matter and no separate board per
service. Without an existing board, offer project files and create .alice/ only after agreement.

## 2. Trace capabilities to implementation

Use the coverage table in TEMPLATE.md as a completeness check, not a demand for nine documents.
For each category, record evidence, not applicable with a reason, or not inspected with its limitation.
Understand responsibilities and boundaries, not every function.

Trace business capability → business flow → service/module → entry point and code. Follow callers,
API clients, routing, event producers/consumers, data ownership and configuration where relevant.
Distinguish configured connectivity from observed runtime behavior. A shared event name or matching
method name alone does not prove a connection. Include external systems even when implementation
access is unavailable, but label what is verified and what remains unknown.

Record development facts from package scripts, Makefiles, docs, CI workflows, container/IaC files and
formatter/linter config. Separate commands found from commands executed and their results.
A deploy trigger proves configuration, not production use; an observed convention is not a mandated
team rule. Interview people only for gaps material to the goal; do not turn discovery into a team audit.

Use four evidence classes: verified fact, inference, conflict, unknown. Cite repository identity,
path/symbol, commit if available, observation date, and whether evidence includes working-tree changes.
Explain conflicts and uncertainty; do not silently choose the most convenient source.
Never record secrets or raw environment/credential files.

## 3. Reuse and refresh without overstating freshness

For each repository, compare the stored identity, baseline and covered paths with the current sources.
With git, inspect HEAD and working-tree status (including staged, unstaged and untracked paths).
Compare committed changes since the recorded baseline and inspect relevant staged/unstaged diffs.
Record enough non-secret evidence to recognize the inspected dirty state, not simply "dirty".
A matching HEAD does not establish freshness when working-tree contents changed.

Use read-only git commands such as git rev-parse HEAD, git status --short,
git diff BASELINE HEAD -- PATHS, git diff -- PATHS and git diff --cached -- PATHS.
Inspect relevant untracked files explicitly. If ignored/generated configuration is material, record
its source separately; do not claim git covers it. Missing baseline, unavailable history, changed repo
identity or an unrepeatable dirty baseline means freshness is unverified: re-inspect the affected area.
A timestamp alone is not proof of freshness.

Choose reuse only when both evidence and coverage fit the question. For a focused refresh:
1. Re-read the existing authoritative detail and identify changed components, contracts, flows and edges.
2. Re-inspect affected paths and their relevant neighbors; update the owning detail and graph.
3. Preserve unrelated prose and its earlier evidence. Mark untouched areas as not rechecked; never
   advance a whole repository's baseline after checking only one part.
4. Report new/changed/removed facts, conflicting evidence and unresolved gaps.

A complete rescan may replace the inspected scope, but keep document identity/history where its
purpose is unchanged. If another person changed a document while you worked, re-read and merge rather
than overwriting it. No background scanner, automatic expiry or persistent fingerprint engine is needed.

## 4. Draft reusable knowledge and the system graph

Produce a useful overview and a separate System graph artifact. Split details only when independently
maintained, reused across flows, or too large to navigate. Keep one authoritative location per fact;
the overview points to detail by title + id/path + section. Do not create a file for each checklist row.

Runtime: use existing Documents, focused tags/search keywords and known ownership only; link the
project and use references/related relations appropriately. Do not supersede knowledge silently.
Project files: use .alice/docs/D-<n>-<slug>.md with existing front matter and body links instead.
Use Markdown documents containing fenced Mermaid source in either destination. Do not introduce a new
file-import type or promise a graph renderer.

The System graph has an overview flowchart of the main apps/services, stores and external systems.
Use stable node ids, named boundaries and edge labels describing protocol/event/data relationship.
Provide an evidence table for nodes/edges and links to owning detail. Show only supported relationships
as facts; keep inferred relationships explicitly distinguished or listed as unknown outside the graph.
Split dense areas into linked subgraphs within this artifact; do not shrink everything onto one canvas.
Detailed time ordering belongs in sequence diagrams in the relevant flow document.

Use the shared Mermaid wrapper in OUTPUT-FORMATS.md. A graph is an as-inspected view, not a proposed
architecture. Do not claim syntax/render validation unless that check actually ran.

## 5. Confirm, save and hand off

Show the complete proposed overview, graph and any detail changes, with coverage, evidence boundaries,
remaining unknowns and a create/update map. Ask for one confirmation before saving, unless the exact
save/update is already authorized. Do not ask again for permission already given in this conversation.

Save only approved content using create_document/update_document (CLI: document create/update),
link_document and document relations; for project files write the approved Markdown documents.
Resolve actual ids after creation; if a multi-document save partly fails, report the saved documents by title and the remaining
links rather than recreating successful documents. Existing content changes create revisions and
invalidate prior review; creation does not imply verification.

Report the saved documents by title (paths for project files), graph location, inspected scope/baselines and unresolved limitations.
Recommend a next skill only when the user has a change request: think for unsettled needs, spec for
technical design, plan for agreed implementation work, alice for an existing task. Never invoke them
automatically. Understanding alone can end with reusable knowledge and no new tasks.

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
