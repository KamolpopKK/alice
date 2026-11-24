// Local daemon: process เดียวที่เปิด SQLite ของ Local workspace หนึ่ง
// ฟังเฉพาะ loopback port สุ่ม, ทุก request ที่ไม่ใช่ health ต้องมี capability, ไม่มีหน้า login/download/web
import fs from 'node:fs'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { AliceError } from '../../shared/errors'
import { APP_VERSION, CLIENT_API_PREFIX } from '../../shared/version'
import { loadConfig } from '../config'
import type { AppContext } from '../context'
import type { openDatabase } from '../db/database'
import { MIGRATIONS, type Migration } from '../db/migrations'
import { dailyBackupIfDue, prepareDatabase } from './backups'
import { ensureWorkspace } from '../domain/workspace'
import { EventBus } from '../events'
import { buildApp, type RouteRegistrar } from '../http/app'
import { bearerToken, registerAuth, setClientBearerResolver } from '../http/auth'
import { registerClientApi } from '../http/client-api'
import { registerPadRoutes } from '../http/pad-routes'
import { registerKnowledgeRoutes } from '../http/knowledge-routes'
import { HUMAN_ROUTES } from '../http/routes'
import { capabilityAccount, localCredentialStore } from '../../local/capabilities'
import { readRegistry } from '../../local/registry'
import { appDataRoot, workspacePaths, writeFileAtomic, type WorkspacePaths } from '../../local/paths'
import { LOCATOR_VERSION, type Locator } from '../../local/locator'
import { bootstrapLocalWorkspace, capabilityMatches, ensureLocalAgentActors, issueCapability, localIntegration, localOwnerId, resolveCapability } from './bootstrap'
import { disableIntegration, enableIntegration, registerLocalRoutes, type LocalRuntime } from './routes'
import { findActorRow, toActor } from '../domain/actors'
import { LOCAL_AGENT_CLIENTS, type Registry } from '../../local/registry'
import { LocalDaemonError, acquireWorkspaceLock } from '../../local/lock'
export { acquireWorkspaceLock }
import { IdleTracker } from './idle'

export const EXIT_ALREADY_RUNNING = 75

/**
 * Applies the machine-level opt-in to this workspace when it opens: an opted-in client that was never
 * enabled or disabled here gets its identity and credential; an opted-out client loses access. Explicit
 * per-workspace disable is respected.
 */
function reconcileIntegrations(ctx: AppContext, root: string, integrations: Registry['integrations'], store: ReturnType<typeof localCredentialStore>): void {
  const owner = toActor(findActorRow(ctx.db, localOwnerId(ctx)!)!)
  const runtime = { root } as Parameters<typeof enableIntegration>[1]
  for (const client of LOCAL_AGENT_CLIENTS) {
    const integration = integrations[client]
    if (!integration) continue
    const row = localIntegration(ctx, client)
    if (integration.optedIn && (!row || (!row.enabled_at && !row.disabled_at))) enableIntegration(ctx, runtime, owner, client)
    else if (integration.optedIn && row?.enabled_at && !row.disabled_at && !store.get(capabilityAccount(ctx.workspaceId, client))) {
      // credential หายจาก store (เช่น ย้ายเครื่อง/restore): ออกใหม่ให้ agent ที่ยังเปิดอยู่
      store.set(capabilityAccount(ctx.workspaceId, client), issueCapability(ctx, row.actor_id, 'agent'))
    } else if (!integration.optedIn && row?.enabled_at && !row.disabled_at) disableIntegration(ctx, runtime, owner, client)
  }
}

/** Test-only fault injection: an extra migration that fails, to prove migration failure fails closed. */
function testMigrations(env: NodeJS.ProcessEnv): Migration[] {
  if (env.NODE_ENV !== 'test' || env.ALICE_TEST_FAILING_MIGRATION !== '1') return MIGRATIONS
  const last = MIGRATIONS[MIGRATIONS.length - 1].version
  return [...MIGRATIONS, { version: last + 1, name: 'test_failure', sql: 'CREATE TABLE test_partial (x); SELECT broken FROM missing_table;' }]
}

export { LocalDaemonError } from '../../local/lock'

/** Paths under the Client API that a Local daemon never serves: sign-in, device flow, invitations, MCP tokens. */
const DENIED = [/^\/auth\/(login|logout|bootstrap|refresh|revoke)(\/|$)/, /^\/device(\/|$)/, /^\/invites(\/|$)/, /^\/client-sessions(\/|$)/, /^\/agents(\/|$)/, /^\/agent-tokens(\/|$)/]

export function isLocalPathAllowed(url: string): boolean {
  const p = url.split('?')[0]
  if (p === '/local/health' || p.startsWith('/local/v1/')) return true
  if (!p.startsWith(`${CLIENT_API_PREFIX}/`)) return false
  const rest = p.slice(CLIENT_API_PREFIX.length)
  return !DENIED.some((re) => re.test(rest))
}

