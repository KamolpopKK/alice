import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { testDir } from '../helpers/tmp'
// @ts-expect-error standalone distributable
import { stylePresets, directionChoices, generateDirectionGallery, directionSceneHtml } from '../../skill/alice-demo/demo-styles.mjs'

const tailored = (count = 2) => Array.from({ length: count }, (_, i) => ({ ...structuredClone(stylePresets[i]), kind: 'custom', key: `tailored-${i}`, name: ['Context to delivery', 'Technical walkthrough', 'Team handoff'][i], reason: 'Tailored to this process and its audience', tradeoff: 'Long labels require readable holds', visual: { ...structuredClone(stylePresets[i].visual), key: `tailored-${i}`, layout: 'custom', composition: ['split', 'cards', 'timeline'][i] } }))

describe('visual direction choices', () => {
  it('offers six/seven meaningful directions and accepts explicit or hybrid direction without another choice', () => {
    for (const n of [2, 3]) expect(directionChoices({ tailored: tailored(n) }).choices).toHaveLength(4 + n)
    expect(new Set(stylePresets.map((d: any) => d.visual.layout)).size).toBe(4)
    expect(directionChoices({ selected: 'editorial' })).toMatchObject({ needsChoice: false, choices: [], selected: { key: 'editorial' } })
    const hybrid = tailored()[0]
    expect(directionChoices({ selected: hybrid }).selected).toEqual(hybrid)
    for (const x of [{}, { tailored: tailored(1) }, { selected: 'unknown' }, { tailored: [tailored()[0], tailored()[0]] }]) expect(() => directionChoices(x)).toThrow()
  })

  it('escapes user content instead of running embedded markup', () => {
    const html = directionSceneHtml(stylePresets[0].visual, { title: '<script>throw 1</script>', onScreenText: 'ไทย API <img src=x onerror=alert(1)>' })
    expect(html).toContain('&lt;script&gt;')
    expect(html).not.toContain('<img src=x')
  })

  it('generates native illustrated gallery files without capture or voice calls', async () => {
    const root = testDir('demo-directions-')
    fs.symlinkSync(path.resolve('node_modules'), path.join(root, 'node_modules'))
    const result = await generateDirectionGallery(root, { tailored: tailored(3), context: { title: 'ทีมและ agent', onScreenText: 'บริบทร่วมกัน → SDLC → ผลงานที่ตรวจแล้ว' } })
    expect(result.choices).toHaveLength(7)
    const images = result.choices.map((d: any) => fs.readFileSync(path.join(root, d.image)))
    expect(new Set(images.map((b: Buffer) => b.toString('base64'))).size).toBe(7)
    expect(fs.readFileSync(path.join(root, result.gallery), 'utf8')).toContain('Exploratory drafts')
    expect(fs.existsSync(path.join(root, 'media/audio'))).toBe(false)
    expect(await generateDirectionGallery(root, { selected: 'diagram' })).toMatchObject({ needsChoice: false, choices: [] })
  })
})
