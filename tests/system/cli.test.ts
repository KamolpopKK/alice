import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { runCli, startApp, tempDataDir, type RunningApp } from '../helpers/app'
import { APP_VERSION } from '../../src/shared/version'
import { HttpClient, bootstrapOwner, inviteHuman } from '../helpers/client'
import { activityFor } from '../helpers/db'
import { alice, buildCli, cliHome, startAlice, type CliEnv } from '../helpers/cli'

/** Signs the CLI in through the real device flow; `approver` plays the human in the browser. */
async function cliLogin(home: CliEnv, approver: HttpClient, profile?: string) {
  const run = await startAlice(home, ['auth', 'login', '--no-browser', '--device-name', 'ci-box', ...(profile ? ['--profile', profile] : [])])
  const [, code] = await run.waitForStderr(/code ([A-Z]{4}-[A-Z]{4})/)
  const approved = await approver.post('/client/v1/device/approve', { userCode: code })
  expect(approved.status).toBe(200)
  return run.done
}

const secretsIn = (text: string) => text.match(/alice_(c[ar]|dc)_[a-z0-9]+/g) ?? []

describe('alice CLI artifact', () => {
  it('installs the embedded understanding skill for both clients and scopes without source files', async () => {
    const { standalone } = await buildCli()
    for (const client of ['codex', 'claude-code']) {
      for (const scope of ['user', 'project']) {
        const target = tempDataDir('understand-install')
        const home = cliHome()
        const result = await alice(home, ['install-skill', '--client', client, '--scope', scope, '--skill', 'alice-understand'], {
          entry: path.join(standalone, 'alice.js'), extraEnv: { HOME: target }, cwd: target,
        })
        expect(result.code, result.stderr).toBe(0)
        const base = path.join(target, client === 'codex' ? '.codex/skills' : '.claude/skills')
        expect(fs.readdirSync(base)).toEqual(['alice-understand'])
        for (const relative of ['skill/_shared', 'skill/alice-understand']) {
          const source = path.resolve(import.meta.dirname, '../..', relative)
          for (const file of fs.readdirSync(source)) {
            expect(fs.readFileSync(path.join(base, 'alice-understand', file), 'utf8')).toBe(fs.readFileSync(path.join(source, file), 'utf8'))
          }
        }
        const version = await alice(home, ['version', '--json'], { entry: path.join(standalone, 'alice.js'), extraEnv: { HOME: target }, cwd: target })
        expect(JSON.parse(version.stdout).agentSkills['alice-understand'][`${client} (${scope})`]).toBe(APP_VERSION)
      }
    }
  })

  it('runs standalone without node_modules, SQLite or server runtime code', async () => {
    const { standalone } = await buildCli()
    expect(fs.readdirSync(standalone)).toEqual(['alice.js'])
    const bundle = fs.readFileSync(path.join(standalone, 'alice.js'), 'utf8')
    for (const forbidden of ['better-sqlite3', 'fastify', '@modelcontextprotocol', 'CREATE TABLE']) expect(bundle).not.toContain(forbidden)

    const home = cliHome()
    const version = await alice(home, ['version', '--json'], { entry: path.join(standalone, 'alice.js') })
    expect(version.code).toBe(0)
    expect(JSON.parse(version.stdout)).toMatchObject({ cli: expect.any(String), clientApi: 1 })

    const legacy = await alice(home, ['migrate'], { entry: path.join(standalone, 'alice.js') })
    expect(legacy.code).toBe(2)
    expect(legacy.stderr).toContain('alice-server migrate')
  })

  it('keeps Agent helpers available from the client distribution', async () => {
    const { standalone } = await buildCli()
    const home = cliHome()
    const fakeHome = tempDataDir('cli-skill-home')
    const res = await alice(home, ['install-skill', '--client', 'claude-code'], { entry: path.join(standalone, 'alice.js'), extraEnv: { HOME: fakeHome } })
    expect(res.code).toBe(0)
    const installed = fs.readFileSync(path.join(fakeHome, '.claude/skills/alice/SKILL.md'), 'utf8')
    expect(installed).toBe(fs.readFileSync(path.resolve(import.meta.dirname, '../../skill/alice/SKILL.md'), 'utf8'))
    expect(fs.existsSync(path.join(fakeHome, '.claude/skills/alice-plan/SKILL.md'))).toBe(true)
    expect(res.stdout).toContain('Installed the alice-plan skill')
    expect(fs.readFileSync(path.join(fakeHome, '.claude/skills/alice-spec/SKILL.md'), 'utf8')).toBe(fs.readFileSync(path.resolve(import.meta.dirname, '../../skill/alice-spec/SKILL.md'), 'utf8'))
    const snippet = await alice(home, ['mcp-config', '--client', 'claude-code', '--url', 'https://alice.example.com'])
    expect(snippet.stdout).toContain('https://alice.example.com/mcp/v1')
    expect(snippet.stdout).toContain('${ALICE_TOKEN}')
    expect((await alice(home, ['install-skill', '--client', 'vim'])).code).toBe(2)
  })
})

