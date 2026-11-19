# Project files: an Alice board without the app

Agents can keep an Alice board as Markdown files in the project, with no Alice Desktop, server or CLI
installed. The files live in `.alice/` and are committed with the code, so the board travels with the
repository and every change shows up in `git diff`. The `alice` and `alice-plan` skills work this way
when the person chooses it, or when `.alice/tasks/` exists and nothing else is available.

When you want the web dashboard later, `alice import` brings the files into a workspace.

## Layout

```
.alice/
  README.md                what this folder is and how to work in it
  .gitignore               machine files that stay out of git
  board.md                 board name and notes
  tasks/
    T-1-login-page.md      one file per task: T-<number>-<slug>.md
    T-2-rate-limit.md
  docs/
    D-1-auth-design.md     one file per document: D-<number>-<slug>.md
```

Ids are `T-<number>` for tasks and `D-<number>` for documents. They are unique in the folder and never
reused; the next id is the highest number plus one. The slug after the id is for people only.

The skills create `.alice/` only after you agree, together with a `README.md` that explains the folder
to people and to agents without the skills, and a `.gitignore` that keeps machine-specific files out of
git: `workspace.local.json` (written by `alice workspace bind`) and `imported.json` (written by
`alice import`). They add either file when it is missing:

```
workspace.local.json
imported.json
```

## board.md

```markdown
---
name: Shop app
---
Anything the team wants to say about the board.
```

`name` becomes the project name on import. Without it, the import uses the name of the folder that
contains `.alice/`.

## Task files

```markdown
---
id: T-2
title: Payment form
status: ready            # backlog | ready | in_progress | blocked | done | canceled
priority: high           # none | low | medium | high | urgent (default none)
assignee: none           # none, or a person's or agent's name (claude-code, codex, …)
due: 2030-01-15          # optional, YYYY-MM-DD
parent: T-1              # optional
blocked_by: [T-3]        # tasks that must finish first
labels: [plan:checkout, ui]
docs: [D-1]              # linked documents
---
## Outcome
A form that takes a card.

## Activity
- 2026-11-19 claude-code: claimed
- 2026-11-19 claude-code: completed — form and validation in src/pay/Form.tsx, PR #42
```

- The body is the task description, in Markdown. The `alice-plan` template sections go here.
- `## Activity` is the task's history. Add one line per claim, comment, question, answer and completion:
  `- <YYYY-MM-DD> <who>: <what>`. Never rewrite earlier lines.
- `title` is required. `status` defaults to `backlog`.
- Quote a value that contains ` #` or starts with a quote: `title: "Fix #12"`.

## Document files

```markdown
---
id: D-1
title: Checkout design
source_url: https://example.com/spec   # optional
---
# Checkout

The document body, in Markdown.
```

## Working together through git

There is no server, so claiming relies on git:

1. Pull first. Pick a task with `status: ready` and `assignee: none` whose `blocked_by` tasks are all `done`.
2. Set `status: in_progress` and `assignee: <you>`, add an Activity line, and commit only that file
   (`Claim T-2: Payment form`). Push right away when the project has a remote.
3. If the push is rejected, pull again. If someone else claimed the task in the meantime, undo your claim
   and pick other work.
4. Finish with `status: done` and an Activity line that says what was delivered and where.

Two people can still edit the same task at the same time; git shows that as a merge conflict in the
file. For teams with several agents working in parallel, a server or a Local workspace gives atomic
claims, approvals, search and the web dashboard.

## Moving to the app

Ask your agent to set it up, or do it yourself:

- **Mac with Apple Silicon:** install Alice Desktop with
  `curl -fsSL https://github.com/KamolpopKK/alice/releases/latest/download/install-macos.sh | sh`, open it,
  and click **Install the alice command** in Agents.
- **Windows, Linux, or a team:** host or join an Alice server (see the README), and install the `alice`
  command from the app's Agents page.

Then run `alice import` in the repository, as described below. The skills tell you this the first time
an agent uses project files in a conversation, and the agent asks before installing anything.

## How the skills share this guidance

Every Alice skill (`alice`, `alice-plan`) ships the same `PROJECT-FILES.md` next to its `SKILL.md`, built
from `skill/_shared/` in this repository. Whichever skill an agent uses first, and even when only one
skill is installed, it finds the file format, the setup of `.alice/`, what to tell you the first time,
and how to move to the app.

## Importing into a workspace

```bash
alice import --dry-run          # check the files and show what would be created
alice import                    # create a new project named after board.md
alice import --project "Shop"   # or add the tasks to an existing project
```

`alice import [DIR]` reads `.alice/` (or DIR) in the selected workspace, Local or Remote:

- It checks every file first and lists every problem. Nothing is created until the files are valid.
- It creates the project (unless `--project` is given), the documents, then the tasks with their status,
  priority, due date, labels, parent, blockers and document links.
- Each task's Activity becomes one comment that starts with `Imported from tasks/<file> (T-<n>)`.
- An assignee that does not match a person or agent in the workspace is left unassigned, with a warning
  and a note in that comment.
- The new ids are written to `.alice/imported.json`. Running the import again is refused unless you pass
  `--force`, which creates a second copy.
- Import as a person. Agents finish work only with `complete` and a summary, so an import with `--as` is
  refused before anything is created when the files contain `done` tasks.

After the import, the workspace is the source of truth. Keep the files as a record or delete them; Alice
does not write back to them.
