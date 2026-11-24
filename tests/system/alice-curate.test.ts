import fs from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startApp, type RunningApp } from '../helpers/app'
import { bootstrapOwner, createAgent, type HttpClient } from '../helpers/client'
import { connectMcp, type McpHandle } from '../helpers/mcp'

// Scripted walkthrough of the alice-curate workflow through the public MCP tools, following the steps
// in skill/alice-curate/SKILL.md. The script plays the agent: it is author-written, not an autonomous
// Codex or Claude run. Evidence goes to the ignored .alice-test/alice-curate/ folder.
const EVIDENCE = path.resolve('.alice-test/alice-curate')
const METHOD = 'Scripted public-tool walkthrough of skill/alice-curate (author-written, not an autonomous model evaluation).'

let app: RunningApp
let owner: HttpClient
let curator: McpHandle
const trace: Array<Record<string, unknown>> = []
const act = async (tool: string, args: Record<string, unknown>) => {
  const result = await curator.ok(tool, args)
  trace.push({ tool, args })
  return result
}
const uuid = () => crypto.randomUUID()

type Doc = { id: string; title: string; revision: number }
const fx: Record<string, Doc> = {}
let project: { id: string }
let other: { id: string }
let topic: { id: string; revision: number }

const createDoc = async (key: string, title: string, body: string, projectId?: string) => {
  const doc = (await owner.post('/api/documents', { title, body })).body.document
  if (projectId) expect((await owner.post(`/api/documents/${doc.id}/links`, { projectId })).status).toBe(200)
  fx[key] = doc
  return doc as Doc
}

// ทั้งคลังของ fixture: ใช้เทียบก่อน/หลังเพื่อพิสูจน์ว่าการสำรวจ/การปฏิเสธไม่เขียนอะไรเลย
const snapshot = async () => {
  const docs = []
  for (const key of Object.keys(fx).sort()) {
    const d = (await owner.get(`/api/documents/${fx[key].id}`)).body.document
    const relations = (await owner.get(`/api/documents/${fx[key].id}/relations`)).body.items
    const revisions = (await owner.get(`/api/documents/${fx[key].id}/revisions`)).body
    docs.push({ key, body: d.body, revision: d.revision, status: d.status, reviewedRevision: d.reviewedRevision, archivedAt: d.archivedAt, relations, revisions })
  }
  const topics = (await owner.get(`/client/v1/projects/${project.id}/knowledge/topics`)).body.items
  const members = []
  for (const t of topics) members.push((await owner.get(`/client/v1/knowledge/topics/${t.id}/documents`)).body.items.map((m: { document: { id: string } }) => m.document.id))
  const documentCount = (await owner.get('/api/documents?archived=all&limit=200')).body.items.length
  const taskCount = (await owner.get('/api/tasks?limit=200')).body.items.length
  return { docs, topics, members, documentCount, taskCount }
}

const LONG = `# Runbook\n\n${Array.from({ length: 60 }, (_, i) => `## Step ${i + 1}\n\nRun check ${i + 1} and record the result in the log.\n`).join('\n')}`

