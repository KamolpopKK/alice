import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const css = fs.readFileSync(path.resolve(import.meta.dirname, '../../src/web/styles.css'), 'utf8')

function tokens(block: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const m of block.matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)) out[m[1]] = m[2].trim()
  return out
}
const light = tokens(css.slice(css.indexOf(':root {'), css.indexOf('@media (prefers-color-scheme: dark)')))
const dark = { ...light, ...tokens(css.slice(css.indexOf('@media (prefers-color-scheme: dark)'), css.indexOf('* {'))) }

function resolve(t: Record<string, string>, name: string): string {
  let v = t[name]
  for (let i = 0; i < 5 && v?.startsWith('var('); i++) v = t[v.slice(6, -1)]
  if (!v || !/^#[0-9a-f]{6}$/i.test(v)) throw new Error(`token --${name} is not a hex colour: ${v}`)
  return v
}
const lum = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
export const contrast = (a: string, b: string) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p)
  return (x + 0.05) / (y + 0.05)
}

// [foreground, background, minimum]: 4.5 text, 3 for focus/UI indicators (WCAG 2.2 AA)
const PAIRS: Array<[string, string, number]> = [
  ['text', 'bg', 4.5],
  ['text', 'surface', 4.5],
  ['text', 'surface-2', 4.5],
  ['muted', 'bg', 4.5],
  ['muted', 'surface', 4.5],
  ['accent', 'bg', 4.5],
  ['accent', 'surface', 4.5],
  ['accent-text', 'accent', 4.5],
  ['accent-text', 'accent-hover', 4.5],
  ['accent', 'accent-soft', 4.5],
  ['danger', 'surface', 4.5],
  ['agent', 'agent-soft', 4.5],
  ['focus', 'bg', 3],
  ['focus', 'surface', 3],
  ['live', 'surface', 3],
]

describe('brand palette contrast (WCAG 2.2 AA)', () => {
  for (const [scheme, t] of [['light', light], ['dark', dark]] as const) {
    it.each(PAIRS)(`${scheme}: --%s on --%s ≥ %d`, (fg, bg, min) => {
      expect(contrast(resolve(t, fg), resolve(t, bg))).toBeGreaterThanOrEqual(min)
    })
  }

  it('matches the brand palette and keeps coral decorative on ivory', () => {
    expect(resolve(light, 'brand-navy-900').toLowerCase()).toBe('#202a44')
    expect(contrast('#202A44', '#FFF8EE')).toBeGreaterThan(13)
    expect(contrast('#EE715F', '#FFF8EE')).toBeLessThan(4.5) // decorative only
    expect(contrast('#B64336', '#FFF8EE')).toBeGreaterThanOrEqual(4.5)
  })
})
