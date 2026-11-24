
import { ConfigError, loadConfig } from './config'
import { MigrationError, migrate, openDatabase, currentSchemaVersion } from './db/database'
import { serve } from './serve'
import { APP_VERSION, CLIENT_API_MIN_VERSION, CLIENT_API_VERSION, MCP_CONTRACT_VERSION } from '../shared/version'
import { LATEST_SCHEMA_VERSION } from './db/migrations'
import { parseArgs } from 'node:util'
import path from 'node:path'
import { createBackup, restoreBackup } from './ops/backup'
import { OpsError } from './ops/errors'
import { exportWorkspace } from './ops/export'
import { PURGE_SCOPES, describePlan, executePurge, planPurge } from './ops/purge'
import { InstanceLockError } from './ops/lock'
import { AliceError } from '../shared/errors'
import { CLIENTS, installSkills, mcpConfigSnippet, parseSkillOption, type AgentClient } from './agent-setup'

const USAGE = `Alice Server ${APP_VERSION}

Usage: alice-server <command> [options]

Commands:
  serve       Start the web, API and MCP server
  migrate     Apply pending database migrations and exit
  version [--json]
              Server, Client API range, MCP contract and schema versions
  backup [--out DIR]
              Consistent online backup with manifest (default: <data>/backups/alice-<time>)
  restore --from DIR [--replace-existing]
              Verify a backup and restore it into a stopped installation
  export --out DIR
              Portable workspace.json plus Markdown documents and tasks
  purge --before DATE [--revisions] [--archived] [--activity] [--execute --confirm CODE]
              Permanently remove old content; dry run unless --execute with the plan's code
  install-skill --client claude-code|codex [--scope user|project] [--skill alice|alice-plan|alice-think|alice-spec|alice-understand|alice-demo]
              Copy the Alice agent skills (all by default) where the client loads skills
  mcp-config --client claude-code|codex [--transport http|stdio] [--url URL]
              Print MCP configuration that reads the token from the environment

Human users: the remote client is \`alice\` (profiles, sign-in, tasks, documents).
`

export class UsageError extends Error {}

export type CommandHandler = (args: string[]) => Promise<number>

