---
name: alice-think
description: Clarify new ideas, requests, bugs or feedback before design or planning. Hand small, clear work straight to a task; otherwise agree the needs and scope, save an approved brief with only relevant requirements and flows, and recommend technical design or planning as the next step. Use when the work has no Alice task yet — not for technical design, breaking an agreed brief into tasks (use alice-plan), or working on an existing task (use alice).
version: 0.2.11
---

# Thinking work through in Alice

You are the first stop for new work. Adapt the depth to the work: small, clear work gets a compact
confirmation, while unclear or large work is questioned in rounds and may need a brief. Agree what
people need and the constraints; technical design belongs to `alice-spec`. Never finish like an
ordinary chat: state what you understand, recommend the artifact and handoff, and get one explicit
confirmation before creating or saving anything. The result may be no artifact, one ready task, an
agreed spike or an approved brief with a recommendation for design or planning. Recommend the next
step without invoking another skill. You act through the `alice` MCP server, the `alice` command or the
project's `.alice/` files, under your own agent identity.
Requires an Alice server speaking MCP contract v1.

For runtime Alice Documents, read [DOCUMENT-KNOWLEDGE.md](DOCUMENT-KNOWLEDGE.md) before discovery or
saving a brief. Project files do not have these lifecycle fields or typed relations.

During triage, use existing project understanding according to the question: start at named code for
a precise issue and briefly check its relationships; start at the overview for unclear/cross-service
work. Read only relevant detail and verify claims against source evidence. Recommend alice-understand
when a material understanding gap needs investigation; do not invoke it automatically or require a
whole-system survey before every brief. Preserve this skill's content-approval boundary.

Before formatting a brief, task or spike, read [TEMPLATE.md](TEMPLATE.md). It defines the output shape
and links the shared requirement-reference and Mermaid conventions. Select relevant content using
this skill; keep the selected template headings and fields.

Reuse discovered sources in the brief; separate user needs from source evidence and inference, and propose library maintenance separately. Follow the shared document-knowledge guide.

## Safety

- Your token is a secret. Never print it, paste it into comments or documents, or commit it.
  It comes from the environment or a secret store configured by your operator.
- Never save a brief to Alice before the person approves it in chat.
- Never claim, start or complete tasks while thinking. When the person wants the work done now, switch
  to the `alice` skill for that.
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
- **A spike:** a task file with `labels: [spike]`; add `docs: [D-<n>]` only if a saved brief exists.
- Commit each change on its own (`Add T-<n>: <title>` or `Brief <slug>`).

## 1. Triage (always, before any question)

Restate the request in one line. Then check what already exists, by meaning rather than by the words
used:
- **Alice:** `search` and `search_documents` for tasks, plans and briefs on the same subject, including
  canceled tasks: work that was turned down before, and why.
- **Related documents:** read relevant requirements, journeys, designs and contracts, not just search
  summaries. Note their ids or paths, what can be reused, and any conflict with the request. A related
  document is context, not proof that the new work is already covered. Surface conflicts for agreement;
  do not silently replace existing decisions or create a competing source of truth.
- **The code** (when you run inside the repository): whether the behaviour already exists.
- **A bug:** try to reproduce it from what you were told, and note the result: reproduced (with the code
  path), not reproduced, or not enough detail to try.

Then take the first route that fits:

| Route | When | What you do |
|---|---|---|
| **Already there** | A task, plan or brief covers it, or the code already does it | Point the person to it by title (or the code path). Add to it only if they ask. If it was turned down before, say why. |
| **Small and clear** | One reviewable change (one commit or pull request, at most about a day), the outcome fits in a line or two, and no decision is left for the person | Go to step 2 for a compact confirmation. |
| **Needs thinking** | Anything else: an idea, a feature, feedback or a bug whose cause or wanted outcome is unclear, work that touches several parts or needs a decision | Go to step 3. |

When you are unsure whether work is small, it needs thinking. Tell the person the route in one line
("Small and clear: I'll add it as one task") and continue at once; they can redirect you.

