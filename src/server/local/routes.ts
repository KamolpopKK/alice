// เส้นทางเฉพาะ Local daemon: health แบบไม่ต้องยืนยันตัวตน (เปิดเผยแค่สถานะ instance)
// และ /local/v1 สำหรับ Desktop/CLI ที่ถือ capability ของเจ้าของ
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { AliceError } from '../../shared/errors'
import { APP_VERSION } from '../../shared/version'
import type { AppContext } from '../context'
import { requireAuth } from '../http/auth'
import type { LocalWorkspace } from '../../local/registry'
import type { LocalHealth } from '../../local/locator'
import type { IdleTracker } from './idle'
import { capabilityAccount, localCredentialStore } from '../../local/capabilities'
import { LOCAL_AGENT_CLIENTS, ensureIntegration, type LocalAgentClient } from '../../local/registry'
import { mutate } from '../domain/activity'
import { getPublicActor } from '../domain/actors'
import { updateTask } from '../domain/tasks'
import { ensureLocalAgentActors, issueCapability, localIntegration, revokeCapabilities } from './bootstrap'
import { applyRetention, backupWorkspace, diskUse, listBackups } from './backups'
import { workspacePaths } from '../../local/paths'

export interface LocalRuntime {
  workspace: LocalWorkspace
  generation: string
  idle: IdleTracker
  root: string
  stopping?: boolean
  requestShutdown?: (reason: string) => void
}

export function requireLocalOwner(req: Parameters<typeof requireAuth>[0]) {
  const actor = requireAuth(req)
  if (!actor.isOwner) throw new AliceError('FORBIDDEN', 'Only the Local Owner can do this')
  return actor
}

export function registerLocalRoutes(app: FastifyInstance, ctx: AppContext, local: LocalRuntime): void {
  app.get('/local/health', async (): Promise<LocalHealth> => ({
    status: local.stopping ? 'stopping' : 'ok',
    workspaceId: local.workspace.id,
    generation: local.generation,
    version: APP_VERSION,
  }))

  // ใครกำลังเชื่อมต่อ (ไม่มี credential) — ใช้ยืนยัน actor ฝั่ง server
  app.get('/local/v1/whoami', async (req) => {
    const actor = requireAuth(req)
    return { actor: { id: actor.id, kind: actor.kind, displayName: actor.displayName, isOwner: actor.isOwner }, workspace: { id: ctx.workspaceId, name: local.workspace.name, kind: 'local' } }
  })

  // Desktop ต่ออายุทุกนาทีเพื่อกัน idle shutdown ของ workspace ที่เปิดอยู่
  app.post('/local/v1/presence', async (req) => {
    requireLocalOwner(req)
    const { seconds } = z.object({ seconds: z.number().int().min(1).max(600).default(120) }).parse(req.body ?? {})
    local.idle.presence(seconds * 1000)
    return { ok: true, ...local.idle.status() }
  })

  // ใช้ตอนอัปเดต runtime หรือลบ workspace: ตอบก่อน แล้วค่อยปิดแบบ graceful
  app.post('/local/v1/shutdown', async (req, reply) => {
    requireLocalOwner(req)
    reply.raw.once('finish', () => local.requestShutdown?.('requested'))
    return { stopping: true }
  })

  // ชื่อที่แสดงของ Local Owner (onboarding และ Settings) — ไม่มี username หรือ password
  app.patch('/local/v1/owner', async (req) => {
    const owner = requireLocalOwner(req)
    const { displayName } = z.object({ displayName: z.string().trim().min(1).max(80) }).strict().parse(req.body ?? {})
    mutate(ctx, owner, (m) => {
      m.db.prepare('UPDATE actors SET display_name = ?, updated_at = ? WHERE id = ?').run(displayName, m.now, owner.id)
      m.record({ verb: 'actor.renamed', resource: { type: 'actor', id: owner.id }, data: { displayName } })
    })
    return { actor: getPublicActor(ctx.db, owner.id) }
  })

  // เปิด/ปิด integration ของ agent (Codex, Claude): เจ้าของเท่านั้น; capability เขียนลง OS credential store ที่นี่
  app.get('/local/v1/integrations', async (req) => {
    requireLocalOwner(req)
    return { integrations: LOCAL_AGENT_CLIENTS.map((client) => integrationView(ctx, client)) }
  })

  app.post('/local/v1/integrations/:client', async (req) => {
    const owner = requireLocalOwner(req)
    const client = z.enum(LOCAL_AGENT_CLIENTS).parse((req.params as { client: string }).client)
    const { enabled } = z.object({ enabled: z.boolean() }).strict().parse(req.body ?? {})
    return local.idle.protect(() => (enabled ? enableIntegration(ctx, local, owner, client) : disableIntegration(ctx, local, owner, client)))
  })

  // backup: รายการ ความใหม่ และพื้นที่ที่ใช้ (Settings) และสั่ง backup ทันที
  app.get('/local/v1/backups', async (req) => {
    requireLocalOwner(req)
    const paths = workspacePaths(local.root, ctx.workspaceId)
    const backups = listBackups(paths).map(({ dir: _dir, ...b }) => b)
    return { backups, lastSuccess: backups[0]?.createdAt ?? null, diskUse: diskUse(paths.backups) }
  })

  app.post('/local/v1/backups', async (req, reply) => {
    requireLocalOwner(req)
    const paths = workspacePaths(local.root, ctx.workspaceId)
    const entry = await local.idle.protect(() => backupWorkspace(paths, 'manual', ctx.db))
    applyRetention(paths)
    const { dir: _dir, ...backup } = entry
    return reply.status(201).send({ backup })
  })

  // ย้ายงานที่ยังค้างกับ agent ที่ปิดแล้วออก (แยกเป็นคำสั่งที่ยืนยันเอง ไม่ทำอัตโนมัติตอนปิด)
  app.post('/local/v1/integrations/:client/unassign', async (req) => {
    const owner = requireLocalOwner(req)
    const client = z.enum(LOCAL_AGENT_CLIENTS).parse((req.params as { client: string }).client)
    const row = localIntegration(ctx, client)
    if (!row) return { unassigned: [] }
    const ids = (ctx.db.prepare(`SELECT id, status FROM tasks WHERE assignee_id = ? AND archived_at IS NULL AND status NOT IN ('done', 'canceled')`).all(row.actor_id) as Array<{ id: string; status: string }>)
    const unassigned = await local.idle.protect(() =>
      ids.map((t) => {
        updateTask(ctx, owner, t.id, t.status === 'in_progress' ? { assigneeId: null, status: 'ready' } : { assigneeId: null })
        return t.id
      }),
    )
    return { unassigned, integration: integrationView(ctx, client) }
  })

  app.get('/local/v1/status', async (req) => {
    requireLocalOwner(req)
    return { workspaceId: ctx.workspaceId, generation: local.generation, version: APP_VERSION, pid: process.pid, ...local.idle.status() }
  })
}

