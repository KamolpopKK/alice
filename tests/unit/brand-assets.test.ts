import fs from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'

const ROOT = path.resolve(import.meta.dirname, '../..')
const BRAND = path.join(ROOT, 'src/web/public/brand')
const manifest = JSON.parse(fs.readFileSync(path.join(BRAND, 'brand-assets.json'), 'utf8'))

// รายชื่อไฟล์ตาม production asset contract ของแบรนด์
const REQUIRED = [
  'alice-logo-horizontal-light.svg',
  'alice-logo-horizontal-dark.svg',
  'alice-mark.svg',
  'alice-mark-monochrome.svg',
  'alice-mascot-friendly.webp',
  'alice-mascot-peek.png',
  'alice-mascot-peek.webp',
  'alice-mascot-neutral.webp',
  'alice-mascot-curious.webp',
  'alice-mascot-focused.webp',
  'alice-mascot-concerned.webp',
  'alice-auth-workspace-dark.webp',
  'favicon.svg',
  'favicon-32.png',
  'apple-touch-icon.png',
  'icon-192.png',
  'icon-512.png',
  'brand-assets.json',
]

describe('production brand assets', () => {
  it('ships every contracted file and a manifest whose paths resolve', () => {
    for (const f of REQUIRED) expect(fs.existsSync(path.join(BRAND, f)), f).toBe(true)
    expect(manifest.palette).toEqual({
      'brand-navy-900': '#202A44',
      'brand-navy-700': '#344466',
      'brand-ivory': '#FFF8EE',
      'brand-cocoa': '#4A312E',
      'brand-coral': '#EE715F',
      'brand-coral-accessible': '#B64336',
    })
    for (const [key, a] of Object.entries(manifest.assets) as Array<[string, { path: string; bytes: number }]>) {
      const file = path.join(ROOT, 'src/web/public', a.path)
      expect(fs.existsSync(file), key).toBe(true)
      expect(fs.statSync(file).size, key).toBe(a.bytes)
    }
  })

  it('keeps files within size budgets', () => {
    for (const f of fs.readdirSync(BRAND)) {
      const size = fs.statSync(path.join(BRAND, f)).size
      expect(size, f).toBeLessThan(300 * 1024)
      if (f.endsWith('.webp')) expect(size, f).toBeLessThan(180 * 1024)
    }
  })

  it('uses clean, self-contained vectors', () => {
    for (const f of fs.readdirSync(BRAND).filter((x) => x.endsWith('.svg'))) {
      const text = fs.readFileSync(path.join(BRAND, f), 'utf8')
      expect(text, f).not.toMatch(/<script|<image|<foreignObject|xlink:href|href=|https?:\/\/(?!www\.w3\.org\/2000\/svg)|base64|@import|<metadata|<text/i)
    }
    const light = fs.readFileSync(path.join(BRAND, 'alice-logo-horizontal-light.svg'), 'utf8')
    expect(light).toContain('aria-label="Alice"')
  })

  it('exports mascots with real alpha and transparent corners', async () => {
    for (const f of fs.readdirSync(BRAND).filter((x) => x.startsWith('alice-mascot-') && /\.(png|webp)$/.test(x))) {
      const { data, info } = await sharp(path.join(BRAND, f)).raw().toBuffer({ resolveWithObject: true })
      expect(info.channels, f).toBe(4)
      const alphaAt = (x: number, y: number) => data[(y * info.width + x) * 4 + 3]
      for (const [x, y] of [[0, 0], [info.width - 1, 0], [0, info.height - 1], [info.width - 1, info.height - 1]]) expect(alphaAt(x, y), f).toBe(0)
      let opaque = 0
      for (let i = 3; i < data.length; i += 4) if (data[i] === 255) opaque++
      expect(opaque / (info.width * info.height), f).toBeGreaterThan(0.25)
    }
  })

  it('never serves the concept boards', () => {
    const offenders: string[] = []
    const walk = (dir: string) => {
      for (const f of fs.readdirSync(dir)) {
        const p = path.join(dir, f)
        if (fs.statSync(p).isDirectory()) walk(p)
        else if (/\.(tsx?|css|html|json|webmanifest)$/.test(f) && fs.readFileSync(p, 'utf8').includes('artifacts/')) offenders.push(p)
      }
    }
    walk(path.join(ROOT, 'src/web'))
    expect(offenders).toEqual([])
  })
})
