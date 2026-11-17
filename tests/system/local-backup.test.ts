import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { alice, buildCli, cliHome, type CliEnv } from '../helpers/cli'
import { call, waitFor } from '../helpers/local'
import { tempDataDir } from '../helpers/app'
import { currentSchemaVersion, migrate, openDatabase } from '../../src/server/db/database'
import { MIGRATIONS, LATEST_SCHEMA_VERSION } from '../../src/server/db/migrations'
import { ensureWorkspace } from '../../src/server/domain/workspace'
import { applyRetention, dailyBackupIfDue, listBackups } from '../../src/server/local/backups'
import { capabilityAccount } from '../../src/local/capabilities'
import { readLocator } from '../../src/local/locator'
import { isProcessAlive, workspacePaths } from '../../src/local/paths'
import { createWorkspace, listWorkspaces } from '../../src/local/registry'

/** Backups, restore, deletion, recovery classification and doctor. */
const homes: CliEnv[] = []
const json = (s: string) => JSON.parse(s)
const root = (h: CliEnv) => h.env.ALICE_HOME
function home(): CliEnv {
  const h = cliHome('local-ops')
  h.env.ALICE_TRASH_DIR = path.join(h.configDir, 'Trash')
  homes.push(h)
  return h
}
const owner = (h: CliEnv, id: string) => (JSON.parse(fs.readFileSync(h.credentialFile, 'utf8')) as Record<string, string>)[capabilityAccount(id, 'owner')]
async function daemon(h: CliEnv, id: string) {
  const locator = readLocator(workspacePaths(root(h), id).locator)!
  return { baseUrl: `http://127.0.0.1:${locator.port}`, pid: locator.pid, token: owner(h, id) }
}
function snapshot(dir: string): Record<string, string> {
  const out: Record<string, string> = {}
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) walk(p)
      else out[path.relative(dir, p)] = createHash('sha256').update(fs.readFileSync(p)).digest('hex') + ':' + (fs.statSync(p).mode & 0o777)
    }
  }
  walk(dir)
  return out
}

beforeAll(async () => {
  await buildCli()
}, 120_000)
afterAll(() => {
  for (const h of homes) {
    try {
      for (const ws of listWorkspaces(root(h))) {
        const l = readLocator(workspacePaths(root(h), ws.id).locator)
        if (l) process.kill(l.pid, 'SIGTERM')
      }
    } catch {
      /* none */
    }
  }
})

