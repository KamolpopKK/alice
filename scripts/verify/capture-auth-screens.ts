// ถ่าย screenshot เมทริกซ์ของหน้า auth สำหรับรีวิวเทียบกับภาพอ้างอิง
// usage: npm run build:web && npx tsx scripts/verify/capture-auth-screens.ts [OUT_DIR]
import fs from 'node:fs'
import { chromium } from '@playwright/test'
import sharp from 'sharp'
import { startApp } from '../../tests/helpers/app'
import { bootstrapOwner } from '../../tests/helpers/client'

const out = process.argv[2] ?? 'test-results/auth-screens'
fs.mkdirSync(out, { recursive: true })
const app = await startApp()
const fresh = await startApp()
const owner = await bootstrapOwner(app)
const invite = (await owner.post('/client/v1/invites', { note: 'screens' })).body.url as string
const STATES: Array<[string, string]> = [
  ['sign-in', `${app.url}/login`],
  ['setup', `${fresh.url}/setup`],
  ['invite', invite],
  ['invite-invalid', `${app.url}/invite/not-a-token`],
]
const VIEWPORTS: Array<[number, number]> = [
  [1440, 900],
  [390, 844],
  [320, 568],
]
const browser = await chromium.launch()
for (const scheme of ['light', 'dark'] as const) {
  for (const [w, h] of VIEWPORTS) {
    // reducedMotion + ไม่มี caret กระพริบ = ภาพนิ่งเหมือนเดิมทุกครั้ง
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: scheme, reducedMotion: 'reduce' })
    const page = await ctx.newPage()
    for (const [name, url] of STATES) {
      await page.goto(url)
      await page.waitForLoadState('networkidle')
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
      const png = await page.screenshot({ fullPage: w < 1440, caret: 'hide', animations: 'disabled' })
      const file = `${out}/${name}-${scheme}-${w}.jpg`
      await sharp(png).resize(Math.min(w, 960)).jpeg({ quality: 74 }).toFile(file)
      console.log(file)
    }
    await ctx.close()
  }
}
await browser.close()
await app.stop()
await fresh.stop()