beforeAll(async () => {
  fs.mkdirSync(EVIDENCE, { recursive: true })
  app = await startApp()
  owner = await bootstrapOwner(app)
  curator = await connectMcp(app.url, (await createAgent(owner, 'Curator')).token)
  project = (await owner.post('/api/projects', { name: 'Curation fixture' })).body.project
  other = (await owner.post('/api/projects', { name: 'Neighbour project' })).body.project

  await createDoc('replacement', 'Setup guide v2', '# Setup\n\nInstall with the alice command.\n', project.id)
  await createDoc('superseded', 'Setup guide v1', '# Setup\n\nInstall from source.\n', project.id)
  await createDoc('archived', 'Retired FAQ', '# FAQ\n\nOld answers.\n', project.id)
  await createDoc('external', 'Shared glossary', '# Glossary\n\nTerms used across projects.\n', other.id)
  await createDoc('neighbourOnly', 'Neighbour secrets of the trade', '# Private\n\nOnly for the neighbour project.\n', other.id)
  await createDoc('overview', 'Start here', [
    '# Start here',
    '',
    '## Setup',
    '',
    `Follow [the setup guide](/documents/${fx.superseded.id}).`,
    '',
    '## History',
    '',
    `See [the FAQ](/documents/${fx.archived.id}) and [the glossary](/documents/${fx.external.id}).`,
    '',
    '## Missing',
    '',
    '[Lost page](/documents/doc_00000000000000000000).',
  ].join('\n'), project.id)
  await createDoc('sameTitleA', 'Deploy', '# Deploy\n\nDeploy the web app with the release workflow.\n', project.id)
  await createDoc('sameTitleB', 'Deploy', '# Deploy\n\nDeploy the desktop app by signing the bundle.\n', project.id)
  await createDoc('oldValid', 'Coding style', '# Coding style\n\nWritten in 2019. Two spaces, no semicolons, single quotes.\n', project.id)
  await createDoc('conflictA', 'Session limits', '# Limits\n\nSessions expire after 30 days.\n', project.id)
  await createDoc('conflictB', 'Security notes', '# Sessions\n\nSessions expire after 7 days.\n', project.id)
  await createDoc('uncurated', 'Release notes', '# Release notes\n\nNo topic links here yet.\n', project.id)
  await createDoc('long', 'Operations runbook', LONG, project.id)

  // supersedes ต้องยืนยันเอง; ทำโดยเจ้าของ fixture ไม่ใช่ curator
  expect((await owner.post(`/api/documents/${fx.replacement.id}/relations`, { targetId: fx.superseded.id, type: 'supersedes', acknowledgeSupersedes: true })).status).toBe(200)
  expect((await owner.post(`/api/documents/${fx.archived.id}/archive`, {})).status).toBe(200)
  for (const key of ['overview', 'sameTitleA']) expect((await owner.post(`/api/documents/${fx[key].id}/review`, { expectedRevision: 1 })).status).toBe(200)

  const created = (await owner.post(`/client/v1/projects/${project.id}/knowledge/topics`, { name: 'Onboarding', description: 'Read these first.', mutationId: uuid() })).body.topic
  let revision = created.revision
  // overview เป็น draft? ไม่: ใส่ superseded guide เป็นจุดเริ่มอ่าน และ external จากอีกโปรเจกต์เป็นสมาชิก (curated only)
  for (const key of ['overview', 'superseded', 'external', 'sameTitleA', 'sameTitleB', 'oldValid', 'conflictA', 'conflictB', 'long']) {
    revision = (await owner.put(`/client/v1/knowledge/topics/${created.id}/documents/${fx[key].id}`, { expectedRevision: revision, mutationId: uuid() })).body.topic.revision
  }
  topic = { id: created.id, revision }
})

afterAll(async () => {
  await curator?.close()
  await app?.stop()
  fs.writeFileSync(path.join(EVIDENCE, 'scenarios.json'), JSON.stringify({ method: METHOD, trace }, null, 2))
})

/** Step 2 of the skill: inventory from project links union topic membership, paged and deduplicated. */
const inventory = async () => {
  const seen = new Map<string, Doc & { status: string }>()
  let cursor: string | undefined
  let pages = 0
  do {
    const page = await act('search_documents', { knowledgeProjectId: project.id, limit: 4, ...(cursor ? { cursor } : {}) })
    pages++
    for (const d of page.items) if (!seen.has(d.id)) seen.set(d.id, d)
    cursor = page.nextCursor ?? undefined
  } while (cursor)
  return { docs: [...seen.values()], pages }
}

/** Reads one document to its end in windows at one revision; stops early when the window budget runs out. */
const readWindows = async (id: string, maxChars: number, budget: { windows: number }) => {
  const first = await act('get_document', { id, maxChars, offset: 0 })
  const revision = first.document.revision
  let body = first.document.body
  let next = first.document.bodyWindow.nextOffset
  let windows = 1
  budget.windows--
  while (next !== null && budget.windows > 0) {
    const part = await act('get_document', { id, expectedRevision: revision, offset: next, maxChars })
    body += part.document.body
    next = part.document.bodyWindow.nextOffset
    windows++
    budget.windows--
  }
  return { id, revision, body, windows, complete: next === null, nextOffset: next }
}

