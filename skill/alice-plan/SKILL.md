---
name: alice-plan
description: Break agreed requirements, an Alice document or an oversized Alice task into a reviewed, linked and ordered work breakdown in Alice. Resolve implementation planning details and recommend alice-spec when main technical design decisions are missing. Use when asked to plan, break down, decompose or scope work in Alice — not for working on an existing task (use the alice skill) or creating technical designs.
version: 0.2.4
---

# Planning work in Alice

You turn a planning input into a work breakdown on the shared Alice board. The result must let any
person or agent pick up a leaf task, call `get_task_context`, and start immediately — no follow-up
questions, no hunting for files. You act through the `alice` MCP server, the `alice` command or the
project's `.alice/` files, under your own agent identity.
Requires an Alice server speaking MCP contract v1.

For runtime Alice Documents, read [DOCUMENT-KNOWLEDGE.md](DOCUMENT-KNOWLEDGE.md) before discovery or
updating the planning reference. Project files do not have these lifecycle fields or typed relations.

During discovery, use project understanding selectively: precise changes can start at code with a
short relationship lookup, while unclear/cross-service work starts at the overview. Verify relevant
source baselines and working-tree changes. Include maintenance of affected owning detail/System graph
when planned work changes responsibilities, contracts, dependencies or flows; internal-only changes
need no document rewrite. Recommend alice-understand for a material knowledge gap, never invoke it
automatically. A stale document alone is not a reason to require a whole-system survey.

Plan implementation from agreed needs and a sufficient technical approach. A separate spec is not
required when existing patterns clearly cover the work. Do not create or replace the main technical
design in planning; if it is missing, recommend `alice-spec` and wait for the person to choose the next
step. Never invoke another skill automatically.

Templates and the pre-creation checklist are in [TEMPLATE.md](TEMPLATE.md). Read it before drafting.

## Safety

- Your token is a secret. Never print it, paste it into comments or documents, or commit it.
  It comes from the environment or a secret store configured by your operator.
- Never create, change or archive anything in Alice before the person approves the draft in chat.
- Never claim, start or complete the tasks you create unless the person separately asks you to work on one
  or selects an execution mode after release (then follow the `alice` skill within that authorization).
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

## Planning through the `alice` command

Do the same steps with the `alice` command, following "Using the `alice` command"
(`alice --as <you> … --json`):
- `task create --title … --description-file - --status backlog --label plan:<slug> --parent ID`
- `task block ID --by BLOCKER_ID`
- `document create`, `document link`
- `search`
- `task update ID --status ready`

## Planning in project files

Before you use project files, read [PROJECT-FILES.md](PROJECT-FILES.md) in this skill's folder: the file
format, setting up `.alice/`, what to tell the user the first time, and moving to the app. Then follow the
same steps, writing files instead of calling Alice:
- **Reference document:** `.alice/docs/D-<n>-<slug>.md`.
- **Tasks:** one `.alice/tasks/T-<n>-<slug>.md` per parent and leaf, `status: backlog`, `assignee: none`,
  `labels: [plan:<slug>]`, `parent`, `docs: [D-<n>]`, and the template sections as the body.
- **Order:** `blocked_by: [T-<n>]` on the task that waits. Check for cycles yourself.
- **Release:** set `status: ready` on leaves whose `blocked_by` tasks are all `done`.
- Commit the plan as one commit (`Plan <slug>`) after the person approves it, not before.

## 1. Identify the input

| Input | Reference document | Where tasks go |
|---|---|---|
| Agreed requirements described in chat | A new planning reference summarizing the agreed needs, existing technical approach and source references | Parent tasks you create |
| An existing Alice document | That document (add a "Planning notes" section; do not rewrite it) | Parent tasks you create |
| An oversized Alice task | Its linked document; if it has none, write a planning reference from the agreed task and technical approach | Subtasks of that task (it becomes the parent) |

Pick the project from the input task or document (`get_task`, `get_document`). For an idea in chat,
ask during discovery which project to use (`list_projects`), recommending an existing one that fits.
Create a project (`create_project`) only for a plan with several parent tasks.

Choose a short plan slug (lowercase, hyphens, e.g. `notifications`). Every task of the plan gets the
label `plan:<slug>`; it is how you find the plan again.

## 2. Discover (mandatory, before any draft)

1. **Alice.** Look for related, duplicate or prerequisite work: `search` (tasks, documents, comments),
   `search_documents`, and `list_tasks` filtered by `projectId` and `label`. Note what to link or reuse
   and what already exists — never create a duplicate task.
   Read the source brief/design and the relevant sections of supporting documents they reference,
   including extracted architecture, contracts and data models. A main document's summary does not
   replace its authoritative detail. Resolve conflicting sources before planning dependent work;
   do not silently choose one or assume missing referenced content.
