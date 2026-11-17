// Backup, restore และการตรวจสุขภาพของ Local workspace
// - pre-migration: ก่อน migrate ทุกครั้ง ต้องสำเร็จและผ่านการตรวจก่อน มิฉะนั้นไม่เปิด workspace
// - daily: ครั้งแรกของวันที่ข้อมูลเปลี่ยน; เก็บ 7 daily + 3 pre-migration; backup ที่กำลังใช้ (.in-use) ไม่ถูกลบ
// - restore: clone (id/alias ใหม่) เป็นค่าเริ่มต้น; replace ต้องระบุ id ตรงตัวและสำรองของเดิมก่อน
import fs from 'node:fs'
import path from 'node:path'
import { currentSchemaVersion, migrate, openDatabase, type DB } from '../db/database'
import { LATEST_SCHEMA_VERSION, MIGRATIONS, type Migration } from '../db/migrations'
import { createBackup, fileSha256, verifyBackup, type BackupManifest } from '../ops/backup'
import { OpsError } from '../ops/errors'
import { workspacePaths, writeFileAtomic, type WorkspacePaths } from '../../local/paths'
import { liveLockHolder, readRegistry, registerRestoredWorkspace, setWorkspaceState, unregisterWorkspace, type LocalWorkspace } from '../../local/registry'

export const DAILY_KEEP = 7
export const PRE_MIGRATION_KEEP = 3
export type BackupKind = 'daily' | 'pre-migration' | 'manual' | 'pre-restore'

export interface BackupEntry {
  name: string
  dir: string
  kind: BackupKind
  createdAt: string
  bytes: number
  schemaVersion: number
  changeMarker: string | null
  inUse: boolean
}

export interface LocalBackupManifest extends BackupManifest {
  kind?: BackupKind
  /** Fingerprint of the data at backup time; a daily backup is skipped when nothing changed. */
  changeMarker?: string
}

const stamp = (d = new Date()) => d.toISOString().replace(/[:.]/g, '-')

/** Monotonic counters SQLite keeps even after rows are pruned: any mutation moves one of them. */
export function changeMarker(db: DB): string {
  const rows = db.prepare(`SELECT name, seq FROM sqlite_sequence WHERE name IN ('activity_events', 'client_events') ORDER BY name`).all() as Array<{ name: string; seq: number }>
  return rows.map((r) => `${r.name}:${r.seq}`).join(',') || 'empty'
}

export function listBackups(paths: WorkspacePaths): BackupEntry[] {
  if (!fs.existsSync(paths.backups)) return []
  const out: BackupEntry[] = []
  for (const name of fs.readdirSync(paths.backups)) {
    const dir = path.join(paths.backups, name)
    try {
      const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')) as LocalBackupManifest
      const kind: BackupKind = manifest.kind ?? (name.startsWith('daily-') ? 'daily' : name.startsWith('pre-migration-') ? 'pre-migration' : name.startsWith('pre-restore-') ? 'pre-restore' : 'manual')
      out.push({ name, dir, kind, createdAt: manifest.createdAt, bytes: manifest.database.bytes, schemaVersion: manifest.schemaVersion, changeMarker: manifest.changeMarker ?? null, inUse: fs.existsSync(path.join(dir, '.in-use')) })
    } catch {
      /* โฟลเดอร์ที่ไม่สมบูรณ์ (เช่น backup ที่ล้มกลางทาง) ไม่นับเป็น backup */
    }
  }
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export function diskUse(dir: string): number {
  if (!fs.existsSync(dir)) return 0
  let total = 0
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name)
    total += entry.isDirectory() ? diskUse(p) : fs.statSync(p).size
  }
  return total
}

