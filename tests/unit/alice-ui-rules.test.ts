import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// กติกาของ Alice UI ที่ตรวจได้จากซอร์ส: token เดียว, ไม่มีสีดิบ, ไอคอนชุดเดียว, story ใช้ข้อมูลสังเคราะห์
const ROOT = path.resolve(import.meta.dirname, '../..')
const UI = path.join(ROOT, 'src/web/ui')
const read = (p: string) => fs.readFileSync(p, 'utf8')
const walk = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]))
const uiFiles = walk(UI)
const RAW_COLOUR = /#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(/i

describe('Alice UI rules', () => {
  it('System dark and explicit Dark define the same roles with the same values', () => {
    const css = read(path.join(UI, 'tokens.css'))
    // เนื้อหาของ rule ที่ประกาศตัวแปร (สำหรับ @media คือ rule ด้านใน)
    const block = (start: string) => {
      let open = css.indexOf('{', css.indexOf(start))
      if (start.startsWith('@media')) open = css.indexOf('{', open + 1)
      return css
        .slice(open + 1, css.indexOf('}', open))
        .split(';')
        .map((l) => l.trim())
        .filter(Boolean)
    }
    const system = block("@media (prefers-color-scheme: dark)")
    const explicit = block(":root[data-theme='dark']")
    expect(system.length).toBeGreaterThan(30)
    expect(system).toEqual(explicit)
  })

  it('every light role has a dark value', () => {
    const css = read(path.join(UI, 'tokens.css'))
    const roles = (text: string) => new Set([...text.matchAll(/(--ui-[\w-]+):/g)].map((m) => m[1]))
    const darkStart = css.indexOf(":root[data-theme='dark']")
    const light = roles(css.slice(css.indexOf('semantic colour roles: Light'), css.indexOf('@media (prefers-color-scheme: dark)')))
    const dark = roles(css.slice(darkStart))
    for (const role of light) expect(dark, role).toContain(role)
  })

  it('components and stories use semantic tokens: no raw colours, no primitive palette', () => {
    for (const file of uiFiles.filter((f) => !f.endsWith('tokens.css'))) {
      const text = read(file).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')
      expect(RAW_COLOUR.test(text), path.relative(ROOT, file)).toBe(false)
      expect(text.includes('--p-'), path.relative(ROOT, file)).toBe(false)
    }
    // primitive palette ใช้ได้ใน tokens.css เท่านั้น ทั้งแอป
    for (const file of walk(path.join(ROOT, 'src/web')).filter((f) => /\.(css|tsx?)$/.test(f) && !f.endsWith(path.join('ui', 'tokens.css')))) {
      expect(/var\(--p-/.test(read(file)), path.relative(ROOT, file)).toBe(false)
    }
  })

  it('functional icons come only from lucide-react, drawn through Icon', () => {
    const pkg = JSON.parse(read(path.join(ROOT, 'package.json')))
    const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })
    expect(deps.filter((d) => /icon|heroicons|feather|fontawesome|material-symbols/i.test(d) && d !== 'lucide-react')).toEqual([])
    for (const file of uiFiles.filter((f) => f.endsWith('.tsx') && !f.includes(`${path.sep}stories${path.sep}`) && !f.endsWith('Icon.tsx'))) {
      // ไม่วาด svg เองและไม่ใช้ glyph เป็นไอคอน
      expect(read(file), path.relative(ROOT, file)).not.toMatch(/<svg|[✓✔✕✖▾▸⋯]/)
    }
  })

  it('stories hold synthetic data only: no real endpoints, paths or credential-like values', () => {
    const stories = uiFiles.filter((f) => f.includes(`${path.sep}stories${path.sep}`))
    expect(stories.length).toBeGreaterThanOrEqual(7)
    for (const file of [...stories, path.join(ROOT, '.storybook/preview.tsx'), path.join(ROOT, '.storybook/main.ts')]) {
      const text = read(file)
      const urls = [...text.matchAll(/https?:\/\/[^\s'"`)]+/g)].map((m) => m[0])
      expect(urls.filter((u) => !/^https?:\/\/[\w.-]*example\.(test|com)(\/|$)/.test(u)), path.relative(ROOT, file)).toEqual([])
      expect(text, path.relative(ROOT, file)).not.toMatch(/localhost|127\.0\.0\.1|\/Users\/|\/home\/|process\.env|import\.meta\.env|Bearer\s|alice_(at|rt|pat)_|sk-[A-Za-z0-9]{10}|BEGIN [A-Z ]*PRIVATE KEY/)
    }
  })

  it('application code never imports Storybook or stories', () => {
    for (const file of walk(path.join(ROOT, 'src')).filter((f) => /\.tsx?$/.test(f) && !f.includes(`${path.sep}stories${path.sep}`))) {
      expect(read(file), path.relative(ROOT, file)).not.toMatch(/from ['"](@storybook\/|storybook)|\.stories['"]/)
    }
  })
})
