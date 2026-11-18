import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
// @ts-expect-error build script เป็น .mjs ไม่มี type declaration
import { buildRuntime } from '../../scripts/runtime-build.mjs'
import { activateRuntime, installRuntime } from '../../src/local/activation'
import { readLocator, LOCATOR_VERSION } from '../../src/local/locator'
import { isProcessAlive, workspacePaths } from '../../src/local/paths'
import { createWorkspace, listWorkspaces } from '../../src/local/registry'
import { installLauncher, installedRuntime, setPointer, verifyRuntimeDir } from '../../src/local/runtime-install'
import { localEnv, localHome, storedCapability } from '../helpers/local'
import { testDir } from '../helpers/tmp'

/** The packaged runtime, launcher and atomic activation with rollback. */
let built: string
const variants: Record<string, string> = {}
const homes: string[] = []

/** A copy of the built runtime under another version name (same code; activation logic is what differs). */
function variant(version: string): string {
  if (variants[version]) return variants[version]
  const dir = testDir(`alice-rt-${version}-`)
  fs.cpSync(built, dir, { recursive: true })
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'))
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ ...manifest, version }))
  return (variants[version] = dir)
}

function launcherEnv(home: string) {
  return { ...localEnv(home), PATH: '/usr/bin:/bin', ALICE_LAUNCHER_PATH: path.join(home, 'bin', 'alice'), ALICE_CONFIG_DIR: path.join(home, 'cli-config') }
}

function run(home: string, args: string[]) {
  const env = launcherEnv(home)
  const res = spawnSync('/bin/sh', [env.ALICE_LAUNCHER_PATH!, ...args], { env, encoding: 'utf8', cwd: os.tmpdir() })
  return { code: res.status, stdout: res.stdout, stderr: res.stderr }
}

beforeAll(async () => {
  // runtime จริงจาก source ของ repo นี้ โดยใช้ Node ที่รัน test เป็นไบนารีที่แจก
  const out = testDir('alice-runtime-')
  await buildRuntime({ root: path.resolve(import.meta.dirname, '../..'), outdir: out, nodeBinary: process.execPath, version: '0.2.0' })
  built = out
}, 180_000)

afterAll(() => {
  for (const home of homes) {
    try {
      for (const ws of listWorkspaces(home)) {
        const l = readLocator(workspacePaths(home, ws.id).locator)
        if (l) process.kill(l.pid, 'SIGTERM')
      }
    } catch {
      /* none */
    }
  }
})

function home(): string {
  const h = localHome()
  homes.push(h)
  return h
}