/** Writes a verified backup of the live database into `backups/<kind>-<stamp>`; incomplete copies never remain. */
export async function backupWorkspace(paths: WorkspacePaths, kind: BackupKind, db?: DB, now = new Date()): Promise<BackupEntry> {
  fs.mkdirSync(paths.backups, { recursive: true, mode: 0o700 })
  const name = kind === 'daily' ? `daily-${now.toISOString().slice(0, 10)}` : `${kind}-${stamp()}`
  const dir = path.join(paths.backups, name)
  const staging = path.join(paths.backups, `.partial-${name}-${process.pid}`)
  fs.rmSync(staging, { recursive: true, force: true })
  try {
    await createBackup(paths.db, staging)
    verifyBackup(staging)
    const manifestFile = path.join(staging, 'manifest.json')
    const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8')) as LocalBackupManifest
    manifest.kind = kind
    if (db) manifest.changeMarker = changeMarker(db)
    writeFileAtomic(manifestFile, JSON.stringify(manifest, null, 2) + '\n')
    fs.rmSync(dir, { recursive: true, force: true })
    fs.renameSync(staging, dir)
  } catch (err) {
    fs.rmSync(staging, { recursive: true, force: true })
    throw err
  }
  return listBackups(paths).find((b) => b.name === name)!
}

/** Keeps the newest DAILY_KEEP daily and PRE_MIGRATION_KEEP pre-migration backups; in-use ones are never removed. */
export function applyRetention(paths: WorkspacePaths): string[] {
  const removed: string[] = []
  const all = listBackups(paths)
  for (const [kind, keep] of [['daily', DAILY_KEEP], ['pre-migration', PRE_MIGRATION_KEEP]] as const) {
    for (const old of all.filter((b) => b.kind === kind).slice(keep)) {
      if (old.inUse) continue
      fs.rmSync(old.dir, { recursive: true, force: true })
      removed.push(old.name)
    }
  }
  return removed
}

/** The first changed opening of a calendar day gets one verified daily backup. */
export async function dailyBackupIfDue(paths: WorkspacePaths, db: DB, now = new Date()): Promise<BackupEntry | null> {
  const today = now.toISOString().slice(0, 10)
  const backups = listBackups(paths)
  if (backups.some((b) => b.kind === 'daily' && b.name === `daily-${today}`)) return null
  const lastDaily = backups.find((b) => b.kind === 'daily')
  const marker = changeMarker(db)
  if (lastDaily ? lastDaily.changeMarker === marker : marker === 'empty') return null
  const entry = await backupWorkspace(paths, 'daily', db, now)
  applyRetention(paths)
  return entry
}

export type RecoveryState = 'integrity' | 'migration-failed' | 'outbox' | 'credential-store'

export interface RecoveryRecord {
  state: RecoveryState
  message: string
  at: string
  backup?: string | null
}

const recoveryFile = (paths: WorkspacePaths) => path.join(paths.dir, 'recovery.json')

export function writeRecovery(paths: WorkspacePaths, record: Omit<RecoveryRecord, 'at'>): void {
  writeFileAtomic(recoveryFile(paths), JSON.stringify({ ...record, at: new Date().toISOString() }) + '\n')
}

export function readRecovery(paths: WorkspacePaths): RecoveryRecord | null {
  try {
    return JSON.parse(fs.readFileSync(recoveryFile(paths), 'utf8')) as RecoveryRecord
  } catch {
    return null
  }
}

export function clearRecovery(paths: WorkspacePaths): void {
  fs.rmSync(recoveryFile(paths), { force: true })
}

/**
 * Startup safety net before the daemon serves anything: integrity check, then a verified
 * pre-migration backup when the schema is behind, then transactional migrations. Any failure leaves
 * the workspace closed with an explicit recovery record. Routine WAL recovery happens on open.
 */
export async function prepareDatabase(paths: WorkspacePaths, migrations: Migration[] = MIGRATIONS): Promise<DB> {
  const existed = fs.existsSync(paths.db)
  const db = openDatabase(paths.db)
  try {
    if (existed) {
      const check = db.pragma('quick_check', { simple: true })
      if (check !== 'ok') {
        writeRecovery(paths, { state: 'integrity', message: `SQLite quick_check reported: ${String(check).slice(0, 200)}` })
        throw new OpsError('The workspace database failed its integrity check')
      }
    }
    const before = existed ? currentSchemaVersion(db) : 0
    const target = migrations[migrations.length - 1].version
    let backup: BackupEntry | null = null
    if (existed && before > 0 && before < target) {
      try {
        backup = await backupWorkspace(paths, 'pre-migration', db)
      } catch (err) {
        writeRecovery(paths, { state: 'migration-failed', message: `The pre-migration backup failed: ${(err as Error).message}` })
        throw err
      }
    }
    try {
      migrate(db, migrations)
    } catch (err) {
      writeRecovery(paths, { state: 'migration-failed', message: (err as Error).message, backup: backup?.name ?? null })
      throw err
    }
    if (backup) applyRetention(paths)
    clearRecovery(paths)
    return db
  } catch (err) {
    db.close()
    throw err
  }
}