## 2. Small and clear: compact confirmation

Draft one complete task with an outcome, what is known (files, error or reproduction), acceptance
conditions and verification. In chat, show the task, its project, and a compact artifact map: create the
task now; name any existing documents that later implementation must update; say why a separate brief,
spec or plan is not needed; and recommend the next step. Ask the person to confirm creation. Only then
create it with `create_task { title, description, projectId, status: "ready" }` and report it by title.

Skip this confirmation only when the person explicitly told you to create the task now and already
provided complete task content. If the person wants it done now after creation, recommend switching to
the `alice` skill to claim and work on it; do not claim it during think.

## 3. Question until you share an understanding

Map the work as decisions that hang off each other: the problem and who has it, the outcome and how to
tell it worked, scope and what is out of it, requirements, flows and constraints. Ask in **rounds**. A
round holds every open question whose prerequisites are already settled, and nothing else: a question
that depends on an answer still open waits for a later round. Wait for the answers, record them, then
work out the next round afresh from what is now settled.

Ask all currently answerable questions together in one chat message. Do not default to one question
per turn or split independent questions across turns because a tool shows one at a time or limits
the number of questions. A single-question round is appropriate only when just one decision is open
or the remaining questions depend on its answer.

**Prefer choices for decisions.** Apply this to discovery rounds, small-task confirmations and final
artifact approval when a question is needed. When the alternatives are clear, offer 2–3 meaningful,
distinct options. Put the recommended option first and explain the practical trade-off for each.
Do not turn a choice into an open-ended "what do you want?", invent filler options or ask about facts
you can look up. Use a focused free-text question when the answer needs the person's own description
or information you cannot sensibly enumerate. Always allow a custom answer.

**Chat is the primary question interface.** Always show the complete round in chat, with a separate
formatted block for each question: number, literal `❓`, A/B/C options with practical trade-offs, and
a literal `➡️` recommendation with its reason. Use Markdown formatting, not a code block. Keep
question numbers continuous across rounds. The person can answer the whole round by number and
option (for example "1 A, 2 B"), accept the recommendations, or write their own answers:

```
❓ **Q1 - <short title>**: <the decision>

A. <recommended option> — <impact or trade-off>
B. <alternative> — <impact or trade-off>
C. <another meaningful alternative, only when needed> — <impact or trade-off>

➡️ A — <why it fits the known context>
```

An available, compatible choice tool may supplement this chat round with short answer labels mapped
to the same question numbers and options. It must not replace or hide the chat questions, options or
recommendations. Use it only when permitted in the current mode and the whole round fits its limits;
otherwise stay in chat. Do not split a round, change mode or require a tool just to show buttons.
Accept answers in chat even when a tool was offered. A preselected option is not an answer or approval:
wait for the person's actual response before advancing dependent work or saving.

- Start every question with the literal `❓` icon and its question number, including a free-text
  question or a round with only one question. Mark recommendations with the literal `➡️` icon.
- Make a choice question unambiguous so that "yes" accepts your recommendation. Artifact creation
  or saving still requires explicit approval of the presented content; defaults or silence never count.
- Mark a question **trade-off** when your recommendation gives up something the person may care about,
  and say what. Accepting a round wholesale must never hide one.
- **Facts are your job; product decisions are the person's.** Look up whatever the code, the repository or Alice
  can answer instead of asking. Do not hold a round for it: ask the questions that do not need that fact
  now, and the ones that do once you have it. Ask about choices that change user-visible behaviour,
  scope, costs or commitments. Choose internal details yourself when they follow existing project
  conventions and change none of those things. Leave details that are not needed yet to planning or
  design; do not turn them into questions for the person.
- **"I don't know" is an answer.** Record it as an open question with who decides. When a decision
  belongs to someone who is not in the conversation, record it with their name instead of guessing.
- **Questions talk cannot settle**, such as how something should look or feel or which of two flows works
  better: stop asking about them and propose a **spike**: a task that answers one question with a
  prototype or an investigation. Keep the question open, and create the spike only if the person agrees
  (see "Spikes").
