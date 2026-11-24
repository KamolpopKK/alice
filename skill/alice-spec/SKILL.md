---
name: alice-spec
description: Design the technical solution for agreed requirements in an Alice brief, document, task or chat. Produce an approved technical design covering only the architecture, data, contracts, integrations or migration the work needs, then recommend the next skill without invoking it. Use for technical design before task planning, not for deciding product scope (use alice-think), breaking work into tasks (use alice-plan), or implementation (use alice).
version: 0.2.9
---

# Technical design in Alice

Turn agreed needs into a technical design that someone can plan without making the main design
decisions again. Choose content by relevance; not every change needs architecture, a new data model or
a rollout design. Act through the `alice` MCP server, the `alice` command or the project's `.alice/`
files, under your own agent identity. Requires an Alice server speaking MCP contract v1.

For runtime Alice Documents, read [DOCUMENT-KNOWLEDGE.md](DOCUMENT-KNOWLEDGE.md) before finding or
saving designs. Project files do not have these lifecycle fields or typed relations.

Use existing project understanding to discover the current system before proposing changes. A named
code location can be the starting point, with a short relationship lookup; unclear/cross-service work
starts from the overview. Follow relevant detail and verify source baselines and dirty changes. Keep
as-inspected knowledge distinct from proposed design. Recommend alice-understand only for a material
knowledge gap; do not invoke it automatically or load all knowledge for every design.

Before formatting the design or a spike, read [TEMPLATE.md](TEMPLATE.md). It defines the output shape
and links the shared requirement-reference and Mermaid conventions. Select only relevant content,
keeping the selected template headings and fields.

Use revision-specific source evidence for technical decisions; expose contradictions rather than treating curated/current as universally correct. Follow the shared document-knowledge guide.

## Safety

- Your token is a secret. Never print it, paste it into comments or documents, or commit it.
  It comes from the environment or a secret store configured by your operator.
- Tests, builds, linters, local project commands and their retries need no Alice-specific approval
  merely because they execute code, create local artifacts or start a local test service. Explain
  meaningful verification in progress updates, then run it autonomously. Request approval only when
  the concrete operation independently requires it, such as changing production or an external system,
  spending money, deleting or irreversibly migrating data, changing credentials or permissions, or
  causing a material effect outside the scoped workspace. If required approval is declined or
  unanswered, leave that operation unrun and report the limitation.
- Never save or change a design in Alice before the person approves the complete content in chat.
- Do not implement the design, change production code, claim or work tasks, or create a work breakdown.
  Create only a spike task the person has explicitly agreed to.
- Recommend other skills as next steps; never invoke them as part of this workflow.
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

## Designing through the `alice` command

Use the command under your own identity, following "Using the `alice` command":
- `search QUERY`, `document search QUERY`, `project list`
- `document show ID`, `task show ID`
- `document create --title … --body-file - --project ID`, `document update ID --body-file -`
- `document link ID --project ID`, `document link ID --task ID`
- For an agreed spike: `task create --title … --description-file - --status ready --label spike`

Reading files and using Alice list/search/get tools is discovery, not executing a check. Tests, builds,
type checks, schema or contract validation, benchmark or prototype runs, and trial migrations are checks
and always require approval for each execution, including ones that only read data.

## Designing in project files

Before using project files, read [PROJECT-FILES.md](PROJECT-FILES.md) and follow its format and setup
rules. Use `.alice/tasks/` and `.alice/docs/` for discovery. Save an approved design as
`.alice/docs/D-<n>-<slug>.md`, or update the existing design file. Cite the source brief and other
references by id and path in its body. An agreed spike is a task file with `status: ready`,
`assignee: none`, `labels: [spike]` and `docs: [D-<n>]` only if a saved design already exists.
Commit approved changes on their own (`Design <slug>` or `Add T-<n>: <title>`).

## 1. Establish the input

Accept an Alice brief, another document, an existing task or requirements agreed in chat. Do not
require an `alice-think` document or run think first. Read the input and its references using
`get_document`, `get_task` and `search_documents` where applicable.

Confirm from the evidence that the problem, goal, scope and acceptance conditions are clear. Ask only
for missing information. If the work needs its basic purpose or scope reconsidered, explain what is
unsettled and recommend `alice-think`, with the existing input as context; do not invoke it.

Choose the project from the input or the person's instruction. Otherwise use `list_projects` and ask
which to use, recommending an existing project or `Untitled`. In project files, use the repository's
board. Settle the destination before presenting the design for approval or creating a spike.