/** Tables whose rows carry the workspace id; all are rewritten together when a copy gets a new identity. */
function rewriteWorkspaceId(db: DB, from: string, to: string): void {
  const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`).all() as Array<{ name: string }>
  // trigger บางตัว (เช่น activity แบบ append-only) กันการแก้แถว: ปิดชั่วคราวเฉพาะในสำเนาที่ยังไม่ถูกใช้ แล้วสร้างคืนใน transaction เดียวกัน
  const triggers = db.prepare(`SELECT name, sql FROM sqlite_master WHERE type = 'trigger' AND sql IS NOT NULL`).all() as Array<{ name: string; sql: string }>
  db.pragma('foreign_keys = OFF')
  db.transaction(() => {
    for (const t of triggers) db.exec(`DROP TRIGGER "${t.name}"`)
    for (const { name } of tables) {
      const cols = db.prepare(`SELECT name FROM pragma_table_info(?)`).all(name) as Array<{ name: string }>
      if (name === 'workspaces') db.prepare('UPDATE workspaces SET id = ? WHERE id = ?').run(to, from)
      else if (cols.some((c) => c.name === 'workspace_id')) db.prepare(`UPDATE "${name}" SET workspace_id = ? WHERE workspace_id = ?`).run(to, from)
    }
    db.prepare(`UPDATE installation SET value = ? WHERE key = 'workspace_id'`).run(to)
    for (const t of triggers) db.exec(t.sql)
  })()
  db.pragma('foreign_keys = ON')
  const problems = db.pragma('foreign_key_check') as unknown[]
  if (problems.length) throw new OpsError('The restored copy has inconsistent references; nothing was registered')
}

/** Ties restored agent identities to this machine's integration ids, so a copy from another computer opens. */
function adoptIntegrations(db: DB, integrations: Record<string, { id: string } | undefined>): void {
  const has = db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'local_integrations'`).get()
  if (!has) return
  for (const [client, integration] of Object.entries(integrations)) {
    if (integration) db.prepare('UPDATE local_integrations SET integration_id = ? WHERE client = ?').run(integration.id, client)
  }
  // capability ของเครื่องเดิมใช้ที่นี่ไม่ได้ (secret อยู่ใน keychain ของอีกเครื่อง): เพิกถอนทั้งหมด
  db.prepare(`UPDATE local_capabilities SET revoked_at = coalesce(revoked_at, ?)`).run(new Date().toISOString())
}

function stageCopy(backupDir: string, manifest: BackupManifest, dataDir: string): string {
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 })
  const staging = path.join(dataDir, 'alice.db.restoring')
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(staging + suffix, { force: true })
  fs.copyFileSync(path.join(backupDir, path.basename(manifest.database.file)), staging)
  if (fileSha256(staging) !== manifest.database.sha256) {
    fs.rmSync(staging, { force: true })
    throw new OpsError('Copy verification failed; nothing was changed')
  }
  return staging
}

/** Default restore: a new workspace with a new id and alias. The source workspace is never touched. */
export function cloneRestore(root: string, backupDir: string, reservedAliases: string[] = []): LocalWorkspace {
  const manifest = verifyBackup(backupDir)
  if (!manifest.workspaceId) throw new OpsError('This backup has no workspace identity')
  const registry = readRegistry(root)
  const source = registry.workspaces.find((w) => w.id === manifest.workspaceId)
  const ws = registerRestoredWorkspace(root, { workspaceId: manifest.workspaceId, name: source?.name ?? 'Workspace', backupCreatedAt: manifest.createdAt }, reservedAliases)
  const paths = workspacePaths(root, ws.id)
  try {
    const staging = stageCopy(backupDir, manifest, paths.dataDir)
    const db = openDatabase(staging)
    try {
      migrate(db)
      rewriteWorkspaceId(db, manifest.workspaceId, ws.id)
      adoptIntegrations(db, registry.integrations)
      db.pragma('journal_mode = DELETE')
    } finally {
      db.close()
    }
    fs.renameSync(staging, paths.db)
    return setWorkspaceState(root, ws.id, 'active')
  } catch (err) {
    unregisterWorkspace(root, ws.id)
    fs.rmSync(paths.dir, { recursive: true, force: true })
    throw err
  }
}

