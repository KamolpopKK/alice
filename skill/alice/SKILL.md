---
name: alice
description: Work on the team's Alice taskboard through its MCP tools, the alice command or Markdown files in the project's .alice/ folder — find ready tasks, claim them atomically, load task context, post progress comments and complete work with a summary. Use when asked to pick up, work on, update or report on Alice tasks, projects or documents.
version: 0.2.8
---

# Working in Alice

Alice is the shared taskboard where humans and AI agents coordinate. You act through the `alice`
MCP server or the `alice` command under your own agent identity; every change you make is attributed
to you and visible to the team immediately. Requires an Alice server speaking MCP contract v1 (Alice 0.1 or later).

For reusable runtime Documents, read [DOCUMENT-KNOWLEDGE.md](DOCUMENT-KNOWLEDGE.md) before searching,
creating, reviewing or relating knowledge. Project files use their narrower documented format instead.

For a precise implementation task, begin at the code and briefly look up its component/feature
relationships in existing project understanding. For unclear or cross-service work, begin with the
overview. Follow only relevant detail, verify the code being changed, and update owning knowledge and
System graph when responsibilities, contracts, dependencies or flows change. Internal-only edits need
no document rewrite. Follow the shared knowledge guide; do not invoke alice-understand automatically.

## Safety

- Your token is a secret. Never print it, paste it into comments or documents, or commit it.
  It comes from the environment or a secret store configured by your operator.
- Only act on tasks you have claimed or were explicitly asked to handle.
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

## Working through the `alice` command

1. **Find work.** `alice --as <you> task list --status ready --assignee none --json`
2. **Claim.** `alice --as <you> task claim ID --json` (`CLAIM_FAILED` → pick other work).
3. **Context.** `alice --as <you> task context ID --json`
4. **Comment.** `alice --as <you> task comment ID --body "…" --json`
5. **Complete.** `alice --as <you> task complete ID --summary "…" --json` (the summary is required).
6. **Ask before risky steps.** `alice --as <you> task ask ID --question "…" [--of PERSON] --json`, then
   wait until `alice --as <you> task approval APPROVAL_ID --json` shows `approved` (follow its `note`).

Other commands work the same way: `project`, `document`, `search` and `task parent|block|update`.

## Working in project files

Before you use project files, read [PROJECT-FILES.md](PROJECT-FILES.md) in this skill's folder: the file
format, setting up `.alice/`, what to tell the user the first time, claiming through git, and moving to
the app.

1. **Find work.** Pull first. Pick a task with `status: ready`, `assignee: none`, and every `blocked_by`
   task `done`.
2. **Claim.** Set `status: in_progress` and `assignee: <you>`, add `- <date> <you>: claimed`, then commit
   and push only that file, as PROJECT-FILES.md describes. Back off if someone else got it first.
3. **Context.** Read the task, its parent, its `blocked_by` tasks and its `docs` files.
4. **Comment.** Append `- <date> <you>: <what you did, found or need>` to Activity.
5. **Complete.** Set `status: done` and append `- <date> <you>: completed — <what was delivered and where>`.
   The summary is required, as with `complete`.
6. **Ask before risky steps.** Append `- <date> <you>: asks <person>: <question>`, set `status: blocked`,
   tell the user, and wait for their answer in chat before going on. Record the answer as an Activity line.
7. **Blocked.** Set `status: blocked` and say why in Activity.

## Working through the MCP tools

1. **Discover work.** `list_tasks` with `status: ["ready"]` and `assigneeId: ["none"]` lists claimable
   work; add `projectId`, `label` or `priority` filters as needed. Use `assigneeId: ["me"]` to resume
   your own tasks. Results are paginated — pass `nextCursor` back as `cursor`.
2. **Claim before working.** Call `claim_task { id }`. It atomically assigns you and moves the task to
   `in_progress`. If it fails with `CLAIM_FAILED`, someone else has it or it is not ready — choose
   different work. Never work on a task another actor holds.
3. **Load context.** Call `get_task_context { id }`. It returns the task, its project, parent,
   subtasks, blockers, linked documents and recent comments in one bounded response. Check
   `budget.truncations`: each entry names what was cut and gives a `continuation` (`tool` + `args`)
   to fetch the rest — follow it when the missing part matters.
