// Seeds the declared operating envelope directly through the domain layer (setup only; all
// measurements go through the public HTTP/MCP interfaces).
import fs from 'node:fs'
import { loadConfig } from '../../src/server/config'
import type { AppContext } from '../../src/server/context'
import { migrate, openDatabase } from '../../src/server/db/database'
import type { Actor } from '../../src/server/domain/actors'
import { toActor, findActorRow } from '../../src/server/domain/actors'
import { insertComment } from '../../src/server/domain/comments'
import { createDocument, linkDocument } from '../../src/server/domain/documents'
import { acceptInvite, bootstrapOwner, createAgent, createInvite } from '../../src/server/domain/identity'
import { createProject } from '../../src/server/domain/projects'
import '../../src/server/domain/relationships'
import { addBlocker } from '../../src/server/domain/relationships'
import { createTask } from '../../src/server/domain/tasks'
import { mutate } from '../../src/server/domain/activity'
import { ensureWorkspace } from '../../src/server/domain/workspace'
import { EventBus } from '../../src/server/events'
import { TASK_PRIORITIES, TASK_STATUSES } from '../../src/shared/contracts'

export const ENVELOPE = { humans: 25, agents: 100, projects: 40, tasks: 100_000, comments: 20_000, documents: 2_000, blockers: 5_000 }
export const SCALE_OWNER = { username: 'owner', displayName: 'Scale Owner', password: 'scale-owner-password' }

const WORDS = 'alpha beta gamma delta api billing search index cache deploy review design mobile payment invoice report export import sync queue worker ประชุม ลูกค้า รายงาน ระบบ'.split(' ')
const pick = <T>(list: readonly T[], i: number) => list[i % list.length]

export async function seedScale(dataDir: string, envelope = ENVELOPE, log = (m: string) => process.stderr.write(m + '\n')): Promise<{ agentToken: string }> {
  fs.mkdirSync(dataDir, { recursive: true })
  const config = loadConfig({ ALICE_DATA_DIR: dataDir, ALICE_BOOTSTRAP_TOKEN: 'scale-bootstrap-token-0123456789', NODE_ENV: 'test' })
  const db = openDatabase(config.dbPath)
  migrate(db)
  const ctx: AppContext = { config, db, workspaceId: ensureWorkspace(db), bus: new EventBus() }
  const ownerPublic = await bootstrapOwner(ctx, { bootstrapToken: 'scale-bootstrap-token-0123456789', ...SCALE_OWNER })
  const owner: Actor = toActor(findActorRow(db, ownerPublic.id)!)
  const humans: Actor[] = [owner]
  for (let i = 1; i < envelope.humans; i++) {
    const { url } = createInvite(ctx, owner, { note: '', expiresInHours: 1 })
    const res = await acceptInvite(ctx, { token: url.split('/').pop()!, username: `human${i}`, displayName: `Human ${i}`, password: 'human-password-1' })
    humans.push(toActor(findActorRow(db, res.actor.id)!))
  }
  const agents: Actor[] = []
  let agentToken = ''
  for (let i = 0; i < envelope.agents; i++) {
    const res = createAgent(ctx, owner, { displayName: `Agent ${i}`, tokenName: 'default' })
    agents.push(toActor(findActorRow(db, res.agent.id)!))
    if (i === 0) agentToken = res.plaintextToken
  }
  const actors = [...humans, ...agents]
  const projects = Array.from({ length: envelope.projects }, (_, i) => createProject(ctx, owner, { name: `Project ${i}`, description: `Scale project ${i}`, labels: [pick(WORDS, i)] }).project.id)
  log(`seeded ${actors.length} actors and ${projects.length} projects`)

  const taskIds: string[] = []
  const BATCH = 1000
  const started = Date.now()
  for (let b = 0; b < envelope.tasks; b += BATCH) {
    db.transaction(() => {
      for (let i = b; i < Math.min(b + BATCH, envelope.tasks); i++) {
        const actor = pick(actors, i * 7)
        const res = createTask(ctx, actor.kind === 'agent' && TASK_STATUSES[i % 6] === 'done' ? owner : actor, {
          title: `${pick(WORDS, i)} ${pick(WORDS, i * 3 + 1)} task ${i}`,
          description: `Work item ${i}: ${pick(WORDS, i * 5)} ${pick(WORDS, i * 11)} ${'details '.repeat(i % 20)}`,
          projectId: i % 10 === 0 ? null : pick(projects, i),
          status: TASK_STATUSES[i % 6],
          priority: TASK_PRIORITIES[i % 5],
          dueAt: i % 4 === 0 ? new Date(Date.UTC(2026, i % 12, (i % 28) + 1)).toISOString() : null,
          assigneeId: i % 3 === 0 ? null : pick(actors, i).id,
          labels: [pick(WORDS, i), pick(WORDS, i + 7)],
        })
        taskIds.push(res.task.id)
      }
    })()
    if ((b / BATCH) % 20 === 0) log(`  tasks ${b + BATCH}/${envelope.tasks} (${Math.round((Date.now() - started) / 1000)}s)`)
  }
  db.transaction(() => {
    for (let i = 0; i < envelope.comments; i++) {
      const actor = pick(actors, i)
      mutate(ctx, actor, (m) => insertComment(m, actor, pick(taskIds, i * 13), `Comment ${i} about ${pick(WORDS, i)}`, 'comment'))
    }
    for (let i = 0; i < envelope.documents; i++) {
      const doc = createDocument(ctx, owner, { title: `Spec ${i} ${pick(WORDS, i)}`, body: `# Spec ${i}\n\n${'Lorem ipsum dolor sit amet. '.repeat(40)}`, sourceUrl: null })
      linkDocument(ctx, owner, doc.document.id, { taskId: pick(taskIds, i * 17) })
      linkDocument(ctx, owner, doc.document.id, { projectId: pick(projects, i) })
    }
    for (let i = 0; i < envelope.blockers; i++) {
      try {
        addBlocker(ctx, owner, pick(taskIds, i * 2 + 1), pick(taskIds, i * 2))
      } catch {
        /* skip duplicates */
      }
    }
  })()
  log(`seed finished in ${Math.round((Date.now() - started) / 1000)}s`)
  db.close()
  return { agentToken }
}
