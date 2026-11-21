import path from 'node:path'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startApp, type RunningApp } from '../helpers/app'
import { HttpClient, bootstrapOwner, createAgent, type AgentHandle } from '../helpers/client'
import { connectMcp, connectWithTransport, type McpHandle } from '../helpers/mcp'
import { ALL_TOOLS } from '../helpers/tools'

const ROOT = path.resolve(import.meta.dirname, '../..')


let app: RunningApp
let owner: HttpClient
let agent: AgentHandle

function stdioTransport(env: Record<string, string>) {
  return new StdioClientTransport({
    command: process.execPath,
    args: ['--import', 'tsx', path.join(ROOT, 'src/stdio/adapter.ts')],
    cwd: ROOT,
    env: { PATH: process.env.PATH ?? '', ...env },
    stderr: 'pipe',
  })
}

const transports: Record<string, () => Promise<McpHandle>> = {
  remote: () => connectMcp(app.url, agent.token),
  stdio: () => connectWithTransport(stdioTransport({ ALICE_URL: app.url, ALICE_TOKEN: agent.token })),
}

beforeAll(async () => {
  app = await startApp()
  owner = await bootstrapOwner(app)
  agent = await createAgent(owner, 'Conformance Agent')
})
afterAll(async () => app?.stop())

/** Removes values that legitimately differ between runs (ids, timestamps). */
function shape(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(shape)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, /(^id$|Id$|At$|^activityId$|nextCursor|cursor)/.test(k) && typeof v === 'string' ? '<var>' : shape(v)]),
    )
  }
  return value
}

/** The shared conformance scenario. Returns normalized observations for cross-transport comparison. */
async function scenario(mcp: McpHandle, label: string) {
  const out: Record<string, unknown> = {}
  const project = await mcp.ok('create_project', { name: `Conformance ${label}` })
  const task = await mcp.ok('create_task', { title: `Task ${label}`, projectId: project.project.id, status: 'ready', labels: ['conf'] })
  out.list = shape(await mcp.ok('list_tasks', { projectId: [project.project.id], status: ['ready'] }))
  out.claim = shape(await mcp.ok('claim_task', { id: task.task.id }))
  out.claimAgain = await mcp.call('claim_task', { id: task.task.id }).then((r) => r.error)
  const doc = await mcp.ok('create_document', {
    title: `Doc ${label}`,
    body: `Conformance-${label}-knowledge reference`,
    tags: ['guide'],
    searchKeywords: [`alias-${label}`],
    status: 'draft',
  })
  out.documentCreate = shape(doc)
  out.review = shape(await mcp.ok('review_document', { id: doc.document.id, expectedRevision: 1 }))
  out.documentSearch = shape(await mcp.ok('search_documents', {
    q: `Conformance-${label}-knowledge`,
    tag: ['guide'],
    status: ['current'],
  }))
  const related = await mcp.ok('create_document', { title: `Related ${label}`, body: 'Peer reference' })
  out.relate = shape(await mcp.ok('link_document_relation', { id: doc.document.id, targetId: related.document.id, type: 'related' }))
  out.documentRelations = shape(await mcp.ok('list_document_relations', { id: doc.document.id, direction: 'outgoing', type: ['related'] }))
  await mcp.ok('link_document', { id: doc.document.id, taskId: task.task.id })
  await mcp.ok('add_comment', { taskId: task.task.id, body: 'Working on it' })
  out.context = shape(await mcp.ok('get_task_context', { id: task.task.id }))
  const sub = await mcp.ok('create_task', { title: `Sub ${label}`, parentId: task.task.id })
  out.cycle = (await mcp.call('set_task_parent', { id: task.task.id, parentId: sub.task.id })).error!.code
  out.noSummary = (await mcp.call('complete_task', { id: task.task.id, summary: '' })).error!.code
  out.complete = shape(await mcp.ok('complete_task', { id: task.task.id, summary: 'Delivered' }))
  out.validation = (await mcp.call('create_task', { title: '' })).error!.code
  out.notFound = await mcp.call('get_task', { id: 'tsk_nope' }).then((r) => r.error)
  out.protected = (await mcp.call('archive_project', { id: (await mcp.ok('list_projects')).items[0].id })).error!.code
  return out
}

describe('MCP conformance across transports', () => {
  it('exposes the documented tool set with identical names and schemas over remote and stdio', async () => {
    const remote = await transports.remote()
    const stdio = await transports.stdio()
    try {
      const r = (await remote.client.listTools()).tools
      const s = (await stdio.client.listTools()).tools
      expect(r.map((t) => t.name)).toEqual(ALL_TOOLS)
      expect(s).toEqual(r)
      expect(stdio.client.getInstructions()).toBe(remote.client.getInstructions())
      expect(stdio.client.getServerVersion()?.version).toBe(remote.client.getServerVersion()?.version)
    } finally {
      await remote.close()
      await stdio.close()
    }
  })

  it('returns equivalent results and stable error codes for the same scenario', async () => {
    const results: Record<string, any> = {}
    const labels: Record<string, string> = { remote: 'R1', stdio: 'S1' }
    for (const [name, connect] of Object.entries(transports)) {
      const handle = await connect()
      try {
        results[name] = await scenario(handle, labels[name])
      } finally {
        await handle.close()
      }
    }
    const normalize = (o: any) =>
      JSON.parse(
        JSON.stringify(o)
          .replace(/\b(tsk|prj|doc|cmt|act|agt|usr)_[0-9a-z]{20}\b/g, '$1_<id>')
          .replace(/\b[RS]1\b/g, 'L1'),
      )
    expect(normalize(results.stdio)).toEqual(normalize(results.remote))
    expect(results.remote.claimAgain.code).toBe('CLAIM_FAILED')
    expect(results.remote.cycle).toBe('RELATIONSHIP_CYCLE')
    expect(results.remote.noSummary).toBe('VALIDATION_ERROR')
    expect(results.remote.validation).toBe('VALIDATION_ERROR')
    expect(results.remote.notFound.code).toBe('NOT_FOUND')
    expect(results.remote.protected).toBe('PROTECTED_RESOURCE')
    expect(results.remote.complete.task.status).toBe('done')
  })
})

describe('stdio adapter setup errors', () => {
  async function failure(env: Record<string, string>) {
    const transport = stdioTransport(env)
    let stderr = ''
    transport.stderr?.on('data', (d) => (stderr += d.toString()))
    const error = await connectWithTransport(transport).then(
      (h) => h.close().then(() => null),
      (e: Error) => e,
    )
    await new Promise((r) => setTimeout(r, 100))
    return { error, stderr }
  }

  it('exits with actionable guidance when configuration is missing', async () => {
    const { error, stderr } = await failure({})
    expect(error).toBeTruthy()
    expect(stderr).toContain('ALICE_URL is not set')
    expect(stderr).toContain('ALICE_TOKEN')
  })

  it('reports revoked or invalid tokens without echoing them', async () => {
    const doomed = await createAgent(owner, 'Revoked Agent')
    await owner.post(`/api/agent-tokens/${doomed.tokenId}/revoke`)
    const { error, stderr } = await failure({ ALICE_URL: app.url, ALICE_TOKEN: doomed.token })
    expect(error).toBeTruthy()
    expect(stderr).toContain('rejected the agent token')
    expect(stderr).not.toContain(doomed.token)
    const unreachable = await failure({ ALICE_URL: 'http://127.0.0.1:9', ALICE_TOKEN: doomed.token })
    expect(unreachable.stderr).toContain('Cannot reach Alice')
  })
})