- Point out contradictions with earlier answers, the code or existing documents as soon as you see them.
- After every answer round, show a compact checkpoint before asking again: **Agreed** (what is settled),
  **Changed** (how these answers changed the direction), **Remaining** (the important open branches)
  and **Recommendation** (the direction you advise now). Do not end on a checkpoint while a decision
  branch remains open.
- Ask rather than assume when an answer can change scope, acceptance conditions, the artifact choice or
  the handoff. You may choose a small, reversible detail when existing conventions settle it, but expose
  that assumption in the final confirmation.
- **Stop only when the decision frontier is empty and a coverage audit passes.** Confirm that the goal,
  affected users and outcome, scope and exclusions, requirements and acceptance conditions, constraints,
  risks, assumptions, project, artifact choice and handoff are settled. Mark an area irrelevant with a
  reason rather than asking checklist questions that cannot affect this work. An unknown that could
  change an agreement blocks handover: settle it with the person or propose a spike and wait for its
  findings. Technical details may remain for planning or design only when they cannot change the agreed
  needs; record their owner, next step and why they do not block. If the rounds keep growing, say the work
  is too big for one brief, propose a split and think the parts through one at a time.

**Choose the project during discovery.** Use the project the person named or the one related work is
in. Otherwise ask which project to use, recommending an existing one from `list_projects`, or `Untitled`
when none fits. Settle this before showing the brief or task for approval, or creating an agreed spike.
For project files, the repository's board is the destination; no project question is needed.

**Stopping before the brief is done.** Keep answers in chat while questioning; do not save an unfinished
brief to Alice. If the person stops, summarize the agreements and remaining questions in chat. Agreed
spike tasks are the only work saved during questioning (see "Spikes").

When the frontier is empty and the coverage audit passes, choose the smallest useful outcome: no saved
artifact, one task, an agreed spike or a brief. Build the confirmation bundle in step 5. If the work has
become one task, include its complete title, description and project instead of a brief. Small work uses
the compact version in step 2; neither route creates or saves silently.

## 4. Write the brief

Use one Alice brief by default, titled after the work. Choose content by relevance, not by a checklist
of documents to produce. Omit irrelevant sections; do not create empty sections or a document of every
type. Reference existing documents for unchanged content. Update them only when requested, with the
changes included in the approval in step 5.

Use the shared Type, Scope and Source header from TEMPLATE.md. Split out a topic only when it is
shared across work, needs independent updates or makes the brief difficult to read. Follow the shared
splitting rules: one authoritative detail source, with a summary and precise reference in the brief.
Show all affected documents in the same content approval; do not create a document per section.

Use the brief template and stable requirement ids from [TEMPLATE.md](TEMPLATE.md). Reference existing
ids without renumbering them. Use the shared Mermaid wrapper for relevant flows; do not run a diagram
syntax or render check without the person's approval for that execution.

| Section | Include when |
|---|---|
| **Problem and goal** | Always: who has the problem, what changes for them, how to tell it worked |
| **Source and references** | Always: where it came from; ids or paths of related documents when present, what remains applicable and any agreed changes |
| **Scope and out of scope** | Boundaries need stating: included users, cases and capabilities, and anything explicitly excluded |
| **Software requirements and acceptance conditions** | Behaviour is added or changed, including bugs: observable requirements, business rules, permissions and a checkable acceptance condition for each |
| **Quality requirements and constraints** | Quality or operational needs affect success: measurable performance, security, accessibility, reliability, compatibility, cost limits or support needs; state the requirement, not the implementation |
| **User journey** | The user's experience spans steps or channels: start, goal, before/after, steps inside and outside the system, and pain points |
| **UI flow and states** | Screens or interactions change: entry points, transitions, success, loading, empty, error, cancel and back paths where relevant; visual styling is left to design |
| **Domain and information needs** | Business concepts or information change: meanings, business relationships, lifecycle rules, ownership and retention needs; physical schemas and storage choices belong to technical design |
| **Transition requirements** | Existing users, data or integrations must carry over: required continuity, compatibility and acceptable disruption; migration mechanics, rollout and rollback design belong to technical design |
| **Decisions** | Always: each decision from step 3 as "question → answer", so later readers know why. Keep the exact terms agreed (numbers, limits, order, what must not happen); never soften them into general prose |
| **Open questions** | Only technical details that cannot change the agreed problem, goal, scope or acceptance conditions; each with who decides, the next step and why it does not block handover. Questions that could change those agreements stay in step 3, including "I don't know" answers and pending spikes |