export const commands: Record<string, CommandHandler> = {
  async serve() {
    await serve(loadConfig())
    return -1 // keep running
  },
  /** Internal: the hidden Local workspace daemon started by Desktop or the CLI. */
  async 'local-daemon'(args) {
    const { values } = parseArgs({ args, options: { workspace: { type: 'string' } } })
    if (!values.workspace) throw new UsageError('--workspace ID is required')
    const { runLocalDaemon } = await import('./local/daemon')
    return runLocalDaemon(values.workspace)
  },
  /** Internal: restore a Local workspace backup; clone by default, --replace ID for an exact target. */
  async 'local-restore'(args) {
    const { values } = parseArgs({ args, options: { from: { type: 'string' }, replace: { type: 'string' }, reserved: { type: 'string', multiple: true } } })
    if (!values.from) throw new UsageError('--from DIR is required')
    const { appDataRoot, workspacePaths } = await import('../local/paths')
    const { cloneRestore, replaceRestore } = await import('./local/backups')
    const root = appDataRoot()
    if (values.replace) {
      const { prepareReplace } = await import('../local/registry')
      const { acquireWorkspaceLock } = await import('./local/daemon')
      const ws = prepareReplace(root, values.replace)
      // ถือ lock ตลอดการแทนที่: daemon เปิด workspace นี้ระหว่างนั้นไม่ได้
      const release = acquireWorkspaceLock(workspacePaths(root, ws.id))
      try {
        const result = await replaceRestore(root, ws.id, path.resolve(values.from))
        console.log(JSON.stringify({ mode: 'replace', workspace: result.workspace, safetyBackup: result.safety?.name ?? null, previous: result.previous }))
      } finally {
        release()
      }
      return 0
    }
    const ws = await cloneRestore(root, path.resolve(values.from), values.reserved ?? [])
    console.log(JSON.stringify({ mode: 'clone', workspace: ws }))
    return 0
  },
  /** Internal: read-only SQLite inspection of a Local workspace for alice doctor. */
  async 'local-inspect'(args) {
    const { values } = parseArgs({ args, options: { workspace: { type: 'string' } } })
    if (!values.workspace) throw new UsageError('--workspace ID is required')
    const { appDataRoot } = await import('../local/paths')
    const { inspectWorkspace } = await import('./local/backups')
    console.log(JSON.stringify(inspectWorkspace(appDataRoot(), values.workspace)))
    return 0
  },
  async migrate() {
    const config = loadConfig()
    const db = openDatabase(config.dbPath)
    try {
      const ran = migrate(db)
      console.log(ran.length ? `Applied migrations: ${ran.join(', ')}` : 'Database is up to date')
      console.log(`Schema version: ${currentSchemaVersion(db)}`)
    } finally {
      db.close()
    }
    return 0
  },
  async backup(args) {
    const { values } = parseArgs({ args, options: { out: { type: 'string' } } })
    const config = loadConfig()
    const out = path.resolve(values.out ?? path.join(config.dataDir, 'backups', `alice-${new Date().toISOString().replace(/[:.]/g, '-')}`))
    const { manifest } = await createBackup(config.dbPath, out)
    console.log(`Backup written to ${out}`)
    console.log(`  schema v${manifest.schemaVersion}, ${manifest.database.bytes} bytes, sha256 ${manifest.database.sha256.slice(0, 16)}…`)
    console.log(`  ${Object.entries(manifest.counts).map(([k, v]) => `${k}=${v}`).join(' ')}`)
    return 0
  },
  async restore(args) {
    const { values } = parseArgs({ args, options: { from: { type: 'string' }, 'replace-existing': { type: 'boolean', default: false } } })
    if (!values.from) throw new UsageError('--from DIR is required')
    const config = loadConfig()
    const result = restoreBackup(path.resolve(values.from), config.dataDir, { replaceExisting: values['replace-existing'] ?? false })
    console.log(`Restored backup from ${result.manifest.createdAt} (schema v${result.manifest.schemaVersion}) into ${config.dbPath}`)
    if (result.migrated.length) console.log(`  applied migrations: ${result.migrated.join(', ')}`)
    if (result.previous) console.log(`  previous database moved to ${result.previous}`)
    return 0
  },
  async export(args) {
    const { values } = parseArgs({ args, options: { out: { type: 'string' } } })
    if (!values.out) throw new UsageError('--out DIR is required')
    const config = loadConfig()
    const result = exportWorkspace(config.dbPath, path.resolve(values.out))
    console.log(`Exported to ${result.dir}`)
    console.log(`  ${Object.entries(result.counts).map(([k, v]) => `${k}=${v}`).join(' ')}`)
    return 0
  },
  async purge(args) {
    const { values } = parseArgs({
      args,
      options: {
        before: { type: 'string' },
        revisions: { type: 'boolean', default: false },
        archived: { type: 'boolean', default: false },
        activity: { type: 'boolean', default: false },
        execute: { type: 'boolean', default: false },
        confirm: { type: 'string' },
      },
    })
    if (!values.before) throw new UsageError('--before DATE is required')
    const scopes = PURGE_SCOPES.filter((s) => values[s])
    const config = loadConfig()
    if (!values.execute) {
      const db = openDatabase(config.dbPath)
      try {
        const plan = planPurge(db, values.before, scopes)
        console.log(describePlan(plan))
        console.log(`\nDry run only. To permanently delete exactly this, re-run with: --execute --confirm ${plan.confirmation}`)
      } finally {
        db.close()
      }
      return 0
    }
    if (!values.confirm) throw new UsageError('--execute requires --confirm CODE from a dry run of the same command')
    const plan = executePurge(config.dbPath, values.before, scopes, values.confirm)
    console.log(describePlan(plan).replace('Purge plan', 'Purged'))
    return 0
  },
  async 'install-skill'(args) {
    const { values } = parseArgs({ args, options: { client: { type: 'string' }, scope: { type: 'string', default: 'user' }, skill: { type: 'string' } } })
    const client = values.client as AgentClient
    if (!CLIENTS.includes(client)) throw new UsageError(`--client must be one of: ${CLIENTS.join(', ')}`)
    if (values.scope !== 'user' && values.scope !== 'project') throw new UsageError('--scope must be user or project')
    const skills = parseSkillOption(values.skill)
    if (typeof skills === 'string') throw new UsageError(skills)
    for (const [i, target] of installSkills(client, values.scope, skills).entries()) console.log(`Installed the ${skills[i]} skill to ${target}`)
    return 0
  },
  async 'mcp-config'(args) {
    const { values } = parseArgs({ args, options: { client: { type: 'string' }, transport: { type: 'string', default: 'http' }, url: { type: 'string' } } })
    const client = values.client as AgentClient
    if (!CLIENTS.includes(client)) throw new UsageError(`--client must be one of: ${CLIENTS.join(', ')}`)
    if (values.transport !== 'http' && values.transport !== 'stdio') throw new UsageError('--transport must be http or stdio')
    const url = values.url ?? process.env.ALICE_PUBLIC_URL ?? 'http://localhost:8080'
    console.log(mcpConfigSnippet(client, url, values.transport))
    return 0
  },
  async version(args) {
    const { values } = parseArgs({ args, options: { json: { type: 'boolean', default: false } } })
    const info = {
      server: APP_VERSION,
      clientApi: { current: CLIENT_API_VERSION, minimum: CLIENT_API_MIN_VERSION },
      mcpContract: MCP_CONTRACT_VERSION,
      schema: LATEST_SCHEMA_VERSION,
      node: process.version,
    }
    if (values.json) console.log(JSON.stringify(info))
    else console.log(`Alice Server ${APP_VERSION} (Client API v${CLIENT_API_MIN_VERSION}–v${CLIENT_API_VERSION}, MCP contract v${MCP_CONTRACT_VERSION}, schema v${LATEST_SCHEMA_VERSION}, Node ${process.version})`)
    return 0
  },
}

