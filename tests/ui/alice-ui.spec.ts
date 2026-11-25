import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'

/**
 * Alice UI through its external seam, the built Storybook: every story in both themes passes axe
 * WCAG 2.2 AA and reflows at 320 px; overlays and composite widgets behave by keyboard.
 */
const index = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, '../../storybook-static/index.json'), 'utf8')) as {
  entries: Record<string, { id: string; type: string; title: string; name: string }>
}
const stories = Object.values(index.entries).filter((e) => e.type === 'story')
// overlay ที่เปิดค้าง (Dialog/Sheet) ตรวจแยก: content อยู่ใน portal และ inert ทั้งหน้าโดยตั้งใจ
const MODAL_OPEN = new Set(['alice-ui-overlays--dialog-open', 'alice-ui-overlays--sheet-open', 'alice-ui-overlays--viewport-dialog-open'])

async function openStory(page: Page, id: string, theme: 'light' | 'dark') {
  await page.goto(`/iframe.html?id=${id}&viewMode=story&globals=theme:${theme}`)
  await page.locator('#storybook-root > *').first().waitFor()
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
}

const axe = (page: Page) => new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])

/** addon-a11y ของ Storybook รัน axe เองหลัง render: ถ้าชนกัน ให้รอแล้วรันใหม่ */
async function analyze(builder: AxeBuilder) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await builder.analyze()
    } catch (error) {
      if (attempt >= 10 || !String(error).includes('Axe is already running')) throw error
      await new Promise((r) => setTimeout(r, 200))
    }
  }
}

test('the Storybook catalogue documents every primitive', () => {
  const titles = new Set(stories.map((s) => s.title))
  for (const t of ['Controls', 'Fields', 'Display', 'Overlays', 'Navigation', 'Foundations', 'Compositions', 'Tasks']) expect(titles).toContain(`Alice UI/${t}`)
  expect(stories.length).toBeGreaterThanOrEqual(20)
})

for (const theme of ['light', 'dark'] as const) {
  for (const story of stories) {
    test(`${story.title} / ${story.name} passes axe in ${theme}`, async ({ page }) => {
      // ไม่มี animation ระหว่างตรวจ contrast (overlay ที่กำลัง fade-in จะถูกวัดผิด)
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await openStory(page, story.id, theme)
      const builder = MODAL_OPEN.has(story.id) ? axe(page).include('[role="dialog"]') : axe(page)
      const { violations } = await analyze(builder)
      expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([])
    })
  }
}

for (const story of stories) {
  test(`${story.title} / ${story.name} reflows at 320 px`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 })
    await openStory(page, story.id, 'light')
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflow).toBeLessThanOrEqual(0)
  })
}

test('focus is always visible on primitives reached by Tab', async ({ page }) => {
  await openStory(page, 'alice-ui-controls--buttons', 'light')
  await page.keyboard.press('Tab')
  const button = page.getByRole('button', { name: 'New task' })
  await expect(button).toBeFocused()
  const outline = await button.evaluate((el) => getComputedStyle(el).outlineStyle + ' ' + getComputedStyle(el).outlineWidth)
  expect(outline).toBe('solid 2px')
})

test('viewport dialog: fixed close, body scrolls alone, nested Escape closes one layer at a time', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 600 })
  await openStory(page, 'alice-ui-overlays--nested-dialogs', 'light')
  const opener = page.getByRole('button', { name: 'Open reader' })
  await opener.focus()
  await page.keyboard.press('Enter')
  const reader = page.getByRole('dialog', { name: 'Release checklist' })
  await expect(reader.getByRole('button', { name: 'Close' })).toBeFocused()
  const box = await reader.boundingBox()
  expect(box!.width).toBeGreaterThan(1200)
  expect(box!.height).toBeGreaterThan(560)
  const body = reader.locator('.ui-dialog-body')
  await body.evaluate((el) => el.scrollTo(0, el.scrollHeight))
  expect(await body.evaluate((el) => el.scrollTop)).toBeGreaterThan(0)
  await expect(reader.getByRole('button', { name: 'Close' })).toBeInViewport()
  const inner = reader.getByRole('button', { name: 'Open diagram' })
  await inner.focus()
  await page.keyboard.press('Enter')
  const diagram = page.getByRole('dialog', { name: 'Diagram' })
  // focus ย้ายเข้าชั้นบนสุดแล้ว (focus trap) ก่อนกด Escape
  await expect(diagram.getByRole('button', { name: 'Close' })).toBeFocused()
  // Radix ลงทะเบียนชั้นใหม่ใน effect หลังย้าย focus: รอหนึ่งเฟรม (คนกดไม่ทันในช่วงนี้)
  await page.evaluate(() => new Promise(requestAnimationFrame))
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: 'Diagram' })).toHaveCount(0)
  await expect(reader).toBeVisible()
  await expect(inner).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(reader).toHaveCount(0)
  await expect(opener).toBeFocused()
})

