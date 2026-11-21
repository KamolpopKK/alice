import { CliContext, type GlobalFlags } from './context'
import { authCommand } from './commands/auth'
import { LEGACY_SERVER_COMMANDS, installSkillCommand, legacyServerCommand, mcpConfigCommand, versionCommand } from './commands/misc'
import { profileCommand } from './commands/profile'
import { workspaceCommand } from './commands/workspaces'
import { localCommand } from './commands/local'
import { doctorCommand } from './commands/doctor'
import { integrationCommand } from './commands/integration'
import { projectCommand } from './commands/project'
import { taskCommand } from './commands/task'
import { documentCommand } from './commands/document'
import { importCommand } from './commands/import'
import { activityCommand, actorCommand, openCommand, searchCommand } from './commands/workspace'
import { CliError, EXIT, codeFor, exitCodeFor, messageFor } from './errors'
import { SelectionError } from './workspaces'
import { Output } from './output'
import { CLI_VERSION } from './version'

export const USAGE = `Alice CLI ${CLI_VERSION} — work with Alice from your terminal

Usage: alice [global options] <command> [options]

Workspaces
  workspace list|current|use|create|rename|alias|bind|unbind|status
                                          Local workspaces on this computer and Remote servers in one list
  profile add|list|show|use|remove|test   Manage named server profiles (Remote workspaces)
  doctor [--repair] [--bundle DIR]        Check the installation and Local workspaces (read-only by default)
  auth login|logout|whoami                Sign in through the browser; no passwords on the command line
  whoami                                  Same as: alice auth whoami
  version                                 CLI, Client API and server versions

Work
  project list|show|create|update|archive|restore
  task list|show|create|update|assign|claim|comment|comments|complete|archive|restore|parent|block|unblock|relations|activity
  document list|search|show|create|update|review|unreview|relations|relate|unrelate|link|unlink|archive|restore|revisions|restore-revision   (alias: doc)
  search QUERY [--kind task|document|comment] [--tag TAG] [--status STATUS] [--owner ACTOR|none] [--project ID|NAME]
  import [DIR] [--project ID|NAME] [--dry-run]   Bring a board kept as Markdown files (.alice/) into this workspace
  activity [--actor ID] [--type task|project|document] [--limit N | --all]
  actor list
  open task|project|document ID [--web | --desktop] [--print]

  Run "alice <group> help" for the options of each group. Lists show 50 items unless --limit N or --all.
  Markdown bodies can come from a file or stdin: --description-file PATH, --body-file -.
  Archive and other destructive commands ask first; pass --yes in scripts.

Agents
  integration list|enable|disable|unassign|refresh   Codex and Claude in Local workspaces (no MCP needed)
  install-skill --client claude-code|codex [--scope user|project] [--skill alice|alice-plan|alice-think|alice-spec|alice-understand]
  mcp-config --client claude-code|codex [--transport http|stdio] [--url URL]

Global options
  --workspace W    Use this workspace (Local alias or id, or Remote profile) for one command
  --as AGENT       Act as a Local agent identity: codex or claude-code (also ALICE_AGENT)
  --profile NAME   Use this profile for one command
  --server URL     Use the profile whose server is URL
  --json           One JSON value on stdout
  --jsonl          One JSON object per line on stdout
  --no-color       Disable colors (also NO_COLOR=1)
  --quiet, -q      Hide progress and warnings on stderr
  --help, -h       Show help

Server administration moved to alice-server (serve, migrate, backup, restore, export, purge).
Exit codes: 0 ok, 1 internal, 2 usage/validation, 3 auth, 4 not found/invalid state, 5 compatibility, 6 network.`

const GLOBAL_VALUE = new Set(['--profile', '--server', '--workspace', '--as'])
const GLOBAL_BOOL = new Set(['--json', '--jsonl', '--no-color', '--quiet', '-q', '--help', '-h'])

/** Extracts global options from anywhere on the command line. */
export function splitGlobals(argv: string[]) {
  const flags: GlobalFlags = {}
  const bools = new Set<string>()
  const rest: string[] = []
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--') {
      rest.push(...argv.slice(i))
      break
    }
    const [name, inline] = arg.startsWith('--') && arg.includes('=') ? [arg.slice(0, arg.indexOf('=')), arg.slice(arg.indexOf('=') + 1)] : [arg, undefined]
    if (GLOBAL_VALUE.has(name)) {
      const value = inline ?? argv[++i]
      if (value === undefined) throw new CliError(`${name} needs a value`)
      flags[name.slice(2) as keyof GlobalFlags] = value
    } else if (GLOBAL_BOOL.has(arg)) bools.add(arg)
    else rest.push(arg)
  }
  return { flags, bools, rest }
}

export async function main(argv: string[], env: NodeJS.ProcessEnv = process.env): Promise<number> {
  let out = new Output({ json: false, jsonl: false, color: false, quiet: false })
  try {
    const { flags, bools, rest } = splitGlobals(argv)
    const json = bools.has('--json')
    const jsonl = bools.has('--jsonl')
    if (json && jsonl) throw new CliError('Choose either --json or --jsonl')
    const color = !bools.has('--no-color') && !env.NO_COLOR && !!process.stdout.isTTY && env.TERM !== 'dumb'
    out = new Output({ json, jsonl, color, quiet: bools.has('--quiet') || bools.has('-q') })
    const [command, ...args] = rest
    if (!command || bools.has('--help') || bools.has('-h') || command === 'help') {
      out.line(USAGE)
      return command || bools.size ? EXIT.ok : EXIT.usage
    }
    const ctx = new CliContext(out, flags, env)
    switch (command) {
      case 'local':
        return await localCommand(ctx, args)
      case 'doctor':
        return await doctorCommand(ctx, args)
      case 'integration':
      case 'integrations':
        return await integrationCommand(ctx, args)
      case 'workspace':
      case 'workspaces':
        return await workspaceCommand(ctx, args)
      case 'profile':
        return await profileCommand(ctx, args)
      case 'auth':
        return await authCommand(ctx, args)
      case 'whoami':
        return await authCommand(ctx, ['whoami', ...args])
      case 'login':
        return await authCommand(ctx, ['login', ...args])
      case 'logout':
        return await authCommand(ctx, ['logout', ...args])
      case 'project':
      case 'projects':
        return await projectCommand(ctx, args)
      case 'task':
      case 'tasks':
        return await taskCommand(ctx, args)
      case 'document':
      case 'documents':
      case 'doc':
      case 'docs':
        return await documentCommand(ctx, args)
      case 'import':
        return await importCommand(ctx, args)
      case 'activity':
        return await activityCommand(ctx, args)
      case 'actor':
      case 'actors':
        return await actorCommand(ctx, args)
      case 'search':
        return await searchCommand(ctx, args)
      case 'open':
        return await openCommand(ctx, args)
      case 'version':
      case '--version':
        return await versionCommand(ctx, args)
      case 'install-skill':
        return await installSkillCommand(ctx, args)
      case 'mcp-config':
        return await mcpConfigCommand(ctx, args)
      default:
        if ((LEGACY_SERVER_COMMANDS as readonly string[]).includes(command)) return legacyServerCommand(ctx, command, args)
        throw new CliError(`Unknown command: ${command}`, 'usage', 'See: alice --help')
    }
  } catch (err) {
    out.error(messageFor(err), err instanceof CliError ? err.hint : undefined)
    out.machineError(codeFor(err), messageFor(err), {
      ...(err instanceof CliError && err.hint ? { hint: err.hint } : {}),
      ...(err instanceof SelectionError ? { choices: err.choices } : {}),
    })
    return exitCodeFor(err)
  }
}
