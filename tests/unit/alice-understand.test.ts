import fs from 'node:fs'
import path from 'node:path'
import { parse } from 'yaml'
import { describe, expect, it } from 'vitest'
import { APP_VERSION } from '../../src/shared/version'

const root = path.resolve(import.meta.dirname, '../..')
const dir = path.join(root, 'skill/alice-understand')

describe('alice-understand package integrity', () => {
  it('has valid distributable metadata at the application version', () => {
    const text = fs.readFileSync(path.join(dir, 'SKILL.md'), 'utf8')
    const front = parse(/^---\n([\s\S]*?)\n---/.exec(text)![1])
    expect(front.name).toBe('alice-understand')
    expect(front.version).toBe(APP_VERSION)
    expect(typeof front.description).toBe('string')
    expect(front.description.length).toBeGreaterThan(40)
    expect(front.description.length).toBeLessThanOrEqual(1024)
  })

  it('resolves every local Markdown reference in its installed flat package', () => {
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.md'))) {
      const text = fs.readFileSync(path.join(dir, file), 'utf8')
      const links = [...text.matchAll(/\]\(([^)#]+\.md)(?:#[^)]*)?\)/g)]
      for (const [, link] of links) {
        if (/^https?:/.test(link)) continue
        expect(fs.existsSync(path.join(dir, link)) || fs.existsSync(path.join(root, 'skill/_shared', link)), `${file}: ${link}`).toBe(true)
      }
    }
  })
})