export function integrationView(ctx: AppContext, client: LocalAgentClient) {
  const row = localIntegration(ctx, client)
  if (!row) return { client, enabled: false, actor: null, assignedTasks: 0 }
  const assigned = ctx.db.prepare(`SELECT count(*) AS n FROM tasks WHERE assignee_id = ? AND archived_at IS NULL AND status <> 'done'`).get(row.actor_id) as { n: number }
  return { client, enabled: !!row.enabled_at && !row.disabled_at, actor: getPublicActor(ctx.db, row.actor_id), assignedTasks: assigned.n }
}

export function enableIntegration(ctx: AppContext, local: LocalRuntime, owner: ReturnType<typeof requireAuth>, client: LocalAgentClient) {
  ensureLocalAgentActors(ctx, [ensureIntegration(local.root, client)])
  const row = localIntegration(ctx, client)!
  mutate(ctx, owner, (m) => {
    m.db.prepare('UPDATE actors SET deactivated_at = NULL, updated_at = ? WHERE id = ?').run(m.now, row.actor_id)
    m.db.prepare('UPDATE local_integrations SET enabled_at = ?, disabled_at = NULL WHERE client = ?').run(m.now, client)
    m.record({ verb: 'agent.enabled', resource: { type: 'actor', id: row.actor_id }, data: { integration: client } })
  })
  // credential store ล้มเหลว = เปิดไม่สำเร็จ (ไม่มี fallback เป็นไฟล์)
  localCredentialStore(local.root).set(capabilityAccount(ctx.workspaceId, client), issueCapability(ctx, row.actor_id, 'agent'))
  return integrationView(ctx, client)
}

export function disableIntegration(ctx: AppContext, local: LocalRuntime, owner: ReturnType<typeof requireAuth>, client: LocalAgentClient) {
  const row = localIntegration(ctx, client)
  if (!row) return integrationView(ctx, client)
  revokeCapabilities(ctx, row.actor_id)
  mutate(ctx, owner, (m) => {
    // ประวัติ (activity, comment, assignment) คงไว้ทั้งหมด: แค่ปิด actor และ capability
    m.db.prepare('UPDATE actors SET deactivated_at = ?, updated_at = ? WHERE id = ? AND deactivated_at IS NULL').run(m.now, m.now, row.actor_id)
    m.db.prepare('UPDATE local_integrations SET disabled_at = ? WHERE client = ?').run(m.now, client)
    m.record({ verb: 'agent.disabled', resource: { type: 'actor', id: row.actor_id }, data: { integration: client } })
  })
  localCredentialStore(local.root).delete(capabilityAccount(ctx.workspaceId, client))
  return integrationView(ctx, client)
}