test('menu: Enter opens, arrows move, disabled items are skipped, Escape returns focus', async ({ page }) => {
  await openStory(page, 'alice-ui-overlays--action-menu', 'light')
  const trigger = page.getByRole('button', { name: 'More actions' })
  await trigger.focus()
  await page.keyboard.press('Enter')
  // Radix ตั้งชื่อเมนูจากปุ่มที่เปิดมัน
  const menu = page.getByRole('menu', { name: 'More actions' })
  await expect(menu).toBeVisible()
  await expect(page.getByRole('menuitem', { name: /Rename/ })).toBeFocused()
  await page.keyboard.press('ArrowDown')
  await expect(page.getByRole('menuitem', { name: /Copy link/ })).toBeFocused()
  await page.keyboard.press('End')
  await expect(page.getByRole('menuitem', { name: /Delete/ })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(menu).toBeHidden()
  await expect(trigger).toBeFocused()
})

test('dialog: focus moves in, Tab stays inside, Escape closes and restores focus', async ({ page }) => {
  await openStory(page, 'alice-ui-overlays--dialogs', 'light')
  const opener = page.getByRole('button', { name: 'Rename pad' })
  await opener.click()
  const dialog = page.getByRole('dialog', { name: 'Rename pad' })
  await expect(dialog).toBeVisible()
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press('Tab')
    expect(await dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true)
  }
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(opener).toBeFocused()
})

test('confirmation names the destructive action and Cancel restores focus', async ({ page }) => {
  await openStory(page, 'alice-ui-overlays--dialogs', 'light')
  const opener = page.getByRole('button', { name: 'Delete pad' })
  await opener.click()
  const dialog = page.getByRole('dialog', { name: 'Delete this pad?' })
  await expect(dialog.getByRole('button', { name: 'Delete pad' })).toBeVisible()
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  await expect(dialog).toBeHidden()
  await expect(opener).toBeFocused()
})

test('tabs and segmented control move with arrow keys and keep one selection', async ({ page }) => {
  await openStory(page, 'alice-ui-navigation--project-tabs', 'light')
  await page.getByRole('tab', { name: 'Overview' }).focus()
  await page.keyboard.press('ArrowRight')
  await expect(page.getByRole('tab', { name: /Tasks/ })).toBeFocused()
  await expect(page.getByRole('tab', { name: /Tasks/ })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('tabpanel')).toContainText('12 open tasks')

  await openStory(page, 'alice-ui-navigation--task-views', 'light')
  const board = page.getByRole('radio', { name: 'Board' })
  await expect(board).toHaveAttribute('aria-checked', 'true')
  await board.click()
  await expect(board).toHaveAttribute('aria-checked', 'true')
  await board.focus()
  await page.keyboard.press('ArrowRight')
  const list = page.getByRole('radio', { name: 'List' })
  await expect(list).toBeFocused()
  await expect(list).toHaveAttribute('aria-checked', 'true')
  await expect(board).toHaveAttribute('aria-checked', 'false')
  // ทั้งกลุ่มเป็น Tab stop เดียว
  await expect(page.locator('[role="radio"][tabindex="0"]')).toHaveCount(1)
})

