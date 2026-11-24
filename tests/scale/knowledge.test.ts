import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { startApp, tempDataDir, type RunningApp } from '../helpers/app'
import { HttpClient } from '../helpers/client'
import { openDatabase } from '../../src/server/db/database'
import { SCALE_OWNER } from './seed'
import { KNOWLEDGE_ENVELOPE, knowledgeDocId, seedKnowledge } from './knowledge-seed'

let app: RunningApp
let client: HttpClient
let fixture: Awaited<ReturnType<typeof seedKnowledge>>
const latencies: Record<string, unknown> = {}
const stats = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b)
  return { samples: values.length, p50: sorted[Math.floor(sorted.length * .5)], p95: sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * .95) - 1)], max: sorted.at(-1) }
}
const ok = (r: {
  status: number
  body: any
}) => {
  if (r.status !== 200) throw new Error(`Unexpected HTTP ${r.status}: ${JSON.stringify(r.body)}`)
  return r.body
}
const read = (i: number) => client.get([
  `/client/v1/documents?q=needle&knowledgeProjectId=${fixture.projectId}&limit=20`,
  `/client/v1/knowledge/topics/${fixture.topicId}/documents?limit=20`,
  `/client/v1/documents/${knowledgeDocId(0)}/backlinks?limit=20`,
  `/client/v1/documents/${knowledgeDocId(2)}/preview`,
  `/client/v1/projects/${fixture.projectId}/knowledge/context?limit=10`,
][i % 5]).then(ok)
beforeAll(async () => {
  const dataDir = tempDataDir('knowledge-scale')
  fixture = await seedKnowledge(dataDir)
  app = await startApp({ dataDir, env: { ALICE_CLIENT_RATE_LIMIT: '100000' } })
  client = new HttpClient(app.url)
  ok(await client.post('/api/auth/login', { username: SCALE_OWNER.username, password: SCALE_OWNER.password }))
})
afterAll(async () => {
  if (!app) return
  const bytes = (suffix: string) => { try { return fs.statSync(path.join(app.dataDir, 'alice.db') + suffix).size } catch { return 0 } }
  const liveStorage = { dbBytes: bytes(''), walBytes: bytes('-wal') }
  await app.stop()
  const measuredSources = Object.fromEntries(['src/server/domain/knowledge.ts', 'src/server/domain/knowledge-scope.ts', 'src/server/domain/search.ts', 'src/server/domain/documents.ts', 'src/server/domain/document-links.ts', 'src/server/domain/document-content.ts'].map((file) => [file, createHash('sha256').update(fs.readFileSync(file)).digest('hex')]))
  const report = { measuredSources, liveStorage, checkpointedOnShutdown: true, warmup: { readerOperations: 10, writerOperations: 5, excludedFromSamples: true }, candidate: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), envelope: KNOWLEDGE_ENVELOPE, fixture, environment: { cpu: os.cpus()[0]?.model, cores: os.cpus().length, ramBytes: os.totalmem(), os: `${os.platform()} ${os.release()} ${os.arch()}`, node: process.version, runtime: 'Node/Fastify/better-sqlite3 WAL', dbBytes: bytes(''), walBytes: bytes('-wal'), testOnlyClientRateLimit: 100000 }, thresholds: { warmP95: 400, mixedReadP95: 800, mixedWriteP95: 1000 }, latencies }
  fs.writeFileSync(path.resolve('.alice-test/project-knowledge/capacity-report.json'), JSON.stringify(report, null, 2))
})
it('contains the exact approved fixture and body distribution', () => {
  expect(fixture.counts).toEqual({ documents: 10000, document_inline_links: 100000, knowledge_topics: 1000, knowledge_topic_documents: 20000 })
  expect(fixture.sizes).toMatchObject({ min: 2048, max: 50000, large: 500 })
})
it('measures at least fifty warm samples of all five public reads', async () => {
  for (let op = 0; op < 5; op++) {
    await read(op)
    const times: number[] = []
    for (let i = 0; i < 50; i++) {      
const start = performance.now()
      await read(op)
      times.push(performance.now() - start)    
}
    const measured = stats(times)
    latencies[`warm-${['search', 'topic-list', 'backlinks', 'preview', 'context'][op]}`] = measured
    expect(measured.p95).toBeLessThanOrEqual(400)
  }
})
it('sustains ten readers and five independent writers for one hundred operations each', async () => {
  const readTimes: number[] = [], writeTimes: number[] = []
  const bodies = await Promise.all(Array.from({ length: 5 }, (_, i) => client.get(`/api/documents/${knowledgeDocId(9992 + i)}`).then(ok).then((r) => r.document.body as string)))
  for (let i = 0; i < 10; i++)await read(i)
  for (let i = 0; i < 5; i++) { ok(await client.patch(`/client/v1/documents/${knowledgeDocId(9992 + i)}`, { body: bodies[i] + '\n\nwarm-up writer ' + i })) }
  const readers = Array.from({ length: 10 }, (_, reader) => (async () => {    
for (let n = 0; n < 100; n++) {      
const t = performance.now()
      await read(reader + n)
      readTimes.push(performance.now() - t)    
}  
})())
  const writers = Array.from({ length: 5 }, (_, writer) => (async () => {    
for (let n = 0; n < 100; n++) {      
const t = performance.now()
      ok(await client.patch(`/client/v1/documents/${knowledgeDocId(9992 + writer)}`, { body: bodies[writer] + `\n\nwriter ${writer} operation ${n}` }))
      writeTimes.push(performance.now() - t)    
}  
})())
  await Promise.all([...readers, ...writers])
  const reads = stats(readTimes), writes = stats(writeTimes)
  latencies.mixed = { readers: 10, writers: 5, operationsPerClient: 100, reads, writes, unexpectedErrors: 0 }
  expect(readTimes).toHaveLength(1000)
  expect(writeTimes).toHaveLength(500)
  expect(reads.p95).toBeLessThanOrEqual(800)
  expect(writes.p95).toBeLessThanOrEqual(1000)
  for (let writer = 0; writer < 5; writer++) {    
const d = ok(await client.get(`/api/documents/${knowledgeDocId(9992 + writer)}`)).document
    expect(d.revision).toBe(102)
    expect(d.body).toBe(bodies[writer] + `\n\nwriter ${writer} operation 99`)  
}
  const db = openDatabase(path.join(app.dataDir, 'alice.db'))
  expect(db.prepare('SELECT count(*) AS n FROM documents d LEFT JOIN document_link_index_state s ON s.source_document_id=d.id WHERE s.source_document_id IS NULL OR d.revision<>s.content_revision').get()).toEqual({ n: 0 })
  expect(db.pragma('foreign_key_check')).toEqual([])
  db.close()
})
it('reports deliberate same-topic revision conflicts separately from successful latency samples', async () => {
  const t = ok(await client.get(`/client/v1/knowledge/topics/${fixture.topicId}`)).topic
  const outcomes = await Promise.all(Array.from({ length: 5 }, (_, i) => client.patch(`/client/v1/knowledge/topics/${t.id}`, { name: `Concurrent topic ${i}`, expectedRevision: t.revision, mutationId: crypto.randomUUID() })))
  expect(outcomes.filter((r) => r.status === 200)).toHaveLength(1)
  expect(outcomes.filter((r) => r.status === 409 && r.body.error.code === 'CONFLICT')).toHaveLength(4)
  latencies.deliberateConflicts = { successes: 1, conflicts: 4, excludedFromLatencySamples: true }
})
