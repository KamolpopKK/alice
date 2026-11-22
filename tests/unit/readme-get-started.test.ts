import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// The README's Get started commands must point at things a release really produces
const ROOT = path.resolve(import.meta.dirname, '../..')
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8')
const readme = read('README.md')
const slug = (heading: string) =>
  heading
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s/g, '-')
const anchors = (file: string) => new Set([...read(file).matchAll(/^#{1,6}\s+(.+)$/gm)].map((m) => slug(m[1])))

describe('README Quick start with AI agents', () => {
  const start = readme.indexOf('## Quick start with AI agents')
  const section = readme.slice(start, readme.indexOf('## Get started'))
  const prompts = Object.fromEntries(
    [...section.matchAll(/<summary><b>(.+?)<\/b>[\s\S]*?```text\n([\s\S]*?)```/g)].map((m) => [m[1].replace(/<\/?code>/g, ''), m[2]]),
  )

  it('comes before the detailed install paths and offers four prompts', () => {
    expect(start).toBeGreaterThan(0)
    expect(start).toBeLessThan(readme.indexOf('## Get started'))
    expect(Object.keys(prompts)).toEqual(['Full setup', 'App only', 'alice command only', 'Skills only'])
  })

  it('every prompt states its prerequisites, keeps what exists, never claims tasks or asks for secrets', () => {
    for (const [name, prompt] of Object.entries(prompts)) {
      expect(prompt, name).toMatch(/Prerequisites: /)
      expect(prompt, name).toMatch(/do\s+not\s+claim\s+tasks/i)
      expect(prompt, name).toMatch(/Preserve\s+existing|Keep\s+an\s+existing|Keep\s+existing|already\s+installed/)
      expect(prompt, name).toMatch(/never\s+ask\s+for,\s+read\s+or\s+print\s+credentials/i)
      expect(prompt, name).toMatch(/do\s+not\s+report\s+success|Do\s+not\s+report\s+complete\s+setup|as\s+incomplete|which\s+check\s+failed/i)
      // ลิงก์ GitHub ใช้ releases/latest เท่านั้น ไม่ฝังเลข version
      for (const url of prompt.match(/https:\/\/github\.com\/\S+/g) ?? []) expect(url, name).not.toMatch(/\d+\.\d+\.\d+/)
    }
  })

  it('names the client identity, checks all five skills and never promises a Local runtime it does not install', () => {
    for (const name of ['Full setup', 'Skills only']) {
      expect(prompts[name]).toMatch(/codex\s+for\s+Codex,\s+claude-code\s+for\s+Claude\s+Code/)
      for (const skill of ['alice-think', 'alice-spec', 'alice-plan', 'alice-understand']) expect(prompts[name]).toContain(skill)
      expect(prompts[name]).toMatch(/PROJECT-FILES\.md,\s+DOCUMENT-KNOWLEDGE\.md\s+and\s+OUTPUT-FORMATS\.md/)
    }
    expect(prompts['alice command only']).toMatch(/does\s+not\s+give\s+this\s+computer\s+a\s+Local\s+runtime/)
    expect(prompts['Skills only']).toMatch(/does\s+not\s+install\s+the\s+app,\s+the\s+alice\s+command\s+or\s+a\s+Local\s+runtime/)
    expect(prompts['App only']).toMatch(/does\s+not\s+install\s+the\s+alice\s+command\s+or\s+agent\s+skills/)
    // ตรวจ checksum ทุกเส้นทางที่ดาวน์โหลดเอง
    expect(prompts['alice command only']).toContain('manifest.json')
    expect(prompts['Skills only']).toContain('SHA256SUMS')
  })
})

describe('README Get started', () => {
  it('opens with the four paths before any project paperwork', () => {
    const start = readme.indexOf('## Get started')
    expect(start).toBeGreaterThan(0)
    expect(readme.indexOf('## Project documentation')).toBeGreaterThan(start)
    const paths = [...readme.slice(start).matchAll(/^### (\d)\. (.+)$/gm)].map((m) => m[1])
    expect(paths.slice(0, 4)).toEqual(['1', '2', '3', '4'])
    for (const text of ['Apple Silicon', 'not notarized', 'Open Anyway', 'SmartScreen', 'Agents']) expect(readme).toContain(text)
  })

  it('downloads only fixed-name assets that the release workflow publishes', () => {
    const release = read('.github/workflows/release.yml')
    const assets = [...readme.matchAll(/releases\/latest\/download\/([\w.-]+)/g)].map((m) => m[1])
    expect(assets).toContain('install-macos.sh')
    expect(assets).toContain('alice-cli.js')
    // ไฟล์ที่ publish ได้: เขียนลง dist-release/ ตรง ๆ หรือเป็นไฟล์ out/ ของ job cli ซึ่งถูกดาวน์โหลดลง dist-release/
    const cliArtifact = /name: cli\s*\n/.test(release) && release.includes('path: dist-release\n          name: cli')
    for (const asset of assets) {
      const checksums = asset === 'SHA256SUMS' && release.includes('(cd dist-release && sha256sum * > SHA256SUMS)')
      const produced = checksums || release.includes(`dist-release/${asset}`) || (cliArtifact && release.includes(`out/${asset}\n`))
      expect(produced, `${asset} is not produced by the release workflow`).toBe(true)
    }
    // อะไรที่มีเลขเวอร์ชันในชื่อไฟล์ ต้องลิงก์ไปหน้า release ไม่ใช่ latest/download
    expect(assets.some((a) => /\d+\.\d+\.\d+|<version>/.test(a))).toBe(false)
    const collected = /const WANTED = (\/.+\/)/.exec(read('scripts/desktop-collect.mjs'))![1]
    for (const ext of ['dmg', 'exe', 'msi', 'AppImage', 'deb', 'rpm']) expect(collected).toContain(ext)
  })

  it('self-hosting files and image match the repository', () => {
    for (const m of readme.matchAll(/raw\.githubusercontent\.com\/KamolpopKK\/alice\/main\/([\w./-]+)/g)) expect(fs.existsSync(path.join(ROOT, m[1])), m[1]).toBe(true)
    const image = /image: (ghcr\.io\/[\w/-]+):/.exec(read('compose.yaml'))![1]
    expect(readme).toContain(`\`${image}\``)
    expect(readme).toContain('docker compose --profile https up -d')
    expect(read('compose.yaml')).toContain('profiles: [https]')
  })

  it('every relative link and anchor resolves', () => {
    const links = [...readme.matchAll(/\]\((?!https?:|mailto:)([^)\s]+)\)|(?:src|srcset)="(?!https?:)([^"]+)"/g)].map((m) => m[1] ?? m[2])
    expect(links.length).toBeGreaterThan(10)
    for (const link of links) {
      const [file, anchor] = link.split('#')
      if (file) expect(fs.existsSync(path.join(ROOT, file)), link).toBe(true)
      if (anchor && file.endsWith('.md')) expect(anchors(file).has(anchor), link).toBe(true)
    }
    // ลิงก์จาก docs กลับมาที่ README ต้องตรงหัวข้อจริง
    expect(read('docs/local-workspaces.md')).toContain('../README.md#1-use-alice-on-your-mac-no-server')
    expect(anchors('README.md').has('1-use-alice-on-your-mac-no-server')).toBe(true)
  })
})