/**
 * Explicit replace restore of a known workspace. The caller holds the workspace lock (so no daemon
 * runs); the current database is backed up first and kept aside, never deleted.
 */
export async function replaceRestore(root: string, workspaceId: string, backupDir: string): Promise<{ workspace: LocalWorkspace; safety: BackupEntry | null; previous: string | null }> {
  const manifest = verifyBackup(backupDir)
  const registry = readRegistry(root)
  const ws = registry.workspaces.find((w) => w.id === workspaceId)
  if (!ws) throw new OpsError(`No Local workspace with id ${workspaceId}`)
  const paths = workspacePaths(root, ws.id)
  // backup ที่กำลังใช้ต้องไม่ถูก retention ลบระหว่าง restore
  const marker = path.join(backupDir, '.in-use')
  fs.writeFileSync(marker, String(process.pid))
  try {
    let safety: BackupEntry | null = null
    if (fs.existsSync(paths.db)) {
      try {
        safety = await backupWorkspace(paths, 'pre-restore')
      } catch {
        // ฐานข้อมูลเดิมเสียจนสำรองไม่ได้: ยังเก็บไฟล์ดิบไว้ด้านข้าง (ด้านล่าง) และไม่ลบอะไร
        safety = null
      }
    }
    const staging = stageCopy(backupDir, manifest, paths.dataDir)
    const db = openDatabase(staging)
    try {
      migrate(db)
      if (manifest.workspaceId && manifest.workspaceId !== ws.id) rewriteWorkspaceId(db, manifest.workspaceId, ws.id)
      adoptIntegrations(db, registry.integrations)
      db.pragma('journal_mode = DELETE')
    } finally {
      db.close()
    }
    let previous: string | null = null
    if (fs.existsSync(paths.db)) {
      previous = path.join(paths.dir, `replaced-${stamp()}`)
      fs.mkdirSync(previous, { mode: 0o700 })
      for (const suffix of ['', '-wal', '-shm']) if (fs.existsSync(paths.db + suffix)) fs.renameSync(paths.db + suffix, path.join(previous, `alice.db${suffix}`))
    }
    fs.renameSync(staging, paths.db)
    clearRecovery(paths)
    return { workspace: ws, safety, previous }
  } finally {
    fs.rmSync(marker, { force: true })
  }
}

export interface InspectResult {
  workspaceId: string
  exists: boolean
  schemaVersion: number | null
  latestSchemaVersion: number
  quickCheck: string | null
  integrations: Array<{ client: string; enabled: boolean }>
  recovery: RecoveryRecord | null
}

/** Read-only SQLite inspection for `alice doctor`; opens the database read-only and changes nothing. */
export function inspectWorkspace(root: string, workspaceId: string): InspectResult {
  const paths = workspacePaths(root, workspaceId)
  const base: InspectResult = { workspaceId, exists: fs.existsSync(paths.db), schemaVersion: null, latestSchemaVersion: LATEST_SCHEMA_VERSION, quickCheck: null, integrations: [], recovery: readRecovery(paths) }
  if (!base.exists) return base
  // เปิดแบบอ่านอย่างเดียวอาจสร้างไฟล์ -wal/-shm ว่าง: ลบเฉพาะที่เราสร้างเองเมื่อไม่มี daemon ถือ workspace อยู่
  const created = ['-wal', '-shm'].filter((sfx) => !fs.existsSync(paths.db + sfx))
  const db = openDatabase(paths.db, { readonly: true })
  try {
    base.quickCheck = String(db.pragma('quick_check', { simple: true }))
    base.schemaVersion = currentSchemaVersion(db)
    const has = db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'local_integrations'`).get()
    if (has) {
      base.integrations = (db.prepare('SELECT client, enabled_at, disabled_at FROM local_integrations').all() as Array<{ client: string; enabled_at: string | null; disabled_at: string | null }>).map((r) => ({
        client: r.client,
        enabled: !!r.enabled_at && !r.disabled_at,
      }))
    }
  } finally {
    db.close()
    if (!liveLockHolder(root, workspaceId)) for (const sfx of created) fs.rmSync(paths.db + sfx, { force: true })
  }
  return base
}
