---
name: alice-plan
description: Break a feature idea, an Alice document or an oversized Alice task into a reviewed, linked and ordered work breakdown in Alice whose tasks can be picked up without asking anyone. Use when asked to plan, break down, decompose or scope work in Alice — not for working on an existing task (use the alice skill).
version: 0.2.0
---

# Planning work in Alice

You turn a planning input into a work breakdown on the shared Alice board. The result must let any
person or agent pick up a leaf task, call `get_task_context`, and start immediately — no follow-up
questions, no hunting for files. You act through the `alice` MCP server under your own agent identity.
Requires an Alice server speaking MCP contract v1.

Templates and the pre-creation checklist are in [TEMPLATE.md](TEMPLATE.md). Read it before drafting.

## Safety

- Your token is a secret. Never print it or put it in tasks, documents or comments.
- Never create, change or archive anything in Alice before the person approves the draft in chat.
- Never claim, start or complete the tasks you create unless the person separately asks you to work on one
  (then follow the `alice` skill).
- Archive instead of deleting; there is no permanent delete for agents.

## Local workspaces (no MCP)

In a Local workspace (no `alice` MCP server, or `alice workspace current --json` reports
`"kind": "local"`), do the same steps with the `alice` command:
- Add `--as claude-code` or `--as codex`, plus `--json`, to every command.
- Name the workspace before creating anything.
- Use these commands:
  - `task create --title … --description-file - --status backlog --label plan:<slug> --parent ID`
  - `task block ID --by BLOCKER_ID`
  - `document create`, `document link`
  - `search`
  - `task update ID --status ready`
- Results use the `{ "ok", "workspace", "data" }` envelope.

## 1. Identify the input

| Input | Reference document | Where tasks go |
|---|---|---|
| An idea described in chat | You write a spec as a new Alice document | Parent tasks you create |
| An existing Alice document | That document (add a "Planning notes" section; do not rewrite it) | Parent tasks you create |
| An oversized Alice task | Its linked document; if it has none, write one | Subtasks of that task (it becomes the parent) |

Pick the project from the input task or document (`get_task`, `get_document`). For an idea in chat,
ask during discovery which project to use (`list_projects`), recommending an existing one that fits.
Create a project (`create_project`) only for a plan with several parent tasks.

Choose a short plan slug (lowercase, hyphens, e.g. `notifications`). Every task of the plan gets the
label `plan:<slug>`; it is how you find the plan again.

## 2. Discover (mandatory, before any draft)

1. **Alice.** Look for related, duplicate or prerequisite work: `search` (tasks, documents, comments),
   `search_documents`, and `list_tasks` filtered by `projectId` and `label`. Note what to link or reuse
   and what already exists — never create a duplicate task.
2. **Codebase** (when you run inside the repository). Find, for each part of the work:
   - the files and symbols to change;
   - prior art to follow (a similar route, component, test);
   - the test files to extend and the exact commands that verify the change;
   - the repository remote (`git remote get-url origin`), the base branch and the current commit
     (`git rev-parse HEAD`).
   Read the project's own instructions (README, CLAUDE.md, AGENTS.md, contributing docs) for conventions
   that every task must respect, and copy the relevant rules into the reference document.
3. **Questions.** Whatever the code and Alice cannot answer, ask the person — one question at a time,
   each with your recommended answer and the alternatives. Continue until no decision is open.
   Explore instead of asking whenever the answer is in the code or in Alice.

The finished plan contains no "TBD", "to be decided", "ask someone", "see the code" or similar.

## 3. Draft in chat and get approval

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
   and for every other Alice document a task cites.
6. **Report** a table: id, title, parent, blocked by, status.

If a call fails midway, report what was created (ids) and what was not; do not retry blindly or create
duplicates. Resume from the first missing item after checking with `list_tasks { label: ["plan:<slug>"] }`.

## 5. Release

Ask whether to release the plan. On yes, `update_task { id, status: "ready" }` for every **leaf** whose
blockers are all done (use `get_task_relations`). Leaves with unfinished blockers and all parent tasks
stay `backlog`; tell the person which ones and why. Agents using the `alice` skill only pick up `ready`,
unassigned tasks, so nothing is worked on before release.

Alice does not promote a task automatically when its blockers finish. When asked to "release the next
tasks" (or "release plan:<slug>"), repeat this step: `list_tasks { label: ["plan:<slug>"], status: ["backlog"] }`,
check each leaf's blockers with `get_task_relations`, show the person which leaves are now unblocked,
and on confirmation set them to `ready`.

## Sizing and structure

- **Leaf = one reviewable change**: one commit or pull request, about half a day to a day of focused work,
  verifiable on its own through its acceptance criteria.
- **Vertical slices**: each leaf delivers working behavior through the layers it needs (schema → service →
  API → UI → test), not "all the database work" then "all the API work".
- **Depth**: parent → leaf. A large plan may use a project above the parents. No deeper nesting.
- **Split** a leaf when it has more than 7 acceptance criteria, touches unrelated areas, or its title needs
  "and" to join separable work.
- **Spikes**: investigation only as a leaf labelled `spike` that states the question and the output
  (usually an Alice document) — never hidden inside an implementation task.
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
- Outside links (specs, vendor docs) go under References → External with a one-line reason.

## Revising an existing plan

When asked to change a plan that already exists in Alice:

1. Find it: `list_tasks { label: ["plan:<slug>"], archived: "all" }` and its reference document.
2. Re-run discovery for what changed, then draft a **change set** in chat: tasks to add, tasks to modify
   (with the new text), tasks to archive, blocker changes, reference document changes.
3. After approval:
   - unclaimed `backlog` or `ready` tasks may be updated (`update_task`) or archived (`archive_task`);
   - claimed, `in_progress` or `blocked` tasks are **not edited**: `add_comment` describing the change and
     mention the assignee by name;
   - `done` tasks are not touched; further work becomes new tasks;
   - update the reference document with `update_document` (complete new body; the revision is kept).
4. Release new or newly unblocked leaves as in step 5, after confirmation.