Search for an existing design for this work. Default to one technical design document per subject,
separate from the requirements brief. Propose updating that design rather than making a duplicate.
Keep unchanged requirements in their source and reference them; do not rewrite the brief or silently
replace an earlier decision. Surface conflicts and get agreement on what changes.

Use the shared Type, Scope and Source header. Keep topics in the main design unless they are reused
across work, need independent updates or make it difficult to read. Follow TEMPLATE.md and the shared
splitting rules for any extracted architecture, contract or data-model document: keep full detail in
that source, and retain an explanatory summary and a precise reference in the main design.

## 2. Discover and choose the approach

When code or documents are accessible, read them before designing. Look for the current behaviour,
boundaries, data ownership, contracts, existing patterns and relevant tests or operational constraints.
Identify the repository and revision when available, and cite paths and symbols for the evidence used.
If a source is inaccessible, state that limitation and distinguish assumptions from observed facts.
Do not claim compatibility or verification from reading alone.

Choose internal details that follow existing conventions yourself. Discuss choices with significant
trade-offs or that are difficult to reverse before elaborating the design: for example a new service,
public contract changes, storage choices or a data migration. Explain your recommendation, realistic
alternatives and what each gives up. Ask dependent questions only after their prerequisites are settled.

Preserve the agreed requirements and constraints. If design reveals that a requirement, user-visible
behaviour, scope, cost limit or commitment must change, put that specific change to the person. Do not
restart the entire discovery process or silently change the agreement. If the change needs broader
product thinking, recommend `alice-think` with the affected decisions and references, then stop there.

Use checks when they would resolve a concrete assumption, not as a compulsory suite for every design.
Before each execution, follow the approval rule in Safety. Report what was actually checked and the
result; keep proposed verification separate from completed checks. Do not create a prototype or run
implementation work as an implicit part of discovery.

Before drafting, agree the Definition of Done (DoD). Read existing agreements in the requirements,
repository and earlier designs first, then ask only about gaps, one question at a time with a
recommendation. For each area, agree what applies, what must pass and what verification or evidence
will demonstrate it. An area may be not applicable with a reason; do not require every check for every
design.

| Area | Discuss as relevant to the work |
|---|---|
| Test levels | Unit, integration, end-to-end and any other needed levels; cases and pass criteria. |
| Security | Required security checks and pass criteria. |
| Deployment / operation | Rollout, rollback, backup/restore and observability (logs, metrics, alerts). |
| Performance testing | Workload, environment, measurements and pass thresholds. |
| Accessibility / compatibility | Keyboard and screen-reader use; supported browsers, devices and versions. |
| Data integrity / reliability / recovery | Migration data preservation, timeout/retry behavior and recovery after failures. |
| Documentation | User guides, API documentation and runbooks that must be updated. |

Do not invent missing thresholds or treat silence as an exemption. Settle required criteria before
presenting the design. If an answer changes an agreed requirement, scope, cost or commitment, follow
the existing requirement-change rule above. If discussion cannot settle a technical choice needed for
the DoD, follow the spike rule below. Record every area in the design as agreed criteria or a justified
exclusion, with its requirement/design coverage, verification, pass criteria and required evidence.
Writing a proposed check does not authorize executing it.

Add a **Testing design** only when risk, complexity or coordination across test levels/suites means
planning should not design the coverage itself. Reuse repository test seams, suites and fixtures before
proposing new ones. Connect source requirements and acceptance conditions to scenario groups and
critical cases, their level/suite, setup and test data/environment, action, expected result and required
evidence. Cover happy paths, boundaries, authorization, failure/recovery, compatibility, accessibility,
security and performance only where the requirements and DoD make them relevant. Do not enumerate
every assertion or invent cases without a risk or requirement.

For a prototype, spike or investigation whose DoD justifiably excludes automated tests, omit Testing
design. Record the alternative validation under Verification and evidence: the question, method (for
example demo, user feedback, experiment or benchmark), expected evidence, decision criterion and time
limit/end condition. A throwaway prototype must state that it will not be merged, deployed or reused in
production. If the person later chooses to productionize it, design and add the required tests before
production handoff.

## 3. Resolve blocking uncertainty

Before recommending planning, settle choices that determine architecture, contracts, the data model
or the migration approach. Planning may choose implementation details that do not change the design.
Do not hide an unresolved design choice behind "TBD" or an instruction to the planner to decide it.