export async function main(argv: string[]): Promise<void> {
  // ชื่อเดิม dist/cli.js ยังใช้ได้ระหว่าง compatibility window แต่แจ้งชื่อใหม่
  if (path.basename(process.argv[1] ?? '') === 'cli.js' && !process.env.ALICE_LEGACY_ALIAS) {
    console.error('alice-server: dist/cli.js is deprecated; run dist/alice-server.js (alice-server). The old name will be removed in Alice 0.4.0.')
  }
  const [command, ...rest] = argv
  if (!command || command === '--help' || command === '-h' || command === 'help') {
    console.log(USAGE)
    process.exitCode = command ? 0 : 1
    return
  }
  const handler = commands[command]
  if (!handler) {
    console.error(`Unknown command: ${command}\n\n${USAGE}`)
    process.exitCode = 1
    return
  }
  try {
    const code = await handler(rest)
    if (code >= 0) process.exitCode = code
  } catch (err) {
    if (err instanceof ConfigError || err instanceof MigrationError || err instanceof UsageError || err instanceof OpsError || err instanceof InstanceLockError || err instanceof AliceError || (err as { name?: string }).name === 'LocalDaemonError') {
      console.error(`alice-server: ${(err as Error).message}`)
    } else if ((err as { name?: string }).name === 'TypeError' && (err as { code?: string }).code?.startsWith('ERR_PARSE_ARGS')) {
      console.error(`alice-server: ${(err as Error).message}`)
    } else {
      console.error(err)
    }
    process.exitCode = 1
  }
}


void main(process.argv.slice(2))
