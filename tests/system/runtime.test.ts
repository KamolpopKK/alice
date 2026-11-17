import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'
import { runCli, startApp, tempDataDir, type RunningApp } from '../helpers/app'

let app: RunningApp | null = null
afterEach(async () => {
  await app?.stop()
  app = null
})

describe('runtime and system seam', () => {
  it('creates and migrates a database on first start, then reports ready', async () => {
    app = await startApp()
    const ready = await fetch(`${app.url}/readyz`)
    expect(ready.status).toBe(200)
    const body = await ready.json()
    expect(body.status).toBe('ready')
    expect(body.schemaVersion).toBeGreaterThanOrEqual(1)
    expect(fs.existsSync(path.join(app.dataDir, 'alice.db'))).toBe(true)

    const live = await fetch(`${app.url}/livez`)
    expect(live.status).toBe(200)
  })

  it('does not re-apply migrations on restart and keeps existing data', async () => {
    const dataDir = tempDataDir()
    app = await startApp({ dataDir })
    const first = await (await fetch(`${app.url}/readyz`)).json()
    await app.stop()

    // ใส่ข้อมูลทดสอบตรง ๆ เพื่อยืนยันว่า restart ไม่ลบข้อมูลเดิม
    const db = new Database(path.join(dataDir, 'alice.db'))
    const appliedBefore = db.prepare('SELECT version, applied_at FROM schema_migrations ORDER BY version').all()
    db.prepare(`INSERT INTO installation (key, value) VALUES ('restart_probe', 'kept')`).run()
    db.close()

    app = await startApp({ dataDir })
    const second = await (await fetch(`${app.url}/readyz`)).json()
    expect(second.schemaVersion).toBe(first.schemaVersion)
    await app.stop()
    app = null

    const db2 = new Database(path.join(dataDir, 'alice.db'))
    expect(db2.prepare('SELECT version, applied_at FROM schema_migrations ORDER BY version').all()).toEqual(appliedBefore)
    expect(db2.prepare(`SELECT value FROM installation WHERE key = 'restart_probe'`).get()).toEqual({ value: 'kept' })
    expect(db2.pragma('journal_mode', { simple: true })).toBe('wal')
    db2.close()
  })

  it('serves the web shell for client routes and JSON 404s for unknown API routes', async () => {
    app = await startApp()
    const shell = await fetch(`${app.url}/projects/anything`)
    expect(shell.status).toBe(200)
    expect(shell.headers.get('content-type')).toContain('text/html')
    expect(await shell.text()).toContain('<title>Alice</title>')
    expect(shell.headers.get('x-content-type-options')).toBe('nosniff')

    const api = await fetch(`${app.url}/api/does-not-exist`)
    expect(api.status).toBe(404)
    expect((await api.json()).error.code).toBe('NOT_FOUND')
  })

  it('refuses to start with invalid security configuration and never prints secret values', () => {
    const secret = 'short-secret'
    const result = runCli(['serve'], {
      NODE_ENV: 'production',
      ALICE_PUBLIC_URL: 'http://alice.example.com',
      ALICE_BOOTSTRAP_TOKEN: secret,
    })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('ALICE_PUBLIC_URL must use https://')
    expect(result.stderr).toContain('ALICE_BOOTSTRAP_TOKEN must be at least 24 characters')
    expect(result.stderr + result.stdout).not.toContain(secret)

    const missing = runCli(['serve'], { NODE_ENV: 'production', ALICE_PUBLIC_URL: undefined })
    expect(missing.status).toBe(1)
    expect(missing.stderr).toContain('ALICE_PUBLIC_URL is required in production')
  })

  it('migrate command is idempotent', () => {
    const dataDir = tempDataDir('migrate')
    const first = runCli(['migrate'], { ALICE_DATA_DIR: dataDir })
    expect(first.status).toBe(0)
    expect(first.stdout).toContain('Applied migrations')
    const second = runCli(['migrate'], { ALICE_DATA_DIR: dataDir })
    expect(second.status).toBe(0)
    expect(second.stdout).toContain('Database is up to date')
  })
})

describe('static assets', () => {
  it('returns 404 for missing asset files instead of the HTML shell', async () => {
    const app = await startApp()
    try {
      const res = await fetch(`${app.url}/assets/missing-abc123.js`)
      expect(res.status).toBe(404)
      expect((await fetch(`${app.url}/favicon.ico`)).status).toBe(404)
      expect((await fetch(`${app.url}/tasks/tsk_abc`)).status).toBe(200)
      const root = await fetch(`${app.url}/`)
      expect(root.status).toBe(200)
      expect(await root.text()).toContain('<title>Alice</title>')
    } finally {
      await app.stop()
    }
  })
})
