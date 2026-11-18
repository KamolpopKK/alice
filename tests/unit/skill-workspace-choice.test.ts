import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = path.resolve(import.meta.dirname, '../..')

// skill ที่แจกจ่ายต้องให้ agent เลือก workspace ก่อนแก้ครั้งแรก ไม่ใช่ใช้ MCP ทันทีเมื่อมี
describe('distributed skills choose a workspace before the first change', () => {
  for (const skill of ['alice', 'alice-plan']) {
    it(skill, () => {
      const text = fs.readFileSync(path.join(ROOT, 'skill', skill, 'SKILL.md'), 'utf8')
      const section = text.slice(text.indexOf('## Choose where you work first'))
      expect(text).toContain('## Choose where you work first')
      expect(section).toContain('workspace current --json')
      expect(section).toContain('local-binding')
      expect(section).toContain('Do not guess')
      expect(section).toContain('UNAUTHENTICATED')
      expect(text).not.toContain('Local workspaces (no MCP)')
    })
  }
})