describe('Local backups and recovery', () => {
  it('backs up before migrating an older database; a failed migration leaves the workspace closed with a recovery record', async () => {
    const h = home()
    const ws = createWorkspace(root(h))
    const paths = workspacePaths(root(h), ws.id)
    // ฐานข้อมูลรุ่นเก่า (schema ก่อน Local workspaces)
    const old = openDatabase(paths.db)
    migrate(old, MIGRATIONS.slice(0, MIGRATIONS.length - 1))
    ensureWorkspace(old, { id: ws.id, name: ws.name })
    old.close()

    expect((await alice(h, ['task', 'create', '--title', 'After upgrade'])).code).toBe(0)
    const pre = listBackups(paths).filter((b) => b.kind === 'pre-migration')
    expect(pre).toHaveLength(1)
    expect(pre[0].schemaVersion).toBe(LATEST_SCHEMA_VERSION - 1)
    const { token, pid } = await daemon(h, ws.id)
    await call((await daemon(h, ws.id)).baseUrl, '/local/v1/shutdown', { token, body: {} })
    await waitFor(() => !isProcessAlive(pid))

    const failing = await alice(h, ['local', 'connect', ws.id, '--json'], { extraEnv: { NODE_ENV: 'test', ALICE_TEST_FAILING_MIGRATION: '1' } })
    expect(failing.code).not.toBe(0)
    expect(json(failing.stdout).error.code).toBe('MIGRATION_FAILED')
    const db = openDatabase(paths.db, { readonly: true })
    expect(currentSchemaVersion(db)).toBe(LATEST_SCHEMA_VERSION)
    expect(db.prepare(`SELECT 1 FROM sqlite_master WHERE name = 'test_partial'`).get()).toBeUndefined()
    db.close()
    expect(listBackups(paths).filter((b) => b.kind === 'pre-migration')).toHaveLength(2)

    // runtime ที่ถูกต้องเปิดได้ตามปกติและล้างสถานะกู้คืน
    const ok = await alice(h, ['task', 'list', '--json'])
    expect(json(ok.stdout).data.map((t: { title: string }) => t.title)).toEqual(['After upgrade'])
    expect(fs.existsSync(path.join(paths.dir, 'recovery.json'))).toBe(false)
  })

  it('makes one daily backup per changed day and keeps 7 daily and 3 pre-migration backups, never an in-use one', async () => {
    const h = home()
    const ws = createWorkspace(root(h))
    const paths = workspacePaths(root(h), ws.id)
    expect((await alice(h, ['task', 'create', '--title', 'Daily'])).code).toBe(0)
    await waitFor(() => listBackups(paths).some((b) => b.kind === 'daily'))

    const db = openDatabase(paths.db)
    const day = (d: string) => new Date(`${d}T09:00:00Z`)
    // วันใหม่ที่ข้อมูลเปลี่ยน → daily; วันถัดไปที่ไม่มีอะไรเปลี่ยน → ไม่ทำ; ทำซ้ำในวันเดียวกัน → ไม่ทำ
    expect((await dailyBackupIfDue(paths, db, day('2099-01-01')))?.name).toBe('daily-2099-01-01')
    expect(await dailyBackupIfDue(paths, db, day('2099-01-02'))).toBeNull()
    db.prepare(`UPDATE sqlite_sequence SET seq = seq + 1 WHERE name = 'activity_events'`).run()
    expect((await dailyBackupIfDue(paths, db, day('2099-01-03')))?.name).toBe('daily-2099-01-03')
    expect(await dailyBackupIfDue(paths, db, day('2099-01-03'))).toBeNull()
    db.close()

    const sample = listBackups(paths)[0]
    const fake = (name: string, kind: string, createdAt: string, inUse = false) => {
      const dir = path.join(paths.backups, name)
      fs.cpSync(sample.dir, dir, { recursive: true })
      const m = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'))
      fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ ...m, kind, createdAt }))
      if (inUse) fs.writeFileSync(path.join(dir, '.in-use'), '1')
    }
    for (let i = 1; i <= 9; i++) fake(`daily-2020-01-0${i}`, 'daily', `2020-01-0${i}T00:00:00.000Z`, i === 1)
    for (let i = 1; i <= 5; i++) fake(`pre-migration-${i}`, 'pre-migration', `2020-02-0${i}T00:00:00.000Z`)
    applyRetention(paths)
    const left = listBackups(paths)
    expect(left.filter((b) => b.kind === 'daily' && !b.inUse)).toHaveLength(7)
    expect(left.some((b) => b.name === 'daily-2020-01-01')).toBe(true)
    expect(left.filter((b) => b.kind === 'pre-migration')).toHaveLength(3)

    const listed = json((await alice(h, ['workspace', 'backups', '--json'])).stdout)
    expect(listed.data.length).toBe(left.length)
    const { baseUrl, token } = await daemon(h, ws.id)
    const status = await call(baseUrl, '/local/v1/backups', { token })
    expect(status.data.lastSuccess).toBeTruthy()
    expect(status.data.diskUse).toBeGreaterThan(0)
  })

  it('clone restore creates a new identity; replace restore needs the exact id and backs up first; bad backups change nothing', async () => {
    const h = home()
    const ws = json((await alice(h, ['workspace', 'create', '--json'])).stdout).data
    expect((await alice(h, ['task', 'create', '--title', 'Kept in backup'])).code).toBe(0)
    const backup = json((await alice(h, ['workspace', 'backup', '--json'])).stdout).data
    expect((await alice(h, ['task', 'create', '--title', 'After backup'])).code).toBe(0)
    const backupDir = path.join(workspacePaths(root(h), ws.id).backups, backup.name)

    // backup ที่ถูกแก้ไขถูกปฏิเสธก่อนแตะ registry
    const corrupt = tempDataDir('corrupt-backup')
    fs.cpSync(backupDir, corrupt, { recursive: true })
    const bytes = fs.readFileSync(path.join(corrupt, 'alice.db'))
    bytes[bytes.length - 10] ^= 0xff
    fs.writeFileSync(path.join(corrupt, 'alice.db'), bytes)
    const before = fs.readFileSync(path.join(root(h), 'registry.json'), 'utf8')
    const rejected = await alice(h, ['workspace', 'restore', '--from', corrupt])
    expect(rejected.code).not.toBe(0)
    expect(rejected.stderr).toMatch(/checksum/i)
    expect(fs.readFileSync(path.join(root(h), 'registry.json'), 'utf8')).toBe(before)

    const cloneRun = await alice(h, ['workspace', 'restore', '--from', backupDir, '--json'])
    expect(cloneRun.stderr).toBe('')
    const clone = json(cloneRun.stdout).data
    expect(clone.workspace.id).not.toBe(ws.id)
    expect(clone.workspace.alias).not.toBe(ws.alias)
    const cloned = json((await alice(h, ['task', 'list', '--workspace', clone.workspace.alias, '--json'])).stdout).data
    expect(cloned.map((t: { title: string }) => t.title)).toEqual(['Kept in backup'])
    expect(json((await alice(h, ['task', 'list', '--workspace', ws.alias, '--json'])).stdout).data).toHaveLength(2)

    expect((await alice(h, ['workspace', 'restore', ws.alias, '--latest', '--replace', '--confirm', 'Personal', '--yes'])).stderr).toContain('exact workspace id')
    expect((await alice(h, ['workspace', 'restore', ws.id, '--from', backupDir, '--replace', '--confirm', 'Wrong', '--yes'])).stderr).toContain('--confirm "Personal"')
    const running = await daemon(h, ws.id)
    const replaced = await alice(h, ['workspace', 'restore', ws.id, '--from', backupDir, '--replace', '--confirm', 'Personal', '--yes', '--json'])
    expect(replaced.code).toBe(0)
    expect(json(replaced.stdout).data.safetyBackup).toMatch(/^pre-restore-/)
    expect(isProcessAlive(running.pid)).toBe(false)
    const after = json((await alice(h, ['task', 'list', '--workspace', ws.id, '--json'])).stdout).data
    expect(after.map((t: { title: string }) => t.title)).toEqual(['Kept in backup'])
  })

  it('delete refuses the wrong name, stops the daemon and moves the data to the Trash', async () => {
    const h = home()
    const ws = json((await alice(h, ['workspace', 'create', 'Scratch', '--json'])).stdout).data
    expect((await alice(h, ['task', 'create', '--title', 'Throwaway'])).code).toBe(0)
    const { pid } = await daemon(h, ws.id)
    expect((await alice(h, ['workspace', 'delete', 'scratch', '--confirm', 'scratch', '--yes'])).stderr).toContain('--confirm "Scratch"')
    expect((await alice(h, ['workspace', 'delete', '--confirm', 'Scratch', '--yes'])).stderr).toContain('needs the workspace as an argument')
    const res = await alice(h, ['workspace', 'delete', 'scratch', '--confirm', 'Scratch', '--yes', '--json'])
    expect(res.code).toBe(0)
    const data = json(res.stdout).data
    expect(isProcessAlive(pid)).toBe(false)
    expect(listWorkspaces(root(h))).toHaveLength(0)
    expect(data.location.startsWith(h.env.ALICE_TRASH_DIR)).toBe(process.platform === 'darwin' || process.platform === 'linux')
    expect(fs.existsSync(path.join(data.location, 'data', 'alice.db'))).toBe(true)
    expect(owner(h, ws.id)).toBeUndefined()
  })

  it('doctor is read-only, reports every dimension, repairs only after a preview, and bundles no data or secrets', async () => {
    const h = home()
    const ws = json((await alice(h, ['workspace', 'create', '--json'])).stdout).data
    expect((await alice(h, ['task', 'create', '--title', 'Secret project codename'])).code).toBe(0)
    const { token, baseUrl, pid } = await daemon(h, ws.id)
    await call(baseUrl, '/local/v1/shutdown', { token, body: {} })
    await waitFor(() => !isProcessAlive(pid))
    // สถานะค้างจาก process ที่ตายไปแล้ว
    fs.writeFileSync(workspacePaths(root(h), ws.id).lock, '999999999')

    const before = snapshot(root(h))
    const report = await alice(h, ['doctor', '--json'])
    expect(snapshot(root(h))).toEqual(before)
    const checks = json(report.stdout).data as Array<{ id: string; status: string; summary: string }>
    for (const id of ['registry', 'permissions', 'credential-store', 'health', 'sqlite', 'schema', 'backups', 'process']) expect(checks.map((c) => c.id)).toContain(id)
    expect(checks.find((c) => c.id === 'sqlite')!.status).toBe('ok')
    expect(report.stdout).not.toContain(token)
    expect(report.stdout).not.toContain('Secret project codename')

    const preview = await alice(h, ['doctor', '--repair'])
    expect(preview.code).toBe(2)
    expect(preview.stderr).toContain('Remove stale daemon files')
    expect(fs.existsSync(workspacePaths(root(h), ws.id).lock)).toBe(true)
    expect((await alice(h, ['doctor', '--repair', '--yes'])).code).toBe(0)
    expect(fs.existsSync(workspacePaths(root(h), ws.id).lock)).toBe(false)

    const bundleDir = path.join(tempDataDir('bundle'), 'out')
    const bundle = await alice(h, ['doctor', '--bundle', bundleDir, '--yes', '--json'])
    expect(bundle.stderr).toContain('The diagnostic bundle will contain')
    const files = json(bundle.stdout).data.files.map((f: { name: string }) => f.name)
    expect(files).toContain('doctor.json')
    const all = Object.keys(snapshot(bundleDir))
    expect(all.some((f) => f.endsWith('.db'))).toBe(false)
    const text = all.map((f) => fs.readFileSync(path.join(bundleDir, f), 'utf8')).join('\n')
    expect(text).not.toMatch(/alice_lc_|Secret project codename/)
    expect(text).not.toContain(process.env.HOME!)
  })
})
