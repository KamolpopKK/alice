# Connecting AI agents to Alice

Each agent gets its own identity and token so every change it makes is attributed to it.

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

Alice ships three skills, and `install-skill` installs all of them unless you pass `--skill` with one
name:

| Skill | Use it to |
|---|---|
| `alice` | Work on the board: find ready tasks, claim, load context, comment and complete. |
| `alice-think` | Think new work through first: hand small, clear work straight to a task, question the rest until you agree, and write a brief. |
| `alice-plan` | Break an idea, an Alice document or a large task into ready-to-pick-up tasks. |

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
alice install-skill --client claude-code            # ~/.claude/skills/{alice,alice-plan,alice-think} (use --scope project for ./.claude)
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
alice install-skill --client codex                  # ~/.codex/skills/{alice,alice-plan,alice-think}
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
   itself, leaves every decision to you, records "I don't know" as an open question with an owner, and
   asks you to confirm the shared understanding before it writes anything.
4. It writes a brief as one Alice document with only the sections the work needs: problem and goal,
   source and decisions always; user journey, requirements, spec, out of scope and open questions when
   they apply.
5. It shows the brief in chat, saves it after your approval, and names the next step: planning it with
   `alice-plan`, or designing the architecture first.

## Planning work with alice-plan

Ask your agent to "plan" or "break down" a feature, an Alice document or a large Alice task. The
`alice-plan` skill then:

1. searches Alice for related work and, inside a repository, finds the files, prior art, tests and
   commands each task needs;
2. asks you only what it cannot find, one question at a time with a recommendation;
3. shows the whole breakdown in chat (reference document, parent and leaf tasks, blockers, full task
   text) and waits for your approval;
4. creates it as `backlog`, labelled `plan:<slug>`, linked to the reference document;
5. on your confirmation, releases unblocked leaves to `ready`. Later, ask it to "release the next tasks"
   once blockers are done; Alice does not promote them automatically.

Each leaf follows the template in [skill/alice-plan/TEMPLATE.md](../skill/alice-plan/TEMPLATE.md): Outcome,
Context, Scope, References (repository, commit, path → symbol, permalinks), Steps, Acceptance criteria,
Verification and Done when. Whoever picks it up gets all of it from `get_task_context`.

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
1. It installs the `alice`, `alice-plan` and `alice-think` skills for that client.
2. It gives the agent its own identity in every Local workspace. Workspaces created later get it when
   they first open.
3. It stores the agent's credential in the OS credential store.

The skills then call `alice --as codex …` with `--json`:
- they name the target workspace before changing anything;
- they claim before working and complete with a summary;
- the Local daemon enforces the same agent rules as MCP.

Updating Alice Desktop refreshes the skills of enabled agents and leaves disabled ones alone.
`alice doctor --repair` reinstalls missing or outdated skill files.

The Remote setup on the **Agents** page (MCP, the stdio adapter and downloads) is unchanged.