describe('alice CLI against a real server', () => {
  let app: RunningApp
  let owner: HttpClient
  let member: HttpClient

  beforeAll(async () => {
    app = await startApp({ env: { ALICE_DEVICE_POLL_INTERVAL: '1' } })
    owner = await bootstrapOwner(app)
    member = await inviteHuman(owner, 'mia', 'Mia Member')
    await buildCli()
  })
  afterAll(async () => {
    await app?.stop()
  })

  it('manages profiles without secrets and enforces HTTPS for remote servers', async () => {
    const home = cliHome()
    const added = await alice(home, ['profile', 'add', 'work', '--server', app.url])
    expect(added.code).toBe(0)
    expect(added.stdout).toContain('Added profile work')
    expect(added.stderr).toContain('unencrypted HTTP')

    const remoteHttp = await alice(home, ['profile', 'add', 'prod', '--server', 'http://alice.example.com'])
    expect(remoteHttp.code).toBe(2)
    expect(remoteHttp.stderr).toContain('Refusing plain HTTP')
    expect(remoteHttp.stderr).toContain('--insecure-dev')
    const dev = await alice(home, ['profile', 'add', 'devbox', '--server', 'http://devbox.internal:8080', '--insecure-dev', '--no-use'])
    expect(dev.code).toBe(0)
    expect((await alice(home, ['profile', 'add', 'staging', '--server', 'https://staging.example.com/', '--no-use'])).code).toBe(0)
    expect((await alice(home, ['profile', 'add', 'bad name', '--server', 'https://x.example'])).code).toBe(2)

    const list = await alice(home, ['profile', 'list', '--json'])
    const profiles = JSON.parse(list.stdout) as Array<{ name: string; active: boolean; server: string; insecure: boolean }>
    expect(profiles.map((p) => [p.name, p.active])).toEqual([
      ['work', true],
      ['devbox', false],
      ['staging', false],
    ])
    expect(profiles.find((p) => p.name === 'staging')!.server).toBe('https://staging.example.com')
    const table = await alice(home, ['profile', 'list'])
    expect(table.stdout.split('\n')[0]).toMatch(/NAME\s+SERVER/)
    expect(table.stdout).toMatch(/\*\s+work/)

    expect((await alice(home, ['profile', 'use', 'staging'])).code).toBe(0)
    expect(JSON.parse((await alice(home, ['profile', 'show', '--json'])).stdout)).toMatchObject({ name: 'staging', active: true, signedIn: false })
    expect((await alice(home, ['profile', 'remove', 'staging'])).code).toBe(2) // non-interactive needs --yes
    expect((await alice(home, ['profile', 'remove', 'staging', '--yes'])).code).toBe(0)
    expect((await alice(home, ['--profile', 'nope', 'whoami'])).code).toBe(2)
  })

  it('tests connectivity and reports compatibility and network failures with stable exit codes', async () => {
    const home = cliHome()
    await alice(home, ['profile', 'add', 'work', '--server', app.url])
    const ok = await alice(home, ['profile', 'test', '--json'])
    expect(ok.code).toBe(0)
    expect(JSON.parse(ok.stdout)).toMatchObject({ profile: 'work', compatible: true, tls: 'none (insecure HTTP)', clientApi: { current: 1, minimum: 1 } })

    // server ที่ต้องการ protocol ใหม่กว่าที่ CLI รองรับ
    const future = http.createServer((req, res) => {
      res.setHeader('content-type', 'application/json')
      if (req.url?.startsWith('/client/v1/info')) {
        res.end(JSON.stringify({ product: 'alice', name: 'Alice', serverVersion: '9.0.0', publicUrl: 'x', clientApi: { current: 3, minimum: 3, prefix: '/client/v3' }, capabilities: [], events: { retentionHours: 1, maxReplay: 1 } }))
      } else {
        res.statusCode = 426
        res.end(JSON.stringify({ error: { code: 'CLIENT_INCOMPATIBLE', message: 'Client API v1 is no longer supported by this server; upgrade the client' } }))
      }
    })
    await new Promise<void>((r) => future.listen(0, '127.0.0.1', r))
    const port = (future.address() as { port: number }).port
    await alice(home, ['profile', 'add', 'future', '--server', `http://127.0.0.1:${port}`, '--no-use'])
    const incompatible = await alice(home, ['--profile', 'future', 'profile', 'test'])
    expect(incompatible.code).toBe(5)
    expect(incompatible.stdout).toContain('Upgrade the client')
    const loginIncompatible = await alice(home, ['--profile', 'future', 'auth', 'login', '--no-browser'])
    expect(loginIncompatible.code).toBe(5)
    future.close()

    // port ที่เพิ่งปิด → connection refused
    const closed = http.createServer()
    await new Promise<void>((r) => closed.listen(0, '127.0.0.1', r))
    const deadPort = (closed.address() as { port: number }).port
    await new Promise((r) => closed.close(r))
    await alice(home, ['profile', 'add', 'down', '--server', `http://127.0.0.1:${deadPort}`, '--no-use'])
    const down = await alice(home, ['--profile', 'down', 'profile', 'test'])
    expect(down.code).toBe(6)
    expect(down.stderr).toContain('Could not connect')

    expect((await alice(home, ['frobnicate'])).code).toBe(2)
    expect((await alice(home, ['profile', 'list', '--bogus'])).code).toBe(2)
    expect((await alice(home, ['--json', '--jsonl', 'version'])).code).toBe(2)
  })

  it('signs in through device approval, keeps secrets out of config and output, and attributes to the human', async () => {
    const home = cliHome()
    await alice(home, ['profile', 'add', 'work', '--server', app.url])
    const login = await cliLogin(home, member)
    expect(login.code).toBe(0)
    expect(login.stdout).toContain('Signed in to work')
    expect(login.stdout).toContain('as Mia Member')
    expect(login.stderr).toMatch(/\/device\?code=[A-Z]{4}-[A-Z]{4}/)

    const config = fs.readFileSync(path.join(home.configDir, 'config.json'), 'utf8')
    expect(secretsIn(config)).toEqual([])
    const stored = JSON.parse(fs.readFileSync(home.credentialFile, 'utf8')) as Record<string, string>
    expect(Object.keys(stored)).toEqual([`work@${app.url}`])
    expect(Object.values(stored)[0]).toMatch(/^alice_cr_/)
    expect(secretsIn(login.stdout + login.stderr)).toEqual([])

    const who = await alice(home, ['whoami', '--json'])
    expect(who.code).toBe(0)
    const me = JSON.parse(who.stdout)
    expect(me).toMatchObject({ profile: 'work', actor: { displayName: 'Mia Member', kind: 'human' }, session: { clientName: 'Alice CLI', deviceName: 'ci-box', current: true } })
    const sessions = (await member.get('/client/v1/client-sessions')).body.items
    expect(sessions.some((s: { id: string; clientKind: string }) => s.id === me.session.id && s.clientKind === 'cli')).toBe(true)

    // activity ของการอนุมัติเป็นของคนที่อนุมัติ
    expect(activityFor(app, me.session.id)[0]).toMatchObject({ verb: 'client_session.approved', actor_id: me.actor.id })
  })

  it('serializes refresh across parallel commands so rotation never looks like replay', async () => {
    const home = cliHome()
    await alice(home, ['profile', 'add', 'work', '--server', app.url])
    expect((await cliLogin(home, member)).code).toBe(0)
    const runs = await Promise.all(Array.from({ length: 6 }, () => alice(home, ['whoami', '--jsonl'])))
    expect(runs.map((r) => r.code)).toEqual([0, 0, 0, 0, 0, 0])
    expect((await alice(home, ['whoami'])).code).toBe(0)
  })

  it('logs out one profile without touching another, and reports revoked sessions', async () => {
    const home = cliHome()
    await alice(home, ['profile', 'add', 'work', '--server', app.url])
    await alice(home, ['profile', 'add', 'admin', '--server', app.url, '--no-use'])
    expect((await cliLogin(home, member, 'work')).code).toBe(0)
    expect((await cliLogin(home, owner, 'admin')).code).toBe(0)
    const workSession = JSON.parse((await alice(home, ['whoami', '--json'])).stdout).session.id

    const out = await alice(home, ['auth', 'logout'])
    expect(out.code).toBe(0)
    expect(out.stdout).toContain('Signed out of work')
    const workRow = (await member.get('/client/v1/client-sessions?include=all')).body.items.find((s: { id: string }) => s.id === workSession)
    expect(workRow.revokedAt).not.toBeNull()
    const afterLogout = await alice(home, ['whoami'])
    expect(afterLogout.code).toBe(3)
    expect(afterLogout.stderr).toContain('alice auth login --profile work')

    const adminWho = await alice(home, ['--profile', 'admin', 'whoami', '--json'])
    expect(adminWho.code).toBe(0)
    expect(JSON.parse(adminWho.stdout).actor.isOwner).toBe(true)

    // owner revoke จากเว็บ → CLI ได้ exit 3 พร้อมคำแนะนำ และลบ credential ที่ใช้ไม่ได้แล้ว
    const adminSession = JSON.parse(adminWho.stdout).session.id
    expect((await owner.post(`/client/v1/client-sessions/${adminSession}/revoke`)).status).toBe(200)
    const revoked = await alice(home, ['--profile', 'admin', 'whoami'])
    expect(revoked.code).toBe(3)
    expect(revoked.stderr).toContain('expired or was revoked')
    expect(secretsIn(revoked.stderr + revoked.stdout)).toEqual([])
    expect(JSON.parse(fs.readFileSync(home.credentialFile, 'utf8'))).toEqual({})
  })

  // ใช้ Keychain จริงของเครื่อง จึงรันเฉพาะเมื่อสั่ง: ALICE_TEST_KEYCHAIN=1 (macOS)
  it.runIf(process.platform === 'darwin' && process.env.ALICE_TEST_KEYCHAIN === '1')('stores the refresh credential in the macOS Keychain', async () => {
    const home = cliHome('cli-keychain')
    const env = { ...home, env: { ...home.env, ALICE_CREDENTIAL_STORE: 'keychain' } }
    const profile = `kc-${Date.now()}`
    await alice(env, ['profile', 'add', profile, '--server', app.url])
    expect((await cliLogin(env, member)).code).toBe(0)
    expect(fs.existsSync(home.credentialFile)).toBe(false)
    const { execFileSync } = await import('node:child_process')
    const account = `${profile}@${app.url}`
    expect(execFileSync('security', ['find-generic-password', '-a', account, '-s', 'alice-cli', '-w']).toString()).toMatch(/^alice_cr_/)
    expect((await alice(env, ['whoami'])).code).toBe(0)
    expect((await alice(env, ['auth', 'logout'])).code).toBe(0)
    expect(() => execFileSync('security', ['find-generic-password', '-a', account, '-s', 'alice-cli'], { stdio: 'ignore' })).toThrow()
  })

  it('forwards legacy server commands to alice-server with a deprecation notice', async () => {
    const home = cliHome()
    const dataDir = tempDataDir('legacy-alias')
    const res = await alice(home, ['migrate'], { extraEnv: { ALICE_DATA_DIR: dataDir, NODE_ENV: 'test' } })
    expect(res.code).toBe(0)
    expect(res.stderr).toContain('"alice migrate" is deprecated; use "alice-server migrate"')
    expect(res.stdout).toContain('Schema version')
  })
})

