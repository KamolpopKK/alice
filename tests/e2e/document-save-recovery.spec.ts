import type { Page, Request } from '@playwright/test'
import { expect, signIn, test } from './fixtures'

/** Interrupted Create/Edit saves: no duplicate documents, no lost drafts, link recovery, minimal updates. */
const V1 = '/client/v1'
const stamp = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 5)
type Owner = { get: (p: string) => Promise<{ body: any }>; post: (p: string, b: unknown) => Promise<{ body: any }> }

async function documentsTitled(owner: Owner, title: string) {
  return ((await owner.get(`${V1}/documents?archived=all&limit=200&q=${encodeURIComponent(title)}`)).body.items as Array<{ id: string; title: string }>).filter((d) => d.title === title)
}

async function fillNew(page: Page, title: string, body: string) {
  await page.getByLabel('Document title').fill(title)
  await page.getByRole('radio', { name: 'Markdown' }).click()
  await page.getByLabel('Body', { exact: true }).fill(body)
}

test('an uncertain create keeps the text and a second press finishes it without a second copy', async ({ app, owner, page }) => {
  const title = `Uncertain ${stamp()}`
  await signIn(page, app)
  await page.goto(`${app.url}/documents/new`)
  await fillNew(page, title, 'Saved once\n')
  // คำขอแรกถึง server (สร้างเอกสารแล้ว) แต่คำตอบหาย; client retry อีก 2 ครั้งก็ขาด
  const keys: string[] = []
  let cut = 3
  await page.route(`**${V1}/documents`, async (route) => {
    if (route.request().method() !== 'POST') return route.fallback()
    keys.push(route.request().headers()['idempotency-key'])
    if (cut-- > 0) {
      if (keys.length === 1) await route.fetch()
      return route.abort('failed')
    }
    return route.fallback()
  })
  await page.getByRole('button', { name: 'Create document' }).click()
  await expect(page.getByText('Alice could not confirm the save. Your text is still here')).toBeVisible()
  await expect(page.getByLabel('Body', { exact: true })).toHaveValue('Saved once\n')
  expect(await documentsTitled(owner, title)).toHaveLength(1)

  await page.getByRole('button', { name: 'Create document' }).click()
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible()
  expect(new Set(keys).size).toBe(1)
  expect(keys).toHaveLength(4)
  const docs = await documentsTitled(owner, title)
  expect(docs).toHaveLength(1)
  expect(page.url()).toContain(`/documents/${docs[0].id}`)
})

test('a failed link says the document exists, and Retry link finishes it without recreating it', async ({ app, owner, page }) => {
  const task = (await owner.post(`${V1}/tasks`, { title: `Link target ${stamp()}` })).body.task
  const title = `Half saved ${stamp()}`
  await signIn(page, app)
  await page.goto(`${app.url}/documents/new?taskId=${task.id}&returnTo=${encodeURIComponent(`/tasks/${task.id}`)}`)
  await fillNew(page, title, 'Needs a link\n')
  await page.route('**/documents/*/links', (route) => (route.request().method() === 'POST' ? route.abort('failed') : route.fallback()))
  await page.getByRole('button', { name: 'Create document' }).click()
  await expect(page.getByText('The document was created but is not linked yet')).toBeVisible()
  await expect(page.getByText(`It still needs to be linked to the task “${task.title}”.`)).toBeVisible()
  const [doc] = await documentsTitled(owner, title)
  await expect(page).toHaveURL(new RegExp(`/documents/${doc.id}/edit`))
  expect((await owner.get(`${V1}/documents/${doc.id}`)).body.document.links.tasks).toEqual([])

  await page.unroute('**/documents/*/links')
  await page.getByRole('button', { name: 'Retry link' }).click()
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible()
  expect((await owner.get(`${V1}/documents/${doc.id}`)).body.document.links.tasks.map((t: { id: string }) => t.id)).toEqual([task.id])
  expect(await documentsTitled(owner, title)).toHaveLength(1)
})

test('a rejected save keeps the draft, and fixing it creates exactly one document', async ({ app, owner, page }) => {
  const title = `Rejected ${stamp()}`
  await signIn(page, app)
  await page.goto(`${app.url}/documents/new`)
  await page.getByLabel('Document title').fill(title)
  await page.getByRole('textbox', { name: 'Tags' }).fill('keep-me')
  await page.getByRole('button', { name: 'Create document' }).click()
  await expect(page.getByText(/needs a body, a source URL, or both/i).last()).toBeVisible()
  await expect(page.getByLabel('Document title')).toHaveValue(title)
  expect(await documentsTitled(owner, title)).toHaveLength(0)
  await page.getByLabel('Source URL (optional)').fill('https://example.com/source')
  await page.getByRole('button', { name: 'Create document' }).click()
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible()
  expect(await documentsTitled(owner, title)).toHaveLength(1)
})

test('edits send only what changed, so revisions and reviews behave as before', async ({ app, owner, page }) => {
  const doc = (await owner.post(`${V1}/documents`, { title: `Patch ${stamp()}`, body: 'Original\n', tags: ['a'] })).body.document
  const patches: unknown[] = []
  page.on('request', (r: Request) => {
    if (r.method() === 'PATCH' && r.url().endsWith(`/documents/${doc.id}`)) patches.push(r.postDataJSON())
  })
  await signIn(page, app)
  await page.goto(`${app.url}/documents/${doc.id}/edit`)
  await page.getByRole('textbox', { name: 'Tags' }).fill('b')
  await expect(page.getByText('Metadata-only changes keep the current content revision and review.')).toBeVisible()
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByRole('heading', { level: 1, name: doc.title })).toBeVisible()
  await expect.poll(() => patches.length).toBe(1)
  expect(Object.keys(patches[0] as object)).toEqual(['tags'])
  expect((await owner.get(`${V1}/documents/${doc.id}`)).body.document.revision).toBe(doc.revision)

  await page.getByRole('button', { name: 'Edit', exact: true }).click()
  await page.getByRole('radio', { name: 'Markdown' }).click()
  await page.getByLabel('Body', { exact: true }).fill('Changed\n')
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByRole('heading', { level: 1, name: doc.title })).toBeVisible()
  await expect.poll(() => patches.length).toBe(2)
  expect(patches[1]).toEqual({ body: 'Changed\n' })
  expect((await owner.get(`${V1}/documents/${doc.id}`)).body.document.revision).toBe(doc.revision + 1)
})
