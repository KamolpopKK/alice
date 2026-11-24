import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { startApp, type RunningApp } from '../helpers/app'
import { bootstrapOwner } from '../helpers/client'
import { alice, buildCli, cliHome, startAlice, type CliEnv } from '../helpers/cli'
import { call } from '../helpers/local'
import { readLocator } from '../../src/local/locator'
import { listWorkspaces } from '../../src/local/registry'
import { workspacePaths } from '../../src/local/paths'
import { registryFile } from '../../src/local/registry'
let app: RunningApp
let home: CliEnv
let local: CliEnv
let standalone: string
let project: string
const run = (args: string[], input?: string) => alice(home, ['--workspace', 'work', ...args], { input, entry: standalone })
const json = async (args: string[], input?: string) => {
  const r = await run([...args, '--json'], input)
  if (r.code) throw new Error(`${args.join(' ')}: ${r.stderr}`)
  return JSON.parse(r.stdout)
}
const guard = (revision: number, mutation = randomUUID()) => ['--revision', String(revision), '--mutation-id', mutation]
beforeAll(async () => {
  app = await startApp({ env: { ALICE_DEVICE_POLL_INTERVAL: '1', ALICE_CLIENT_RATE_LIMIT: '10000' } })
  const owner = await bootstrapOwner(app)
  standalone = path.join((await buildCli()).standalone, 'alice.js')
  home = cliHome('knowledge-remote')
  await alice(home, ['profile', 'add', 'work', '--server', app.url])
  const login = await startAlice(home, ['--workspace', 'work', 'auth', 'login', '--no-browser'])
  const [, code] = await login.waitForStderr(/code ([A-Z]{4}-[A-Z]{4})/)
  await owner.post('/client/v1/device/approve', { userCode: code })
  expect((await login.done).code).toBe(0)
  project = (await json(['project', 'create', '--name', 'Knowledge CLI'])).id
})
afterAll(async () => {
  await app?.stop()
  if (local) for (const ws of listWorkspaces(local.env.ALICE_HOME)) {
    const locator = readLocator(workspacePaths(local.env.ALICE_HOME, ws.id).locator)
    if (locator) try { process.kill(locator.pid, 'SIGTERM') } catch { /* already stopped */ }
  }
})

it('manages topics, files/stdin and revision/replay conflicts with a standalone Remote CLI', async () => {
  const id = randomUUID()
  const args = ['knowledge', 'topic', 'create', '--project', 'Knowledge CLI', '--name', 'Accounts', '--description-file', '-', '--mutation-id', id]
  const t = await json(args, 'Read the overview first.')
  expect(t.topic).toMatchObject({ projectId: project, name: 'Accounts', revision: 1, description: 'Read the overview first.' })
  expect(await json(args, 'Read the overview first.')).toEqual(t)
  expect((await run(args, 'Changed payload')).code).toBe(2)
  const file = path.join(home.configDir, 'topic.txt')
  fs.writeFileSync(file, 'Updated description from file.')
  expect((await json(['knowledge', 'topic', 'update', t.topic.id, '--description-file', file, ...guard(1)])).topic.revision).toBe(2)
  const stale = await run(['knowledge', 'topic', 'update', t.topic.id, '--name', 'Stale', ...guard(1)])
  expect(stale.code).toBe(4)
  expect(stale.stderr).toContain('reload')
  await json(['knowledge', 'topic', 'create', '--project', project, '--name', 'Second', '--mutation-id', randomUUID()])
  const page = await json(['knowledge', 'topic', 'list', '--project', project, '--limit', '1'])
  expect(page.items).toHaveLength(1)
  expect(page.nextCursor).toBeTruthy()
  expect((await json(['knowledge', 'topic', 'list', '--project', project, '--cursor', page.nextCursor])).items).toHaveLength(1)
  const archive = await json(['knowledge', 'topic', 'archive', t.topic.id, ...guard(2), '--yes'])
  expect(archive.topic.archivedAt).toBeTruthy()
  expect((await json(['knowledge', 'topic', 'restore', t.topic.id, ...guard(3)])).topic.archivedAt).toBeNull()
  expect((await json(['knowledge', 'topic', 'show', t.topic.id])).topic.revision).toBe(4)
})