describe('version diagnostics', () => {
  it('reports CLI, Client API, server, adapter and installed skill versions without secrets', async () => {
    const app = await startApp()
    try {
      const home = cliHome('cli-diag')
      const fakeHome = tempDataDir('cli-diag-home')
      await alice(home, ['profile', 'add', 'work', '--server', app.url])
      await alice(home, ['install-skill', '--client', 'codex'], { extraEnv: { HOME: fakeHome } })
      const res = await alice(home, ['version', '--json'], { extraEnv: { HOME: fakeHome } })
      expect(res.code).toBe(0)
      const v = JSON.parse(res.stdout)
      expect(v).toMatchObject({ cli: APP_VERSION, clientApi: 1, server: { version: APP_VERSION, compatible: true, clientApi: { current: 1, minimum: 1 } }, skills: { 'codex (user)': APP_VERSION }, agentSkills: { alice: { 'codex (user)': APP_VERSION }, 'alice-plan': { 'codex (user)': APP_VERSION } } })
      expect(v).toHaveProperty('desktop')
      expect(v).toHaveProperty('mcpAdapter')
      expect(res.stdout).not.toMatch(/alice_(c[ar]|at)_/)

      const server = runCli(['version', '--json'], {})
      expect(JSON.parse(server.stdout)).toEqual({ server: APP_VERSION, clientApi: { current: 1, minimum: 1 }, mcpContract: '1', schema: expect.any(Number), node: process.version })
    } finally {
      await app.stop()
    }
  })
})