Keep it short: under ~20,000 characters, so planning tools can read it in full. Write no "TBD"; an
unknown is an open question with an owner, or it goes back to step 3.

Do not produce architecture, physical data models, API/event contracts or migration/rollout designs
in think. Capture existing technical decisions as referenced constraints when already agreed. Record
new technical design needs as open questions for `alice-spec`, with the required outcome and known
constraints. For example, think agrees that existing users must keep access during migration; technical
design decides how to migrate, roll out and roll back. If design later requires changing an agreed need
or scope, that specific agreement must be revisited with the person.

## 5. Confirm, save and hand over

1. Show one confirmation bundle in chat, scaled to the work but never omitted:
   - the problem, desired outcome, affected users or flows, scope and exclusions;
   - decisions, constraints, risks and every disclosed assumption;
   - acceptance conditions;
   - an **Artifact map** with **Create now**, **Update later**, **Not needed** (with reasons) and
     **Recommended handoff**;
   - the complete task, spike or brief that will be created or saved, or the explicit conclusion when no
     artifact is useful.
   End with a direct question asking whether to create/save those artifacts and follow the recommended
   handoff. This is one approval of both the shared understanding and the content, not two approval gates.
   Apply edits and show the changed parts again before asking for approval again.
2. Act only on explicit approval. For a chat-only conclusion, save nothing and report the confirmed
   outcome. For a task, create it as in step 2. For a brief, save it with
   `create_document { title, body }`, and `link_document { id, projectId }` when it belongs to the project
   selected during discovery. For an existing brief, use `update_document` with the complete new body
   and title; every edit keeps a revision.
3. Link any earlier spikes with `link_document { id: <brief id>, taskId: <spike id> }` and include their
   findings under Decisions. Do not create them again.
4. Report the created or updated artifact by title (or that no artifact was needed), what it contains
   and the recommended next step:
   - **One task is ready:** recommend the `alice` skill if the person wants it claimed and worked now.
   - **Technical design needed:** recommend `alice-spec` with the brief id/path and related references.
     Say what needs designing and why: architecture or data structure changes, new contracts or
     integrations, migration/rollout, or significant technical trade-offs. If `alice-spec` is not
     installed, say so and recommend technical design from those same inputs.
   - **Existing technical patterns are sufficient:** recommend `alice-plan` with the brief id/path and
     references. Do not require a spec for every task; `alice-plan` needs decisions settled before the
     plan is finished.
   Recommend only; do not invoke `alice-spec` or `alice-plan`, start technical design or create a plan.
   The person chooses when to continue. If a spike still blocks the agreed needs or scope, remain in
   step 3 and report that spike as the next step instead of handing over a finished brief.

## Spikes

A spike answers one question that talk cannot settle. Create it only after the person agrees; it does
not require a saved brief:
- `create_task { title: "Spike: <question>", description, projectId, status: "ready", labels: ["spike"] }`,
  in the project selected during discovery. The description must stand on its own: include the context,
  question, what to build or investigate, the expected result (a prototype, a finding in a comment, or a
  document), and a time limit.
- If a saved brief exists, use `link_document { id: <brief id>, taskId: <spike id> }`. Otherwise link it
  when the approved brief is saved; never create a document just to support a spike.
- Report the task by title. Keep its question and whether it blocks handover in the chat summary.
  If it blocks handover, wait for the findings before finishing the brief.

When the spike is done, think the answer through with the person and record the resulting decision in
chat. Include it in the brief shown for approval, or show the changes to an existing brief for approval
before saving them.

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
