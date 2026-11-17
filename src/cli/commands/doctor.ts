// `alice doctor`: ตรวจอย่างเดียวโดยค่าเริ่มต้น; --repair แสดงสิ่งที่จะทำก่อนเสมอ
// และไม่เคยเลือก restore ฐานข้อมูลเอง; --bundle สร้างไฟล์วินิจฉัยที่ตัดเนื้อหาและ credential ออก
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { CLIENTS, SKILLS, installSkills, skillTargetDir } from '../../server/agent-setup'
import { capabilityAccount, localCredentialStore } from '../../local/capabilities'
import { probeDaemon } from '../../local/daemon-client'
import { listBackupDirs } from '../../local/backup-list'
import { readLocator } from '../../local/locator'
import { isProcessAlive, workspacePaths } from '../../local/paths'
import { readRegistry, registryFile, type LocalAgentClient, type Registry } from '../../local/registry'
import { CliContext, parseCommand } from '../context'
import { CliError } from '../errors'
import { confirm } from '../output'
import { runServer } from '../local-ops'
import { maintenanceNotice } from '../maintenance'
import { CLI_VERSION } from '../version'
import { installedRuntime, launcherPath, installLauncher } from '../../local/runtime-install'

export type CheckStatus = 'ok' | 'warn' | 'fail' | 'info'

export interface RepairAction {
  id: string
  description: string
  /** Credential-affecting or destructive: needs explicit approval even with --yes. */
  sensitive?: boolean
  run: () => void
}

export interface Check {
  id: string
  status: CheckStatus
  summary: string
  workspace?: string
  repair?: Omit<RepairAction, 'run'>
}

const SECRET = /alice_(lc|at|ca|cr|dc|boot|s|inv)_[A-Za-z0-9_-]+/g

/** Removes credentials and the home directory (user names in paths) from diagnostic text. */
export function redact(text: string, home = os.homedir()): string {
  let out = text.replace(SECRET, '[redacted]')
  if (home && home.length > 1) out = out.split(home).join('~')
  return out
}

const modeOk = (p: string) => process.platform === 'win32' || !fs.existsSync(p) || (fs.statSync(p).mode & 0o077) === 0

