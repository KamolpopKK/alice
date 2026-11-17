import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { APP_VERSION } from '../../shared/version'
import { currentSchemaVersion, migrate, openDatabase, type DB } from '../db/database'
import { LATEST_SCHEMA_VERSION } from '../db/migrations'
import { OpsError } from './errors'
import { runningServerPid } from './lock'

export const BACKUP_FORMAT = 'alice-backup'
export const BACKUP_FORMAT_VERSION = 1

export interface BackupManifest {
  format: typeof BACKUP_FORMAT
  formatVersion: number
  appVersion: string
  schemaVersion: number
  workspaceId: string | null
  createdAt: string
  database: { file: string; bytes: number; sha256: string }
  counts: Record<string, number>
}

const COUNTED_TABLES = ['actors', 'projects', 'tasks', 'comments', 'documents', 'document_revisions', 'task_documents', 'project_documents', 'task_blockers', 'activity_events', 'pads', 'pad_blocks']

export function fileSha256(file: string): string {
  const hash = createHash('sha256')
  const fd = fs.openSync(file, 'r')
  const buf = Buffer.alloc(1 << 20)
  try {
    let n: number
    while ((n = fs.readSync(fd, buf, 0, buf.length, null)) > 0) hash.update(buf.subarray(0, n))
  } finally {
    fs.closeSync(fd)
  }
  return hash.digest('hex')
}

export function tableCounts(db: DB): Record<string, number> {
  const out: Record<string, number> = {}
  for (const table of COUNTED_TABLES) {
    const exists = db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`).get(table)
    if (exists) out[table] = (db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n
  }
  return out
}

function integrityOk(file: string): boolean {
  const db = openDatabase(file, { readonly: true })
  try {
    return db.pragma('integrity_check', { simple: true }) === 'ok'
  } finally {
    db.close()
  }
}

/**
 * Online, consistent backup using SQLite's backup API (safe while the server runs), plus a
 * manifest with checksum, versions and row counts. The copy is integrity-checked before returning.
 */
export async function createBackup(dbPath: string, outDir: string): Promise<{ dir: string; manifest: BackupManifest }> {
  if (!fs.existsSync(dbPath)) throw new OpsError(`No database at ${dbPath}; nothing to back up`)
  if (fs.existsSync(outDir) && fs.readdirSync(outDir).length > 0) throw new OpsError(`Backup directory ${outDir} is not empty`)
  fs.mkdirSync(outDir, { recursive: true })
  const target = path.join(outDir, 'alice.db')
  const source = openDatabase(dbPath)
  try {
    await source.backup(target)
  } finally {
    source.close()
  }
  // backup เป็นไฟล์เดี่ยว ไม่ใช้ WAL เพื่อให้ checksum คงที่
  const copy = openDatabase(target)
  copy.pragma('journal_mode = DELETE')
  const schemaVersion = currentSchemaVersion(copy)
  const workspace = copy.prepare(`SELECT value FROM installation WHERE key = 'workspace_id'`).get() as { value: string } | undefined
  const counts = tableCounts(copy)
  copy.close()
  if (!integrityOk(target)) throw new OpsError('The backup copy failed SQLite integrity_check; the source database may be damaged')
  const manifest: BackupManifest = {
    format: BACKUP_FORMAT,
    formatVersion: BACKUP_FORMAT_VERSION,
    appVersion: APP_VERSION,
    schemaVersion,
    workspaceId: workspace?.value ?? null,
    createdAt: new Date().toISOString(),
    database: { file: 'alice.db', bytes: fs.statSync(target).size, sha256: fileSha256(target) },
    counts,
  }
  fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
  return { dir: outDir, manifest }
}

export function readManifest(dir: string): BackupManifest {
  const file = path.join(dir, 'manifest.json')
  if (!fs.existsSync(file)) throw new OpsError(`${dir} has no manifest.json; it is not an Alice backup`)
  let manifest: BackupManifest
  try {
    manifest = JSON.parse(fs.readFileSync(file, 'utf8')) as BackupManifest
  } catch {
    throw new OpsError('manifest.json is not valid JSON; the backup is damaged')
  }
  if (manifest.format !== BACKUP_FORMAT || manifest.formatVersion !== BACKUP_FORMAT_VERSION) {
    throw new OpsError(`Unsupported backup format ${manifest.format}/${manifest.formatVersion}`)
  }
  return manifest
}

/** Verifies checksum, schema compatibility and SQLite integrity. Never touches the target. */
export function verifyBackup(dir: string): BackupManifest {
  const manifest = readManifest(dir)
  const db = path.join(dir, path.basename(manifest.database.file))
  if (!fs.existsSync(db)) throw new OpsError(`Backup database ${manifest.database.file} is missing`)
  if (fileSha256(db) !== manifest.database.sha256) {
    throw new OpsError('Backup checksum does not match its manifest: the backup is corrupted or was modified. Use another backup.')
  }
  if (manifest.schemaVersion > LATEST_SCHEMA_VERSION) {
    throw new OpsError(`Backup schema v${manifest.schemaVersion} is newer than this Alice (${APP_VERSION}, schema v${LATEST_SCHEMA_VERSION}). Restore it with Alice ${manifest.appVersion} or newer.`)
  }
  if (!integrityOk(db)) throw new OpsError('Backup database failed SQLite integrity_check. Use another backup.')
  return manifest
}

export interface RestoreResult {
  manifest: BackupManifest
  previous: string | null
  migrated: number[]
}

/**
 * Offline restore into an inactive installation. The current database is moved aside (never
 * deleted) and the backup is migrated to the current schema before it becomes live.
 */
export function restoreBackup(dir: string, dataDir: string, options: { replaceExisting: boolean }): RestoreResult {
  const manifest = verifyBackup(dir)
  const pid = runningServerPid(dataDir)
  if (pid) throw new OpsError(`Alice is running (pid ${pid}) on ${dataDir}. Stop it before restoring; the target was not changed.`)
  const live = path.join(dataDir, 'alice.db')
  const hasExisting = fs.existsSync(live)
  if (hasExisting && !options.replaceExisting) {
    throw new OpsError(`${live} already exists. Re-run with --replace-existing to move it aside and restore; nothing was changed.`)
  }
  fs.mkdirSync(dataDir, { recursive: true })
  const staging = path.join(dataDir, 'alice.db.restoring')
  fs.rmSync(staging, { force: true })
  fs.copyFileSync(path.join(dir, path.basename(manifest.database.file)), staging)
  if (fileSha256(staging) !== manifest.database.sha256) {
    fs.rmSync(staging, { force: true })
    throw new OpsError('Copy verification failed; the target was not changed')
  }
  const stagingDb = openDatabase(staging)
  let migrated: number[]
  try {
    migrated = migrate(stagingDb)
  } finally {
    stagingDb.close()
  }
  for (const suffix of ['-wal', '-shm']) fs.rmSync(staging + suffix, { force: true })

  let previous: string | null = null
  if (hasExisting) {
    previous = path.join(dataDir, `pre-restore-${new Date().toISOString().replace(/[:.]/g, '-')}`)
    fs.mkdirSync(previous)
    for (const suffix of ['', '-wal', '-shm']) {
      if (fs.existsSync(live + suffix)) fs.renameSync(live + suffix, path.join(previous, `alice.db${suffix}`))
    }
  }
  fs.renameSync(staging, live)
  return { manifest, previous, migrated }
}
