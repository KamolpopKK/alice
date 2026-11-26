import fs from 'node:fs'
import path from 'node:path'
import { parse } from 'yaml'
import { describe, expect, it } from 'vitest'
import { APP_VERSION } from '../../src/shared/version'

const root = path.resolve(import.meta.dirname, '../..')
const dir = path.join(root, 'skill/alice-demo')

describe('alice-demo distributable instructions', () => {
  it('has valid discoverable metadata at the application version', () => {
    const text = fs.readFileSync(path.join(dir, 'SKILL.md'), 'utf8')
    const front = parse(/^---\n([\s\S]*?)\n---/.exec(text)![1])
    expect(front.name).toBe('alice-demo')
    expect(front.version).toBe(APP_VERSION)
    expect(front.description.length).toBeGreaterThan(40)
    expect(front.description.length).toBeLessThanOrEqual(1024)
  })

  it('resolves local resource references in the flat installed package', () => {
    for (const file of fs.readdirSync(dir).filter((name) => name.endsWith('.md'))) {
      const text = fs.readFileSync(path.join(dir, file), 'utf8')
      for (const [, link] of text.matchAll(/\]\(([^)#]+\.(?:md|mjs|html))(?:#[^)]*)?\)/g)) {
        if (/^https?:/.test(link)) continue
        expect(fs.existsSync(path.join(dir, link)) || fs.existsSync(path.join(root, 'skill/_shared', link)), `${file}: ${link}`).toBe(true)
      }
    }
  })
})