it('curates, paginates and discovers sources, then reads bounded revision-stable evidence', async () => {
  const t = (await json(['knowledge', 'topic', 'create', '--project', project, '--name', 'Reading', '--mutation-id', randomUUID()])).topic
  const first = await json(['document', 'create', '--title', 'Overviewneedle', '--body', '# Overview\n' + 'content '.repeat(400), '--keyword', 'contextneedle'])
  const second = await json(['document', 'create', '--title', 'Designneedle', '--body', '# Design\n\n## Details\nEvidence.'])
  const original = await json(['document', 'show', first.id])
  const put = ['knowledge', 'member', 'add', t.id, first.id, ...guard(1)]
  const added = await json(put)
  expect(await json(put)).toEqual(added)
  await json(['knowledge', 'member', 'put', t.id, second.id, ...guard(2)])
  await json(['knowledge', 'member', 'move', t.id, second.id, '--before', first.id, ...guard(3)])
  const page = await json(['knowledge', 'member', 'list', t.id, '--limit', '1'])
  expect(page).toMatchObject({ topic: { revision: 4 }, items: [{ document: { id: second.id } }] })
  expect((await json(['knowledge', 'member', 'list', t.id, '--cursor', page.nextCursor])).items[0].document.id).toBe(first.id)
  const context = await json(['knowledge', 'context', '--project', project, '--topic', t.id, '--limit', '1'])
  expect(context.candidates.items[0].document.id).toBe(second.id)
  expect((await json(['knowledge', 'context', '--project', project, '--topic', t.id, '--limit', '1', '--cursor', context.candidates.nextCursor])).candidates.items[0].document.id).toBe(first.id)
  expect((await json(['knowledge', 'context', '--project', project, '--q', 'contextneedle'])).candidates.items[0].match.field).toBe('keyword')
  expect((await json(['document', 'search', 'contextneedle', '--knowledge-project', project, '--topic', t.id, '--curated-only']))[0].id).toBe(first.id)
  expect((await json(['search', 'contextneedle', '--knowledge-project', project, '--curated-only']))[0].id).toBe(first.id)
  const outline = await json(['document', 'outline', second.id, '--revision', '1', '--limit', '1'])
  expect(outline.items[0].text).toBe('Design')
  expect(outline.nextCursor).toBeTruthy()
  expect((await json(['document', 'outline', second.id, '--revision', '1', '--cursor', outline.nextCursor])).items[0].text).toBe('Details')
  const content = await json(['document', 'content', first.id, '--revision', '1', '--max-chars', '100'])
  expect(content.document.body).toHaveLength(100)
  expect(content.document.bodyWindow.nextOffset).toBe(100)
  expect((await run(['document', 'content', second.id, '--body-only'])).stdout).toBe(second.body)
  expect((await json(['document', 'preview', first.id])).body).toHaveLength(2000)
  const source = await json(['document', 'create', '--title', 'Backlink source', '--body', `[source](/documents/${first.id})`])
  expect((await json(['document', 'backlinks', first.id])).items[0]).toMatchObject({ document: { id: source.id }, provenance: ['inline'] })
  expect((await json(['document', 'topics', first.id])).items[0].topic.id).toBe(t.id)
  await json(['document', 'update', second.id, '--body', '# Changed'])
  expect((await run(['document', 'content', second.id, '--revision', '1'])).code).toBe(4)
  expect((await run(['document', 'outline', second.id, '--cursor', outline.nextCursor])).code).toBe(4)
  await json(['knowledge', 'member', 'remove', t.id, first.id, ...guard(4)])
  expect(await json(['document', 'show', first.id])).toEqual(original)
})

