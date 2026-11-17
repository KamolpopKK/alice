import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import AxeBuilder from '@axe-core/playwright'
import { FakeNativeCore } from './desktop-bridge'
import { expect, test } from './fixtures'
import { SERVER_COMMAND, localEnv, localHome, stopLocalDaemons, waitFor } from '../helpers/local'
import { listWorkspaces } from '../../src/local/registry'
import { readLocator } from '../../src/local/locator'
import { isProcessAlive, workspacePaths } from '../../src/local/paths'

/**
 * Primary journey: clean install → onboarding → first task in a Task Pad →
 * Desktop closed → Codex works through the terminal CLI (daemon auto-starts) → Desktop reopens and
 * shows the same tasks with Codex attribution. Screenshots are kept as release evidence.
 */
const REPO = path.resolve(import.meta.dirname, '../..')
const EVIDENCE = path.join(REPO, 'test-results', 'local-journey')
test.afterAll(stopLocalDaemons)

/** The person's own terminal: same computer account (app data, keychain, home), its own CLI state. */
function terminal(home: string, args: string[]) {
  const env = {
    ...localEnv(home),
    HOME: path.join(home, 'user-home'),
    ALICE_CONFIG_DIR: path.join(home, 'terminal-cli'),
    ALICE_RUNTIME_COMMAND: JSON.stringify(SERVER_COMMAND),
  }
  const res = spawnSync(process.execPath, ['--import', 'tsx', path.join(REPO, 'src/cli/index.ts'), ...args], { env, encoding: 'utf8', cwd: REPO })
  return { code: res.status, stdout: res.stdout, stderr: res.stderr, json: () => JSON.parse(res.stdout) }
}

test('install to first task, Codex works with Desktop closed, Desktop shows its work', async ({ app, browser }) => {
  fs.mkdirSync(EVIDENCE, { recursive: true })
  const home = localHome()

  // 1. first launch: no server, URL, password or MCP
  const ctx1 = await browser.newContext({ viewport: { width: 1100, height: 760 } })
  const page1 = await ctx1.newPage()
  const desktop1 = await FakeNativeCore.attach(page1, { localHome: home })
  await page1.goto(app.url)
  await expect(page1.getByRole('heading', { name: 'Welcome to Alice' })).toBeVisible()
  await page1.screenshot({ path: path.join(EVIDENCE, '01-onboarding.png') })
  await page1.getByLabel('Your name').fill('Kim')
  await page1.getByRole('button', { name: 'Continue' }).click()
  await page1.getByRole('checkbox', { name: /Claude Code/ }).uncheck()
  await page1.screenshot({ path: path.join(EVIDENCE, '02-tools-consent.png') })
  await page1.getByRole('button', { name: 'Open my Task Pad' }).click()
  const line = page1.getByRole('textbox', { name: 'New task' }).first()
  // onboarding ติดตั้ง CLI + skill ก่อนเปิด Task Pad: บน CI ใช้เกิน 5 วินาทีได้
  await expect(line).toBeFocused({ timeout: 20_000 })
  await page1.keyboard.type('Write the release notes')
  await page1.keyboard.press('Enter')
  await page1.screenshot({ path: path.join(EVIDENCE, '03-first-task.png') })
  const ws = listWorkspaces(home)[0]
  expect(ws).toMatchObject({ name: 'Personal', alias: 'personal' })

  // 2. close Desktop and stop its daemon: the terminal must start Local Alice on its own
  await ctx1.close()
  const pid = readLocator(workspacePaths(home, ws.id).locator)!.pid
  process.kill(pid, 'SIGTERM')
  await waitFor(() => !isProcessAlive(pid))
  void desktop1

  const listed = terminal(home, ['--as', 'codex', 'task', 'list', '--json'])
  expect(listed.code, listed.stderr).toBe(0)
  expect(listed.stderr).toContain('Starting Local workspace "personal"')
  expect(listed.json()).toMatchObject({ ok: true, workspace: { id: ws.id, kind: 'local' } })
  const first = listed.json().data.find((t: { title: string }) => t.title === 'Write the release notes')
  expect(first).toBeTruthy()
  expect(terminal(home, ['task', 'update', first.id, '--status', 'ready']).code).toBe(0)
  expect(terminal(home, ['--as', 'codex', 'task', 'claim', first.id, '--json']).json().data.assignee.displayName).toBe('Codex')
  const created = terminal(home, ['--as', 'codex', 'task', 'create', '--title', 'Check the changelog links', '--json']).json().data
  expect(terminal(home, ['--as', 'codex', 'task', 'complete', first.id, '--summary', 'Release notes drafted in CHANGELOG.md'], ).code).toBe(0)

  // 3. reopen Desktop on the same computer account: same authoritative tasks, Codex attribution
  const ctx2 = await browser.newContext({ viewport: { width: 1100, height: 760 } })
  const page2 = await ctx2.newPage()
  const desktop2 = await FakeNativeCore.attach(page2, { localHome: home })
  desktop2.active = ws.id // Desktop keeps its own active workspace across launches
  await page2.goto(`${app.url}/tasks/${first.id}`)
  await expect(page2.getByRole('heading', { name: 'Write the release notes' })).toBeVisible()
  await expect(page2.getByText('Release notes drafted in CHANGELOG.md')).toBeVisible()
  await expect(page2.locator('main')).toContainText('Codex')
  // Local ไม่มีหน้าของ Remote server
  for (const name of ['Devices', 'For agent', 'Admin']) await expect(page2.getByRole('navigation', { name: 'Main' }).getByRole('link', { name })).toHaveCount(0)
  await expect(page2.getByRole('button', { name: 'Sign out' })).toHaveCount(0)
  await page2.screenshot({ path: path.join(EVIDENCE, '04-codex-attribution.png'), fullPage: true })
  await page2.goto(`${app.url}/tasks/${created.id}`)
  await expect(page2.getByRole('heading', { name: 'Check the changelog links' })).toBeVisible()
  await expect(page2.locator('main')).toContainText('Codex')
  const axe = await new AxeBuilder({ page: page2 }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()
  expect(axe.violations.map((v) => v.id)).toEqual([])

  // 4. a second Local workspace and a Remote server stay separate
  await page2.getByRole('button', { name: 'Switch workspace' }).click()
  await page2.screenshot({ path: path.join(EVIDENCE, '05-workspace-switcher.png'), fullPage: true })
  await page2.getByLabel('New Local workspace').fill('Side')
  await page2.keyboard.press('Enter')
  await expect(page2.getByRole('region', { name: 'Workspace', exact: true })).toContainText('Side')
  const side = terminal(home, ['task', 'list', '--workspace', 'side', '--json']).json()
  expect(side.data).toEqual([])
  expect(terminal(home, ['--as', 'codex', 'task', 'list', '--workspace', 'side', '--json']).json().ok).toBe(true)
  await ctx2.close()
})