const linksIn = (body: string) => [...body.matchAll(/\]\(\/documents\/([A-Za-z0-9_]+)/g)].map((m) => m[1])

describe('alice-curate qualification', () => {
  let before: Awaited<ReturnType<typeof snapshot>>
  const findings: Array<{ id: string; class: 'fact' | 'suspicion' | 'conflict' | 'unknown'; found: string; evidence: string }> = []

  it('REQ-001/002/005: builds the project inventory from links and curation across pages without leaking the neighbour project', async () => {
    before = await snapshot()
    const { docs, pages } = await inventory()
    const ids = new Set(docs.map((d) => d.id))
    expect(pages).toBeGreaterThan(1)
    expect(docs.length).toBe(ids.size)
    // curated-only external doc is in scope; the neighbour project's own documents are not
    expect(ids.has(fx.external.id)).toBe(true)
    expect(ids.has(fx.neighbourOnly.id)).toBe(false)
    // archived documents are not part of normal discovery
    expect(ids.has(fx.archived.id)).toBe(false)
    for (const key of ['overview', 'replacement', 'superseded', 'sameTitleA', 'sameTitleB', 'oldValid', 'conflictA', 'conflictB', 'uncurated', 'long']) expect(ids.has(fx[key].id), key).toBe(true)
    trace.push({ step: 'inventory', pages, listed: docs.length })
  })

  it('REQ-002: structural findings separate facts from information and never judge by age or title alone', async () => {
    const topics = await act('list_knowledge_topics', { projectId: project.id })
    expect(topics.items.map((t: { id: string }) => t.id)).toEqual([topic.id])
    const members = (await act('list_topic_documents', { topicId: topic.id, limit: 50 })).items.map((m: { document: { id: string; status: string } }) => m.document)
    const memberIds = new Set(members.map((m: { id: string }) => m.id))

    // ไม่มี topic: เป็นข้อมูลให้พิจารณา ไม่ใช่ข้อผิดพลาด
    for (const d of (await inventory()).docs) {
      const inTopics = (await act('list_document_topics', { id: d.id })).items
      if (!memberIds.has(d.id)) {
        expect(inTopics).toEqual([])
        findings.push({ id: d.id, class: 'fact', found: `"${d.title}" is in no topic (information, not an error)`, evidence: `list_document_topics ${d.id}: none` })
      }
    }
    expect(findings.map((f) => f.id).sort()).toEqual([fx.replacement.id, fx.uncurated.id].sort())
    const backlinks = await act('list_document_backlinks', { id: fx.uncurated.id })
    expect(backlinks.items).toEqual([])

    // reading list starts with a superseded member: fact, with its replacement from the relation
    const superseded = members.find((m: { id: string }) => m.id === fx.superseded.id)
    expect(superseded.status).toBe('superseded')
    const incoming = await act('list_document_relations', { id: fx.superseded.id, direction: 'incoming' })
    expect(incoming.items.map((r: { type: string; document: { id: string } }) => [r.type, r.document.id])).toEqual([['supersedes', fx.replacement.id]])
    findings.push({ id: fx.superseded.id, class: 'fact', found: 'Topic "Onboarding" lists a superseded guide', evidence: `"Setup guide v1" (${fx.superseded.id}) superseded by "Setup guide v2" (${fx.replacement.id})` })

    // same title, different content and an old-looking document stay suspicions/reasons to read at most
    const deploys = members.filter((m: { title: string }) => m.title === 'Deploy')
    expect(deploys).toHaveLength(2)
    expect(findings.some((f) => f.id === fx.oldValid.id)).toBe(false)
  })

  it('REQ-001/002/005: depth A reads only bodies with a reason and cites the revision and section actually read', async () => {
    const reasons: Record<string, string> = {
      [fx.overview.id]: 'reading start with outgoing links',
      [fx.sameTitleA.id]: 'same title as another member',
      [fx.sameTitleB.id]: 'same title as another member',
    }
    const read: string[] = []
    for (const id of Object.keys(reasons)) {
      const outline = await act('get_document_outline', { id })
      const content = await readWindows(id, 20_000, { windows: 10 })
      expect(content.complete).toBe(true)
      expect(content.revision).toBe(outline.document.revision)
      read.push(id)
      trace.push({ step: 'depth A read', id, reason: reasons[id], revision: content.revision, headings: outline.items.map((h: { text: string }) => h.text) })
      if (id === fx.overview.id) {
        for (const target of linksIn(content.body)) {
          const preview = await curator.call('get_document_preview', { id: target })
          if (target === fx.superseded.id) expect(preview.result.document.status).toBe('superseded')
          if (target === fx.archived.id) {
            expect(preview.result).toMatchObject({ state: 'archived', body: null })
            findings.push({ id: target, class: 'fact', found: '"Start here" links an archived document', evidence: `"Start here" (${id}) rev ${content.revision} § History; preview state archived, no body` })
          }
          if (target === fx.external.id) expect(preview.result.state).toBe('available')
          if (target === 'doc_00000000000000000000') {
            expect(preview.result).toMatchObject({ state: 'unavailable', body: null })
            findings.push({ id: target, class: 'unknown', found: '"Start here" links a document that cannot be read', evidence: `"Start here" (${id}) rev ${content.revision} § Missing; preview state unavailable` })
          }
        }
      }
    }
    // the two "Deploy" bodies differ: no duplicate finding from the title alone
    const [a, b] = await Promise.all([fx.sameTitleA.id, fx.sameTitleB.id].map((id) => act('get_document', { id })))
    expect(a.document.body).not.toBe(b.document.body)
    // depth A never read the long runbook, the conflict pair or the neighbour project's own documents
    for (const key of ['long', 'conflictA', 'conflictB', 'neighbourOnly']) expect(read).not.toContain(fx[key].id)
    expect(trace.some((t) => t.tool === 'get_document' && (t.args as { id: string }).id === fx.neighbourOnly.id)).toBe(false)
  })

  it('REQ-005: depth B reads every in-scope body, reports progress when the budget runs out, and finishes from the continuation', async () => {
    const { docs } = await inventory()
    // first pass: a budget too small for everything → explicit incomplete report with continuation
    const budget = { windows: 8 }
    const done: Array<Awaited<ReturnType<typeof readWindows>>> = []
    let continuation: { id: string; offset: number } | null = null
    for (const d of docs) {
      if (budget.windows <= 0) { continuation ??= { id: d.id, offset: 0 }; continue }
      const r = await readWindows(d.id, 1000, budget)
      done.push(r)
      if (!r.complete) continuation = { id: d.id, offset: r.nextOffset! }
    }
    const incomplete = { read: done.filter((r) => r.complete).map((r) => r.id), remaining: docs.length - done.filter((r) => r.complete).length, continuation }
    expect(incomplete.remaining).toBeGreaterThan(0)
    expect(incomplete.continuation).not.toBeNull()
    trace.push({ step: 'depth B incomplete', ...incomplete })

    // second pass: generous budget → every body read to its end, the long one over several windows
    const full = { windows: 500 }
    const all = []
    for (const d of docs) all.push(await readWindows(d.id, 1000, full))
    expect(all.every((r) => r.complete)).toBe(true)
    expect(all.length).toBe(docs.length)
    const long = all.find((r) => r.id === fx.long.id)!
    expect(long.windows).toBeGreaterThan(1)
    expect(long.body).toBe(LONG)

    // supported conflict between two bodies that were actually read
    const sessions = all.filter((r) => /Sessions expire after (\d+) days/.test(r.body)).map((r) => [r.id, /after (\d+) days/.exec(r.body)![1], r.revision])
    expect(sessions.map((s) => s[1]).sort()).toEqual(['30', '7'])
    findings.push({ id: fx.conflictA.id, class: 'conflict', found: 'Session lifetime differs', evidence: sessions.map(([id, days, rev]) => `${id} rev ${rev}: ${days} days`).join(' vs ') })
    trace.push({ step: 'depth B complete', documents: all.length, longWindows: long.windows })
  })

  it('REQ-003/004: inspection, a proposal and its rejection leave the library, tasks and documents unchanged', async () => {
    const proposal = [
      { n: 'P1', target: fx.overview.id, basedOn: 1, change: `replace link to ${fx.superseded.id} with ${fx.replacement.id} in § Setup`, effect: 'new content revision; current review cleared' },
      { n: 'P2', target: topic.id, basedOn: topic.revision, change: `add ${fx.uncurated.id} to topic`, effect: 'topic revision only' },
      { n: 'P3', target: fx.sameTitleA.id, basedOn: 1, change: 'rename heading to "Deploy the web app"', effect: 'new content revision; current review cleared' },
      { n: 'P4', target: fx.uncurated.id, basedOn: 1, change: `references ${fx.replacement.id}`, effect: 'no content revision' },
    ]
    trace.push({ step: 'report', findings, proposal, approval: 'none yet' })
    expect(await snapshot()).toEqual(before)
    trace.push({ step: 'rejection', approval: 'Skip everything; I only wanted the report.' })
    expect(await snapshot()).toEqual(before)
  })

  it('REQ-004: applies only the approved subset, re-proposes invalidated work, reports a topic conflict and never reviews, archives or supersedes', async () => {
    // approval: P1, P2 and P3; P4 is not approved
    trace.push({ step: 'approval', approved: ['P1', 'P2', 'P3'], notApproved: ['P4'] })
    const results: Record<string, string> = {}

    // someone else edits while the curator works: overview loses § Setup, sameTitleA gains an unrelated line, topic changes
    const overviewNow = (await owner.get(`/api/documents/${fx.overview.id}`)).body.document
    await owner.patch(`/api/documents/${fx.overview.id}`, { body: overviewNow.body.replace(/## Setup\n\nFollow .*\n\n/, '') })
    await owner.patch(`/api/documents/${fx.sameTitleA.id}`, { body: '# Deploy\n\nDeploy the web app with the release workflow.\n\nAsk in #releases first.\n' })
    expect((await owner.patch(`/client/v1/knowledge/topics/${topic.id}`, { description: 'Read these first, in order.', expectedRevision: topic.revision, mutationId: uuid() })).body.topic.revision).toBe(topic.revision + 1)

    // P1: re-read; the section it changes is gone → not applied, re-proposed
    const p1 = await act('get_document', { id: fx.overview.id })
    expect(p1.document.revision).toBe(2)
    expect(p1.document.body).not.toContain(fx.superseded.id)
    results.P1 = 'Not applied — changed since proposal'

    // P2: topic write against the proposal's revision → CONFLICT, reported as failed
    const p2 = await curator.call('put_topic_document', { topicId: topic.id, documentId: fx.uncurated.id, expectedRevision: topic.revision, mutationId: uuid() })
    expect(p2.isError).toBe(true)
    expect(p2.error?.code).toBe('CONFLICT')
    results.P2 = `Failed — ${p2.error?.code}`

    // P3: re-read, merge into the latest body so the other edit survives
    const latest = await act('get_document', { id: fx.sameTitleA.id })
    expect(latest.document.revision).toBe(2)
    const merged = latest.document.body.replace('# Deploy\n', '# Deploy the web app\n')
    const applied = await act('update_document', { id: fx.sameTitleA.id, body: merged })
    expect(applied.document).toMatchObject({ revision: 3, status: 'unreviewed', reviewedRevision: null, archivedAt: null })
    expect(applied.document.body).toContain('Ask in #releases first.')
    results.P3 = 'Applied'
    results.P4 = 'Not applied — not approved'
    trace.push({ step: 'apply summary', results })

    // nothing outside the approved subset changed; no review, archive or supersedes by implication
    expect((await owner.get(`/api/documents/${fx.uncurated.id}/relations`)).body.items).toEqual([])
    const after = await snapshot()
    for (const doc of after.docs) {
      const was = before.docs.find((d) => d.key === doc.key)!
      expect(doc.archivedAt, doc.key).toBe(was.archivedAt)
      expect(doc.relations, doc.key).toEqual(was.relations)
      if (!['overview', 'sameTitleA'].includes(doc.key)) expect(doc.revision, doc.key).toBe(was.revision)
      if (doc.reviewedRevision !== was.reviewedRevision) expect(doc.reviewedRevision, doc.key).toBeNull()
    }
    expect(after.documentCount).toBe(before.documentCount)
    expect(after.taskCount).toBe(before.taskCount)
    expect(after.members).toEqual(before.members)
    expect(after.members[0]).not.toContain(fx.uncurated.id)
  })
})