export async function runChecks(ctx: CliContext, only?: string): Promise<{ checks: Check[]; repairs: RepairAction[] }> {
  const root = ctx.resolver.root
  const checks: Check[] = []
  const repairs: RepairAction[] = []
  const add = (check: Check, repair?: RepairAction) => {
    if (repair) {
      check.repair = { id: repair.id, description: repair.description, sensitive: repair.sensitive }
      repairs.push(repair)
    }
    checks.push(check)
  }

  // runtime, launcher และเวอร์ชัน
  const runtime = installedRuntime(root)
  if (!runtime) add({ id: 'runtime', status: 'info', summary: 'No Desktop-managed runtime is installed (development or npm install)' })
  else if (runtime.problems.length) add({ id: 'runtime', status: 'fail', summary: `Runtime ${runtime.version} is damaged: ${runtime.problems.join('; ')}. Reinstall or update Alice Desktop.` })
  else add({ id: 'runtime', status: runtime.version === CLI_VERSION ? 'ok' : 'warn', summary: `Runtime ${runtime.version} (this CLI ${CLI_VERSION}); previous: ${runtime.previous ?? 'none'}` })
  if (runtime) {
    const launcher = launcherPath(ctx.env)
    const ok = fs.existsSync(launcher) && fs.readFileSync(launcher, 'utf8').includes(path.join(root, 'runtime', 'current'))
    add(
      { id: 'launcher', status: ok ? 'ok' : 'warn', summary: ok ? `alice launcher at ${launcher}` : `The alice launcher at ${launcher} is missing or points elsewhere` },
      ok ? undefined : { id: 'launcher', description: `Reinstall the alice launcher at ${launcher}`, run: () => installLauncher(root, ctx.env) },
    )
  }
  const notice = maintenanceNotice(root, ctx.env)
  if (notice) add({ id: 'updates', status: 'warn', summary: notice })

  // skills ของ agent ต้องตรงกับเวอร์ชันของ CLI
  for (const client of CLIENTS) {
    for (const skill of SKILLS) {
      const file = path.join(skillTargetDir(client, 'user', undefined, undefined, skill), 'SKILL.md')
      if (!fs.existsSync(file)) continue
      const version = /^version:\s*(\S+)/m.exec(fs.readFileSync(file, 'utf8'))?.[1] ?? 'unknown'
      const ok = version === CLI_VERSION
      add(
        { id: `skill:${client}:${skill}`, status: ok ? 'ok' : 'warn', summary: `${skill} skill for ${client}: ${version}${ok ? '' : ` (expected ${CLI_VERSION})`}` },
        ok ? undefined : { id: `skill:${client}:${skill}`, description: `Reinstall the ${skill} skill for ${client}`, run: () => void installSkills(client, 'user', [skill]) },
      )
    }
  }

  // registry, alias และสิทธิ์ไฟล์
  let registry: Registry | null = null
  try {
    registry = readRegistry(root)
    const aliases = registry.workspaces.map((w) => w.alias.toLowerCase())
    const dupes = aliases.filter((a, i) => aliases.indexOf(a) !== i)
    add({ id: 'registry', status: dupes.length ? 'fail' : 'ok', summary: dupes.length ? `Duplicate aliases: ${[...new Set(dupes)].join(', ')}` : `${registry.workspaces.length} Local workspace(s)` })
  } catch (err) {
    add({ id: 'registry', status: 'fail', summary: (err as Error).message })
  }
  const loose = [root, registryFile(root)].filter((p) => !modeOk(p))
  for (const ws of registry?.workspaces ?? []) {
    const p = workspacePaths(root, ws.id)
    loose.push(...[p.dir, p.dataDir, p.db, p.locator].filter((f) => !modeOk(f)))
  }
  add(
    { id: 'permissions', status: loose.length ? 'warn' : 'ok', summary: loose.length ? `${loose.length} path(s) readable by other accounts` : 'Owner-only permissions' },
    loose.length
      ? { id: 'permissions', description: `Restrict ${loose.length} path(s) to this account`, run: () => loose.forEach((f) => fs.chmodSync(f, fs.statSync(f).isDirectory() ? 0o700 : 0o600)) }
      : undefined,
  )

  // แต่ละ workspace: process, health, schema, SQLite, integration และ backup
  let store: ReturnType<typeof localCredentialStore> | null = null
  try {
    store = localCredentialStore(root, ctx.env)
    add({ id: 'credential-store', status: store.secure ? 'ok' : 'warn', summary: `Capabilities kept in ${store.name}` })
  } catch (err) {
    add({ id: 'credential-store', status: 'fail', summary: (err as Error).message })
  }
  for (const ws of registry?.workspaces ?? []) {
    if (only && ws.id !== only && ws.alias.toLowerCase() !== only.toLowerCase()) continue
    const label = ws.alias
    const paths = workspacePaths(root, ws.id)
    if (!fs.existsSync(paths.dir)) {
      add({ id: 'workspace', workspace: label, status: 'fail', summary: `The data folder of ${label} is missing` })
      continue
    }
    const locator = readLocator(paths.locator)
    let lockPid = NaN
    try {
      lockPid = Number(fs.readFileSync(paths.lock, 'utf8').trim())
    } catch {
      /* no lock */
    }
    const staleLock = Number.isInteger(lockPid) && lockPid > 0 && !isProcessAlive(lockPid)
    const staleLocator = !!locator && !isProcessAlive(locator.pid)
    if (staleLock || staleLocator) {
      add(
        { id: 'process', workspace: label, status: 'warn', summary: 'Stale daemon state from a process that is no longer running' },
        {
          id: `stale:${ws.id}`,
          description: `Remove stale daemon files of ${label}`,
          run: () => {
            if (staleLock) fs.rmSync(paths.lock, { force: true })
            if (staleLocator) fs.rmSync(paths.locator, { force: true })
          },
        },
      )
    }
    const probe = await probeDaemon(root, ws.id)
    add({ id: 'health', workspace: label, status: probe.ok || probe.reason === 'missing' || probe.reason === 'dead' ? 'ok' : 'fail', summary: probe.ok ? `Running (pid ${probe.locator.pid}, ${probe.locator.version})` : probe.reason === 'version' ? `Running a different Alice version (${probe.detail})` : 'Not running' })

    try {
      const inspect = runServer<{ exists: boolean; schemaVersion: number | null; latestSchemaVersion: number; quickCheck: string | null; integrations: Array<{ client: LocalAgentClient; enabled: boolean }>; recovery: { state: string; message: string } | null }>(root, ctx.env, ['local-inspect', '--workspace', ws.id])
      if (inspect.recovery) add({ id: 'recovery', workspace: label, status: 'fail', summary: `${inspect.recovery.state}: ${inspect.recovery.message}. Restore a backup (alice workspace restore ${ws.id} --latest --replace) or contact support.` })
      if (inspect.exists) {
        add({ id: 'sqlite', workspace: label, status: inspect.quickCheck === 'ok' ? 'ok' : 'fail', summary: `SQLite quick_check: ${inspect.quickCheck}` })
        add({ id: 'schema', workspace: label, status: inspect.schemaVersion === inspect.latestSchemaVersion ? 'ok' : 'warn', summary: `Schema v${inspect.schemaVersion} (this Alice v${inspect.latestSchemaVersion})` })
      }
      for (const i of inspect.integrations.filter((x) => x.enabled)) {
        const has = store?.get(capabilityAccount(ws.id, i.client))
        add({ id: `integration:${i.client}`, workspace: label, status: has ? 'ok' : 'warn', summary: has ? `${i.client} enabled` : `${i.client} is enabled but its credential is missing; disable and enable it again in Settings` })
      }
    } catch (err) {
      add({ id: 'sqlite', workspace: label, status: 'warn', summary: `Could not inspect the database: ${(err as Error).message}` })
    }

    const backups = listBackupDirs(root, ws.id)
    const daily = backups.find((b) => b.kind === 'daily')
    const age = daily ? (Date.now() - Date.parse(daily.createdAt)) / 86_400_000 : null
    add({ id: 'backups', workspace: label, status: age === null ? 'info' : age > 3 ? 'warn' : 'ok', summary: age === null ? 'No daily backup yet (made after the first change of a day)' : `Last daily backup ${daily!.createdAt} · ${backups.length} backup(s)` })
  }
  return { checks, repairs }
}

