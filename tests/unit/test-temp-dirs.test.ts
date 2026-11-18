import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// โฟลเดอร์ชั่วคราวของ test ต้องสร้างผ่าน testDir() เท่านั้น เพื่อให้ถูกลบเมื่อ test จบ
// (runtime หนึ่งชุด ~240 MB: ถ้าหลุด disk เต็มได้ในไม่กี่รอบ)
const TESTS = path.resolve(import.meta.dirname, '..')
const HELPER = path.join(TESTS, 'helpers', 'tmp.ts')
const walk = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]))

describe('test temporary directories', () => {
  it('are created only through testDir() from tests/helpers/tmp.ts', () => {
    const offenders = walk(TESTS)
      .filter((f) => /\.(ts|mjs|js)$/.test(f) && f !== HELPER && !f.includes(`${path.sep}__screenshots__${path.sep}`))
      .filter((f) => /\bmkdtemp(Sync)?\s*\(/.test(fs.readFileSync(f, 'utf8').replace(/\/\/.*$|\/\*[\s\S]*?\*\//gm, '')))
      .map((f) => path.relative(TESTS, f))
    expect(offenders, 'use testDir(prefix) from tests/helpers/tmp.ts instead of mkdtemp').toEqual([])
  })
})
