# Connecting AI agents to Alice

Each agent gets its own identity so every change it makes is attributed to it. For Local workspaces,
use [Local agent integrations](#local-workspaces-codex-and-claude-without-mcp); no MCP setup or token
is needed. The following connection steps are for Remote servers.

The quickest way is the **Agents** page in the Alice dashboard (`/agents`, visible to every signed-in person; the old `/for-agent` link still opens it).
Pick Claude Code or Codex and either follow the steps, which already contain your server URL, or copy the setup
prompt into your agent. The agent downloads and checks the tools, installs the skills and the MCP connection, then
stops so that you place the token yourself with a command that reads it without echoing it
(`~/.config/alice/token`, mode `0600`). Both clients run the stdio adapter, which reads that file on every
connection. After you restart the agent, it calls `whoami` to confirm the connection.
The page and the prompt never ask for, show or store a token. Their text comes from `src/shared/agent-guide.ts`.

To do it by hand:

1. In Alice, open **Settings › Administration** (workspace owner), create an agent and copy its token (shown once).
2. Store the token outside your repository: an environment variable (`ALICE_TOKEN`) or a private
   file (`ALICE_TOKEN_FILE`, mode `0600`). Never commit it.
3. Install the skills and configure MCP for your client as below.

Compatibility is decided by the **MCP contract** (`/mcp/v1`), not by matching release numbers. The
skill, the stdio adapter, the server and the human clients are released separately and report their
versions separately:

- `alice version` shows the CLI, server, Desktop, adapter and installed skill versions;
- `alice-server version` shows the server, Client API range, MCP contract and schema;
- `alice-mcp-stdio --version` shows the adapter and its MCP contract.

The adapter refuses to start against a server that speaks a different MCP contract and says which
contract it needs. The `install-skill` and `mcp-config` helpers are part of the `alice` CLI. They also
work from the standalone `alice.js`, which has every skill embedded.

Alice ships five skills, and `install-skill` installs all of them unless you pass `--skill` with one
name:

| Skill | Use it to |
|---|---|
| `alice` | Work on the board: find ready tasks, claim, load context, comment and complete. |
| `alice-think` | Agree the problem, needs and scope. Create one task for small, clear work, or an approved brief with relevant requirements and flows. |
| `alice-spec` | Design the technical solution for agreed needs: architecture, data model, contracts, migration and operations where relevant. |
| `alice-plan` | Break agreed requirements and a sufficient technical approach into reviewed tasks, dependencies and verification steps. |
| `alice-understand` | Understand an existing system, connect business flows to code/services, and maintain reusable knowledge with a separate Mermaid System graph. |

Every skill talks to you about tasks and documents by their titles, adding the project or parent task
when two share a title. It shows an id only when you ask for it or an exact command needs it, and then
next to the title; tool calls, saved references and requirement ids such as `REQ-001` keep using ids.

Choose the skill for the work at hand; this is not a mandatory sequence. Think and spec
finish by recommending the next skill, with the reason and input document ids/paths. They do not
invoke it automatically. Plan also recommends think or spec when its input is not ready.

## Understanding an existing project

Use `$alice-understand` in Codex or `/alice-understand` in Claude Code, for example:

```text
Understand this project and save reusable knowledge and a Mermaid System graph.
Trace order cancellation across the API and payments repositories.
Refresh the order-service knowledge after the changes since its recorded baseline.
```

The skill supports an overview, a focused question or a refresh. It records coverage, repository
baselines (including working-tree changes), source evidence, conflicts and unknowns. Its coverage
check includes capabilities, architecture, code structure, contracts, components, stack, dependencies,
development commands and test/CI facts; it does not score the system or infer team policies from code.
Commands found are distinguished from commands executed. Configuration alone does not prove
production behavior. Inaccessible services remain explicit boundaries rather than invented details.

Outputs use existing Documents: one overview, a separate System graph with Mermaid source, and detail
documents only when useful to maintain independently. The graph shows as-inspected apps/services,
stores and external systems with evidence-backed, labelled edges and stable IDs. Dense areas get
smaller views; sequence diagrams belong in flow documents. Mermaid may display as source code in
Alice; this skill does not add a renderer or promise validation it has not performed.

Later tasks use this knowledge selectively. A precise fix can start at code plus a short relationship
lookup; unclear work starts at the overview. Update owning detail and graph when responsibilities,
contracts, dependencies or flows change, not for every internal edit. Focused refresh preserves earlier
evidence for untouched areas and never labels the whole system freshly checked. A missing baseline
requires re-inspection. Review is not automatic, and no background scan or new connector is required.

Install with `alice install-skill --client codex --skill alice-understand` (or `claude-code`), or omit
`--skill` for the whole set. An older released CLI cannot install a skill it does not bundle; use a
release containing the skill, or build this source for development. See the
[output templates](../skill/alice-understand/TEMPLATE.md) and
[walkthrough](../tests/manual/alice-understand.md).

## Downloading the tools from your server

Every Alice server serves the CLI and the stdio adapter that match its version. No sign-in is needed, and
both files run with Node.js 22 or newer without `node_modules`:

```bash
mkdir -p ~/.local/bin
curl -fsSL https://alice.example.com/downloads/alice.js -o ~/.local/bin/alice
curl -fsSL https://alice.example.com/downloads/alice-mcp-stdio.js -o ~/.local/bin/alice-mcp-stdio
chmod +x ~/.local/bin/alice ~/.local/bin/alice-mcp-stdio
```

`/downloads/manifest.json` lists `{ version, files: [{ name, path, bytes, sha256 }] }`. Compare each file with
`shasum -a 256` before running it. A server built without `npm run build:server` answers `404 NOT_FOUND`.

## Claude Code

The recommended setup (the one the Agents page uses) runs the stdio adapter, which reads the token
from a file every time it connects:

```bash
alice install-skill --client claude-code            # ~/.claude/skills/{alice,alice-plan,alice-think,alice-spec,alice-understand} (use --scope project for ./.claude)
mkdir -p ~/.config/alice && (umask 077; printf 'Paste the Alice agent token: '; read -rs t; printf %s "$t" > ~/.config/alice/token; echo)
claude mcp add --scope user -e ALICE_URL=https://alice.example.com -e ALICE_TOKEN_FILE=$HOME/.config/alice/token --transport stdio alice -- alice-mcp-stdio
claude mcp get alice                                # Status: ✔ Connected
```

- No token in your shell profile or Claude Code config.
- To rotate a token, run the second command again and reconnect the `alice` MCP server. No restart.
- Keep `--transport stdio` between the `-e` options and the name `alice`; otherwise `claude mcp add`
  reads the name as another `KEY=value` pair and fails with "missing required argument 'commandOrUrl'".

`alice mcp-config --client claude-code --transport stdio --url https://alice.example.com` prints the same
command plus an equivalent `.mcp.json` entry.

Remote HTTP instead (`alice mcp-config --client claude-code --url …`) sends
`Authorization: Bearer ${ALICE_TOKEN}`, which Claude Code expands from its environment. It needs no local
adapter, but `ALICE_TOKEN` must be set in the environment Claude Code starts from, and a rotated token
needs a restart.

## Codex

```bash
alice install-skill --client codex                  # ~/.codex/skills/{alice,alice-plan,alice-think,alice-spec,alice-understand}
mkdir -p ~/.config/alice && (umask 077 && printf %s "$ALICE_TOKEN" > ~/.config/alice/token)
alice mcp-config --client codex --url https://alice.example.com >> ~/.codex/config.toml
```

The Codex config runs the stdio adapter, which reads the token from `ALICE_TOKEN_FILE`.

## The stdio adapter

`alice-mcp-stdio` (from `npm install -g` of this repository, or `node dist/alice-mcp-stdio.js`)
forwards the exact remote tool contract over stdio. It stores no workspace data.

| Variable | Meaning |
|---|---|
| `ALICE_URL` | Alice server origin, e.g. `https://alice.example.com` |
| `ALICE_TOKEN` | Agent token, or |
| `ALICE_TOKEN_FILE` | Path to a file containing the token |

On missing configuration, an unreachable server, an invalid/rotated/revoked token or a version
mismatch it exits with code 2 and a message explaining what to fix. Tokens are never printed.

## Updating after a server upgrade

The **Keep it up to date** section of the Agents page has an update prompt and the same steps by hand:

```bash
alice version                                                   # installed CLI, adapter and skills
curl -fsSL https://alice.example.com/downloads/manifest.json    # what the server ships
curl -fsSL https://alice.example.com/downloads/alice.js -o ~/.local/bin/alice
curl -fsSL https://alice.example.com/downloads/alice-mcp-stdio.js -o ~/.local/bin/alice-mcp-stdio
chmod +x ~/.local/bin/alice ~/.local/bin/alice-mcp-stdio        # then compare SHA-256 with the manifest
alice install-skill --client claude-code                        # or codex; also adds skills shipped since
```

Then start a new agent session so it loads the updated skills. The token file and MCP configuration do
not change. A skill that `alice version` reports as "not installed" (for example `alice-plan` after an
older CLI) is fixed by the same steps.

`install-skill` rewrites the selected skills and their templates from the CLI you are running, even
if the installed version number is the same. For a source checkout, run the rebuilt CLI; a previously
downloaded standalone CLI still contains its older embedded files. Automatic Local refresh compares
version numbers only, so reinstall explicitly when you need changed templates from a build with the
same version. Use the same `--scope user` or `--scope project` as the original installation.

## Thinking new work through with alice-think

Give your agent a new idea, request, bug report or piece of feedback that has no Alice task yet. The
`alice-think` skill decides how much thinking it needs, and no more:

1. It restates the request in one line and checks, by meaning rather than wording, whether a task, plan
   or brief in Alice, or the code itself, already covers it, including work that was turned down before.
   It tries to reproduce a bug.
2. **Small and clear work** (one reviewable change, nothing left for you to decide) gets a compact
   confirmation: the complete task, its project, why no separate brief/spec/plan is needed and the
   recommended next step. It becomes `ready` only after you confirm, unless you explicitly asked to
   create it now and already supplied complete task content.
3. Anything else gets questioned in rounds. A round holds every question that can be asked now; one that
   depends on an earlier answer waits for the next round. Each question is numbered with a recommended
   answer: every question starts with `❓` and its recommendation starts with `➡️`, even when a round has
   only one question. Each is worded so that "yes" accepts it, so you can answer a round by number. The
   agent looks up facts itself and chooses internal details that follow existing conventions. It asks
   you about choices
   that change user-visible behaviour, scope, costs or commitments. Questions that could change the
   agreed needs must be resolved before handover, possibly through an agreed spike. After each round it
   reports what is agreed, what changed, what remains and what it recommends next.
4. It writes a brief as one Alice document with only the sections the work needs: problem and goal,
   source and decisions always; requirements with acceptance conditions, quality constraints, user
   journey, UI flow, domain information and transition requirements when relevant. Technical design
   belongs to `alice-spec`.
5. It stops questioning only when the decision frontier is empty and a coverage audit finds no silent
   assumption about the goal, users/outcome, scope, acceptance, constraints, risks, artifacts or
   handoff. It then shows one confirmation bundle: shared understanding, acceptance conditions, an
   artifact map (create now, update later, not needed and recommended handoff), plus the complete task,
   spike or brief when one is useful. Your single approval confirms both the understanding and the
   content. Only then does it save, or explicitly conclude that no artifact is needed. It recommends
   `alice-plan` when existing technical patterns suffice or `alice-spec` for technical design.

A question that talk cannot settle, such as how a screen should feel, becomes a **spike** when you agree:
a `ready` task labelled `spike`, with a question, context, expected result and time limit. It can stand
alone before a brief exists; link it when the brief is saved. The agent does not work the spike during
think. Unfinished agreements and remaining questions stay in chat, with a summary when you pause;
there is no saved draft brief. A spike that could change the agreed needs or scope must be resolved
before finishing the brief.

## Designing the technical solution with alice-spec

Start from an agreed brief, another document, a task or requirements in chat. A think document is not
mandatory. Spec asks only for missing information, reads accessible code and related documents, and
uses existing patterns. It discusses significant trade-offs and hard-to-reverse choices before
elaborating the design.

The output is one technical design document by default, separate from its requirements source. It
contains only relevant architecture/interactions, technical data model, contracts/integrations,
behaviour/failure handling, migration/rollout/rollback and operational design. It always explains the
purpose and references, decisions and alternatives, and verification evidence or limitations. An
existing design for the same subject is proposed for update rather than duplicated.

Before drafting, spec agrees the Definition of Done: test levels, security, deployment/operation
(including rollout, rollback, backup/restore and observability), performance testing,
accessibility/compatibility, data integrity/reliability/recovery and documentation. It reuses explicit
source agreements and asks only about gaps, with pass criteria and required evidence. Every area is
recorded in the design as agreed criteria or a justified exclusion. Missing thresholds are not guessed;
answers that change agreed needs follow the existing handoff to `alice-think`.

When risk, complexity or several suites make the coverage a design choice, spec adds an optional
Testing design that maps requirements to scenario groups and critical cases, test levels/suites,
setup/data/environment, expected results and evidence. DoD states what must pass; Testing design states
what to exercise and where; Verification and evidence separates proposed checks from approved checks
actually run. Simple work may rely on established test patterns without this section.

A prototype, spike or investigation may justifiably exclude automated tests and omit Testing design.
Its Verification and evidence instead records the question, validation method (such as a demo, user
feedback, experiment or benchmark), expected evidence, decision criterion and end condition. A
throwaway prototype is not merged, deployed or reused in production; productionizing it requires the
applicable tests first.

Tests, builds, linters, local project commands, local test services and retries are normal implementation
work: the agent reports meaningful verification and runs it without separate Alice approval. Reading or
searching files, Alice list/search/get tools, `git status`, `git diff`, `git diff --check` and static
validation likewise need no approval. The agent asks only when the concrete operation independently
requires it—for example, changing production or an external system, spending money, deleting or
irreversibly migrating data, changing credentials or permissions, or causing a material effect outside
the scoped workspace. Declined operations stay unrun and are recorded as limitations; proposed checks
remain separate from actual results.

Unresolved main design choices block the recommendation to plan. The agent can propose a spike and
create its task if you agree, while unfinished design stays in chat. If design requires a change to
the agreed needs, it asks you about that specific change; broader product questions are recommended
back to `alice-think` without invoking it.

The agent shows the complete design for approval before saving. It then recommends `alice-plan` with
the design and source requirement references when ready. It does not implement the design, run the
spike, create a plan or invoke another skill.

## Planning work with alice-plan

Ask your agent to "plan" or "break down" agreed requirements, an Alice document or a large Alice task. The
`alice-plan` skill then:

1. searches Alice for related work and, inside a repository, finds the files, prior art, tests and
   commands each task needs;
2. checks that the needs and main technical approach are settled; existing project patterns can be
   enough without a separate spec. If product agreements are missing, it recommends `alice-think`;
   if main architecture, contract, data model or migration decisions are missing, it recommends
   `alice-spec`, naming the questions and input references, and stops before drafting a plan;
3. resolves implementation planning choices within the agreed design, asking you one question at a
   time with a recommendation when needed. It determines task boundaries, files, sequencing,
   dependencies and verification steps. When an approved technical design contains a DoD, planning
   maps its applicable criteria into tasks and evidence without agreeing them again. When the design
   contains Testing design, planning maps its scenarios/cases into leaf tasks, existing suites and
   verification commands without redesigning them. Work covered by established patterns may still
   skip a separate spec and use source acceptance conditions;
4. drafts the plan and checks it itself (coverage of every requirement, task size, dependencies with no
   cycles, no duplicates, no placeholders) instead of showing you a draft to approve;
5. writes it to the board right away, labelled `plan:<slug>` and linked to the reference document, and
   makes every unassigned leaf whose dependencies are done **ready (พร้อมทำ)**. Parents and tasks still
   waiting for others stay in backlog;
6. reports in a few lines, by task title: what was created, what is ready, what waits for what, and
   whether every requirement is covered. Review the full tasks on the board;
7. asks whether to work continuously, finish one task and ask before the next, or not start. You can
   instead type the name of a specific task. Starting requires that separate choice; writing the plan
   or making tasks ready never starts work.

Each leaf follows the template in [skill/alice-plan/TEMPLATE.md](../skill/alice-plan/TEMPLATE.md): Outcome,
Context, Scope, References (repository, commit, path → symbol, permalinks), Steps, Acceptance criteria,
Verification and Done when. Whoever picks it up gets all of it from `get_task_context`.

A new planning reference summarizes agreed needs and the established technical approach; plan does
not author a new technical design. Existing source documents receive approved Planning notes without
rewriting their requirements or design. Missing design is not deferred into implementation tasks.
When a technical design supplies a DoD, applicable criteria flow into leaf acceptance criteria,
Verification and Done when; checks spanning leaves also appear in the parent's Done when, with a leaf
responsible for running them. The planning reference cites the design rather than duplicating its DoD.

The closing questions stay short, for example:

> สร้างแผน 6 งานเรียบร้อยแล้ว เปลี่ยนสถานะงานที่พร้อมทั้งหมดเป็น **ready (พร้อมทำ)** เลยไหมครับ?
> สถานะนี้เปิดให้คนหรือ agent หยิบงานไปทำได้ ส่วนงานที่ยังรอ dependency จะอยู่ใน backlog ก่อนครับ

After you agree and eligible work is ready:

> อยากเริ่มทำต่อแบบไหนครับ?
> **1. ทำต่อเนื่อง** — ไล่ทำทีละงานจนจบแผน
> **2. ทำทีละงาน** — จบงานแล้วถามก่อนเริ่มงานถัดไป
> **3. ยังไม่เริ่ม**
>
> ตอบแค่เลขได้เลย หรืออยากให้ทำเฉพาะ task ไหน พิมพ์ชื่อหรือรหัสมาได้ครับ

Choosing to work authorizes `alice` for that plan or task selection. It claims one eligible task at a
time, completes it with a summary and respects dependencies. Continuous mode includes changing newly
unblocked leaves of that same plan to ready without another status question. One-at-a-time mode asks
before the next task, mentioning any required change to ready in that same question. A named task
does not authorize doing its prerequisites or other work without asking. Tasks held by other actors
are not taken over.

Execution stops when the authorized leaves are done, a task cannot be completed, no eligible work
remains, a scope/design decision is needed, or you ask it to stop. Remaining blocked or held work is
reported. Check executions still need your approval each time, including retries. Outside an approved
execution mode, later requests to make newly unblocked tasks ready still require confirmation; Alice
does not promote them automatically.

## Output templates and diagrams

| Output | Format |
|---|---|
| Brief: requirements, journeys and UI flows | [Think template](../skill/alice-think/TEMPLATE.md) |
| Technical design: architecture, data, contracts and rollout | [Spec template](../skill/alice-spec/TEMPLATE.md) |
| Planning reference, parent tasks and leaf tasks | [Plan templates](../skill/alice-plan/TEMPLATE.md) |
| Small tasks, spikes, requirement references and diagrams | [Shared output formats](../skill/_shared/OUTPUT-FORMATS.md) |

Think and spec keep the selected headings and field order, omitting irrelevant sections rather than
creating every document type. Requirements receive stable local ids such as `REQ-001`; other documents
and tasks cite `<source brief id/path> / REQ-001`. Existing ids are not renumbered or reused. Older
documents without ids can be cited by section.

### Reuse document knowledge first

In a runtime Alice workspace, agents search before creating a brief, design, plan or reusable finding.
Document search is lexical across title, curated keywords, tags, body and source URL; its match reason is
an explanation, not semantic proof. Open and read the relevant section, then inspect lifecycle status,
owner, source and review audit. Prefer reviewed `current` knowledge, verify `draft`/`unreviewed`, and
follow relations away from `superseded` sources. Cite title + document id + section wherever knowledge is
reused. `references`, symmetric `related`, and explicitly acknowledged `supersedes` relations connect
documents; Task/Project links connect knowledge to work.

Project files remain intentionally narrower: document front matter is only `id`, `title` and optional
`source_url`, with citations in the Markdown body. Do not invent runtime lifecycle fields or typed
relations in `.alice/` files.

Each brief, design, new planning reference or separately extracted topic starts with Type, Scope and
Source in the Markdown body, plus Related documents when present. These describe its role, boundaries
and origin without adding application metadata or another approval status.

Keep brief/design topics together by default. Extract a journey, architecture, contract or data model
only when it is reused across work, needs independent updates or makes the main document difficult to
read. Full details live in one authoritative document; the main document keeps a useful summary and
an explicit title/id/path/section reference. Conflicts between sources must be resolved before relying
on them. Plan reads the relevant supporting sections and cites and links the sources each task needs,
explaining their purpose in References. No separate artifact-index document is required.

Diagrams use fenced Mermaid source: flowcharts for architecture/UI flows, sequence diagrams for
calls/events, state diagrams for lifecycles and ER diagrams for data relationships. Each has a title,
purpose and explanation. Alice renders diagrams locally, follows the app theme and keeps the source
available. Invalid syntax shows an error with the source; external resources are not supported.
Diagram source does not replace precise requirements, contracts or acceptance conditions.

Example prompts (send the next one when you choose to continue):

```text
Use alice-think to agree what comment notifications should do.
Use alice-spec to design the technical solution from brief <id>.
Use alice-plan to break down design <id>, using requirements from brief <id>.
Use alice to work on task <id>.
```

## What the skill teaches

Discover ready work → `claim_task` → `get_task_context` → progress via `add_comment` →
`complete_task` with a summary. See [skill/alice/SKILL.md](../skill/alice/SKILL.md) and the tool
contract in [mcp.md](mcp.md).

## Local workspaces: Codex and Claude without MCP

Agents do not need MCP, a server URL or a token to work in a Local workspace on your own computer
(see [Local workspaces](local-workspaces.md)). Turn an agent on in one of three places:
- during Alice Desktop's first-run setup;
- in Alice Desktop → Switch workspace → Agents;
- from a terminal:

```bash
alice integration enable codex          # or claude-code
alice integration list
alice integration disable codex         # takes effect at once; history keeps the agent's name
alice integration unassign codex --workspace personal --yes
```

Enabling an agent does three things:
1. It installs the `alice`, `alice-plan`, `alice-think`, `alice-spec` and `alice-understand` skills and their supporting files for that client.
2. It gives the agent its own identity in every Local workspace. Workspaces created later get it when
   they first open.
3. It stores the agent's credential in the OS credential store.

The skills then call `alice --as codex …` with `--json`:
- they name the target workspace before changing anything;
- they claim before working and complete with a summary;
- the Local daemon enforces the same agent rules as MCP.

Updating Alice Desktop refreshes missing skills and skills with a different version for enabled agents,
leaving disabled agents alone. `alice doctor --repair` can reinstall an existing skill with an outdated
version. For a missing skill or supporting file, or changed content at the same version, use
`alice install-skill --client codex` (or `claude-code`) from the updated CLI to reinstall the full set.

The Remote setup on the **Agents** page (MCP, the stdio adapter and downloads) is unchanged.

The Local setup prompt carries setup through verification. It finds `alice` on PATH or at
`~/.local/bin/alice`, uses available app-control tools to install the command if needed, enables only
the selected client, checks all five skills and supporting files, and selects a Local workspace before
reading ready tasks. With several Local workspaces it asks which to use. It does not claim tasks.

The agent requests the filesystem, network, Local daemon or app-control access an action needs through
its host permission system. For `EPERM` or `EACCES`, it explains the blocked action/path and retries that
action once after approval. Permission requests are part of setup, not a reason to abandon it. If access
is declined/unavailable or the approved retry fails, it explains the blocker and asks for the smallest
manual action needed, then continues without repeating successful steps. It does not change filesystem
permissions or disable sandbox protections. If UI control is unavailable, a user click may still be
needed; the prompt does not require a generic first-run confirmation when setup is already complete.

An older CLI cannot install skills absent from its embedded bundle. Setup reports which files are
missing and the need for an updated release instead of repeatedly reinstalling the same version. After
verification, start a new agent session if needed to load new skills. The completion message includes
an invocation example: `$alice-plan` for Codex or `/alice-plan` for Claude Code, with plain-language
invocation as another option.
