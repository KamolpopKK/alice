// คู่มือเชื่อม agent กับ Alice: แหล่งเดียวของคำสั่งและ prompt ที่หน้า For agent แสดง
// ห้ามใส่ค่า token ลงในผลลัพธ์ใด ๆ — คนเป็นผู้วาง token เองเสมอ
import { MCP_ENDPOINT_PATH } from './version'

export const AGENT_GUIDE_CLIENTS = [
  { id: 'claude-code', label: 'Claude Code' },
  { id: 'codex', label: 'Codex' },
] as const

export type AgentGuideClient = (typeof AGENT_GUIDE_CLIENTS)[number]['id']

export interface GuideStep {
  title: string
  description: string
  code: string
  /** True when the person must run the step themselves (it handles the token). */
  human?: boolean
}

export interface AgentSetupGuide {
  client: AgentGuideClient
  label: string
  origin: string
  mcpUrl: string
  steps: GuideStep[]
  prompt: string
  /** Keeping an existing setup current after the server is upgraded. */
  update: { steps: GuideStep[]; prompt: string }
}

export const TOKEN_FILE = '~/.config/alice/token'
const BIN = '~/.local/bin'

function normalizeOrigin(origin: string): string {
  return new URL(origin).origin
}

/** The one command the person runs: reads the token without echo and writes it with mode 0600. */
export function tokenFileCommand(): string {
  return [
    'mkdir -p ~/.config/alice',
    `(umask 077; printf 'Paste the Alice agent token: '; read -rs t; printf %s "$t" > ${TOKEN_FILE}; echo)`,
  ].join('\n')
}

export function installCommands(origin: string): string {
  return [
    `mkdir -p ${BIN}`,
    `curl -fsSL ${origin}/downloads/alice.js -o ${BIN}/alice`,
    `curl -fsSL ${origin}/downloads/alice-mcp-stdio.js -o ${BIN}/alice-mcp-stdio`,
    `chmod +x ${BIN}/alice ${BIN}/alice-mcp-stdio`,
  ].join('\n')
}

export function checksumCommands(origin: string): string {
  return [
    `curl -fsSL ${origin}/downloads/manifest.json`,
    `shasum -a 256 ${BIN}/alice ${BIN}/alice-mcp-stdio   # Linux: sha256sum`,
  ].join('\n')
}

/**
 * Claude Code runs the stdio adapter, which reads the token file each time it connects: rotating a
 * token means rewriting the file and reconnecting — no profile edit, no restart. `--transport stdio`
 * must sit between the `-e` pairs and the server name, or the CLI reads the name as another pair.
 */
export function claudeMcpAddCommand(origin: string): string {
  return `claude mcp add --scope user -e ALICE_URL=${origin} -e ALICE_TOKEN_FILE=$HOME/.config/alice/token --transport stdio alice -- alice-mcp-stdio`
}

export const PATH_PROFILE_LINE = 'export PATH="$HOME/.local/bin:$PATH"'

function connectStep(client: AgentGuideClient, origin: string): GuideStep {
  if (client === 'claude-code') {
    return {
      title: 'Connect Claude Code to Alice MCP',
      description: `Adds Alice for your user through the stdio adapter, which reads the token from ${TOKEN_FILE} each time it connects. No token goes into your shell profile or Claude Code config. Check it with claude mcp get alice.`,
      code: claudeMcpAddCommand(origin),
    }
  }
  return {
    title: 'Connect Codex to Alice MCP',
    description: `Appends the stdio adapter to ~/.codex/config.toml (skip if it already has [mcp_servers.alice]). The adapter reads the token from ${TOKEN_FILE}.`,
    code: `alice mcp-config --client codex --url ${origin} >> ~/.codex/config.toml`,
  }
}

