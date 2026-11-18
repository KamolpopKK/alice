import AxeBuilder from '@axe-core/playwright'
import { expect, signIn, test } from './fixtures'

/** Projects, Documents and Search on Alice UI: tabs, free links, shared result language, states. */
const V1 = '/client/v1'
const stamp = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 5)

test('Project Detail has Overview, Tasks, Documents and Activity tabs that deep-link', async ({ app, owner, page }) => {
  const s = stamp()
  const project = (await owner.post(`${V1}/projects`, { name: `Tabs ${s}`, description: 'Ship the **portal**' })).body.project
  await owner.post(`${V1}/tasks`, { title: `Open work ${s}`, projectId: project.id, priority: 'urgent' })
  await owner.post(`${V1}/tasks`, { title: `Finished work ${s}`, projectId: project.id, status: 'done' })
  const doc = (await owner.post(`${V1}/documents`, { title: `Portal brief ${s}`, body: 'Brief' })).body.document
  await owner.post(`${V1}/documents/${doc.id}/links`, { projectId: project.id })
  await owner.patch(`${V1}/projects/${project.id}`, { labels: ['portal'] })
  await signIn(page, app)
  await page.goto(`${app.url}/projects/${project.id}`)
  await expect(page.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true')
  await expect(page.locator('strong', { hasText: 'portal' })).toBeVisible()
  const next = page.getByRole('region', { name: 'Next tasks', exact: true })
  await expect(next.getByRole('link', { name: `Open work ${s}` })).toBeVisible()
  await expect(next.getByRole('link', { name: `Finished work ${s}` })).toHaveCount(0)
  await expect(next).toContainText('1 open · 1 done or canceled')

  await page.getByRole('tab', { name: 'Documents' }).click()
  await expect(page).toHaveURL(/tab=documents/)
  await expect(page.getByRole('tabpanel').getByRole('link', { name: `Portal brief ${s}` })).toBeVisible()
  await page.getByRole('tab', { name: 'Activity' }).click()
  await expect(page.getByRole('tabpanel')).toContainText('Olivia Owner')

  await page.goto(`${app.url}/projects/${project.id}?tab=tasks`)
  await expect(page.getByRole('tab', { name: 'Tasks' })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('link', { name: `Finished work ${s}` })).toBeVisible()
  // ลิงก์ task ในหน้า project พาไปหน้า task เต็ม
  await page.getByRole('link', { name: `Open work ${s}` }).click()
  await expect(page.getByRole('heading', { level: 1, name: `Open work ${s}` })).toBeVisible()
})

test('documents link freely to tasks and projects, and the list filters archived ones', async ({ app, owner, page }) => {
  const s = stamp()
  const task = (await owner.post(`${V1}/tasks`, { title: `Linked task ${s}` })).body.task
  const project = (await owner.post(`${V1}/projects`, { name: `Linked project ${s}` })).body.project
  const doc = (await owner.post(`${V1}/documents`, { title: `Free doc ${s}`, body: 'Body' })).body.document
  await owner.post(`${V1}/documents/${doc.id}/links`, { taskId: task.id })
  await owner.post(`${V1}/documents/${doc.id}/links`, { projectId: project.id })
  const old = (await owner.post(`${V1}/documents`, { title: `Old doc ${s}`, body: 'Old' })).body.document
  await owner.post(`${V1}/documents/${old.id}/archive`, {})
  await signIn(page, app)
  await page.goto(`${app.url}/documents/${doc.id}`)
  const links = page.getByRole('region', { name: 'Linked to' })
  await expect(links.getByRole('link', { name: task.title })).toBeVisible()
  await expect(links.getByRole('link', { name: project.name })).toBeVisible()
  await links.getByRole('button', { name: `Unlink ${project.name}` }).click()
  await expect(links.getByRole('link', { name: project.name })).toHaveCount(0)
  await expect(links.getByRole('link', { name: task.title })).toBeVisible()

  await page.goto(`${app.url}/documents?q=${s}`)
  await expect(page.getByRole('link', { name: `Free doc ${s}` })).toBeVisible()
  await expect(page.getByRole('link', { name: `Old doc ${s}` })).toHaveCount(0)
  await page.getByRole('radio', { name: 'Archived' }).click()
  await expect(page.getByRole('link', { name: `Old doc ${s}` })).toBeVisible()
  await expect(page.getByRole('link', { name: `Free doc ${s}` })).toHaveCount(0)
})

test('quick and full search share result language and open the right resource', async ({ app, owner, page }) => {
  const s = stamp()
  await owner.post(`${V1}/tasks`, { title: `Zebra task ${s}` })
  const doc = (await owner.post(`${V1}/documents`, { title: `Zebra notes ${s}`, body: 'Stripes' })).body.document
  await signIn(page, app)
  await page.keyboard.press('ControlOrMeta+k')
  await page.keyboard.type(`Zebra notes ${s}`)
  await expect(page.getByRole('option', { name: `Zebra notes ${s}, Documents` })).toBeVisible()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(new RegExp(`/documents/${doc.id}$`))

  await page.keyboard.press('ControlOrMeta+k')
  await page.keyboard.type(`Zebra ${s}`)
  await page.getByRole('option', { name: /Search everything for/ }).click()
  await expect(page).toHaveURL(new RegExp(`/search\\?q=Zebra`))
  const results = page.getByRole('list', { name: 'Search results' })
  await expect(results.getByRole('listitem').filter({ hasText: 'Task' }).getByRole('link', { name: `Zebra task ${s}` })).toBeVisible()
  await expect(results.getByRole('listitem').filter({ hasText: 'Document' }).getByRole('link', { name: `Zebra notes ${s}` })).toBeVisible()
  await page.getByLabel('Type').selectOption('document')
  await expect(page).toHaveURL(/kind=document/)
  await expect(results.getByRole('link', { name: `Zebra task ${s}` })).toHaveCount(0)
})

for (const scheme of ['light', 'dark'] as const) {
  test(`Projects, Documents and Search pass axe and reflow at 320 px (${scheme})`, async ({ app, owner, page }) => {
    const s = stamp()
    const project = (await owner.post(`${V1}/projects`, { name: `Axe project ${s}`, description: 'A description' })).body.project
    const doc = (await owner.post(`${V1}/documents`, { title: `Axe doc ${s}`, body: 'Text', sourceUrl: 'https://example.com/a-very-long-source-url-that-should-wrap/on/narrow/screens' })).body.document
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' })
    await signIn(page, app)
    const paths = ['/projects', `/projects/${project.id}`, `/projects/${project.id}?tab=activity`, '/documents', `/documents/${doc.id}`, `/search?q=Axe`]
    for (const path of paths) {
      await page.goto(`${app.url}${path}`)
      await expect(page.locator('#main h1').first()).toBeVisible()
      await page.locator('.ui-skeleton').first().waitFor({ state: 'detached' }).catch(() => undefined)
      const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).include('#main').analyze()
      expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`), path).toEqual([])
    }
    await page.setViewportSize({ width: 320, height: 700 })
    for (const path of paths) {
      await page.goto(`${app.url}${path}`)
      await expect(page.locator('#main h1').first()).toBeVisible()
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), { message: path }).toBe(true)
    }
  })
}
