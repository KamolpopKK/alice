import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { parse } from 'yaml'
import { expect, it } from 'vitest'
import { startApp } from '../helpers/app'
import { bootstrapOwner } from '../helpers/client'
import { testDir } from '../helpers/tmp'

// Author-driven walkthrough of the storage/evidence seams, not an autonomous agent evaluation.
it('persists linked system knowledge and a focused refresh without changing source repositories', async () => {
  const root = testDir('understand-walkthrough-')
  const git = (repo: string, ...args: string[]) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim()
  const repos = ['api', 'payments'].map((name) => {
    const repo = path.join(root, name)
    fs.mkdirSync(repo)
    git(repo, 'init', '--quiet')
    return repo
  })
  const [api, payments] = repos
  fs.writeFileSync(path.join(api, 'routes.js'), 'export const cancel = () => publish("order.cancelled")\n')
  fs.writeFileSync(path.join(api, 'README.md'), 'Cancellation publishes order.deleted.\n')
  fs.writeFileSync(path.join(api, 'package.json'), JSON.stringify({ scripts: { test: 'node --test' } }))
  fs.writeFileSync(path.join(payments, 'consumer.js'), 'subscribe("order.cancelled", refund)\n')
  fs.writeFileSync(path.join(payments, 'gateway.js'), 'export const gateway = "https://gateway.example.invalid/refund"\n')
  const baselines = repos.map((repo) => {
    git(repo, 'add', '.')
    git(repo, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'Initial fixture')
    return git(repo, 'rev-parse', 'HEAD')
  })
  // All three dirty states at the same HEAD: refresh must inspect more than commit identity.
  fs.writeFileSync(path.join(api, 'contract.json'), '{"event":"order.cancelled.v2"}\n')
  git(api, 'add', 'contract.json')
  fs.writeFileSync(path.join(api, 'routes.js'), 'export const cancel = () => publish("order.cancelled.v2")\n')
  fs.writeFileSync(path.join(api, 'new-consumer.js'), 'subscribe("order.cancelled.v2", notify)\n')
  const status = git(api, 'status', '--porcelain')
  expect(status).toContain('A  contract.json')
  expect(status).toContain(' M routes.js')
  expect(status).toContain('?? new-consumer.js')
  expect(git(api, 'rev-parse', 'HEAD')).toBe(baselines[0])
  expect(git(api, 'diff', '--', 'routes.js')).toContain('order.cancelled.v2')
  expect(git(api, 'diff', '--cached', '--', 'contract.json')).toContain('order.cancelled.v2')
  const snapshot = repos.map((repo) => ({
    status: git(repo, 'status', '--porcelain'),
    files: Object.fromEntries(fs.readdirSync(repo).filter((f) => f !== '.git').map((f) => [f, fs.readFileSync(path.join(repo, f), 'utf8')])),
  }))

  const app = await startApp()
  try {
    const owner = await bootstrapOwner(app)
    const project = (await owner.post('/api/projects', { name: 'Fixture understanding' })).body.project
    const create = async (title: string, body: string) => {
      const result = await owner.post('/api/documents', { title, body, tags: ['project-knowledge'], searchKeywords: ['cancellation', 'refund'], status: 'draft' })
      expect(result.status, JSON.stringify(result.body)).toBe(201)
      expect(result.body.document.reviewedAt).toBeNull()
      expect((await owner.post(`/api/documents/${result.body.document.id}/links`, { projectId: project.id })).status).toBe(200)
      return result.body.document
    }
    const detail = await create('Payments detail', `Payments consumer.js handles order.cancelled; gateway.js configures an external refund URL. Gateway implementation and production use unknown. Baseline ${baselines[1]}; not rechecked during API-only refresh.`)
    const graphBody = '# Fixture — System graph\n- Type: System graph.\n- Scope: API and payments, configured gateway only.\n- Source: API routes.js; payments consumer.js and gateway.js at recorded baselines.\n\n### Cancellation\nPurpose: Recorded cancellation/refund relationship.\n```mermaid\nflowchart LR\n  api["API"] -->|"order.cancelled event"| payments["Payments"]\n  payments -->|"Configured HTTPS refund"| gateway["External gateway"]\n```\nExplanation: Configuration/code evidence; production delivery and external implementation unverified.\n'
    const graph = await create('Fixture System graph', graphBody)
    const overview = await create('Fixture understanding', `Capability: cancellation → API cancel → order.cancelled → payments refund. API baseline ${baselines[0]}; payments baseline ${baselines[1]}. Found test command node --test in package.json, not executed. Conflict: README says order.deleted, routes.js says order.cancelled. Gateway unavailable. Tests/CI not inspected. Detail: ${detail.id}; graph: ${graph.id}.`)
    for (const target of [detail, graph]) {
      expect((await owner.post(`/api/documents/${overview.id}/relations`, { targetId: target.id, type: 'references' })).status).toBe(200)
    }
    const previousDetail = (await owner.get(`/api/documents/${detail.id}`)).body.document
    // Focused refresh describes the changed edge and retains the untouched payment evidence.
    const refreshed = graphBody.replace('order.cancelled event', 'order.cancelled.v2 producer; consumer migration unverified') + `\n## Refresh scope\nAPI inspected at unchanged HEAD ${baselines[0]} plus staged contract.json, unstaged routes.js and untracked new-consumer.js. Payments retained from ${baselines[1]}, not rechecked. Consumer compatibility unresolved. No claim of whole-system freshness.\n`
    const updated = await owner.patch(`/api/documents/${graph.id}`, { body: refreshed })
    expect(updated.body.document).toMatchObject({ id: graph.id, revision: 2, reviewedAt: null })
    expect((await owner.get(`/api/documents/${detail.id}`)).body.document).toEqual(previousDetail)
    const relations = (await owner.get(`/api/documents/${overview.id}/relations?direction=outgoing`)).body.items
    expect(relations.map((r: { document: { id: string } }) => r.document.id).sort()).toEqual([detail.id, graph.id].sort())
    const found = await owner.get('/api/documents?q=cancellation&tag=project-knowledge')
    expect(found.status).toBe(200)
    expect(JSON.stringify(found.body)).toContain(graph.id)

    const board = path.join(root, 'board/.alice/docs')
    fs.mkdirSync(board, { recursive: true })
    fs.writeFileSync(path.join(board, 'D-1-understanding.md'), '---\nid: D-1\ntitle: Fixture understanding\n---\nSee [System graph](D-2-system-graph.md) and Payments detail in D-3.\n')
    fs.writeFileSync(path.join(board, 'D-2-system-graph.md'), `---\nid: D-2\ntitle: Fixture System graph\n---\n${refreshed}`)
    fs.writeFileSync(path.join(board, 'D-3-payments.md'), `---\nid: D-3\ntitle: Payments detail\n---\n${detail.body}`)
    for (const file of fs.readdirSync(board)) {
      const text = fs.readFileSync(path.join(board, file), 'utf8')
      expect(Object.keys(parse(/^---\n([\s\S]*?)\n---/.exec(text)![1])).sort()).toEqual(['id', 'title'])
    }
    expect(fs.readFileSync(path.join(board, 'D-2-system-graph.md'), 'utf8')).toContain('```mermaid')
    for (const [i, repo] of repos.entries()) {
      expect(git(repo, 'status', '--porcelain')).toBe(snapshot[i].status)
      for (const [file, content] of Object.entries(snapshot[i].files)) expect(fs.readFileSync(path.join(repo, file), 'utf8')).toBe(content)
    }
  } finally {
    await app.stop()
  }
})
