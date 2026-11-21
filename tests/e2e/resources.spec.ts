import AxeBuilder from '@axe-core/playwright'
import { createAgent } from '../helpers/client'
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

test('document discovery filters and explains the best match', async ({ app, owner, page }) => {
  const s = stamp()
  const agent = await createAgent(owner, `Knowledge owner ${s}`)
  const project = (await owner.post(`${V1}/projects`, { name: `Knowledge project ${s}` })).body.project
  const current = (await owner.post(`${V1}/documents`, {
    title: `Release guide ${s}`,
    body: 'Deployment procedure',
    tags: [`ops-${s}`],
    searchKeywords: [`go-live-${s}`],
    ownerId: agent.id,
  })).body.document
  await owner.post(`${V1}/documents/${current.id}/links`, { projectId: project.id })
  await owner.post(`${V1}/documents/${current.id}/review`, { expectedRevision: 1, markCurrent: true })
  await owner.post(`${V1}/documents`, {
    title: `Old release guide ${s}`,
    body: 'Older deployment procedure',
    tags: ['legacy'],
    searchKeywords: [`go-live-${s}`],
    status: 'draft',
  })

  await signIn(page, app)
  await page.goto(`${app.url}/search?q=go-live-${s}&kind=document`)
  const target = page.getByRole('listitem').filter({ hasText: `Release guide ${s}` }).first()
  await expect(target).toContainText(`Matched keyword: go-live-${s}`)
  await expect(target).toContainText('Current')
  await expect(target).toContainText(project.name)
  await page.getByLabel('Tag').fill(`ops-${s}`)
  await page.getByLabel('Knowledge status').selectOption('current')
  await page.getByLabel('Knowledge owner').selectOption(agent.id)
  await page.getByLabel('Linked project').selectOption(project.id)
  await expect(page).toHaveURL(new RegExp(`tag=ops-${s}`))
  await expect(page.getByRole('link', { name: `Release guide ${s}` })).toBeVisible()
  await expect(page.getByRole('link', { name: `Old release guide ${s}` })).toHaveCount(0)
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

test('a project plan shows dates, members, milestones and progress, and every change is attributed', async ({ app, owner, page }) => {
  const s = stamp()
  const project = (await owner.post(`${V1}/projects`, { name: `Plan ${s}` })).body.project
  for (const status of ['done', 'ready', 'ready', 'canceled']) await owner.post(`${V1}/tasks`, { title: `Plan task ${status} ${s}`, status, projectId: project.id })
  const { createAgent } = await import('../helpers/client')
  const agent = await createAgent(owner, `Plan Bot ${s}`)
  await signIn(page, app)
  await page.goto(`${app.url}/projects/${project.id}`)
  const plan = page.getByRole('region', { name: 'Plan', exact: true })
  await expect(plan.getByRole('progressbar')).toHaveAttribute('aria-valuetext', '1 of 3 tasks done')
  await expect(plan).toContainText('33%')

  await page.getByRole('button', { name: 'Edit' }).click()
  await page.getByLabel('Start date').fill('2026-03-01')
  await page.getByLabel('Target date').fill('2026-04-30')
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(plan).toContainText(/Mar 1, 2026|1 Mar 2026/)
  expect((await owner.get(`${V1}/projects/${project.id}`)).body.project).toMatchObject({ startDate: '2026-03-01', targetDate: '2026-04-30' })

  await page.getByRole('button', { name: /^0 members$/ }).click()
  const members = page.getByRole('dialog', { name: 'Project members' })
  await members.getByLabel('Add a person or agent').selectOption({ label: `Plan Bot ${s} (agent)` })
  await members.getByRole('button', { name: 'Add' }).click()
  await expect(members.getByRole('list', { name: 'Members' })).toContainText(`Plan Bot ${s}`)
  await page.keyboard.press('Escape')
  await expect(page.getByRole('button', { name: '1 member' })).toBeVisible()

  const milestones = plan.getByRole('form', { name: 'Add a milestone' })
  await milestones.getByLabel('Milestone').fill('Design review')
  await milestones.getByLabel('Due date').fill('2026-03-15')
  await milestones.getByRole('button', { name: 'Add milestone' }).click()
  await plan.getByLabel('Complete milestone Design review').check()
  await expect(plan.getByRole('list', { name: 'Milestones' }).getByText('Done', { exact: true })).toBeVisible()
  void agent

  await page.getByRole('tab', { name: 'Activity' }).click()
  const activity = page.getByRole('tabpanel')
  await expect(activity).toContainText(`added Plan Bot ${s} to the project`)
  await expect(activity).toContainText('completed milestone “Design review”')
  await expect(activity).toContainText('changed start date from none to')
})
