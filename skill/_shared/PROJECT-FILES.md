# Alice project files

Read this before you read or change a board kept as **project files**: Markdown in the repository's
`.alice/` folder, committed with the code, with no Alice app, server or CLI needed. Every Alice skill ships
this same file, so it applies whichever skill you are using.

## Layout

```
.alice/
  README.md                what this folder is, for people and agents (see "Setting up .alice/")
  .gitignore               machine files that stay out of git
  board.md                 front matter `name: <project name>`, then notes
  tasks/T-<n>-<slug>.md    one file per task
  docs/D-<n>-<slug>.md     one file per document (front matter `id`, `title`, optional `source_url`)
```

Ids are `T-<n>` and `D-<n>`, unique in the folder and never reused; a new id is the highest number in
its folder plus one. The slug is for people only.

## Task files

```markdown
---
id: T-2
title: Payment form
status: ready            # backlog | ready | in_progress | blocked | done | canceled
priority: high           # none | low | medium | high | urgent
assignee: none           # none, or a name such as claude-code or codex
due: 2030-01-15          # optional, YYYY-MM-DD
parent: T-1              # optional
blocked_by: [T-3]
labels: [plan:checkout]
docs: [D-1]
---
<description: the task's Markdown>

## Activity
- 2026-11-19 claude-code: claimed
```

- Quote a value that contains ` #`: `title: "Fix #12"`.
- Edit only the front matter you are changing. Append to `## Activity`, one line per claim, comment,
  question, answer and completion: `- <YYYY-MM-DD> <who>: <what>`. Never rewrite earlier lines or other
  people's text.

## Setting up .alice/

Create `.alice/` only after the user agrees. Then write all of these in one commit (`Start the Alice board`):

1. `.alice/board.md` with `name: <project name>`.
2. `.alice/.gitignore` with exactly these lines, so files that belong to one computer stay out of git (do
   not edit the repository's own `.gitignore` for this):
   ```
   workspace.local.json
   imported.json
   ```
3. `.alice/README.md` with this text:

   ```markdown
   # Alice board

   This folder is the project's Alice board, kept as Markdown and committed with the code.
   `tasks/` holds one file per task and `docs/` one file per document; `board.md` names the board.

   - Pull before you pick or claim work, and commit board changes on their own.
   - Claim a task by setting `status: in_progress` and `assignee`, then commit and push that file at once.
   - Add to a task's `## Activity`; never rewrite earlier lines.
   - Agents with the Alice skills (alice, alice-plan, alice-think, alice-spec) follow these rules for you.

   Want the web dashboard? Install Alice (https://github.com/KamolpopKK/alice), then run
   `alice import --dry-run` and `alice import` here. Your agent can set it up if you ask.
   ```

If `.alice/` exists but `.gitignore` or `README.md` is missing, add the missing file the same way and tell
the user.

## The first time in a conversation

The first time you use project files in a conversation, tell the user briefly, once:
- **Where the board is:** `.alice/` in this repository; `.alice/README.md` explains it.
- **Good practice:** pull before picking or claiming work, commit board changes on their own, never edit
  someone else's Activity lines. Several agents working at the same time can still collide; the app gives
  atomic claims, approvals, search and a web dashboard.
- **Moving to the app later:** they can ask you to set it up, and `alice import` brings this board in.

## Working together through git

There is no server, so claims go through git. Pull first when the project has a remote. To claim, set
`status: in_progress` and `assignee: <you>`, add an Activity line, commit only that file
(`Claim T-2: Payment form`) and push at once. If the push is rejected, pull; if someone else claimed the
task meanwhile, undo your claim and pick other work. Commit board changes on their own, not mixed with
code, unless the user asks otherwise.

## Moving to the app

Only when the user asks, and ask before installing anything:
1. **Mac with Apple Silicon:** with the user's go-ahead, run
   `curl -fsSL https://github.com/KamolpopKK/alice/releases/latest/download/install-macos.sh | sh`. It checks
   the download and installs Alice into Applications without admin rights. Ask the user to open Alice,
   finish the first-run steps, and click **Install the alice command** in Agents.
2. **Windows, Linux, or a team:** the user needs an Alice server. Point them to "Host Alice for your team"
   or "Join an existing Alice server" in the README at github.com/KamolpopKK/alice, and to the `alice`
   command install on the app's Agents page.
3. **Import:** ask the user to run `alice import --dry-run`, then `alice import`, in this repository. They
   run it as themselves: agents never run Alice commands without `--as`, and agents cannot import `done`
   tasks.
4. After the import, the workspace is the source of truth. Work through the `alice` command from then on,
   and ask the user whether to keep or delete `.alice/tasks/` and `.alice/docs/` so there is one board.
