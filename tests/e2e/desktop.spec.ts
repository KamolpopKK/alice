import http from 'node:http'
import { FakeNativeCore } from './desktop-bridge'
import { expect, test } from './fixtures'

test.describe('Alice Desktop UI (production build in a native-bridge harness)', () => {
  test('adds a profile, signs in through the browser and keeps credentials out of the WebView', async ({ app, owner, page }) => {
    const native = await FakeNativeCore.attach(page)
    await page.goto(app.url)
    await expect(page.getByRole('heading', { name: 'Alice servers' })).toBeVisible()

    await page.getByLabel('Profile name').fill('prod')
    await page.getByLabel('Server URL').fill('http://alice.example.com')
    await page.getByRole('button', { name: 'Add server' }).click()
    await expect(page.getByRole('alert')).toContainText('Refusing plain HTTP')

    await page.getByLabel('Server URL').fill(app.url)
    await page.getByLabel('Profile name').fill('work')
    await page.getByRole('button', { name: 'Add server' }).click()
    await expect(page.getByRole('heading', { name: 'Sign in to work' })).toBeVisible()
    await expect(page.getByRole('region', { name: 'Server profile' })).toContainText(app.url)
    await expect(page.getByText('Unencrypted HTTP — development only')).toBeVisible()

    await page.getByRole('button', { name: 'Sign in with browser' }).click()
    await expect(page.getByLabel('Sign-in code')).toHaveText(/^[A-Z]{4}-[A-Z]{4}$/)
    expect(native.opened.at(-1)).toContain('/device?code=')
    const approved = await owner.post('/client/v1/device/approve', { userCode: native.pendingUserCode })
    expect(approved.status).toBe(200)

    await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible()
    await page.goto(`${app.url}/tasks/new`)
    await page.getByLabel('Title').fill('Made in Desktop')
    await page.getByRole('button', { name: 'Create task' }).click()
    await expect(page.getByRole('heading', { name: 'Made in Desktop' })).toBeVisible()
    const tasks = (await owner.get('/client/v1/tasks?q=Desktop')).body.items
    expect(tasks[0].createdBy).toMatchObject({ kind: 'human', displayName: 'Olivia Owner' })

    // credential อยู่ใน native layer เท่านั้น: ไม่มีใน storage, cookie หรือ DOM ของ WebView
    const exposed = await page.evaluate(async () => {
      const dbs = (await indexedDB.databases?.()) ?? []
      return JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage }, cookie: document.cookie, dbs, html: document.documentElement.outerHTML })
    })
    for (const secret of native.secrets()) expect(exposed).not.toContain(secret)
    expect(exposed).not.toMatch(/alice_c[ar]_/)
    expect(native.calls).not.toContain('plugin:http|fetch')
  })
})

test('incompatible and unreachable servers block the UI with an explanation', async ({ app, page }) => {
  const native = await FakeNativeCore.attach(page)
  const future = http.createServer((_req, res) => {
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ product: 'alice', name: 'Alice', serverVersion: '9.0.0', publicUrl: 'x', clientApi: { current: 3, minimum: 3, prefix: '/client/v3' }, capabilities: [], events: { retentionHours: 1, maxReplay: 1 } }))
  })
  await new Promise<void>((r) => future.listen(0, '127.0.0.1', r))
  const port = (future.address() as { port: number }).port
  native.profiles.push({ name: 'future', server: `http://127.0.0.1:${port}`, insecure: true, createdAt: '', session: null })
  native.active = 'future'
  await page.goto(app.url)
  await expect(page.getByRole('heading', { name: 'Update Alice Desktop' })).toBeVisible()
  await expect(page.getByText('supports Client API v3–v3')).toBeVisible()
  future.close()

  // server ตัวเดิมปิดไปแล้ว → เพิ่ม profile ใหม่ชี้ไปที่ port นั้น (profile ใหม่จะ active ทันที)
  await page.getByRole('button', { name: 'Switch server' }).click()
  await page.getByLabel('Profile name').fill('down')
  await page.getByLabel('Server URL').fill(`http://127.0.0.1:${port}`)
  await page.getByRole('button', { name: 'Add server' }).click()
  await expect(page.getByRole('listitem').filter({ hasText: 'down' })).toContainText('active')
  await page.getByRole('button', { name: 'Done' }).click()
  await expect(page.getByRole('heading', { name: 'Cannot reach the server' })).toBeVisible()
  await expect(page.getByText('keeps no offline copy')).toBeVisible()
})

