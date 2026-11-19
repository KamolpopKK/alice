---
name: alice-think
description: Think a new idea, request, bug report or piece of feedback through before anyone plans or builds it. Hand small, clear work straight to a task; otherwise question the person until you both understand it the same way, then write a brief (problem, user journey, requirements, spec — only what the work needs) as an Alice document ready for planning or design. Use when the work has no Alice task yet — not for breaking an agreed brief into tasks (use alice-plan) or working on an existing task (use alice).
version: 0.2.1
---

# Thinking work through in Alice

You are the first stop for new work. You decide how much thinking it needs, and no more: small, clear
work goes straight to a task with no questions, and only work that is unclear or large gets questioned
and written up. The result is either one task ready to work on or a brief that the `alice-plan` skill,
or whoever designs the architecture, can use without asking anyone again. You act through the `alice`
MCP server, the `alice` command or the project's `.alice/` files, under your own agent identity.
Requires an Alice server speaking MCP contract v1.

## Safety

- Your token is a secret. Never print it, paste it into comments or documents, or commit it.
  It comes from the environment or a secret store configured by your operator.
- Never save a brief to Alice before the person approves it in chat.
- Never claim, start or complete tasks while thinking. When the person wants the work done now, switch
  to the `alice` skill for that.
- Archive instead of deleting; there is no permanent delete for agents.

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

Every result is `{ "ok", "workspace", "data" }` or `{ "ok": false, "error": { "code", "message" } }` with
the codes in "Recovering from errors", and the exit status is non-zero on errors. `UNAUTHENTICATED` from
the command means the person disabled your integration: stop and tell them. `alice --help` and
`alice <group> help` list every command and option.

## Thinking through the `alice` command

Do the same steps with the `alice` command, following "Using the `alice` command"
(`alice --as <you> … --json`):
- `search QUERY`, `document search QUERY`, `project list`
- `task create --title … --description-file - --status ready`
- `document create --title … --body-file - --project ID`, `document update ID --body-file -`

## Thinking in project files

Before you use project files, read [PROJECT-FILES.md](PROJECT-FILES.md) in this skill's folder: the file
format, setting up `.alice/`, what to tell the user the first time, and moving to the app. Then follow the
same steps, writing files instead of calling Alice:
- **Look for existing work** in `.alice/tasks/` and `.alice/docs/`.
- **A small task:** `.alice/tasks/T-<n>-<slug>.md` with `status: ready` and `assignee: none`.
- **A brief:** `.alice/docs/D-<n>-<slug>.md`, after the person approves it.
- Commit the new file on its own (`Add T-<n>: <title>` or `Brief <slug>`).

## 1. Triage (always, before any question)

Restate the request in one line, then look for existing work: `search` and `search_documents` for tasks,
plans and briefs on the same subject. Then take the first route that fits:

| Route | When | What you do |
|---|---|---|
| **Already on the board** | A task, plan or brief covers it | Point the person to it (id and title). Add to it only if they ask. |
| **Small and clear** | One reviewable change (one commit or pull request, at most about a day), the outcome fits in a line or two, and no decision is left for the person | Go to step 2. Ask nothing. |
| **Needs thinking** | Anything else: an idea, a feature, feedback or a bug whose cause or wanted outcome is unclear, work that touches several parts or needs a decision | Go to step 3. |

When you are unsure whether work is small, it needs thinking. Tell the person the route in one line
("Small and clear: I'll add it as one task") and continue at once; they can redirect you.

## 2. Small and clear: one task, no questions

Create one task with `create_task { title, description, projectId, status: "ready" }`: an outcome line,
what is known (files, error, steps to reproduce) and how to check it is done. Use the project the person
named or the one related tasks are in; otherwise leave it out (it goes to `Untitled`) and say so. Report
the task id and title. If the person wants it done now, follow the `alice` skill to claim and work on it;
otherwise stop here.

## 3. Question until you share an understanding

- Ask **one question at a time**, each with your recommended answer and the alternatives.
- Explore instead of asking whenever the answer is in the code (when you run inside the repository) or
  in Alice. Never ask what you could look up.
- Resolve decisions in the order they depend on each other: the problem and who has it, the outcome and
  how to tell it worked, scope and what is out of it, constraints, then technical choices.
- Point out contradictions with earlier answers, the code or existing documents as soon as you see them.
- **Stop when enough is decided**: someone could plan the work, or do it, without asking the person
  again. Do not ask about details that belong in the work itself.

If the answers show the work is one task after all, create it as in step 2 with what you learned as the
description, and skip the brief.

## 4. Write the brief

One Alice document, titled after the work, with only the sections this work needs:

| Section | Include when |
|---|---|
| **Problem and goal** | Always: who has the problem, what changes for them, how to tell it worked |
| **Source** | Always: where it came from (the person, the feedback, a link) |
| **User journey** | People go through a flow: the steps, before and after |
| **Requirements** | A feature: each requirement with its acceptance condition |
| **Spec** | Several parts of the system or a technical choice: the design, interfaces, data, what was rejected and why |
| **Out of scope** | Something was explicitly left out |
| **Decisions** | Always: each decision from step 3 as "question → answer", so later readers know why |
| **Open questions** | Only questions that can wait for planning or design, each with who decides |

Keep it short: under ~20,000 characters, so planning tools can read it in full. Write no "TBD"; an
unknown is an open question with an owner, or it goes back to step 3.

## 5. Approve, save and hand over

1. Show the complete brief in chat. Apply the person's edits and show the changed parts again. Save only
   on explicit approval.
2. Save it with `create_document { title, body }`, and `link_document { id, projectId }` when it belongs to
   a project (ask which, recommending an existing one from `list_projects`). For an existing brief, use
   `update_document` with the complete new body; every edit keeps a revision.
3. Report the document id and title, and name the next step without taking it: "Next: plan it with
   `alice-plan` from <document id>", or design the architecture from its Spec section first when the
   brief leaves technical choices open.

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
