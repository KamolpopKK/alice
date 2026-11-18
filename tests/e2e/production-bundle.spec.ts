import fs from 'node:fs'
import path from 'node:path'
import { expect, test } from './fixtures'

/** Storybook is development tooling only: nothing of it reaches the production build or its routes. */
test('the production build and server contain no Storybook', async ({ app, page }) => {
  const web = path.resolve(import.meta.dirname, '../../dist/web')
  const files = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(path.join(dir, e.name)) : [path.join(dir, e.name)]))
  const all = files(web)
  expect(all.length).toBeGreaterThan(3)
  for (const file of all) {
    expect(path.basename(file)).not.toMatch(/^iframe\.html$|stories|storybook/i)
    if (/\.(js|css|html|json)$/.test(file)) expect(fs.readFileSync(file, 'utf8'), path.relative(web, file)).not.toMatch(/storybook|__STORYBOOK|\.stories/i)
  }
  for (const route of ['/iframe.html', '/index.json', '/storybook', '/?path=/story/alice-ui-controls--buttons']) {
    const res = await page.request.get(`${app.url}${route}`)
    expect((await res.text()).toLowerCase(), route).not.toContain('storybook')
  }
})