test('external links open through the native opener and revocation returns to sign-in', async ({ app, owner, page }) => {
  const native = await FakeNativeCore.attach(page)
  const doc = (await owner.post('/client/v1/documents', { title: 'Spec link', sourceUrl: 'https://example.com/spec', body: 'See [the spec](https://example.com/spec).' })).body.document
  await page.goto(app.url)
  await page.getByLabel('Profile name').fill('work')
  await page.getByLabel('Server URL').fill(app.url)
  await page.getByRole('button', { name: 'Add server' }).click()
  await page.getByRole('button', { name: 'Sign in with browser' }).click()
  await expect(page.getByLabel('Sign-in code')).toBeVisible()
  await owner.post('/client/v1/device/approve', { userCode: native.pendingUserCode })
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible()

  await page.goto(`${app.url}/documents/${doc.id}`)
  await page.getByRole('link', { name: 'the spec' }).click()
  await expect.poll(() => native.opened).toContain('https://example.com/spec')
  expect(new URL(page.url()).pathname).toBe(`/documents/${doc.id}`)

  const session = native.profiles[0].session!.id
  await owner.post(`/client/v1/client-sessions/${session}/revoke`)
  await page.goto(`${app.url}/list`)
  await expect(page.getByRole('heading', { name: 'Sign in to work' })).toBeVisible()
})

async function signedInDesktop(app: { url: string }, owner: import('../helpers/client').HttpClient, page: import('@playwright/test').Page) {
  const native = await FakeNativeCore.attach(page)
  await page.goto(app.url)
  await page.getByLabel('Profile name').fill('work')
  await page.getByLabel('Server URL').fill(app.url)
  await page.getByRole('button', { name: 'Add server' }).click()
  await page.getByRole('button', { name: 'Sign in with browser' }).click()
  await expect(page.getByLabel('Sign-in code')).toBeVisible()
  await owner.post('/client/v1/device/approve', { userCode: native.pendingUserCode })
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible()
  return native
}

test('Desktop runs the human workflow and sees agent and other-client changes live', async ({ app, owner, page }) => {
  const { createAgent } = await import('../helpers/client')
  const { connectMcp } = await import('../helpers/mcp')
  await signedInDesktop(app, owner, page)
  await expect(page.getByText('Live updates on')).toBeAttached()

  await page.goto(`${app.url}/projects`)
  await page.getByRole('button', { name: 'New project' }).click()
  await page.getByLabel('Project name').fill('Desktop project')
  await page.getByRole('button', { name: 'Create project' }).click()
  await expect(page.getByRole('heading', { name: 'Desktop project' })).toBeVisible()

  await page.goto(`${app.url}/tasks/new`)
  await page.getByLabel('Title').fill('Desktop task')
  await page.getByLabel('Project').selectOption({ label: 'Desktop project' })
  await page.getByLabel('Status').selectOption('ready')
  await page.getByRole('button', { name: 'Create task' }).click()
  await expect(page.getByRole('heading', { name: 'Desktop task' })).toBeVisible()
  const taskId = new URL(page.url()).pathname.split('/').pop()!
  await page.getByLabel('Add a comment').fill('Written in Desktop')
  await page.getByRole('button', { name: 'Comment' }).click()
  await expect(page.getByText('Written in Desktop')).toBeVisible()

  // agent ทำงานผ่าน MCP → Desktop เห็นเองโดยไม่ reload
  const agent = await createAgent(owner, 'Live Bot')
  const mcp = await connectMcp(app.url, agent.token)
  await mcp.ok('claim_task', { id: taskId })
  await mcp.ok('add_comment', { taskId, body: 'Agent on it' })
  await expect(page.getByText('Agent on it')).toBeVisible()
  await expect(page.getByLabel('Status')).toHaveValue('in_progress')
  await mcp.ok('complete_task', { id: taskId, summary: 'Done by the agent' })
  await expect(page.getByText('Done by the agent')).toBeVisible()
  await mcp.close()

  // การแก้จาก client อื่น (เว็บ/CLI ใช้ Client API เดียวกัน) ก็มาถึงเช่นกัน
  await owner.patch(`/client/v1/tasks/${taskId}`, { title: 'Renamed elsewhere' })
  await expect(page.getByRole('heading', { name: 'Renamed elsewhere' })).toBeVisible()
  const activity = (await owner.get(`/client/v1/tasks/${taskId}/activity`)).body.items
  expect(activity.find((e: { verb: string }) => e.verb === 'task.created').actor.displayName).toBe('Olivia Owner')
})

