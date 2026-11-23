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
      expect(section).toContain('Create `.alice/` only after the user agrees')
      expect(text).toContain(skill === 'alice' ? '## Working in project files' : '## Planning in project files')
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

describe('the shared document knowledge guide', () => {
  const guide = fs.readFileSync(path.join(ROOT, 'skill/_shared/DOCUMENT-KNOWLEDGE.md'), 'utf8')
  const skills = ['alice', 'alice-plan', 'alice-think', 'alice-spec', 'alice-understand', 'alice-demo']

  it('is required by every skill and distinguishes runtime documents from project files', () => {
    for (const skill of skills) {
      const text = fs.readFileSync(path.join(ROOT, 'skill', skill, 'SKILL.md'), 'utf8')
      expect(text).toContain('[DOCUMENT-KNOWLEDGE.md](DOCUMENT-KNOWLEDGE.md)')
    }
    expect(guide).toContain('not semantic or vector search')
    expect(guide).toContain('title + id + section')
    expect(guide).toContain('use `superseded` only as history')
    expect(guide).toContain('does not apply to project files')
  })
})

// ส่วนที่ทุก skill ต้องมีเหมือนกันทุกตัวอักษร: ซ้ำสองที่โดยตั้งใจ (SKILL.md โหลดทุกครั้ง) แต่ห้ามขาดหรือเพี้ยน
describe('sections every skill carries word for word', () => {
  const read = (skill: string) => fs.readFileSync(path.join(ROOT, 'skill', skill, 'SKILL.md'), 'utf8')
  const section = (text: string, heading: string) => {
    const start = text.indexOf(`${heading}\n`)
    if (start < 0) return null
    const next = text.indexOf('\n## ', start + heading.length)
    return text.slice(start, next < 0 ? undefined : next + 1)
  }
  const skills = fs.readdirSync(path.join(ROOT, 'skill')).filter((d) => !d.startsWith('_'))

  for (const heading of ['## Naming tasks and documents', '## Choose where you work first', '## Using the `alice` command', '## Recovering from errors', '## Quick reference']) {
    it(heading, () => {
      const [first, ...rest] = skills.map((s) => [s, section(read(s), heading)] as const)
      expect(first[1], `${first[0]} has ${heading}`).not.toBeNull()
      for (const [skill, text] of rest) expect(text, `${skill} matches ${first[0]}`).toBe(first[1])
    })
  }

  // คุยกับคนด้วยชื่อ task/เอกสาร ไม่ใช่ id: รายงานที่เคยสั่งให้บอก id ต้องไม่เหลือ
  it('talk about tasks and documents by title, keeping ids for tools and saved references', () => {
    const files = skills.flatMap((s) => fs.readdirSync(path.join(ROOT, 'skill', s)).map((f) => path.join(ROOT, 'skill', s, f)))
    for (const file of files) {
      const text = fs.readFileSync(file, 'utf8')
      expect(text, file).not.toMatch(/[Rr]eport (the |its |their )?(saved |created or updated |task |design |document )*(artifact )?(ids?\/titles?|ids?, title|ids?\/paths?|id and title)|report saved ids|ask which id/)
    }
    for (const skill of skills) {
      const rule = section(read(skill), '## Naming tasks and documents')!
      expect(rule).toContain('call tasks and documents by their titles')
      expect(rule).toContain('fetch the title; never invent one')
      expect(rule).toContain('keep the title next to it')
      expect(rule).toContain('source requirement ids such as `REQ-001`')
    }
  })

  it('the shared safety rules', () => {
    for (const skill of skills) {
      const safety = section(read(skill), '## Safety')!
      expect(safety).toContain('- Your token is a secret. Never print it, paste it into comments or documents, or commit it.')
      expect(safety).toContain('- Archive instead of deleting; there is no permanent delete for agents.')
    }
  })
})
