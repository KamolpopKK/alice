import fs from 'node:fs'
import path from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ALICE_COPY, BrandLogo, IllustratedState, MascotImage } from '../../src/web/brand'

describe('brand components', () => {
  it('BrandLogo exposes exactly one accessible name and switches variants by colour scheme', () => {
    const full = renderToStaticMarkup(<BrandLogo />)
    expect(full.match(/alt="Alice"/g)).toHaveLength(1)
    expect(full).toContain('<source srcSet="/brand/alice-logo-horizontal-dark.svg" media="(prefers-color-scheme: dark)"/>')
    expect(full).toContain('src="/brand/alice-logo-horizontal-light.svg"')
    expect(full).not.toMatch(/filter|invert/)
    const compact = renderToStaticMarkup(<BrandLogo variant="compact" />)
    expect(compact).toContain('alt="" aria-hidden="true"')
    expect(compact).toContain('<span class="brand-wordmark">Alice</span>')
    expect(compact.match(/Alice/g)).toHaveLength(1)
  })

  it('MascotImage is decorative, sized and lazy by default', () => {
    const html = renderToStaticMarkup(<MascotImage pose="neutral" width={120} />)
    expect(html).toMatch(/^<img src="\/brand\/alice-mascot-neutral\.webp" width="120" height="\d+" alt="" aria-hidden="true" loading="lazy"/)
    expect(html).not.toContain('tabindex')
  })

  it('MascotImage exposes the approved workspace-peek pose as a typed decorative asset', () => {
    const html = renderToStaticMarkup(<MascotImage pose="peek" width={266} />)
    expect(html).toContain('src="/brand/alice-mascot-peek.webp"')
    expect(html).toContain('alt=""')
    expect(html).toContain('aria-hidden="true"')
  })

  it('IllustratedState has a labelled heading, the exact approved line and an optional action', () => {
    const html = renderToStaticMarkup(<IllustratedState pose="curious" copy="projectsEmpty" title="No projects" action={<button type="button">New project</button>} />)
    expect(html).toContain('<section class="illustrated-state" aria-labelledby="state-projectsEmpty">')
    expect(html).toContain('<h2 id="state-projectsEmpty">No projects</h2>')
    expect(html).toContain(`<p class="alice-says">${ALICE_COPY.projectsEmpty.replace('’', '’')}</p>`)
    expect(html).toContain('<button type="button">New project</button>')
    expect(html.indexOf('<img')).toBeLessThan(html.indexOf('<h2'))
    expect(html).not.toContain('tabindex')
  })

  it('keeps the approved copy deck exact and free of role-play language', () => {
    expect(ALICE_COPY).toEqual({
      login: 'Welcome back. Everything’s ready for you.',
      setup: 'Let’s get your workspace in order.',
      invite: 'Welcome in. Let’s get you settled.',
      myTasksEmpty: 'All tidy. Nothing needs your attention right now.',
      projectsEmpty: 'No projects yet. Start one, and I’ll help keep things organized.',
      documentsEmpty: 'No documents yet. Add one when you’re ready.',
      notFound: 'I couldn’t find that page. Let’s head back somewhere familiar.',
      fullPageError: 'Something slipped out of place. Let’s try that again.',
    })
    for (const line of Object.values(ALICE_COPY)) expect(line).not.toMatch(/master|mistress|at your service/i)
  })

  it('pages use copy keys instead of duplicating mascot dialogue', () => {
    const offenders: string[] = []
    const walk = (dir: string) => {
      for (const f of fs.readdirSync(dir)) {
        const p = path.join(dir, f)
        if (fs.statSync(p).isDirectory()) walk(p)
        else if (/\.tsx?$/.test(f) && !p.includes(`${path.sep}brand${path.sep}`)) {
          const text = fs.readFileSync(p, 'utf8')
          for (const line of Object.values(ALICE_COPY)) if (text.includes(line.slice(0, 18))) offenders.push(`${p}: ${line}`)
        }
      }
    }
    walk(path.resolve(import.meta.dirname, '../../src/web'))
    expect(offenders).toEqual([])
  })
})
