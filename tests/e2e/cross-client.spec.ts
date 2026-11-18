import { accountButton } from './fixtures'
import fs from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { startApp, type RunningApp } from '../helpers/app'
import { bootstrapOwner, createAgent, OWNER, type HttpClient } from '../helpers/client'
import { alice, buildCli, cliHome, startAlice, type CliEnv } from '../helpers/cli'
import { DesktopProbe, buildProbe, probeAvailable } from '../helpers/desktop-probe'
import { connectMcp } from '../helpers/mcp'

/**
 * The highest seam: one real Alice Server and SQLite database shared by the Web dashboard (a real
 * browser), the Alice CLI (the built artifact as a subprocess), Alice Desktop's real Rust core (network,
 * credentials and event stream) and an MCP agent. No database access and no test-only mutation shortcuts:
 * every change goes through a public client surface.
 */
test.describe.configure({ mode: 'serial' })
test.skip(!probeAvailable(), 'needs the Rust toolchain to drive the real Desktop core')

let app: RunningApp
let owner: HttpClient

test.beforeAll(async () => {
  test.setTimeout(300_000)
  buildProbe()
  await buildCli()
  app = await startApp({ env: { ALICE_LOG_REQUESTS: 'true', ALICE_DEVICE_POLL_INTERVAL: '1' } })
  owner = await bootstrapOwner(app)
})
test.afterAll(async () => {
  await app?.stop()
})

/** Approves a device sign-in exactly as a person would: on the /device page of the Web dashboard. */
async function approveInBrowser(page: Page, userCode: string) {
  await page.goto(`${app.url}/device?code=${userCode}`)
  await expect(page.getByRole('heading', { name: /Allow Alice (CLI|Desktop) to act as you\?/ })).toBeVisible()
  await expect(page.getByText(userCode)).toBeVisible()
  await page.getByRole('button', { name: 'Approve' }).click()
  await expect(page.getByRole('heading', { name: 'Approved' })).toBeVisible()
}

/** Reads through the Web dashboard's own transport (session cookie in the browser). */
const web = (page: Page, p: string) => page.evaluate(async (path) => (await fetch(`/client/v1${path}`, { credentials: 'same-origin' })).json(), p)