test('toasts are announced politely and offer their action by keyboard', async ({ page }) => {
  await openStory(page, 'alice-ui-overlays--toasts', 'light')
  await page.getByRole('button', { name: 'Show success' }).click()
  const region = page.getByRole('status', { name: 'Notifications' })
  await expect(region).toHaveAttribute('aria-live', 'polite')
  await expect(region).toContainText('Task created')
  await expect(region.getByRole('button', { name: 'Undo' })).toBeVisible()
})

test('reduced motion removes overlay and skeleton animation', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await openStory(page, 'alice-ui-overlays--dialog-open', 'light')
  expect(await page.getByRole('dialog').evaluate((el) => getComputedStyle(el).animationName)).toBe('none')
  await openStory(page, 'alice-ui-display--empty-loading-and-banners', 'light')
  expect(await page.locator('.ui-skeleton').first().evaluate((el) => getComputedStyle(el).animationName)).toBe('none')
})

test('an explicit theme overrides the operating system, and System follows it', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' })
  await openStory(page, 'alice-ui-foundations--colour-roles', 'light')
  const canvas = () => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--ui-canvas').trim())
  const light = await canvas()
  await page.goto('/iframe.html?id=alice-ui-foundations--colour-roles&viewMode=story&globals=theme:system')
  await page.locator('#storybook-root > *').first().waitFor()
  expect(await page.locator('html').getAttribute('data-theme')).toBeNull()
  const systemDark = await canvas()
  expect(systemDark).not.toBe(light)
  await openStory(page, 'alice-ui-foundations--colour-roles', 'dark')
  expect(await canvas()).toBe(systemDark)
})

test('selects and date fields match text fields and drop the platform look', async ({ page }) => {
  await openStory(page, 'alice-ui-fields--side-by-side', 'dark')
  const row = page.getByTestId('control-row')
  const boxes = await row.locator('select, input').evaluateAll((els) =>
    els.map((el) => {
      const style = getComputedStyle(el)
      return { height: el.getBoundingClientRect().height, radius: style.borderTopLeftRadius, border: style.borderTopColor, appearance: style.appearance, icon: style.backgroundImage !== 'none' }
    }),
  )
  expect(boxes).toHaveLength(4)
  for (const box of boxes.slice(1)) expect({ height: box.height, radius: box.radius, border: box.border }).toEqual({ height: boxes[0].height, radius: boxes[0].radius, border: boxes[0].border })
  // select ไม่มีหน้าตาของ OS แต่มี chevron, ช่องวันที่มีไอคอนปฏิทิน
  expect(boxes.slice(0, 2).map((b) => [b.appearance, b.icon])).toEqual([['none', true], ['none', true]])
  expect(boxes[2].icon).toBe(true)
  // ตัวเลือกยาวไม่ทับ chevron
  const assignee = page.getByLabel('Assignee')
  await assignee.selectOption('a')
  expect(await assignee.evaluate((el) => parseFloat(getComputedStyle(el).paddingRight))).toBeGreaterThanOrEqual(24)
})

// ภาพ baseline ต่อแพลตฟอร์ม เปิดด้วย ALICE_UI_VISUAL=1 (CI บน Linux ยังไม่มี baseline ที่คนรีวิวแล้ว)
test.describe('visual snapshots', () => {
  test.skip(process.env.ALICE_UI_VISUAL !== '1', 'opt-in: ALICE_UI_VISUAL=1')
  for (const theme of ['light', 'dark'] as const) {
    for (const id of ['alice-ui-controls--buttons', 'alice-ui-fields--text-inputs', 'alice-ui-display--badges', 'alice-ui-display--empty-loading-and-banners', 'alice-ui-compositions--task-section', 'alice-ui-compositions--settings-card']) {
      test(`${id} (${theme})`, async ({ page }) => {
        await page.emulateMedia({ reducedMotion: 'reduce' })
        await openStory(page, id, theme)
        await expect(page).toHaveScreenshot(`${id}-${theme}.png`, { fullPage: true, animations: 'disabled', caret: 'hide' })
      })
    }
  }
})
