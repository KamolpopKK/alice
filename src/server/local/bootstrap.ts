// Bootstrap ของ Local workspace: Local Owner ไม่มี password และไม่มีหน้า login
// agent ของเครื่อง (Codex, Claude) เป็น actor แยก เริ่มแบบ deactivated จนกว่าจะเปิด integration
import { generateSecret, sha256 } from '../auth/crypto'
import type { AppContext } from '../context'
import { mutate } from '../domain/activity'
import { findActorRow, toActor, type Actor } from '../domain/actors'
import { getInstallationValue, setInstallationValue } from '../domain/workspace'
import { newId, nowIso } from '../ids'
import { CAPABILITY_PREFIX } from '../../local/capabilities'
import { LOCAL_AGENT_LABEL, type Integration, type LocalAgentClient } from '../../local/registry'

export const LOCAL_OWNER_NAME = 'Local Owner'

export function isLocalDatabase(ctx: AppContext): boolean {
  return getInstallationValue(ctx.db, 'mode') === 'local'
}

export function localOwnerId(ctx: AppContext): string | null {
  const row = ctx.db.prepare('SELECT id FROM actors WHERE workspace_id = ? AND is_owner = 1').get(ctx.workspaceId) as { id: string } | undefined
  return row?.id ?? null
}

/** Creates the Local Owner once. Idempotent; never creates a password or a login. */
export function bootstrapLocalWorkspace(ctx: AppContext, ownerDisplayName = LOCAL_OWNER_NAME): string {
  const existing = localOwnerId(ctx)
  if (existing) {
    if (!isLocalDatabase(ctx)) throw new Error('This database belongs to a Remote installation and cannot open as a Local workspace')
    return existing
  }
  return mutate(ctx, null, (m) => {
    const id = newId('usr')
    m.db
      .prepare(`INSERT INTO actors (id, workspace_id, kind, display_name, is_owner, created_at, updated_at) VALUES (?, ?, 'human', ?, 1, ?, ?)`)
      .run(id, m.workspaceId, ownerDisplayName, m.now, m.now)
    setInstallationValue(m.db, 'mode', 'local')
    m.record({ verb: 'workspace.bootstrapped', resource: { type: 'actor', id }, data: { displayName: ownerDisplayName, local: true } })
    return id
  }).value
}

interface IntegrationRow {
  client: LocalAgentClient
  integration_id: string
  actor_id: string
  enabled_at: string | null
  disabled_at: string | null
}

export function localIntegration(ctx: AppContext, client: LocalAgentClient): IntegrationRow | undefined {
  return ctx.db.prepare('SELECT * FROM local_integrations WHERE client = ?').get(client) as IntegrationRow | undefined
}

/**
 * Materialises each machine-level integration as a distinct agent actor in this workspace. New actors
 * start deactivated: they appear in history only after the integration is enabled.
 */
export function ensureLocalAgentActors(ctx: AppContext, integrations: Integration[]): void {
  for (const integration of integrations) {
    const row = localIntegration(ctx, integration.client)
    if (row) {
      if (row.integration_id !== integration.id) throw new Error(`The ${integration.client} integration in this workspace belongs to another machine identity`)
      continue
    }
    const owner = localOwnerId(ctx)
    const ownerActor = owner ? toActor(findActorRow(ctx.db, owner)!) : null
    mutate(ctx, ownerActor, (m) => {
      const id = newId('agt')
      m.db
        .prepare(`INSERT INTO actors (id, workspace_id, kind, display_name, is_owner, created_at, updated_at, deactivated_at) VALUES (?, ?, 'agent', ?, 0, ?, ?, ?)`)
        .run(id, m.workspaceId, LOCAL_AGENT_LABEL[integration.client], m.now, m.now, m.now)
      m.db.prepare('INSERT INTO local_integrations (client, integration_id, actor_id) VALUES (?, ?, ?)').run(integration.client, integration.id, id)
      m.record({ verb: 'agent.created', resource: { type: 'actor', id }, data: { displayName: LOCAL_AGENT_LABEL[integration.client], integration: integration.client } })
    })
  }
}

/** Issues a new capability for an actor and revokes its previous ones. Only the hash is stored. */
export function issueCapability(ctx: AppContext, actorId: string, purpose: 'owner' | 'agent'): string {
  const secret = generateSecret(CAPABILITY_PREFIX, 40)
  ctx.db
    .transaction(() => {
      const now = nowIso()
      ctx.db.prepare('UPDATE local_capabilities SET revoked_at = ? WHERE actor_id = ? AND revoked_at IS NULL').run(now, actorId)
      ctx.db
        .prepare('INSERT INTO local_capabilities (id, actor_id, purpose, secret_hash, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(newId('cap'), actorId, purpose, sha256(secret), now)
    })
    .immediate()
  return secret
}

export function revokeCapabilities(ctx: AppContext, actorId: string): void {
  ctx.db.prepare('UPDATE local_capabilities SET revoked_at = ? WHERE actor_id = ? AND revoked_at IS NULL').run(nowIso(), actorId)
}

/** True when `secret` is the actor's current, unrevoked capability. */
export function capabilityMatches(ctx: AppContext, actorId: string, secret: string | null): boolean {
  if (!secret?.startsWith(CAPABILITY_PREFIX)) return false
  return !!ctx.db.prepare('SELECT 1 FROM local_capabilities WHERE actor_id = ? AND secret_hash = ? AND revoked_at IS NULL').get(actorId, sha256(secret))
}

/** Resolves a capability to its active actor (owner or enabled agent), or null. */
export function resolveCapability(ctx: AppContext, secret: string): Actor | null {
  if (!secret.startsWith(CAPABILITY_PREFIX)) return null
  const row = ctx.db.prepare('SELECT id, actor_id FROM local_capabilities WHERE secret_hash = ? AND revoked_at IS NULL').get(sha256(secret)) as
    | { id: string; actor_id: string }
    | undefined
  if (!row) return null
  const actor = findActorRow(ctx.db, row.actor_id)
  if (!actor || actor.deactivated_at || actor.workspace_id !== ctx.workspaceId) return null
  ctx.db.prepare('UPDATE local_capabilities SET last_used_at = ? WHERE id = ?').run(nowIso(), row.id)
  return toActor(actor)
}
