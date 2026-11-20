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

Alice ships four skills, and `install-skill` installs all of them unless you pass `--skill` with one
name:

| Skill | Use it to |
|---|---|
| `alice` | Work on the board: find ready tasks, claim, load context, comment and complete. |
| `alice-think` | Agree the problem, needs and scope. Create one task for small, clear work, or an approved brief with relevant requirements and flows. |
| `alice-spec` | Design the technical solution for agreed needs: architecture, data model, contracts, migration and operations where relevant. |
| `alice-plan` | Break agreed requirements and a sufficient technical approach into reviewed tasks, dependencies and verification steps. |

Choose the skill for the work at hand; this is not a mandatory four-stage pipeline. Think and spec
finish by recommending the next skill, with the reason and input document ids/paths. They do not
invoke it automatically. Plan also recommends think or spec when its input is not ready.

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
alice install-skill --client claude-code            # ~/.claude/skills/{alice,alice-plan,alice-think,alice-spec} (use --scope project for ./.claude)
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
alice install-skill --client codex                  # ~/.codex/skills/{alice,alice-plan,alice-think,alice-spec}
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
2. **Small and clear work** (one reviewable change, nothing left for you to decide) becomes one `ready`
   task straight away, with no questions. Ask the agent to do it now and it continues with the `alice`
   skill.
3. Anything else gets questioned in rounds. A round holds every question that can be asked now; one that
   depends on an earlier answer waits for the next round. Each question is numbered with a recommended
   answer, worded so that "yes" accepts it, so you can answer a round by number. The agent looks up facts
   itself and chooses internal details that follow existing conventions. It asks you about choices
   that change user-visible behaviour, scope, costs or commitments. Questions that could change the
   agreed needs must be resolved before handover, possibly through an agreed spike.
4. It writes a brief as one Alice document with only the sections the work needs: problem and goal,
   source and decisions always; requirements with acceptance conditions, quality constraints, user
   journey, UI flow, domain information and transition requirements when relevant. Technical design
   belongs to `alice-spec`.
5. It shows the brief in chat, saves it after your approval, and names the next step: planning it with
   `alice-plan` when existing technical patterns suffice, or using `alice-spec` for technical design.
   There is one content approval, without a separate confirmation of understanding. If questioning
   reduces the work to one task, it shows the complete task for approval instead of a brief. Work
   classified as small and clear at triage still creates a task directly.

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

Before **every check execution**, including tests, schema validation, trial migrations and Mermaid
syntax/render checks, the agent explains the command or operation, target, purpose and side effects,
then waits for your explicit approval. An earlier execution or content approval does not authorize a
retry or another check. Reading files and using Alice list/search/get tools is discovery. Checks you
decline stay unrun and are recorded as limitations; proposed checks are separate from actual results.

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
   dependencies and verification steps;
4. shows the whole breakdown in chat (reference document, parent and leaf tasks, blockers, full task
   text) and waits for your approval;
5. creates it as `backlog`, labelled `plan:<slug>`, linked to the reference document;
6. first asks whether to change eligible leaves to **ready (พร้อมทำ)**, explaining that people or agents
   can then pick them up. A no keeps the plan in backlog and ends the flow. Parents and unfinished
   dependencies remain unchanged;
7. after approval and a successful status change, asks whether to work continuously, finish one task
   and ask before the next, or not start. You can instead type the name/id of a specific task. Starting
   requires that separate choice; it is not implied by making tasks ready.

Each leaf follows the template in [skill/alice-plan/TEMPLATE.md](../skill/alice-plan/TEMPLATE.md): Outcome,
Context, Scope, References (repository, commit, path → symbol, permalinks), Steps, Acceptance criteria,
Verification and Done when. Whoever picks it up gets all of it from `get_task_context`.

A new planning reference summarizes agreed needs and the established technical approach; plan does
not author a new technical design. Existing source documents receive approved Planning notes without
rewriting their requirements or design. Missing design is not deferred into implementation tasks.

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

Diagrams use fenced Mermaid source: flowcharts for architecture/UI flows, sequence diagrams for
calls/events, state diagrams for lifecycles and ER diagrams for data relationships. Each has a title,
purpose and explanation. Alice currently displays the source as code; visual rendering is separate
future work. Diagram source does not replace precise requirements, contracts or acceptance conditions.

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
1. It installs the `alice`, `alice-plan`, `alice-think` and `alice-spec` skills and their supporting files for that client.
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
