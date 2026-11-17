import { describe, expect, it } from 'vitest'
import { MigrationError, currentSchemaVersion, migrate, openDatabase } from '../../src/server/db/database'
import { MIGRATIONS } from '../../src/server/db/migrations'

describe('migration runner', () => {
  it('has strictly increasing versions', () => {
    MIGRATIONS.forEach((m, i) => expect(m.version).toBe(i + 1))
  })

  it('applies in order once and is a no-op afterwards', () => {
    const db = openDatabase(':memory:')
    const migrations = [
      { version: 1, name: 'a', sql: 'CREATE TABLE a (x INTEGER)' },
      { version: 2, name: 'b', sql: 'ALTER TABLE a ADD COLUMN y INTEGER' },
    ]
    expect(migrate(db, migrations)).toEqual([1, 2])
    expect(migrate(db, migrations)).toEqual([])
    expect(currentSchemaVersion(db)).toBe(2)
  })

  it('rolls back a failing migration and keeps earlier ones', () => {
    const db = openDatabase(':memory:')
    const migrations = [
      { version: 1, name: 'a', sql: 'CREATE TABLE a (x INTEGER)' },
      { version: 2, name: 'broken', sql: 'CREATE TABLE b (x INTEGER); SELECT * FROM missing_table' },
    ]
    expect(() => migrate(db, migrations)).toThrow(MigrationError)
    expect(currentSchemaVersion(db)).toBe(1)
    expect(db.prepare(`SELECT name FROM sqlite_master WHERE name = 'b'`).get()).toBeUndefined()
  })

  it('refuses databases from newer builds or with altered migrations', () => {
    const db = openDatabase(':memory:')
    migrate(db, [{ version: 1, name: 'a', sql: 'CREATE TABLE a (x INTEGER)' }, { version: 2, name: 'b', sql: 'CREATE TABLE b (x INTEGER)' }])
    expect(() => migrate(db, [{ version: 1, name: 'a', sql: 'CREATE TABLE a (x INTEGER)' }])).toThrow(/newer/)
    expect(() =>
      migrate(db, [
        { version: 1, name: 'a', sql: 'CREATE TABLE a (x TEXT)' },
        { version: 2, name: 'b', sql: 'CREATE TABLE b (x INTEGER)' },
      ]),
    ).toThrow(/differs/)
  })
})