test('a disconnected Desktop labels stale state, refuses writes without queueing and keeps drafts', async ({ app, owner, page }) => {
  const native = await signedInDesktop(app, owner, page)
  const task = (await owner.post('/client/v1/tasks', { title: 'Offline draft target' })).body.task
  await page.goto(`${app.url}/tasks/${task.id}`)
  await expect(page.getByRole('heading', { name: 'Offline draft target' })).toBeVisible()

  await native.goOffline()
  await expect(page.getByText('Disconnected from the server.')).toBeVisible()
  await page.getByLabel('Add a comment').fill('Typed while offline')
  await page.getByRole('button', { name: 'Comment' }).click()
  await expect(page.getByText('nothing was saved')).toBeVisible()
  await expect(page.getByLabel('Add a comment')).toHaveValue('Typed while offline')
  expect((await owner.get(`/client/v1/tasks/${task.id}/comments`)).body.items).toHaveLength(0)

  native.goOnline()
  await expect(page.getByText('Disconnected from the server.')).toBeHidden()
  await page.getByRole('button', { name: 'Comment' }).click()
  await expect(page.getByText('Typed while offline')).toBeVisible()
  // ส่งครั้งเดียว ไม่มีของค้างที่ถูกส่งซ้ำ
  await expect.poll(async () => (await owner.get(`/client/v1/tasks/${task.id}/comments`)).body.items.length).toBe(1)
})

test('deep links open the named profile and resource, warm and cold, and never substitute a profile', async ({ app, owner, page }) => {
  const native = await signedInDesktop(app, owner, page)
  const task = (await owner.post('/client/v1/tasks', { title: 'Linked from the terminal' })).body.task
  const doc = (await owner.post('/client/v1/documents', { title: 'Linked doc', body: 'x' })).body.document

  // warm: แอปเปิดอยู่แล้ว
  expect(await native.deliverDeepLink(`alice://open/task/${task.id}?profile=work`)).toBe('accepted')
  await expect(page.getByRole('heading', { name: 'Linked from the terminal' })).toBeVisible()
  expect(new URL(page.url()).pathname).toBe(`/tasks/${task.id}`)

  // ลิงก์ผิดรูปแบบ / profile ที่ไม่รู้จัก → ไม่ navigate และไม่ใช้ profile ที่ active แทน
  expect(await native.deliverDeepLink(`alice://open/task/${task.id}?profile=work&server=https://evil.example`)).toBe('rejected')
  await expect(page.getByRole('alert').filter({ hasText: 'not a valid Alice link' })).toBeVisible()
  expect(await native.deliverDeepLink(`alice://open/document/${doc.id}?profile=personal`)).toBe('unknown_profile')
  await expect(page.getByRole('alert').filter({ hasText: '"personal"' })).toBeVisible()
  expect(new URL(page.url()).pathname).toBe(`/tasks/${task.id}`)
  expect(native.active).toBe('work')

  // cold: แอปถูกเปิดใหม่จากลิงก์ (credential ยังอยู่ใน native store)
  native.pendingLink = { profile: 'work', kind: 'document', id: doc.id }
  await page.goto(app.url)
  await expect(page.getByRole('heading', { name: 'Linked doc' })).toBeVisible()
  expect(new URL(page.url()).pathname).toBe(`/documents/${doc.id}`)
})

test('a link for a signed-out profile switches profile and signs in before showing the resource', async ({ app, owner, page }) => {
  const native = await signedInDesktop(app, owner, page)
  const task = (await owner.post('/client/v1/tasks', { title: 'Needs the second profile' })).body.task
  native.profiles.push({ name: 'second', server: app.url, insecure: true, createdAt: '', session: null })

  expect(await native.deliverDeepLink(`alice://open/task/${task.id}?profile=second`)).toBe('accepted')
  await expect(page.getByRole('heading', { name: 'Sign in to second' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Needs the second profile' })).toBeHidden()
  await page.getByRole('button', { name: 'Sign in with browser' }).click()
  await expect(page.getByLabel('Sign-in code')).toBeVisible()
  await owner.post('/client/v1/device/approve', { userCode: native.pendingUserCode })
  await expect(page.getByRole('heading', { name: 'Needs the second profile' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Server profile' })).toContainText('second')
})