it('rejects malformed/foreign arguments and preserves legacy commands and offline help', async () => {
  for (const args of [
    ['knowledge', 'topic', 'create', '--project', project, '--name', 'Missing mutation'],
    ['knowledge', 'context', '--project', project, '--limit', '21'],
    ['document', 'content', 'doc_unknown', '--max-chars', '99'],
    ['knowledge', 'topic', 'update', 'knt_unknown', '--name', 'Invalid', ...guard(0)],
  ]) expect((await run(args)).code).toBe(2)
  expect((await run(['knowledge', 'topic', 'show', 'knt_foreign'])).code).toBe(4)
  expect((await run(['knowledge', 'context', '--project', 'prj_foreign'])).code).toBe(4)
  const help = await alice(cliHome(), ['knowledge', 'help'], { entry: standalone })
  expect(help.code).toBe(0)
  expect(help.stdout).toContain('--mutation-id')
  expect((await run(['document', 'list'])).code).toBe(0)
  expect((await run(['--as', 'codex', 'knowledge', 'topic', 'list', '--project', project])).code).toBe(2)
})

it('uses the chosen Local agent/workspace without switching active workspace or credentials', async () => {
  local = cliHome('knowledge-local')
  const created = await alice(local, ['workspace', 'create', '--json'])
  const ws = JSON.parse(created.stdout).data
  // The test explicitly opts in this isolated workspace only.
  await alice(local, ['--workspace', ws.alias, 'project', 'list'])
  const locator = readLocator(workspacePaths(local.env.ALICE_HOME, ws.id).locator)!
  // Use the established helper's account format rather than accessing any machine credential store.
  const { capabilityAccount } = await import('../../src/local/capabilities')
  const token = JSON.parse(fs.readFileSync(local.credentialFile, 'utf8'))[capabilityAccount(ws.id, 'owner')]
  expect((await call(`http://127.0.0.1:${locator.port}`, '/local/v1/integrations/codex', { token, body: { enabled: true } })).status).toBe(200)
  const selectionState = () => JSON.parse(fs.readFileSync(registryFile(local.env.ALICE_HOME), 'utf8'), (key, value) => key === 'lastUsedAt' ? null : value)
  const registry = selectionState()
  const credentials = fs.readFileSync(local.credentialFile, 'utf8')
  const readSelection = () => fs.existsSync(path.join(local.configDir, 'config.json')) ? fs.readFileSync(path.join(local.configDir, 'config.json'), 'utf8') : null
  const config = readSelection()
  const localJson = async (args: string[]) => {
    const r = await alice(local, ['--as', 'codex', '--workspace', ws.alias, ...args, '--json'])
    expect(r.code, r.stderr).toBe(0)
    const result = JSON.parse(r.stdout)
    expect(result.workspace.id).toBe(ws.id)
    return result.data
  }
  const p = await localJson(['project', 'create', '--name', 'Local knowledge'])
  const t = await localJson(['knowledge', 'topic', 'create', '--project', p.id, '--name', 'Local reading', '--mutation-id', randomUUID()])
  expect(t.topic.createdBy).toMatchObject({ displayName: 'Codex', kind: 'agent' })
  expect((await localJson(['knowledge', 'context', '--project', p.id])).candidates.items).toEqual([])
  const d = await localJson(['document', 'create', '--title', 'Local source', '--body', '# Local heading'])
  await localJson(['knowledge', 'member', 'put', t.topic.id, d.id, ...guard(1)])
  expect((await localJson(['knowledge', 'context', '--project', p.id])).candidates.items[0].document.id).toBe(d.id)
  expect((await localJson(['document', 'outline', d.id])).items[0].text).toBe('Local heading')
  expect((await localJson(['document', 'content', d.id, '--revision', '1'])).document.body).toBe('# Local heading')
  expect((await localJson(['document', 'preview', d.id])).state).toBe('available')
  expect((await localJson(['document', 'backlinks', d.id])).items).toEqual([])
  expect((await localJson(['document', 'topics', d.id])).items[0].topic.id).toBe(t.topic.id)
  expect(selectionState()).toEqual(registry)
  expect(readSelection()).toBe(config)
  expect(fs.readFileSync(local.credentialFile, 'utf8')).toBe(credentials)
})