function bundleInventory(ctx: CliContext): Array<{ name: string; source: string | null }> {
  const root = ctx.resolver.root
  const files: Array<{ name: string; source: string | null }> = [
    { name: 'doctor.json', source: null },
    { name: 'versions.json', source: null },
  ]
  for (const ws of (() => {
    try {
      return readRegistry(root).workspaces
    } catch {
      return []
    }
  })()) {
    const logs = workspacePaths(root, ws.id).logs
    if (!fs.existsSync(logs)) continue
    for (const f of fs.readdirSync(logs).filter((n) => n.endsWith('.log'))) files.push({ name: `logs/${ws.id}/${f}`, source: path.join(logs, f) })
  }
  return files
}

export async function doctorCommand(ctx: CliContext, args: string[]): Promise<number> {
  const { values } = parseCommand(args, { repair: { type: 'boolean' }, yes: { type: 'boolean' }, bundle: { type: 'string' } })
  const { out } = ctx
  out.useEnvelope(null)
  const only = ctx.flags.workspace
  const { checks, repairs } = await runChecks(ctx, only)

  if (values.bundle) {
    const dir = path.resolve(values.bundle)
    const inventory = bundleInventory(ctx)
    // แสดงรายการไฟล์ก่อนสร้างเสมอ; ไม่มีฐานข้อมูลหรือ export ที่มีเนื้อหา
    out.info(`The diagnostic bundle will contain:\n${inventory.map((f) => `  ${f.name}`).join('\n')}\nNo databases, tasks, documents, credentials or home-folder paths are included.`)
    await confirm(out, `Write ${inventory.length} file(s) to ${dir}?`, !!values.yes)
    if (fs.existsSync(dir) && fs.readdirSync(dir).length) throw new CliError(`${dir} is not empty`)
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
    const write = (name: string, text: string) => {
      fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true })
      fs.writeFileSync(path.join(dir, name), redact(text), { mode: 0o600 })
    }
    write('doctor.json', JSON.stringify(checks, null, 2))
    write('versions.json', JSON.stringify({ cli: CLI_VERSION, node: process.version, platform: `${process.platform}-${process.arch}` }, null, 2))
    for (const f of inventory) if (f.source) write(f.name, fs.readFileSync(f.source, 'utf8'))
    const manifest = inventory.map((f) => ({ name: f.name, sha256: createHash('sha256').update(fs.readFileSync(path.join(dir, f.name))).digest('hex') }))
    out.value({ bundle: dir, files: manifest }, () => out.line(`Diagnostic bundle written to ${dir}`))
    return 0
  }

  if (values.repair) {
    if (repairs.length === 0) {
      out.value({ checks, repairs: [] }, () => out.line('Nothing to repair.'))
      return 0
    }
    out.info(`Repair would:\n${repairs.map((r) => `  - ${r.description}${r.sensitive ? ' (needs separate approval)' : ''}`).join('\n')}\nIt never restores a database; use alice workspace restore for that.`)
    await confirm(out, 'Apply these repairs?', !!values.yes)
    const applied: string[] = []
    for (const r of repairs.filter((x) => !x.sensitive)) {
      r.run()
      applied.push(r.id)
    }
    out.value({ applied, skipped: repairs.filter((x) => x.sensitive).map((x) => x.id) }, () => out.line(`Applied ${applied.length} repair(s).`))
    return 0
  }

  const failing = checks.some((c) => c.status === 'fail')
  out.list(checks, [
    { header: 'STATUS', value: (c) => c.status.toUpperCase() },
    { header: 'CHECK', value: (c) => (c.workspace ? `${c.workspace}: ${c.id}` : c.id) },
    { header: 'DETAIL', value: (c) => redact(c.summary), max: 100 },
  ])
  if (repairs.length && !out.machine) out.info(`${repairs.length} item(s) can be repaired: alice doctor --repair`)
  return failing ? 1 : 0
}