When discussion and available evidence cannot settle a choice, propose a spike: one question, enough
context to understand it independently, the investigation or prototype needed, the expected output and
a time limit. Create it only after the person agrees:
- `create_task { title: "Spike: <question>", description, projectId, status: "ready", labels: ["spike"] }`.
- If a saved design exists, `link_document { id: <design id>, taskId: <spike id> }`. Otherwise include
  source references in the task; do not create a document merely to support it.
- Report it by title with the decision waiting on it. Do not claim or execute the spike yourself.

Keep unfinished decisions in chat. If work pauses, summarize settled decisions, evidence, limitations
and remaining questions there; do not save a draft design. When spike findings arrive, discuss their
implications and record the resulting decision before finishing the design.

## 4. Write the technical design in chat

Use only the sections the work needs. The design should specify observable technical behaviour and
interfaces enough to avoid redesign during planning, grounded in the existing system. It need not list
every file to change, implementation step or task dependency; that belongs to planning.

Use the technical design template in [TEMPLATE.md](TEMPLATE.md). Cite the source brief id/path and
stable requirement ids in the sections that satisfy them. Use Mermaid for relevant diagrams with the
shared title, purpose and explanation wrapper. Syntax and render validation are normal local checks;
follow Safety only when their concrete target or side effects independently require approval.

| Content | Include when |
|---|---|
| **Purpose, scope and references** | Always: what is being designed, the source requirements by id/path, relevant existing designs, constraints, and any approved changes to earlier decisions |
| **Architecture and interactions** | Responsibilities or system boundaries change: components, ownership, data/request flow, dependencies and failure boundaries; use a diagram when it clarifies the design |
| **Technical data model** | Data changes: entities, schemas, relationships, invariants, lifecycle, retention and concurrency needs |
| **Contracts and integrations** | Interfaces change: API/event shapes, validation, errors, authorization, versioning, compatibility, retries and idempotency as relevant |
| **Behaviour and failure handling** | Technical execution needs specifying: state transitions, ordering, consistency, recovery and degraded behaviour |
| **Migration, rollout and rollback** | Existing data, users or consumers are affected: compatibility during transition, sequence, activation, monitoring, rollback conditions and irreversible steps |
| **Operational design** | Running the change introduces needs: configuration, secrets handling, observability, capacity, security controls and support/recovery procedures |
| **Definition of Done** | Always: agreed criteria or justified exclusions for every DoD area, linked to requirements/design coverage, verification, pass criteria and evidence |
| **Testing design** | Risk, complexity or several test levels/suites require agreed scenario groups, critical cases, setup/data, expected results and evidence before planning |
| **Decisions and alternatives** | Always: the chosen approach and why; significant alternatives rejected and their trade-offs |
| **Verification and evidence** | Always: how the design satisfies the source acceptance conditions, evidence read, checks actually run and their results, and checks not run or unavailable sources |
| **Remaining implementation details** | Details can wait without changing the design: state the boundary within which planning may choose; blocking design questions stay in step 3 |

Keep the design compact (under ~20,000 characters) and link source material rather than copying it.
An approved design does not imply it has been implemented, tested or deployed.

## 5. Approve, save and recommend

Show the complete design, title, destination and whether it creates or updates a document. Apply edits
and show changed parts again. Wait for explicit content approval before saving. Keep the requirements
brief separate; its id/path belongs in the design's references.

When splitting is needed, include the supporting documents and changed references in this same
approval. Use the existing document create/update operations for each approved document and report
their actual ids/paths. Do not finish with unresolved temporary references or silently overwrite a
shared source document.

Use `create_document { title, body }` for a new design, or re-read an existing design before
`update_document { id, title, body }` with the complete approved body to avoid overwriting changes.
If it changed since the approval, reconcile and show the changed content for approval again. Create
calls return `{ document: { id, … } }`; use `document.id` in subsequent links.

Use `link_document { id, projectId }` for the selected project, and `link_document { id, taskId }` for
relevant existing tasks or earlier spikes. In runtime Alice, use `link_document_relation` for an
intentional `references`, `related` or acknowledged `supersedes` relationship; cite the source
title/id/section in the body as well. In project files, use body references only and do not invent
runtime metadata or relations. If saving or linking fails, report which operations succeeded and their
ids, re-read before retrying, and avoid duplicate documents or spikes.

Report the saved document by title (or file path), what it designs and any verification limitations.
Recommend `alice-plan` to break down this design, naming the design and requirements references as
inputs. Do not invoke `alice-plan`, create its plan or release tasks. If a blocker remains, report the
question or agreed spike as the next step instead of recommending planning. The person chooses when
to continue and which skill to use.

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