/** Daily log files, kept for seven days. Only redacted request metadata is logged (no bodies, no queries). */
function prepareLogFile(paths: WorkspacePaths, now = new Date()): string {
  fs.mkdirSync(paths.logs, { recursive: true, mode: 0o700 })
  const cutoff = now.getTime() - 7 * 86_400_000
  for (const name of fs.readdirSync(paths.logs)) {
    const file = path.join(paths.logs, name)
    if (fs.statSync(file).mtimeMs < cutoff) fs.rmSync(file, { force: true })
  }
  const file = path.join(paths.logs, `daemon-${now.toISOString().slice(0, 10)}.log`)
  fs.closeSync(fs.openSync(file, 'a', 0o600))
  return file
}

export interface RunningDaemon {
  ctx: AppContext
  app: FastifyInstance
  locator: Locator
  shutdown: (reason: string) => Promise<void>
}

export async function startLocalDaemon(workspaceId: string, env: NodeJS.ProcessEnv = process.env): Promise<RunningDaemon> {
  const root = appDataRoot(env)
  const registry = readRegistry(root)
  const ws = registry.workspaces.find((w) => w.id === workspaceId)
  if (!ws) throw new LocalDaemonError(`no Local workspace with id ${workspaceId}`)
  const paths = workspacePaths(root, ws.id)
  fs.mkdirSync(paths.dataDir, { recursive: true, mode: 0o700 })
  const releaseLock = acquireWorkspaceLock(paths)
  let db: ReturnType<typeof openDatabase> | null = null
  try {
    const logFile = env.ALICE_LOCAL_LOG === 'stderr' ? undefined : prepareLogFile(paths)
    const config = loadConfig({
      NODE_ENV: env.NODE_ENV === 'test' ? 'test' : 'production',
      ALICE_DATA_DIR: paths.dataDir,
      ALICE_HOST: '127.0.0.1',
      ALICE_PORT: '0',
      ALICE_PUBLIC_URL: 'http://127.0.0.1',
      ALICE_WEB_DIR: path.join(paths.dir, 'no-web'),
      ALICE_DOWNLOADS_DIR: path.join(paths.dir, 'no-downloads'),
      ALICE_LOG_LEVEL: env.ALICE_LOG_LEVEL || 'info',
      ALICE_CLIENT_RATE_LIMIT: '100000',
    })
    config.logFile = logFile
    // integrity → pre-migration backup → migrate (ล้มที่ขั้นไหน workspace ปิดอยู่พร้อม recovery record)
    db = await prepareDatabase(paths, testMigrations(env))
    const id = ensureWorkspace(db, { id: ws.id, name: ws.name })
    const ctx: AppContext = { config, db, workspaceId: id, bus: new EventBus() }
    const ownerId = bootstrapLocalWorkspace(ctx)
    ensureLocalAgentActors(ctx, Object.values(registry.integrations))

    // capability ของเจ้าของ: ถ้า credential store ใช้ไม่ได้ให้หยุด ห้าม fallback เป็นไฟล์ plaintext
    const store = localCredentialStore(root, env)
    const account = capabilityAccount(ws.id, 'owner')
    if (!capabilityMatches(ctx, ownerId, store.get(account))) store.set(account, issueCapability(ctx, ownerId, 'owner'))
    reconcileIntegrations(ctx, root, registry.integrations, store)

    const idle = new IdleTracker(Number(env.ALICE_LOCAL_IDLE_MS) || 10 * 60_000)
    // daily backup: ตอนเปิด และทุกชั่วโมงระหว่างทำงาน (ทำครั้งแรกของวันที่ข้อมูลเปลี่ยน)
    const daily = () => idle.protect(() => dailyBackupIfDue(paths, ctx.db)).catch((err) => ctx.log?.error({ err: (err as Error).message }, 'alice.local.daily_backup_failed'))
    const dailyTimer = setInterval(() => void daily(), Number(env.ALICE_LOCAL_BACKUP_CHECK_MS) || 3_600_000)
    dailyTimer.unref()
    const generation = randomBytes(12).toString('hex')
    const local: LocalRuntime = { workspace: ws, generation, idle, root }
    // ตรวจก่อน registerAuth: เส้นทางที่ Local ไม่มีต้องได้ 404 ไม่ใช่ 401
    const surface: RouteRegistrar = (app) => {
      app.addHook('onRequest', async (req) => {
        // ป้องกัน DNS rebinding และเว็บไซต์อื่น: Host ต้องเป็น loopback และห้ามมี Origin (ไม่มี CORS เลย)
        const host = (req.headers.host ?? '').replace(/:\d+$/, '')
        if (host !== '127.0.0.1' && host !== 'localhost') throw new AliceError('FORBIDDEN', 'Local Alice accepts loopback requests only')
        if (req.headers.origin) throw new AliceError('FORBIDDEN', 'Browser requests are not accepted by Local Alice')
        if (!isLocalPathAllowed(req.url)) throw new AliceError('NOT_FOUND', 'Route not found')
      })
    }
    const guard: RouteRegistrar = (app) => {
      app.addHook('onRequest', async (req, reply) => {
        if (req.url.split('?')[0] === '/local/health') return
        // /local/v1 อยู่นอกเส้นทางที่ registerAuth ตรวจ จึง resolve capability ที่นี่
        const token = bearerToken(req)
        if (!req.auth && token) {
          const actor = resolveCapability(ctx, token)
          if (actor) req.auth = { actor, via: 'client' }
        }
        if (!req.auth) throw new AliceError('UNAUTHENTICATED', 'A Local capability is required')
        if (local.stopping) throw new AliceError('INVALID_STATE', 'Local Alice is shutting down; retry in a moment')
        reply.raw.once('close', idle.begin(req.url.split('?')[0] === `${CLIENT_API_PREFIX}/events`))
      })
    }
    const localHumanRoutes: RouteRegistrar = async (app, c) => {
      await app.register(async (child) => registerPadRoutes(child, c), { prefix: CLIENT_API_PREFIX })
      await app.register(async (child) => registerKnowledgeRoutes(child, c), { prefix: CLIENT_API_PREFIX })
      await app.register(
        async (child) => {
          for (const register of HUMAN_ROUTES) await register(child, c)
        },
        { prefix: CLIENT_API_PREFIX },
      )
    }
    const capabilityAuth: RouteRegistrar = () => {
      setClientBearerResolver((c, token) => {
        const actor = resolveCapability(c, token)
        return actor ? { actor, via: 'client', revalidate: () => resolveCapability(c, token) !== null } : null
      })
    }
    // ลำดับ: surface → registerAuth (ตั้ง req.auth) → guard (บังคับ capability)
    const app = await buildApp(ctx, [surface, registerAuth, capabilityAuth, guard, registerClientApi, localHumanRoutes, (a, c) => registerLocalRoutes(a, c, local)])
    await app.listen({ host: '127.0.0.1', port: 0 })
    const address = app.server.address()
    if (!address || typeof address === 'string' || address.address !== '127.0.0.1') throw new LocalDaemonError('the daemon must listen on loopback only')
    const locator: Locator = {
      locatorVersion: LOCATOR_VERSION,
      workspaceId: ws.id,
      pid: process.pid,
      port: address.port,
      generation,
      version: APP_VERSION,
      startedAt: new Date().toISOString(),
    }
    writeFileAtomic(paths.locator, JSON.stringify(locator) + '\n')
    void daily()
    app.log.info({ workspaceId: ws.id, port: address.port }, 'alice.local.listening')

    let closing: Promise<void> | null = null
    const shutdown = (reason: string) =>
      (closing ??= (async () => {
        app.log.info({ reason }, 'alice.local.shutdown')
        local.stopping = true
        idle.stop()
        clearInterval(dailyTimer)
        try {
          // รับงานใหม่ไม่ได้แล้ว: รอ request ที่รับไว้ให้จบก่อนปิด (event stream ปิดได้ทันที)
          await idle.drained()
          await app.close()
        } finally {
          try {
            const current = JSON.parse(fs.readFileSync(paths.locator, 'utf8')) as Locator
            if (current.generation === generation) fs.rmSync(paths.locator, { force: true })
          } catch {
            /* locator already gone */
          }
          db?.close()
          releaseLock()
        }
      })())
    idle.onIdle(() => void shutdown('idle'))
    local.requestShutdown = (reason) => void shutdown(reason)
    return { ctx, app, locator, shutdown }
  } catch (err) {
    db?.close()
    releaseLock()
    throw err
  }
}

/** `alice-server local-daemon --workspace <id>`: runs until idle or signalled. */
export async function runLocalDaemon(workspaceId: string): Promise<number> {
  let daemon: RunningDaemon
  try {
    daemon = await startLocalDaemon(workspaceId)
  } catch (err) {
    if (err instanceof LocalDaemonError && err.message.startsWith('already running')) {
      process.stderr.write(`alice-server: workspace ${workspaceId} is ${err.message}\n`)
      return EXIT_ALREADY_RUNNING
    }
    throw err
  }
  const stop = (signal: string) =>
    void daemon.shutdown(signal).finally(() => process.exit(0))
  process.on('SIGTERM', () => stop('SIGTERM'))
  process.on('SIGINT', () => stop('SIGINT'))
  daemon.app.server.on('close', () => setTimeout(() => process.exit(0), 50).unref())
  return -1
}

