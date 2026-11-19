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
      const produced = release.includes(`dist-release/${asset}`) || (cliArtifact && release.includes(`out/${asset}\n`))
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
