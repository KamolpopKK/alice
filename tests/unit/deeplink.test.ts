import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { DeepLinkError, formatDeepLink, parseDeepLink, webPath } from '../../src/shared/deeplink'

// ชุดตัวอย่างเดียวกันนี้ใช้ทดสอบ parser ฝั่ง Rust ด้วย (src-tauri/src/deeplink.rs)
const vectors = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, '../fixtures/deeplinks.json'), 'utf8')) as {
  valid: Array<[string, { profile?: string; workspace?: string; kind: string; id: string }]>
  invalid: Array<[string, string]>
}

describe('deep links', () => {
  it.each(vectors.valid)('accepts %s', (raw, expected) => {
    expect(parseDeepLink(raw)).toEqual(expected)
    expect(formatDeepLink(expected as never)).toBe(raw)
  })

  it.each(vectors.invalid)('rejects %j (%s)', (raw) => {
    expect(() => parseDeepLink(raw)).toThrow(DeepLinkError)
  })

  it('maps resources to Web paths', () => {
    expect(webPath({ kind: 'project', id: 'prj_x' })).toBe('/projects/prj_x')
    expect(webPath({ kind: 'document', id: 'doc_x' })).toBe('/documents/doc_x')
    expect(webPath({ kind: 'task', id: 'tsk_x' })).toBe('/tasks/tsk_x')
  })
})
