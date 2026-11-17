import path from 'node:path'
import Database from 'better-sqlite3'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startApp, type RunningApp } from '../helpers/app'
import { HttpClient, agentClient, bootstrapOwner, createAgent, inviteHuman } from '../helpers/client'
import { activityFor } from '../helpers/db'

let app: RunningApp
let owner: HttpClient
let bob: HttpClient

beforeAll(async () => {
  app = await startApp()
  owner = await bootstrapOwner(app)
  bob = await inviteHuman(owner, 'bob', 'Bob')
})
afterAll(async () => app?.stop())

describe('projects', () => {
  it('has exactly one protected Untitled project from the start', async () => {
    const res = await owner.get('/api/projects')
    const system = res.body.items.filter((p: any) => p.isSystem)
    expect(system).toHaveLength(1)
    expect(system[0]).toMatchObject({ name: 'Untitled', systemKey: 'untitled', archivedAt: null })
    expect(res.body.items[0].isSystem).toBe(true)
  })

  it('creates and edits projects visibly to other actors with attributed activity', async () => {
    const created = await owner.post('/api/projects', { name: 'Website', description: '# Goals\nShip it', labels: ['web', 'Web', ' q4 '] })
    expect(created.status).toBe(201)
    expect(created.body.project).toMatchObject({ name: 'Website', labels: ['web', 'q4'], isSystem: false })
    expect(created.body.activityId).toMatch(/^act_/)
    const id = created.body.project.id

    const seenByBob = await bob.get(`/api/projects/${id}`)
    expect(seenByBob.body.project.description).toBe('# Goals\nShip it')

    const edited = await bob.patch(`/api/projects/${id}`, { description: 'Updated by Bob', labels: ['web'] })
    expect(edited.status).toBe(200)
    expect(edited.body.project.updatedBy.displayName).toBe('Bob')

    const agent = await createAgent(owner, 'Planner')
    const viaAgent = await agentClient(app, agent).get(`/api/projects/${id}`)
    expect(viaAgent.body.project.description).toBe('Updated by Bob')

    const events = activityFor(app, id)
    expect(events.map((e) => e.verb)).toEqual(['project.created', 'project.updated'])
    expect(events[1].data.changes.description).toEqual({ from: '# Goals\nShip it', to: 'Updated by Bob' })
    expect(events[1].actor_id).toBe(edited.body.project.updatedBy.id)
  })

  it('archives and restores a normal project without deleting data', async () => {
    const { body } = await owner.post('/api/projects', { name: 'Old initiative', description: 'keep me' })
    const id = body.project.id
    const archived = await owner.post(`/api/projects/${id}/archive`)
    expect(archived.body.project.archivedAt).toBeTruthy()
    expect((await owner.get('/api/projects')).body.items.some((p: any) => p.id === id)).toBe(false)
    expect((await owner.get('/api/projects?archived=archived')).body.items.some((p: any) => p.id === id)).toBe(true)

    const restored = await bob.post(`/api/projects/${id}/restore`)
    expect(restored.body.project).toMatchObject({ archivedAt: null, description: 'keep me', id })
    expect((await owner.get('/api/projects')).body.items.some((p: any) => p.id === id)).toBe(true)
  })

  it('rejects rename, archive and purge of the system project through every interface', async () => {
    const untitled = (await owner.get('/api/projects')).body.items.find((p: any) => p.isSystem)
    const rename = await owner.patch(`/api/projects/${untitled.id}`, { name: 'Inbox' })
    expect(rename.status).toBe(409)
    expect(rename.body.error.code).toBe('PROTECTED_RESOURCE')
    const archive = await bob.post(`/api/projects/${untitled.id}/archive`)
    expect(archive.body.error.code).toBe('PROTECTED_RESOURCE')

    // description ยังแก้ได้
    expect((await owner.patch(`/api/projects/${untitled.id}`, { description: 'Inbox for unsorted work' })).status).toBe(200)

    // ฐานข้อมูลเองก็ปฏิเสธ (กันเครื่องมือ maintenance หรือ SQL ตรง)
    const db = new Database(path.join(app.dataDir, 'alice.db'))
    expect(() => db.prepare('DELETE FROM projects WHERE id = ?').run(untitled.id)).toThrow(/cannot be deleted/)
    expect(() => db.prepare('UPDATE projects SET name = ? WHERE id = ?').run('Renamed', untitled.id)).toThrow(/cannot be renamed/)
    db.close()
  })

  it('uses immutable ids, not names, for identity and protection', async () => {
    const lookalike = await owner.post('/api/projects', { name: 'Untitled' })
    expect(lookalike.status).toBe(201)
    expect(lookalike.body.project.isSystem).toBe(false)
    const twin = await owner.post('/api/projects', { name: 'Untitled' })
    expect(twin.body.project.id).not.toBe(lookalike.body.project.id)

    expect((await owner.patch(`/api/projects/${lookalike.body.project.id}`, { name: 'Renamed lookalike' })).status).toBe(200)
    expect((await owner.post(`/api/projects/${twin.body.project.id}/archive`)).status).toBe(200)
    const systems = (await owner.get('/api/projects?archived=all')).body.items.filter((p: any) => p.isSystem)
    expect(systems).toHaveLength(1)
    expect(systems[0].name).toBe('Untitled')
  })

  it('validates input and returns stable errors', async () => {
    const bad = await owner.post('/api/projects', { name: '' })
    expect(bad.status).toBe(400)
    expect(bad.body.error.code).toBe('VALIDATION_ERROR')
    expect((await owner.get('/api/projects/prj_missing')).body.error.code).toBe('NOT_FOUND')
    expect((await new HttpClient(app.url).get('/api/projects')).status).toBe(401)
    const unknown = await owner.patch(`/api/projects/prj_x`, { bogus: 1 })
    expect(unknown.body.error.code).toBe('VALIDATION_ERROR')
  })
})