function buildPrompt(client: AgentGuideClient, label: string, origin: string): string {
  const connect =
    client === 'claude-code'
      ? [
          `5. Connect MCP for my user with exactly: ${claudeMcpAddCommand(origin)}`,
          '   Keep --transport stdio between the -e options and the name "alice". If a server named "alice" already exists (claude mcp get alice), show me its config and ask before replacing it with claude mcp remove alice --scope user.',
          '   Do not add ALICE_TOKEN to my shell profile; the adapter reads the token file.',
        ]
      : [
          `5. Connect MCP: if ~/.codex/config.toml has no [mcp_servers.alice] section, run: ${BIN}/alice mcp-config --client codex --url ${origin} >> ~/.codex/config.toml`,
          '   If the section already exists, show it to me and ask before changing it.',
        ]
  return [
    `Set up the Alice taskboard for ${label} on this machine. Alice server: ${origin}`,
    '',
    'Rules:',
    '- Never ask me for the agent token, never read, print or echo it, and never write it anywhere yourself.',
    '- If I paste a token into this chat anyway, do not use it; tell me to revoke it in Alice and create a new one.',
    '- Do not use sudo. Stop and tell me if any step fails.',
    '',
    'Steps:',
    '1. Check that Node.js 22 or newer is installed (node --version). If not, stop and tell me.',
    `2. Download the tools into ${BIN}:`,
    ...installCommands(origin).split('\n').map((l) => `   ${l}`),
    `3. Fetch ${origin}/downloads/manifest.json and compare the SHA-256 of both files with it (shasum -a 256, or sha256sum on Linux). If they differ, delete the files and stop.`,
    `   If ${BIN} is not on my PATH, add this line to my shell profile: ${PATH_PROFILE_LINE}`,
    `4. Install the Alice skills (alice for working on tasks, alice-plan for breaking work down, alice-think for thinking new work through): ${BIN}/alice install-skill --client ${client}`,
    ...connect,
    '6. Stop here and ask me to place the token myself. Show me this command to run in my own terminal (it reads the token without echoing it):',
    ...tokenFileCommand().split('\n').map((l) => `   ${l}`),
    `   Tell me to get the token from the Alice owner (Admin → Agents) if I do not have one, then to restart ${label} from a new terminal, resume this conversation and reply "done".`,
    `7. After I reply "done": run ${BIN}/alice version, then call the Alice MCP tool whoami and tell me which agent identity you are connected as. If it fails, explain which step to fix.`,
  ].join('\n')
}

/** How the agent client picks up new skills after an update (skills load when a session starts). */
function restartHint(client: AgentGuideClient, label: string): string {
  return client === 'claude-code'
    ? `Start a new ${label} session so it loads the updated skills; the MCP server reconnects on its own (check with claude mcp get alice).`
    : `Restart ${label} so it loads the updated skills and adapter.`
}

function updateSteps(client: AgentGuideClient, label: string, origin: string): GuideStep[] {
  return [
    {
      title: 'Compare versions',
      description: 'Your installed CLI, adapter and skills against this server. Update when they differ, or when a skill shows "not installed".',
      code: ['alice version', `curl -fsSL ${origin}/downloads/manifest.json`].join('\n'),
    },
    {
      title: 'Download the new CLI and MCP adapter',
      description: 'Overwrites the files in place. Check the SHA-256 against manifest.json as in the first setup.',
      code: [installCommands(origin), checksumCommands(origin).split('\n')[1]].join('\n'),
    },
    {
      title: 'Reinstall the skills',
      description: 'Replaces alice, alice-plan and alice-think with the versions embedded in the new CLI and adds any skill shipped since your first setup.',
      code: `alice install-skill --client ${client}`,
    },
    {
      title: 'Restart and check',
      description: `${restartHint(client, label)} Your token file and MCP configuration stay as they are.`,
      code: 'alice version',
    },
  ]
}

function buildUpdatePrompt(client: AgentGuideClient, label: string, origin: string): string {
  return [
    `Update the Alice tools and skills for ${label} on this machine. Alice server: ${origin}`,
    '',
    'Rules:',
    '- Never read, print, change or ask for the agent token or ~/.config/alice/token.',
    '- Do not change the MCP configuration. Do not use sudo. Stop and tell me if any step fails.',
    '',
    'Steps:',
    `1. Run ${BIN}/alice version and fetch ${origin}/downloads/manifest.json. If the CLI, adapter and every skill (alice, alice-plan, alice-think) already match the manifest version, tell me everything is up to date and stop.`,
    `2. Download the new files into ${BIN}:`,
    ...installCommands(origin).split('\n').map((l) => `   ${l}`),
    '3. Compare the SHA-256 of both files with the manifest (shasum -a 256, or sha256sum on Linux). If they differ, stop and tell me; do not run them.',
    `4. Reinstall the skills: ${BIN}/alice install-skill --client ${client}`,
    `5. Run ${BIN}/alice version again and show me the before and after versions.`,
    `6. Tell me: ${restartHint(client, label)} After that, call the Alice MCP tool whoami to confirm the connection still works.`,
  ].join('\n')
}

