import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { afterAll, describe, expect, it } from 'vitest'
import { ensureDaemon, probeDaemon } from '../../src/local/daemon-client'
import { readLocator } from '../../src/local/locator'
import { createWorkspace, ensureDefaultWorkspace, registryFile } from '../../src/local/registry'
import { isProcessAlive, workspacePaths } from '../../src/local/paths'
import { SERVER_COMMAND, call, localEnv, localHome, stopLocalDaemons, storedCapability, waitFor } from '../helpers/local'

afterAll(stopLocalDaemons)

const start = (home: string, ws: Parameters<typeof ensureDaemon>[1], extra: Record<string, string | undefined> = {}, version?: string) =>
  ensureDaemon(home, ws, { env: localEnv(home, extra), command: SERVER_COMMAND, version })

describe('Local daemon supervision', () => {
  it('concurrent starts produce one daemon that Desktop and CLI share; workspaces run side by side', async () => {
    const home = localHome()
    const { workspace } = ensureDefaultWorkspace(home)
    const other = createWorkspace(home, { name: 'Side' })
    const endpoints = await Promise.all([...Array.from({ length: 5 }, () => start(home, workspace)), start(home, other)])
    const mine = endpoints.slice(0, 5)
    expect(new Set(mine.map((e) => e.locator.pid)).size).toBe(1)
    expect(new Set(mine.map((e) => e.baseUrl)).size).toBe(1)
    expect(endpoints[5].locator.port).not.toBe(mine[0].locator.port)
    expect(fs.readFileSync(workspacePaths(home, workspace.id).lock, 'utf8').trim()).toBe(String(mine[0].locator.pid))
    const again = await start(home, workspace)
    expect(again).toMatchObject({ started: false, baseUrl: mine[0].baseUrl })
  })

  it('requires the capability, resolves the owner server-side and exposes no browser, login, device, download or MCP surface', async () => {
    const home = localHome()
    const { workspace } = ensureDefaultWorkspace(home)
    const { baseUrl } = await start(home, workspace)
    const owner = storedCapability(home, workspace.id)!
    expect(owner).toMatch(/^alice_lc_/)

    const health = await call(baseUrl, '/local/health')
    expect(health.status).toBe(200)
    expect(Object.keys(health.data).sort()).toEqual(['generation', 'status', 'version', 'workspaceId'])

    expect((await call(baseUrl, '/local/v1/whoami', { token: owner })).data).toMatchObject({ actor: { displayName: 'Local Owner', isOwner: true, kind: 'human' }, workspace: { id: workspace.id, kind: 'local' } })
    expect((await call(baseUrl, '/client/v1/tasks')).status).toBe(401)
    expect((await call(baseUrl, '/client/v1/tasks', { token: 'alice_lc_wrong' })).status).toBe(401)
    expect((await call(baseUrl, '/local/v1/whoami', { token: 'alice_lc_wrong' })).status).toBe(401)
    const created = await call(baseUrl, '/client/v1/tasks', { token: owner, body: { title: 'First local task' } })
    expect(created.status).toBe(201)

    // เว็บไซต์อื่น (มี Origin) และ DNS rebinding (Host ไม่ใช่ loopback) ถูกปฏิเสธ แม้มี capability
    expect((await call(baseUrl, '/client/v1/tasks', { token: owner, headers: { origin: 'https://evil.example' } })).status).toBe(403)
    // fetch ไม่ยอมให้ตั้ง Host เอง จึงใช้ node:http
    const rebound = await new Promise<number>((resolve, reject) => {
      const req = http.request(`${baseUrl}/client/v1/tasks`, { headers: { host: 'evil.example', authorization: `Bearer ${owner}` } }, (res) => {
        res.resume()
        resolve(res.statusCode!)
      })
      req.on('error', reject)
      req.end()
    })
    expect(rebound).toBe(403)
    for (const p of ['/', '/login', '/setup', '/livez', '/downloads/manifest.json', '/mcp/v1', '/api/tasks', '/client/v1/auth/login', '/client/v1/auth/bootstrap', '/client/v1/device/authorize', '/client/v1/invites', '/client/v1/agents']) {
      const res = await call(baseUrl, p, { token: owner, method: p.includes('login') || p.includes('authorize') ? 'POST' : 'GET', body: p.includes('login') || p.includes('authorize') ? {} : undefined })
      expect([p, res.status]).toEqual([p, 404])
    }
    const preflight = await fetch(`${baseUrl}/client/v1/tasks`, { method: 'OPTIONS', headers: { origin: 'https://evil.example', 'access-control-request-method': 'GET' } })
    expect(preflight.headers.get('access-control-allow-origin')).toBeNull()

    // capability ไม่อยู่ใน registry, locator หรือ log
    const paths = workspacePaths(home, workspace.id)
    const logs = fs.readdirSync(paths.logs).map((f) => fs.readFileSync(path.join(paths.logs, f), 'utf8')).join('\n')
    expect(logs).toContain('alice.local.listening')
    for (const text of [fs.readFileSync(registryFile(home), 'utf8'), fs.readFileSync(paths.locator, 'utf8'), logs]) expect(text).not.toContain(owner)
    if (process.platform !== 'win32') expect(fs.statSync(paths.locator).mode & 0o777).toBe(0o600)
  })

  it('cleans a stale locator without touching the unrelated live process it names', async () => {
    const home = localHome()
    const { workspace } = ensureDefaultWorkspace(home)
    const paths = workspacePaths(home, workspace.id)
    const bystander = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore' })
    fs.writeFileSync(paths.locator, JSON.stringify({ locatorVersion: 1, workspaceId: workspace.id, pid: bystander.pid, port: 1, generation: 'old', version: '0.0.0', startedAt: 'x' }))
    fs.writeFileSync(paths.lock, '999999999')
    const { locator } = await start(home, workspace)
    expect(locator.pid).not.toBe(bystander.pid)
    expect(isProcessAlive(bystander.pid!)).toBe(true)
    bystander.kill()
  })

  it('a CLI-only daemon stops when idle, a Desktop presence lease keeps it alive, and shutdown is graceful', async () => {
    const home = localHome()
    const { workspace } = ensureDefaultWorkspace(home)
    const paths = workspacePaths(home, workspace.id)
    const idle = { ALICE_LOCAL_IDLE_MS: '1200' }
    const first = await start(home, workspace, idle)
    await waitFor(() => !isProcessAlive(first.locator.pid))
    expect(fs.existsSync(paths.locator)).toBe(false)
    expect(fs.existsSync(paths.lock)).toBe(false)

    const second = await start(home, workspace, idle)
    const owner = storedCapability(home, workspace.id)!
    expect((await call(second.baseUrl, '/local/v1/presence', { token: owner, body: { seconds: 4 } })).status).toBe(200)
    await new Promise((r) => setTimeout(r, 2_500))
    expect(isProcessAlive(second.locator.pid)).toBe(true)
    const task = await call(second.baseUrl, '/client/v1/tasks', { token: owner, body: { title: 'Survives shutdown' } })
    expect((await call(second.baseUrl, '/local/v1/shutdown', { token: owner, body: {} })).data).toEqual({ stopping: true })
    await waitFor(() => !isProcessAlive(second.locator.pid))
    expect(fs.existsSync(paths.locator)).toBe(false)

    const third = await start(home, workspace)
    expect((await call(third.baseUrl, `/client/v1/tasks/${task.data.task?.id ?? task.data.id}`, { token: owner })).status).toBe(200)
  })

  it('a crashed daemon restarts with every committed mutation and the owner keeps its capability', async () => {
    const home = localHome()
    const { workspace } = ensureDefaultWorkspace(home)
    const first = await start(home, workspace)
    const owner = storedCapability(home, workspace.id)!
    for (let i = 0; i < 5; i++) await call(first.baseUrl, '/client/v1/tasks', { token: owner, body: { title: `Before crash ${i}` } })
    process.kill(first.locator.pid, 'SIGKILL')
    await waitFor(() => !isProcessAlive(first.locator.pid))
    const second = await start(home, workspace)
    expect(second.locator.generation).not.toBe(first.locator.generation)
    expect(storedCapability(home, workspace.id)).toBe(owner)
    const list = await call(second.baseUrl, '/client/v1/tasks?limit=50', { token: owner })
    expect(JSON.stringify(list.data).match(/Before crash/g)).toHaveLength(5)
  })

  it('refuses an exact-version mismatch and stops when the credential store is unavailable', async () => {
    const home = localHome()
    const { workspace } = ensureDefaultWorkspace(home)
    await start(home, workspace)
    await expect(start(home, workspace, {}, '9.9.9')).rejects.toMatchObject({ code: 'CLIENT_INCOMPATIBLE' })
    expect((await probeDaemon(home, workspace.id)).ok).toBe(true)

    const broken = createWorkspace(home, { name: 'No keyring' })
    await expect(start(home, broken, { ALICE_CREDENTIAL_STORE: 'secret-service', PATH: '/nonexistent' }, undefined)).rejects.toThrow(/could not start/)
    expect(readLocator(workspacePaths(home, broken.id).locator)).toBeNull()
  })
})