test('Web, CLI, Desktop and an MCP agent tell the same story on one board', async ({ page }) => {
  test.setTimeout(180_000)
  const secrets: string[] = []
  const consoleLines: string[] = []
  page.on('console', (m) => consoleLines.push(m.text()))

  // ---- Web: the owner signs in and sets up the project and its reference document
  await page.goto(`${app.url}/login`)
  await page.getByLabel('Username').fill(OWNER.username)
  await page.getByLabel('Password', { exact: true }).fill(OWNER.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(accountButton(page)).toBeVisible()
  await page.goto(`${app.url}/projects`)
  await page.getByRole('button', { name: 'New project' }).click()
  await page.getByLabel('Project name').fill('Launch')
  await page.getByRole('button', { name: 'Create project' }).click()
  await expect(page.getByRole('heading', { name: 'Launch' })).toBeVisible()
  await page.goto(`${app.url}/documents?new=1`)
  await page.getByLabel('Document title').fill('Launch plan')
  await page.getByLabel('Body (Markdown)').fill('Plan v1: email on Monday.')
  await page.getByRole('button', { name: 'Create document' }).click()
  await expect(page.getByText('Revision 1')).toBeVisible()
  const docId = new URL(page.url()).pathname.split('/').pop()!

  // ---- CLI: sign in through the browser, create the ready task and link the document
  const home: CliEnv = cliHome('cross-cli')
  await alice(home, ['profile', 'add', 'work', '--server', app.url])
  const login = await startAlice(home, ['auth', 'login', '--no-browser', '--device-name', 'ci-terminal'])
  const [, cliCode] = await login.waitForStderr(/code ([A-Z]{4}-[A-Z]{4})/)
  await approveInBrowser(page, cliCode)
  expect((await login.done).code).toBe(0)
  const created = await alice(home, ['task', 'create', '--title', 'Ship launch email', '--project', 'Launch', '--status', 'ready', '--description-file', '-', '--json'], { input: 'Write and send the **launch email**.\n' })
  expect(created.code).toBe(0)
  const taskId = JSON.parse(created.stdout).id as string
  expect((await alice(home, ['doc', 'link', docId, '--task', taskId])).code).toBe(0)
  secrets.push(...Object.values(JSON.parse(fs.readFileSync(home.credentialFile, 'utf8')) as Record<string, string>))

  // ---- Desktop (real Rust core): sign in through the browser and follow live events
  const desktop = await DesktopProbe.start()
  try {
    await desktop.send({ cmd: 'add_profile', name: 'work', server: app.url })
    const started = await desktop.send({ cmd: 'login', profile: 'work' })
    await approveInBrowser(page, started.userCode)
    await desktop.waitFor((e) => e.event === 'alice://auth' && e.payload.status === 'signed_in')
    await desktop.send({ cmd: 'subscribe' })
    await desktop.waitFor((e) => e.event === 'alice://events' && e.payload.type === 'ready')

    // ---- Agent (MCP): find claimable work and claim it
    const bot = await createAgent(owner, 'Launch Bot')
    secrets.push(bot.token)
    const mcp = await connectMcp(app.url, bot.token)
    const ready = await mcp.ok('list_tasks', { status: ['ready'], assigneeId: ['none'] })
    expect(ready.items.map((t: { id: string }) => t.id)).toContain(taskId)
    await mcp.ok('claim_task', { id: taskId })
    await desktop.waitFor((e) => e.event === 'alice://events' && e.payload.type === 'invalidate' && e.payload.data.id === taskId && e.payload.data.mutation === 'task.claimed')

    // Desktop drops its stream; the agent keeps working; Desktop resumes from its last position
    const resumeFrom = Math.max(...desktop.invalidations().map((e) => e.position))
    await desktop.send({ cmd: 'unsubscribe' })
    const context = await mcp.ok('get_task_context', { id: taskId })
    expect(context.documents.items.map((d: { id: string; body: string }) => [d.id, d.body])).toEqual([[docId, 'Plan v1: email on Monday.']])
    expect(context.task.description).toBe('Write and send the **launch email**.\n')
    await mcp.ok('add_comment', { taskId, body: 'Drafted the email; sending after review.' })
    await mcp.ok('update_document', { id: docId, body: 'Plan v2: email sent Tuesday 09:00.' })
    await mcp.ok('complete_task', { id: taskId, summary: 'Launch email sent. Plan updated to v2.' })
    await mcp.close()

    const before = desktop.events.length
    await desktop.send({ cmd: 'subscribe', after: resumeFrom })
    await desktop.waitFor((e) => e.event === 'alice://events' && e.payload.type === 'invalidate' && e.payload.data.kind === 'task' && e.payload.data.mutation === 'task.completed')
    const replayed = desktop.events.slice(before).filter((e) => e.event === 'alice://events')
    expect(replayed.some((e) => e.payload.type === 'reset')).toBe(false)
    const mutations = replayed.filter((e) => e.payload.type === 'invalidate').map((e) => `${e.payload.data.kind}:${e.payload.data.mutation}`)
    expect(mutations).toEqual(expect.arrayContaining(['task:comment.added', 'document:document.updated', 'task:task.completed']))

    // ---- Same final state everywhere
    const viaWeb = { task: (await web(page, `/tasks/${taskId}`)).task, activity: (await web(page, `/tasks/${taskId}/activity`)).items, doc: (await web(page, `/documents/${docId}`)).document, comments: (await web(page, `/tasks/${taskId}/comments`)).items }
    const viaCli = {
      task: JSON.parse((await alice(home, ['task', 'show', taskId, '--json'])).stdout),
      activity: JSON.parse((await alice(home, ['task', 'activity', taskId, '--json'])).stdout),
      doc: JSON.parse((await alice(home, ['doc', 'show', docId, '--json'])).stdout),
      comments: JSON.parse((await alice(home, ['task', 'comments', taskId, '--json'])).stdout),
    }
    const viaDesktop = {
      task: (await desktop.request('GET', `/tasks/${taskId}`)).data.task,
      activity: (await desktop.request('GET', `/tasks/${taskId}/activity`)).data.items,
      doc: (await desktop.request('GET', `/documents/${docId}`)).data.document,
      comments: (await desktop.request('GET', `/tasks/${taskId}/comments`)).data.items,
    }
    const agentView = await connectMcp(app.url, bot.token)
    const viaMcp = { task: (await agentView.ok('get_task', { id: taskId })).task, doc: (await agentView.ok('get_document', { id: docId })).document }
    await agentView.close()

    for (const view of [viaCli, viaDesktop]) {
      expect(view.task).toEqual(viaWeb.task)
      expect(view.activity).toEqual(viaWeb.activity)
      expect(view.doc).toEqual(viaWeb.doc)
      expect(view.comments).toEqual(viaWeb.comments)
    }
    expect(viaMcp.task).toEqual(viaWeb.task)
    expect(viaMcp.doc.revision).toBe(viaWeb.doc.revision)

    const task = viaWeb.task
    expect(task).toMatchObject({ status: 'done', assignee: { displayName: 'Launch Bot', kind: 'agent' }, createdBy: { displayName: OWNER.displayName, kind: 'human' }, project: { name: 'Launch' } })
    expect(task.completedAt).toEqual(expect.any(String))
    expect(viaWeb.doc).toMatchObject({ revision: 2, body: 'Plan v2: email sent Tuesday 09:00.', updatedBy: { kind: 'agent' } })
    expect(viaWeb.comments.map((c: { kind: string; author: { kind: string } }) => [c.kind, c.author.kind])).toEqual([
      ['comment', 'agent'],
      ['completion_summary', 'agent'],
    ])
    // newest first: the agent's completion, comment and claim after the human's CLI creation and link
    expect(viaWeb.activity.map((e: { verb: string; actor: { kind: string } }) => [e.verb, e.actor.kind])).toEqual([
      ['task.completed', 'agent'],
      ['comment.added', 'agent'],
      ['task.claimed', 'agent'],
      ['document.linked', 'human'],
      ['task.created', 'human'],
    ])

    // ---- The Web UI shows it without a reload-only workaround
    await page.goto(`${app.url}/tasks/${taskId}`)
    await expect(page.getByRole('heading', { name: 'Ship launch email' })).toBeVisible()
    await expect(page.getByText('Launch email sent. Plan updated to v2.')).toBeVisible()
    await expect(page.getByLabel('Status')).toHaveValue('done')

    // ---- Nothing secret or private leaked into logs or client output
    const logs = app.output() + desktop.stdout.join('\n') + consoleLines.join('\n') + login.stderrText() + login.stdoutText()
    for (const secret of secrets) expect(logs).not.toContain(secret)
    expect(logs).not.toMatch(/alice_c[ar]_[0-9a-z]{10}/)
    for (const privateText of ['Plan v2: email sent', 'Drafted the email', 'launch email**']) expect(app.output()).not.toContain(privateText)
    expect(app.output()).toMatch(/"clientSession":"cls_/)
  } finally {
    desktop.stop()
  }
})
