import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'
import { MIGRATIONS, LATEST_SCHEMA_VERSION, type Migration } from './migrations'

export type DB = Database.Database

export class MigrationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MigrationError'
  }
}

/**
 * The packaged Local runtime ships `better_sqlite3.node` beside alice-server.js and has no
 * node_modules; `ALICE_SQLITE_BINDING` overrides it. Elsewhere better-sqlite3 finds its own prebuild.
 */
function nativeBinding(): string | undefined {
  if (process.env.ALICE_SQLITE_BINDING) return process.env.ALICE_SQLITE_BINDING
  const script = process.argv[1]
  if (!script) return undefined
  const beside = path.join(path.dirname(script), 'better_sqlite3.node')
  return fs.existsSync(beside) ? beside : undefined
}

export function openDatabase(file: string, options: { readonly?: boolean } = {}): DB {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true })
  const db = new Database(file, { readonly: options.readonly ?? false, fileMustExist: options.readonly ?? false, nativeBinding: nativeBinding() })
  if (!options.readonly) db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.pragma('busy_timeout = 5000')
  db.pragma('synchronous = NORMAL')
  return db
}

export function migrationChecksum(migration: Migration): string {
  return createHash('sha256').update(migration.sql).digest('hex')
}

interface AppliedRow {
  version: number
  name: string
  checksum: string
}

export function appliedMigrations(db: DB): AppliedRow[] {
  const exists = db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'`).get()
  if (!exists) return []
  return db.prepare('SELECT version, name, checksum FROM schema_migrations ORDER BY version').all() as AppliedRow[]
}

export function currentSchemaVersion(db: DB): number {
  const rows = appliedMigrations(db)
  return rows.length === 0 ? 0 : rows[rows.length - 1].version
}

/**
 * Applies pending migrations in order. Each migration runs in its own transaction,
 * so a failure leaves the database at the last fully applied version.
 * Returns the versions that were applied by this call.
 */
export function migrate(db: DB, migrations: Migration[] = MIGRATIONS): number[] {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    checksum TEXT NOT NULL,
    applied_at TEXT NOT NULL
  ) STRICT`)

  const applied = appliedMigrations(db)
  const known = new Map(migrations.map((m) => [m.version, m]))
  const latestKnown = migrations.length ? migrations[migrations.length - 1].version : 0

  for (const row of applied) {
    const migration = known.get(row.version)
    if (!migration) {
      throw new MigrationError(
        `Database schema version ${row.version} is newer than this Alice build supports (latest ${latestKnown}). ` +
          'Run a newer Alice release or restore a backup taken with this version.',
      )
    }
    if (migrationChecksum(migration) !== row.checksum) {
      throw new MigrationError(
        `Migration ${row.version} (${row.name}) differs from the one applied to this database. ` +
          'The database was created by an incompatible build; restore from a backup.',
      )
    }
  }

  const appliedVersions = new Set(applied.map((r) => r.version))
  const ran: number[] = []
  const record = db.prepare('INSERT INTO schema_migrations (version, name, checksum, applied_at) VALUES (?, ?, ?, ?)')

  for (const migration of migrations) {
    if (appliedVersions.has(migration.version)) continue
    const run = db.transaction(() => {
      db.exec(migration.sql)
      record.run(migration.version, migration.name, migrationChecksum(migration), new Date().toISOString())
    })
    try {
      run()
    } catch (err) {
      throw new MigrationError(`Migration ${migration.version} (${migration.name}) failed and was rolled back: ${(err as Error).message}`)
    }
    ran.push(migration.version)
  }
  return ran
}

export function isSchemaCurrent(db: DB): boolean {
  return currentSchemaVersion(db) === LATEST_SCHEMA_VERSION
}
