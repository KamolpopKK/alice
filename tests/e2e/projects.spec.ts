import { expect, signIn, test } from './fixtures'

test('member creates, edits, archives and restores a project', async ({ app, owner: _owner, page }) => {
  await signIn(page, app)
  await page.getByRole('link', { name: 'Projects' }).click()
  await expect(page.getByRole('link', { name: 'Untitled' })).toBeVisible()

  await page.getByRole('button', { name: 'New project' }).click()
  await page.getByLabel('Project name').fill('Launch site')
  await page.getByLabel('Description (Markdown)').fill('## Goal\n\nShip **v1**')
  await page.getByLabel('Labels').fill('web, launch')
  await page.getByRole('button', { name: 'Create project' }).click()
  await expect(page.getByRole('heading', { name: 'Launch site' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Goal' })).toBeVisible()
  await expect(page.locator('strong', { hasText: 'v1' })).toBeVisible()

  await page.getByRole('button', { name: 'Edit' }).click()
  await page.getByLabel('Project name').fill('Launch website')
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByRole('heading', { name: 'Launch website' })).toBeVisible()

  await page.getByRole('button', { name: 'Archive' }).click()
  await expect(page.getByText('archived', { exact: true })).toBeVisible()
  await page.getByRole('link', { name: 'Projects' }).click()
  await expect(page.getByRole('link', { name: 'Launch website' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Show archived' }).click()
  await page.getByRole('link', { name: 'Launch website' }).click()
  await page.getByRole('button', { name: 'Restore' }).click()
  await expect(page.getByRole('button', { name: 'Archive' })).toBeVisible()
})

test('the Untitled project cannot be renamed or archived from the UI', async ({ app, owner: _owner, page }) => {
  await signIn(page, app)
  await page.goto(`${app.url}/projects`)
  await page.getByRole('link', { name: 'Untitled' }).click()
  await expect(page.getByRole('button', { name: 'Archive' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Edit' }).click()
  await expect(page.getByLabel('Project name')).toBeDisabled()
})
