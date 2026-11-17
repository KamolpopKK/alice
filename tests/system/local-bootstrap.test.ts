import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { loadConfig } from '../../src/server/config'
import type { AppContext } from '../../src/server/context'
import { migrate, openDatabase } from '../../src/server/db/database'
import { listActors } from '../../src/server/domain/actors'
import { ensureWorkspace } from '../../src/server/domain/workspace'
import { EventBus } from '../../src/server/events'
import {
  bootstrapLocalWorkspace,
  capabilityMatches,
  ensureLocalAgentActors,
  issueCapability,
  resolveCapability,
} from '../../src/server/local/bootstrap'
import { createWorkspace, ensureIntegration } from '../../src/local/registry'
import { workspacePaths } from '../../src/local/paths'

const roots: string[] = []
afterEach(() => {
  for (const dir of roots.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

function openLocal(home: string, ws: { id: string; name: string }): AppContext {
  const paths = workspacePaths(home, ws.id)
  const db = openDatabase(paths.db)
  migrate(db)
  const workspaceId = ensureWorkspace(db, { id: ws.id, name: ws.name })
  return { config: loadConfig({ NODE_ENV: 'test', ALICE_DATA_DIR: paths.dataDir }), db, workspaceId, bus: new EventBus() }
}

describe('Local workspace bootstrap', () => {
  it('creates one passwordless Local Owner, keeps the registry id and is idempotent', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'alice-home-'))
    roots.push(home)
    const ws = createWorkspace(home)
    const ctx = openLocal(home, ws)
    const owner = bootstrapLocalWorkspace(ctx)
    expect(bootstrapLocalWorkspace(ctx)).toBe(owner)
    expect(ctx.workspaceId).toBe(ws.id)
    const humans = listActors(ctx.db, ctx.workspaceId, { kind: 'human' })
    expect(humans).toEqual([expect.objectContaining({ id: owner, displayName: 'Local Owner', isOwner: true, username: null })])
    expect(ctx.db.prepare('SELECT COUNT(*) AS n FROM human_credentials').get()).toEqual({ n: 0 })
    ctx.db.close()
    // ฐานข้อมูลของ workspace หนึ่งเปิดเป็นอีก workspace ไม่ได้
    const reopened = openDatabase(workspacePaths(home, ws.id).db)
    expect(() => ensureWorkspace(reopened, { id: 'wsp_other0000', name: 'x' })).toThrow(/belongs to workspace/)
    reopened.close()
  })

  it('materialises Codex and Claude as distinct, deactivated, non-owner agents tied to the machine identity', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'alice-home-'))
    roots.push(home)
    const ws = createWorkspace(home)
    const ctx = openLocal(home, ws)
    bootstrapLocalWorkspace(ctx)
    const integrations = [ensureIntegration(home, 'codex'), ensureIntegration(home, 'claude-code')]
    ensureLocalAgentActors(ctx, integrations)
    ensureLocalAgentActors(ctx, integrations)
    const agents = listActors(ctx.db, ctx.workspaceId, { kind: 'agent', includeDeactivated: true })
    expect(agents.map((a) => a.displayName).sort()).toEqual(['Claude', 'Codex'])
    expect(agents.every((a) => !a.isOwner && a.deactivatedAt)).toBe(true)
    expect(() => ensureLocalAgentActors(ctx, [{ ...integrations[0], id: 'int_somewhereelse' }])).toThrow(/another machine identity/)
  })

  it('capabilities are stored as hashes, rotate, and never resolve a deactivated actor', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'alice-home-'))
    roots.push(home)
    const ws = createWorkspace(home)
    const ctx = openLocal(home, ws)
    const owner = bootstrapLocalWorkspace(ctx)
    const first = issueCapability(ctx, owner, 'owner')
    expect(first).toMatch(/^alice_lc_/)
    expect(resolveCapability(ctx, first)?.id).toBe(owner)
    const second = issueCapability(ctx, owner, 'owner')
    expect(resolveCapability(ctx, first)).toBeNull()
    expect(capabilityMatches(ctx, owner, second)).toBe(true)
    const stored = JSON.stringify(ctx.db.prepare('SELECT * FROM local_capabilities').all())
    expect(stored).not.toContain(second)

    ensureLocalAgentActors(ctx, [ensureIntegration(home, 'codex')])
    const codex = listActors(ctx.db, ctx.workspaceId, { kind: 'agent', includeDeactivated: true })[0]
    const agentCap = issueCapability(ctx, codex.id, 'agent')
    expect(resolveCapability(ctx, agentCap)).toBeNull()
  })
})
