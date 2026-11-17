import { expect, signIn, test } from './fixtures'

test('Markdown from any actor cannot execute script in the dashboard', async ({ app, owner, page }) => {
  const payload = [
    '<script>window.__xss = 1</script>',
    '<img src=x onerror="window.__xss = 2">',
    '[click me](javascript:window.__xss=3)',
    '<a href="javascript:window.__xss=4">raw link</a>',
    '**bold still works**',
  ].join('\n\n')
  const task = (await owner.post('/api/tasks', { title: 'XSS probe', description: payload })).body.task
  await owner.post(`/api/tasks/${task.id}/comments`, { body: payload })
  const doc = (await owner.post('/api/documents', { title: 'XSS doc', body: payload })).body.document
  const dialogs: string[] = []
  page.on('dialog', (d) => {
    dialogs.push(d.message())
    void d.dismiss()
  })
  await signIn(page, app)
  for (const url of [`/tasks/${task.id}`, `/documents/${doc.id}`]) {
    await page.goto(app.url + url)
    await expect(page.locator('strong', { hasText: 'bold still works' }).first()).toBeVisible()
    const link = page.getByRole('link', { name: 'click me' }).first()
    if (await link.count()) {
      expect(await link.getAttribute('href')).not.toMatch(/^javascript:/i)
      await link.click({ modifiers: ['Meta'] }).catch(() => {})
    }
    expect(await page.locator('.markdown script, .markdown img[onerror], .markdown a[href^="javascript"]').count()).toBe(0)
    expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined()
  }
  expect(dialogs).toEqual([])
})