describe('Local runtime packaging and activation', () => {
  it('installs a verified runtime and a launcher that work without the repository or a system Node.js', () => {
    const h = home()
    const manifest = installRuntime(h, built)
    expect(manifest.files.map((f) => f.path).sort()).toEqual(['alice-server.js', 'alice.js', 'better_sqlite3.node', 'node'])
    expect(manifest.node.version).toBe(process.version)
    setPointer(h, 'current', manifest.version)
    const launcher = installLauncher(h, launcherEnv(h))
    expect(fs.readFileSync(launcher, 'utf8')).toContain(path.join(h, 'runtime', 'current'))

    expect(run(h, ['workspace', 'create', '--json']).code).toBe(0)
    const created = run(h, ['task', 'create', '--title', 'From the packaged runtime', '--json'])
    expect(created.code).toBe(0)
    expect(JSON.parse(created.stdout).workspace.kind).toBe('local')
    // daemon ทำงานจาก runtime ที่ติดตั้ง ไม่ใช่จาก repo
    const ws = listWorkspaces(h)[0]
    const pid = readLocator(workspacePaths(h, ws.id).locator)!.pid
    const cmd = spawnSync('ps', ['-o', 'command=', '-p', String(pid)], { encoding: 'utf8' }).stdout
    expect(cmd).toContain(path.join(h, 'runtime'))
    expect(cmd).not.toContain('src/server/cli.ts')
    expect(cmd).not.toContain('tsx')
  })

  it('detects a tampered runtime and a missing one, and the launcher explains the missing runtime', () => {
    const h = home()
    installRuntime(h, built)
    setPointer(h, 'current', '0.2.0')
    installLauncher(h, launcherEnv(h))
    const server = path.join(h, 'runtime', '0.2.0', 'alice-server.js')
    fs.appendFileSync(server, '\n// tampered\n')
    expect(verifyRuntimeDir(path.join(h, 'runtime', '0.2.0'), '0.2.0')).toEqual(['alice-server.js: checksum mismatch'])
    expect(installedRuntime(h)!.problems).toHaveLength(1)
    // ติดตั้งซ้ำแทนที่สำเนาที่เสีย
    installRuntime(h, built)
    expect(installedRuntime(h)!.problems).toEqual([])
    setPointer(h, 'current', null)
    const missing = run(h, ['version'])
    expect(missing.code).toBe(1)
    expect(missing.stderr).toContain('the Alice runtime is missing')
  })

  it('switches runtimes atomically, defers while work is running, and keeps the previous runtime', async () => {
    const h = home()
    installRuntime(h, variant('0.2.0-a'))
    expect((await activateRuntime(h, '0.2.0-a', { env: localEnv(h) })).status).toBe('activated')
    const ws = createWorkspace(h)
    installRuntime(h, variant('0.2.0-b'))

    // daemon ปลอมที่กำลังมีงานค้าง: การสลับต้องเลื่อนออกไป ไม่ตัดงาน
    const server = http.createServer((req, res) => {
      res.setHeader('content-type', 'application/json')
      if (req.url === '/local/health') return res.end(JSON.stringify({ status: 'ok', workspaceId: ws.id, generation: 'busy', version: '0.2.0' }))
      res.end(JSON.stringify({ active: 3, protectedOperations: 1 }))
    })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    const port = (server.address() as { port: number }).port
    fs.writeFileSync(workspacePaths(h, ws.id).locator, JSON.stringify({ locatorVersion: LOCATOR_VERSION, workspaceId: ws.id, pid: process.pid, port, generation: 'busy', version: '0.2.0', startedAt: '' }))
    const capFile = path.join(h, 'test-credentials.json')
    fs.writeFileSync(capFile, JSON.stringify({ [`${ws.id}/owner`]: 'alice_lc_fake' }))
    const deferred = await activateRuntime(h, '0.2.0-b', { env: localEnv(h) })
    expect(deferred).toMatchObject({ status: 'deferred', busy: [ws.alias] })
    expect(installedRuntime(h)!.version).toBe('0.2.0-a')
    server.close()
    fs.rmSync(workspacePaths(h, ws.id).locator)
    fs.rmSync(capFile)

    const activated = await activateRuntime(h, '0.2.0-b', { env: localEnv(h) })
    expect(activated).toMatchObject({ status: 'activated', from: '0.2.0-a', to: '0.2.0-b' })
    expect(installedRuntime(h)).toMatchObject({ version: '0.2.0-b', previous: '0.2.0-a' })
    // pointer ค้างจากการเขียนที่ถูกขัดจังหวะไม่ทำให้ current เสีย
    fs.symlinkSync('0.2.0-a', path.join(h, 'runtime', 'current.12345.0.tmp'))
    expect(installedRuntime(h)!.version).toBe('0.2.0-b')
  })

  it('a failed migration under the new runtime rolls back and the workspace opens with the previous one', async () => {
    const h = home()
    installRuntime(h, variant('0.2.0-a'))
    await activateRuntime(h, '0.2.0-a', { env: localEnv(h) })
    const ws = createWorkspace(h)
    const { ensureDaemon } = await import('../../src/local/daemon-client')
    const first = await ensureDaemon(h, ws, { env: localEnv(h), command: [path.join(h, 'runtime', 'current', 'node'), path.join(h, 'runtime', 'current', 'alice-server.js')] })
    const token = storedCapability(h, ws.id)!
    await fetch(`${first.baseUrl}/client/v1/tasks`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ title: 'Survives the failed update' }) })

    installRuntime(h, variant('0.2.0-c'))
    const result = await activateRuntime(h, '0.2.0-c', { env: localEnv(h), newDaemonEnv: { NODE_ENV: 'test', ALICE_TEST_FAILING_MIGRATION: '1' } })
    expect(result).toMatchObject({ status: 'rolled-back', from: '0.2.0-a', to: '0.2.0-c', failed: ws.alias })
    expect(installedRuntime(h)!.version).toBe('0.2.0-a')
    expect(isProcessAlive(first.locator.pid)).toBe(false)
    const reopened = readLocator(workspacePaths(h, ws.id).locator)!
    const tasks = await (await fetch(`http://127.0.0.1:${reopened.port}/client/v1/tasks`, { headers: { authorization: `Bearer ${token}` } })).json()
    expect((tasks as { items: Array<{ title: string }> }).items.map((t) => t.title)).toEqual(['Survives the failed update'])
  })
})