2. **Codebase** (when you run inside the repository). Find, for each part of the work:
   - the files and symbols to change;
   - prior art to follow (a similar route, component, test);
   - the test files to extend and the exact commands that verify the change;
   - the repository remote (`git remote get-url origin`), the base branch and the current commit
     (`git rev-parse HEAD`).
   Read the project's own instructions (README, CLAUDE.md, AGENTS.md, contributing docs) for conventions
   that every task must respect, and copy the relevant rules into the reference document.
3. **Readiness.** Check whether the requirements and main technical approach are sufficient for task
   breakdown. Read linked designs and existing patterns; do not require a new spec when those already
   settle the approach. If the basic problem, scope or acceptance conditions are unsettled, recommend
   `alice-think` with the missing agreements. If architecture, contracts, the data model or migration
   approach still needs a main design decision, recommend `alice-spec` with the exact questions, why
   they affect planning, and input document ids/paths. Stop before drafting or creating the plan;
   do not hide missing design in task placeholders or an instruction to decide during implementation.
4. **Planning questions.** Resolve only implementation planning details within the agreed design:
   task boundaries, file changes, sequencing, dependencies and verification steps. Choose details that
   follow existing conventions yourself. For remaining planning choices requiring the person, ask
   one question at a time, with your recommendation and alternatives, until no planning decision is
   open. Explore instead of asking whenever the answer is in the code or in Alice. If an answer would
   change the agreed needs or main design, return to the readiness rule rather than deciding it here.
5. **Definition of Done handoff.** When an approved technical design contains a DoD, do not renegotiate
   it. Map each applicable criterion to leaf acceptance criteria, Verification and Done when; put checks
   spanning leaves in the parent's Done when and give their execution a leaf task. Cite the design
   rather than copying its criteria into the planning reference. When established patterns make a
   separate design unnecessary, use the source quality/transition requirements and acceptance
   conditions; do not require `alice-spec` merely to create a DoD.
6. **Testing design handoff.** When an approved design contains Testing design, map its scenarios and
   critical cases to leaf tasks, existing test files/suites and exact verification commands without
   redesigning the coverage. When it is absent, use source acceptance conditions, established test
   patterns and any agreed prototype/investigation validation; do not require Testing design for every
   plan.

The finished plan contains no "TBD", "to be decided", "ask someone", "see the code" or similar.

## 3. Draft in chat and get approval

Before presenting the plan for approval, use the existing pre-creation checklist to compare every
in-scope requirement and its acceptance conditions with the proposed leaf tasks and their acceptance
criteria, including applicable DoD criteria and Testing design from an approved design. Each
requirement needs task coverage or an evidence-based reason why no system change is
needed; use source sections when ids are absent. Fix planning omissions before presenting the plan.
If coverage needs a missing main technical design decision, follow the readiness rule and recommend
`alice-spec` rather than inventing the design. Report coverage briefly (complete, or the specific gaps),
without a separate document or approval gate. Coverage means the plan addresses the requirements,
not that implementation or tests have passed.

Show the complete plan in chat — nothing is written to Alice yet:

1. the reference document (full text for a new one, or the Planning notes you will add);
2. a tree of parent and leaf tasks with titles, labels and priority;
3. the blocker edges ("B waits for A") — check there are no cycles;
4. the full description of every leaf task (leaf template) and every parent (parent template);
5. the result of the pre-creation checklist in TEMPLATE.md.

Apply the person's edits to the draft and show the changed parts again. Proceed only on explicit approval.

## 4. Create in Alice

In this order, after approval. Create calls return the new object wrapped: `create_task` returns
`{ task: { id, … } }` and `create_document` returns `{ document: { id, … } }` — use `task.id` and
`document.id` in the following calls.

1. **Reference document.** `create_document` (or `update_document` with the complete new body for an
   existing one — every edit keeps a revision). Link it to the project with `link_document { id, projectId }`.
2. **Parent tasks.** `create_task { title, description, projectId, status: "backlog", priority, labels }`.
   For an oversized-task input, the input task is the parent; do not create another.
3. **Leaf tasks.** `create_task` with `parentId`, `status: "backlog"`, no `assigneeId`. Fix a wrong parent
   later with `set_task_parent`.
4. **Order.** `add_task_blocker { id, blockerId }` for each edge ("`id` waits for `blockerId`").
   `RELATIONSHIP_CYCLE` means the draft has a cycle: stop and fix the draft with the person.
5. **References.** `link_document { id, taskId }` for the reference document on every parent and leaf,
   and for every other Alice document a task cites, including relevant extracted supporting documents.
   For project files, include those ids in the task's `docs` list; external/repository sources remain
   precise body references. Cite title, id/path, section and why each source is needed in References.
   Link only what that task needs; do not create a separate artifact index document.
6. **Report** a table: id, title, parent, blocked by, status.

If a call fails midway, report what was created (ids) and what was not; do not retry blindly or create
duplicates. Resume from the first missing item after checking with `list_tasks { label: ["plan:<slug>"] }`.

## 5. Release