export function agentSetupGuide(client: AgentGuideClient, originInput: string): AgentSetupGuide {
  const origin = normalizeOrigin(originInput)
  const mcpUrl = `${origin}${MCP_ENDPOINT_PATH}`
  const label = AGENT_GUIDE_CLIENTS.find((c) => c.id === client)!.label
  const steps: GuideStep[] = [
    {
      title: 'Download the CLI and MCP adapter',
      description: 'Both files come from this server and match its version. They need Node.js 22 or newer; no sudo.',
      code: installCommands(origin),
    },
    {
      title: 'Check the downloads',
      description: `Compare each SHA-256 with manifest.json. If ${BIN} is not on your PATH, add: ${PATH_PROFILE_LINE}`,
      code: checksumCommands(origin),
    },
    {
      title: 'Install the Alice skills',
      description: `Installs alice (claim, read context, comment, complete), alice-plan (break work down into ready-to-pick-up tasks) and alice-think (think a new idea or request through into a brief) for ${label}.`,
      code: `alice install-skill --client ${client}`,
    },
    connectStep(client, origin),
    {
      title: 'Place the agent token (you do this)',
      description: 'Run this in your own terminal. It reads the token without showing it and stores it readable only by you. To rotate the token later, run it again and reconnect the MCP server.',
      code: tokenFileCommand(),
      human: true,
    },
    {
      title: 'Restart and check',
      description: `Restart ${label} from a new terminal, then ask it to call the Alice tool whoami.`,
      code: 'alice version',
    },
  ]
  return {
    client,
    label,
    origin,
    mcpUrl,
    steps,
    prompt: buildPrompt(client, label, origin),
    update: { steps: updateSteps(client, label, origin), prompt: buildUpdatePrompt(client, label, origin) },
  }
}

// ---------- Local workspaces (Alice Desktop on this computer) ----------
// ไม่มี server, URL, token หรือ MCP: คำสั่ง alice มากับ Alice Desktop และอ่าน credential เองจาก OS

export interface LocalAgentGuide {
  client: AgentGuideClient
  label: string
  /** Pasted into the agent: it checks the alice command, enables itself and confirms the workspace. */
  prompt: string
  /** The same setup by hand, for people who prefer to run the commands. */
  steps: GuideStep[]
  /** First things to ask the agent once it is set up. */
  tryPrompts: string[]
}

export const LOCAL_CLI_MISSING = 'Open Alice Desktop › Agents and choose “Install the alice command”, then ask me again.'

export function localAgentSetupGuide(client: AgentGuideClient): LocalAgentGuide {
  const label = AGENT_GUIDE_CLIENTS.find((c) => c.id === client)!.label
  const as = `alice --as ${client}`
  const steps: GuideStep[] = [
    { title: 'Check the alice command', description: 'Alice Desktop installs it. If it is missing, choose “Install the alice command” on this page.', code: 'alice version' },
    {
      title: `Give ${label} its own identity and the Alice skills`,
      description: `Installs the alice, alice-plan and alice-think skills for ${label} and lets it work in every Local workspace under its own name.`,
      code: `alice integration enable ${client}`,
    },
    { title: 'Check the connection', description: `${label} should see the workspace it will change.`, code: `${as} workspace current --json` },
  ]
  const prompt = [
    `Set up Alice for ${label} on this computer.`,
    '',
    'Alice is a taskboard that runs privately on this Mac in Alice Desktop. You work in it with the `alice` command, under your own name. There is no server, URL, token or MCP to configure.',
    '',
    'Rules:',
    '- Never use sudo, and never ask for, read or print passwords, tokens or credentials. The `alice` command reads your credential itself.',
    '- Stop and tell me if a step fails: show the command and its error.',
    '',
    'Steps:',
    `1. Run \`alice version\`. If the command is not found, stop and tell me: "${LOCAL_CLI_MISSING}"`,
    `2. Run \`alice integration enable ${client}\`. It installs the Alice skills for you and gives you your own identity in every Local workspace.`,
    `3. Run \`${as} workspace current --json\` and tell me the workspace name and alias.`,
    `4. Run \`${as} task list --status ready --json\` and summarise what is ready, or say that nothing is.`,
    `5. From now on, use the alice skill for anything about Alice tasks, projects or documents, and always pass \`--as ${client}\`. If the skill is not available in this session yet, tell me to restart you.`,
  ].join('\n')
  const tryPrompts = [
    'Look at the ready tasks in Alice and take one to work on.',
    'Create a task in Alice: “Write the install section of the README”, priority high.',
    'Use alice-think to think through “Sign-in with email” with me before we plan it.',
    'Use alice-plan to break “Sign-in with email” into tasks in Alice.',
    'Summarise which Alice tasks are blocked and why.',
  ]
  return { client, label, prompt, steps, tryPrompts }
}
