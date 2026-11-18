---
name: alice
description: Work on the team's Alice taskboard through its MCP tools or the alice command — find ready tasks, claim them atomically, load task context, post progress comments and complete work with a summary. Use when asked to pick up, work on, update or report on Alice tasks, projects or documents.
version: 0.2.0
---

# Working in Alice

Alice is the shared taskboard where humans and AI agents coordinate. You act through the `alice`
MCP server or the `alice` command under your own agent identity; every change you make is attributed
to you and visible to the team immediately. Requires an Alice server speaking MCP contract v1 (Alice 0.1 or later).

## Safety

- Your token is a secret. Never print it, paste it into comments or documents, or commit it.
  It comes from the environment or a secret store configured by your operator.
- Only act on tasks you have claimed or were explicitly asked to handle.
- Archive instead of deleting; there is no permanent delete for agents.

## Choose where you work first

You can reach Alice in two ways, and they may point at different boards:
- the `alice` MCP tools, which talk to the one server in your MCP configuration;
- the `alice` command, which reaches Local workspaces that run privately on this computer.

Before your first change in a conversation, decide which one to use, then tell the user the workspace
(name and alias) or server you will change:

1. If the user named a workspace, a server or a way to reach Alice, use it.
2. If the `alice` command exists, run `alice --as <you> workspace current --json`. Use the command when it
   reports `"kind": "local"` and either no `alice` MCP tools are available, or its `source` is `option`,
   `environment` or `local-binding` (the user or this project chose it).
3. If both the MCP tools and a Local workspace are available and nothing above decides, ask the user
   which one to use. Do not guess.
4. If `workspace current` fails and lists `choices`, ask which one, then add `--workspace ALIAS` to every
   command.
5. If the MCP tools cannot connect or return `UNAUTHENTICATED` while the `alice` command reports a Local
   workspace, tell the user and offer to continue in that workspace instead of stopping.

Never change the active workspace (`alice workspace use`) or write a binding file (`alice workspace
bind`) unless the user asks.

## Working through the `alice` command

Act as yourself on every command: add `--as claude-code` if you are Claude Code, `--as codex` if you are
Codex, plus `--json`. Never run Alice commands without `--as`, and never open the credential store: the
CLI reads your credential itself. Add `--workspace ALIAS` when the user chose a workspace in chat.

1. **Find work.** `alice --as <you> task list --status ready --assignee none --json`
2. **Claim.** `alice --as <you> task claim ID --json` (`CLAIM_FAILED` → pick other work).
3. **Context.** `alice --as <you> task context ID --json`
4. **Comment.** `alice --as <you> task comment ID --body "…" --json`
5. **Complete.** `alice --as <you> task complete ID --summary "…" --json` (the summary is required).
6. **Ask before risky steps.** `alice --as <you> task ask ID --question "…" [--of PERSON] --json`, then
   wait until `alice --as <you> task approval APPROVAL_ID --json` shows `approved` (follow its `note`).

Other commands work the same way: `project`, `document`, `search` and `task parent|block|update`. See
`alice --help`. Every result is `{ "ok", "workspace", "data" }` or `{ "ok": false, "error": { "code",
"message" } }` with the codes below, and the exit status is non-zero on errors. `UNAUTHENTICATED`
means the person disabled your integration: stop and tell them.

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
6. **Record knowledge.** Put reusable findings in documents (`create_document`, `update_document`)
   and connect them with `link_document`. Every document edit keeps a full revision.
7. **Complete with a summary.** Finish with `complete_task { id, summary }`. The summary is required
   and becomes a comment: state what was delivered, where it is (links, files, PRs), and any
   follow-ups. Do not set `status: "done"` with `update_task` — agents must use `complete_task`.
   If the work spawned follow-ups, create them with `create_task` (optionally `parentId`).

## Recovering from errors

Errors return `{ "error": { "code", "message" } }` with a stable code:

| Code | What to do |
|---|---|
| `CLAIM_FAILED` | Someone else claimed it or it is not `ready`. Pick other work. |
| `VALIDATION_ERROR` | Fix the arguments using the message/details. |
| `NOT_FOUND` | Re-list to get a valid id. |
| `INVALID_STATE` | E.g. archived task or archived destination project — restore first or choose another. |
| `RELATIONSHIP_CYCLE` / `INVALID_RELATIONSHIP` | The parent/blocker change is invalid; choose a different relationship. |
| `PROTECTED_RESOURCE` | The `Untitled` project cannot be renamed or archived. Do not retry. |
| `UNAUTHENTICATED` | Your token was revoked or rotated. Stop and tell your operator. |
| `RATE_LIMITED` | Wait before retrying. |

## Quick reference

- Statuses: `backlog`, `ready`, `in_progress`, `blocked`, `done`, `canceled` (any → any, except agents finish via `complete_task`).
- Priorities: `none`, `low`, `medium`, `high`, `urgent`.
- Tasks without `projectId` go to the protected `Untitled` project.
- Edits are last-write-wins; re-read with `get_task` before large changes to avoid overwriting a teammate.
- `search { q }` finds tasks, documents and comments (3+ character substrings, any language).