Use the short closing prompts in TEMPLATE.md. First ask whether to change eligible tasks to
**ready (พร้อมทำ)**; explain that this makes them available for people or agents to pick up. Do not
use "release" or "ปล่อยงาน" alone in user-facing prompts. This status approval does not authorize
implementation. If the person declines or has not answered, leave the tasks in backlog and stop;
do not ask the execution-mode question.

On yes, re-read the plan's tasks. Use `update_task { id, status: "ready" }` only for unassigned
**backlog leaves** whose blockers are all done (use `get_task_relations`). Leave parent tasks, claimed
tasks and leaves with unfinished blockers unchanged. Report how many are ready and what still waits.
If none can be started, explain why and stop instead of offering to start unavailable work.

Then ask how the person wants to proceed: work continuously through the plan, finish one task and ask
before the next, or do not start. Also invite them to type a task name or id to work only on that task.
Accept a short number or plain-language answer; ask for clarification only when it is ambiguous.
Do not pick a mode from silence or from the earlier approval of the plan or ready status.

After an explicit choice to work, follow `alice` with the selected workspace, plan label, concrete
leaf task ids, source references and the chosen mode. Claim one task immediately before working it;
never claim the whole plan at once. Choosing not to start leaves the ready statuses in place. A named
task authorizes only that task; if blocked, name its prerequisites and ask before adding any to the
work scope. Do not invoke think or spec when reporting a design/scope blocker; recommend the next step.

Alice does not promote tasks automatically when blockers finish. Continuous mode explicitly authorizes
the working agent to promote newly eligible backlog leaves of this same plan as needed, without another
release question. In one-at-a-time mode, the next-task question includes changing that task to ready
when needed. Outside an authorized execution mode, a later request to "release the next tasks" still
requires showing eligible leaves and confirming their change to ready before updating them.

## Sizing and structure

- **Leaf = one reviewable change**: one commit or pull request, about half a day to a day of focused work,
  verifiable on its own through its acceptance criteria.
- **Vertical slices**: each leaf delivers working behavior through the layers it needs (schema → service →
  API → UI → test), not "all the database work" then "all the API work".
- **Depth**: parent → leaf. A large plan may use a project above the parents. No deeper nesting.
- **Split** a leaf when it has more than 7 acceptance criteria, touches unrelated areas, or its title needs
  "and" to join separable work.
- **Spikes**: investigation only as a leaf labelled `spike` that states the question and the output
  (usually an Alice document) — never hidden inside an implementation task. A spike here may clarify
  implementation within an agreed design; unresolved main design choices follow the readiness rule
  and are recommended to `alice-spec` before planning.
- **Parallelism**: add a blocker only for a real ordering need (uses another task's output, or edits the
  same files). Otherwise leave tasks independent so several people or agents can work at once.
- **Size budget**: keep a leaf description under ~8,000 characters and the reference document compact
  (under ~20,000 characters) so `get_task_context` returns both without truncation. Put shared material
  in the reference document once instead of repeating it in every task.
- **Labels**: `plan:<slug>` on every task, plus area labels (`backend`, `web`, `cli`, `desktop`, `docs`,
  `test`, …) and `spike` where it applies. At most 20 labels of 40 characters each.
- **Priority**: follow the reference document's order of importance (`urgent`, `high`, `medium`, `low`).

## References that survive

Whoever picks up a task may be on another machine, without the repository, or on a newer commit.

- Record the **repository remote, base branch and planning commit** in the reference document and in
  every parent task.
- In leaf tasks, cite code as `path` → `symbol` (function, component, route, test name). Add a line number
  only as a hint.
- When the remote is on GitHub, add permalinks pinned to the planning commit:
  `https://github.com/<owner>/<repo>/blob/<commit>/<path>#L<start>-L<end>`.
- Quote short critical excerpts (an interface, a schema, a config block — at most ~20 lines) in the task
  or the reference document instead of making people look them up.
- Cite Alice documents by id and title, and link them to the task.
- When source requirements have ids, cite `<source brief id/path> / REQ-001` in relevant tasks and
  acceptance criteria. Preserve those ids; use source sections for older documents without ids.
- Outside links (specs, vendor docs) go under References → External with a one-line reason.

## Revising an existing plan

When asked to change a plan that already exists in Alice:

1. Find it: `list_tasks { label: ["plan:<slug>"], archived: "all" }` and its reference document.
2. Re-run discovery, including the readiness rule, for what changed. If main design decisions are
   missing, report affected work and recommend `alice-spec` without changing existing tasks or source
   designs. Otherwise draft a **change set** in chat: tasks to add, tasks to modify (with the new text),
   tasks to archive, blocker changes, reference document changes.
3. After approval:
   - unclaimed `backlog` or `ready` tasks may be updated (`update_task`) or archived (`archive_task`);
   - claimed, `in_progress` or `blocked` tasks are **not edited**: `add_comment` describing the change and
     mention the assignee by name;
   - `done` tasks are not touched; further work becomes new tasks;
   - update the reference document with `update_document` (complete new body; the revision is kept).
4. Release new or newly unblocked leaves as in step 5, after confirmation.

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