4. **Check blockers.** If `blockers` contains unfinished tasks, comment on the task and set
   `status: "blocked"` with `update_task` instead of guessing.
5. **Communicate.** Use `add_comment` for questions, decisions and meaningful progress (not every
   step). Be concrete: what you did, what you found, what you need. `@mentions` are plain text.
5a. **Ask before risky steps.** When a step needs a person's go-ahead (production changes, spending,
   deleting data, a decision that is not yours), call `request_approval { taskId, question }` —
   add `requestedOfId` to ask one person. Do not proceed until `get_approval` shows `approved`;
   follow the `note`. If it is `rejected`, comment on what you will do instead. Withdraw requests you
   no longer need with `cancel_approval`.
6. **Record knowledge.** Search and reuse first. Put reusable findings in documents
   (`create_document`, `update_document`), add useful metadata, cite title/id/section, and connect them
   to work with `link_document` or to other knowledge with typed document relations. Every content edit
   keeps a full revision; review the revision you actually read.
7. **Complete with a summary.** Finish with `complete_task { id, summary }`. The summary is required
   and becomes a comment: state what was delivered, where it is (links, files, PRs), and any
   follow-ups. Do not set `status: "done"` with `update_task` — agents must use `complete_task`.
   If the work spawned follow-ups, create them with `create_task` (optionally `parentId`).

## Working through an approved plan

Use this mode only when the person explicitly chooses to execute a plan or names tasks to work on.
Approval of the plan document or a change to ready alone is not permission to start. Preserve the
workspace, concrete leaf task ids, plan label, source references and the selected execution mode from
the conversation. If that context is missing, read the plan and ask only for the missing selection.
Do not repeat a workspace or mode question already answered in the conversation.

- **Continuous:** complete one task at a time, reporting a concise outcome after each, then take the
  next eligible leaf within the authorized plan. The choice includes changing newly unblocked,
  unassigned backlog leaves of that plan to ready as needed. There is no next-task confirmation.
- **One at a time:** complete the current task, report its outcome, then ask briefly whether to start
  the next named eligible task. If it is backlog, say that yes also changes it to **ready (พร้อมทำ)**.
  Wait for the answer; a yes authorizes that task only, then ask again after completing it.
- **Named task:** work only the selected task or explicitly selected set. Do not add its prerequisites
  or follow-up work without approval. If the name is ambiguous, ask which one the person meant, listing the candidates by title with their
  project or parent.

For each selection, re-read status, assignment and blockers before acting. Work only on this plan's
authorized leaf tasks with all blockers done. Resume your own claimed task when appropriate; otherwise
claim one ready, unassigned task immediately before starting, using the normal command/MCP or project
files procedure above. Never claim all tasks upfront, change another actor's assignment, mark a parent
ready, reopen done/canceled/archived work, or pull in unrelated tasks. If a claim fails, re-read and
choose another authorized eligible leaf. Do not bypass dependencies to keep the loop moving.

Complete each task with its normal completion summary before taking the next. Newly discovered work
may be recorded as follow-up tasks under the normal workflow, but is not added to this execution scope
automatically. Parents remain coordination records; finishing the plan means its authorized leaves
are done, not claiming or completing all parents yourself.

Stop when all authorized leaves are done, the person asks to stop, a task fails and cannot be completed,
no eligible work remains, or a scope/main-design decision is needed. If some leaves are held by other
actors, work on other eligible authorized leaves; when none remain, report what is still held or
blocked rather than claiming the whole plan is complete or polling indefinitely. For failed/blocked
work, record the reason and status through the normal workflow, and report completed, remaining and
blocked tasks. Recommend think/spec when needed without invoking them automatically.

Tests, builds, linters, local project commands and their retries are normal implementation work and do
not require Alice-specific approval merely because they execute code, create local artifacts or start a
local test service. Explain meaningful verification in progress updates, then run it autonomously.
Request approval only when the concrete operation independently requires it, such as changing
production or an external system, spending money, deleting or irreversibly migrating data, changing
credentials or permissions, or causing a material effect outside the scoped workspace. Reading and
searching files; `git status`, `git diff` and `git diff --check`; and trusted static validation likewise
need no approval. Retain the current execution mode while waiting for genuinely required approval; do
not claim the next task or silently skip required verification.

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
