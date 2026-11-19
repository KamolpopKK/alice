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
      expect(section).toContain('workspace list --json')
      expect(section).toMatch(/Two or more:?\*{0,2} ask the user which one/)
      expect(section).toContain('--workspace ALIAS')
      expect(section).toContain('UNAUTHENTICATED')
      expect(text).not.toContain('Local workspaces (no MCP)')
      // project files: บอร์ดเป็น markdown ใน .alice/ ไม่ต้องมี app
      expect(section).toContain('.alice/tasks/')
      expect(section).toContain('create `.alice/` only after the user agrees'.replace(/^c/, skill === 'alice' ? 'C' : 'c'))
      expect(text).toContain(skill === 'alice' ? '## Working in project files' : '### Planning in project files')
      // คำแนะนำครั้งแรก, การตั้ง .alice/ และการย้ายไป app อยู่ในไฟล์กลางที่ทุก skill อ่าน
      expect(text).toContain('read [PROJECT-FILES.md](PROJECT-FILES.md)')
    })
  }
})

describe('the shared project files guide', () => {
  const guide = fs.readFileSync(path.join(ROOT, 'skill/_shared/PROJECT-FILES.md'), 'utf8')

  it('sets up .alice/ with a .gitignore and a README, and covers first use and moving to the app', () => {
    for (const point of [
      '## Setting up .alice/',
      'workspace.local.json\n   imported.json',
      "do\n   not edit the repository's own `.gitignore`",
      '`.alice/README.md` with this text',
      '## The first time in a conversation',
      '## Moving to the app',
      'install-macos.sh',
      'alice import --dry-run',
    ]) {
      expect(guide).toContain(point)
    }
  })

  it('is not a skill of its own', () => {
    expect(fs.existsSync(path.join(ROOT, 'skill/_shared/SKILL.md'))).toBe(false)
  })
})
