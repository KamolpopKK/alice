import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { motionScript } from './demo-motion.mjs'
import { fail, hash, jobPath, writeJson, loadPlaywright, isMain, readJson, cliError } from './demo-core.mjs'

export const escapeHtml = (text) => String(text ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const profile = (key, name, layout, motion, background, foreground, accent, reason, tradeoff) => ({ key, name, kind: 'preset', reason, tradeoff,
  visual: { key, palette: { background, foreground, accent }, typography: { family: 'sans-serif' }, layout, motion, dependencies: [] } })
export const stylePresets = [
  profile('editorial', 'Editorial', 'editorial', 'reveal', '#fff8ef', '#2b2823', '#a94727', 'A calm argument with a clear reading order and generous holds.', 'Less energetic for a fast launch.'),
  profile('spotlight', 'Product Spotlight', 'spotlight', 'focus', '#111c35', '#f4f5ff', '#b8ef70', 'One focal product or feature, with supporting details around it.', 'Needs a strong central feature; less room for dense explanation.'),
  profile('diagram', 'Diagram Explainer', 'diagram', 'handoff', '#edf7f4', '#143d38', '#007e6c', 'Explain a process through connected steps and a visible handoff.', 'Poor fit for a story without a meaningful sequence.'),
  profile('kinetic', 'Kinetic Typography', 'kinetic', 'stagger', '#f6cf59', '#26211e', '#9b3026', 'A bold statement followed by staged supporting words.', 'Requires concise copy and slower holds for Thai/technical terms.'),
]

function validateDirection(d) {
  const v = d?.visual
  if (!d || !/^[\w-]{1,80}$/.test(d.key ?? '') || !['preset', 'custom'].includes(d.kind) ||
      !['name', 'reason', 'tradeoff'].every((k) => typeof d[k] === 'string' && d[k].trim()) ||
      !v || v.key !== d.key || !['editorial', 'spotlight', 'diagram', 'kinetic', 'custom'].includes(v.layout) ||
      !['reveal', 'stagger', 'focus', 'handoff', 'none'].includes(v.motion) ||
      !['background', 'foreground', 'accent'].every((k) => /^#[\da-f]{6}$/i.test(v.palette?.[k] ?? '')) ||
      typeof v.typography?.family !== 'string' || !v.typography.family.trim() || !Array.isArray(v.dependencies) ||
      (v.layout === 'custom' && !['split', 'cards', 'timeline'].includes(v.composition))) fail('INVALID_DIRECTION', 'Provide a named direction with concrete visual tokens, composition, motion, reason and trade-off')
  return structuredClone(d)
}

export function directionChoices({ tailored = [], selected } = {}) {
  if (selected) {
    const direction = typeof selected === 'string' ? stylePresets.find((d) => d.key === selected) : selected
    return { selected: validateDirection(direction), choices: [], needsChoice: false }
  }
  if (![2, 3].includes(tailored.length)) fail('INVALID_CHOICES', 'Propose two or three tailored directions alongside the four base profiles')
  const choices = [...stylePresets, ...tailored].map(validateDirection)
  if (new Set(choices.map((d) => d.key)).size !== choices.length || tailored.some((d) => d.kind !== 'custom')) fail('INVALID_CHOICES', 'Tailored directions need unique keys and custom kind')
  return { selected: null, choices, needsChoice: true }
}

// The same native composition is used for exploratory cards and selected/full scenes.
export function directionSceneHtml(visual, scene = {}) {
  const p = visual.palette, layout = visual.layout === 'custom' ? visual.composition : visual.layout
  const title = escapeHtml(scene.title || 'A clear story'), copy = escapeHtml(scene.onScreenText || 'Shared context → Focused work → Verified result')
  const steps = (scene.steps ?? ['Context', 'Work', 'Outcome']).map((s, i) => `<div class="step" data-part><b>0${i + 1}</b><span>${escapeHtml(s)}</span></div>`).join('<span class="arrow" data-part>→</span>')
  const content = layout === 'timeline' ? `<section data-part><small>THE HANDOFF</small><h1>${title}</h1><p>${copy}</p></section><section class="flow">${steps}</section>`
    : layout === 'diagram' ? `<header data-part><small>FOLLOW THE FLOW</small><h1>${title}</h1></header><section class="flow">${steps}</section><p data-part>${copy}</p>`
    : layout === 'spotlight' ? `<header data-part><small>IN FOCUS</small><h1>${title}</h1></header><section class="feature" data-part><span>✦</span><p>${copy}</p></section>`
      : layout === 'kinetic' ? `<small data-part>MAKE IT CLEAR.</small><h1 data-part>${title}</h1><p class="statement" data-part>${copy}</p>`
        : layout === 'split' ? `<header data-part><small>CONTEXT / OUTCOME</small><h1>${title}</h1></header><section class="split-copy" data-part><span class="big-mark">→</span><p>${copy}</p></section>`
        : layout === 'cards' ? `<h1 data-part>${title}</h1><section class="flow">${steps}</section><p data-part>${copy}</p>`
          : `<aside data-part><span>01 / THE IDEA</span><div class="rule"></div></aside><section><small data-part>ONE STORY. SHARED CONTEXT.</small><h1 data-part>${title}</h1><p data-part>${copy}</p></section>`
  return `<!doctype html><html lang="th"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<style>*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden}body{background:${p.background};color:${p.foreground};font-family:${JSON.stringify(visual.typography.family).replace(/</g, '\\3c ')},sans-serif}main{height:100%;padding:7%;display:flex;flex-direction:column;justify-content:center;gap:3vh}small,aside{letter-spacing:.12em;font-size:1.6vw}h1{font-size:5vw;line-height:1.4;margin:1vh 0;overflow-wrap:anywhere}p{font-size:2.5vw;line-height:1.65;margin:0;white-space:pre-wrap;overflow-wrap:anywhere}.rule{height:1vh;background:${p.accent};width:10vw;margin-top:3vh}aside{color:${p.accent}}main.editorial,main.split{display:grid;grid-template-columns:22% 1fr;align-items:center;gap:5%}main.split{grid-template-columns:1fr 1fr}main.split .split-copy{border-left:2px solid ${p.accent};padding-left:3vw}.big-mark{font-size:8vw;color:${p.accent}} .flow{display:flex;align-items:stretch;gap:1.5vw}.step{flex:1;background:${p.foreground}0e;border:1px solid ${p.foreground}40;border-radius:1.5vw;padding:2vw;display:flex;flex-direction:column;gap:2vh;min-width:0}.step b{font-size:3vw;color:${p.accent}}.step span{font-size:2vw;line-height:1.5;overflow-wrap:anywhere}.arrow{align-self:center;font-size:2vw;color:${p.accent}}.feature{display:grid;grid-template-columns:25% 1fr;align-items:center;border:1px solid ${p.accent};padding:4vw;border-radius:3vw;gap:4vw}.feature>span{font-size:9vw;color:${p.accent};text-align:center}main.kinetic h1{font-size:7vw;max-width:85%}.statement{border-left:.7vw solid ${p.accent};padding-left:3vw}main.cards .arrow{display:none}main.timeline{display:grid;grid-template-columns:1fr 1fr;align-items:center;gap:5%}.timeline .flow{flex-direction:column;gap:1vh}.timeline .step{flex-direction:row;align-items:center;padding:1.3vw;gap:2vw}.timeline .arrow{rotate:90deg}footer{position:absolute;bottom:14%;left:7%;font-size:1.2vw;opacity:.65}</style>
<main class="${escapeHtml(layout)}">${content}</main><footer>${escapeHtml(scene.disclosure || '')}</footer>
<script>${motionScript(visual, scene.duration ?? 5, scene.seed ?? 0)}</script></html>`
}

export async function generateDirectionGallery(root, input, { chromium } = {}) {
  const selection = directionChoices(input)
  if (!selection.needsChoice) return selection
  const relative = `directions/${randomUUID()}`, folder = jobPath(root, relative)
  fs.mkdirSync(folder, { recursive: true })
  const browser = await (chromium ?? loadPlaywright(root).chromium).launch({ headless: true })
  const records = []
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 540 } })
    await page.route('**/*', (route) => route.abort())
    for (const d of selection.choices) {
      const html = directionSceneHtml(d.visual, { ...input.context, disclosure: 'EXPLORATORY DRAFT · visual direction only' })
      fs.writeFileSync(path.join(folder, `${d.key}.html`), html)
      await page.setContent(html, { waitUntil: 'load' })
      await page.evaluate(() => document.fonts.ready)
      await page.screenshot({ path: path.join(folder, `${d.key}.png`), animations: 'disabled' })
      records.push({ ...d, image: `${relative}/${d.key}.png`, imageHash: hash(fs.readFileSync(path.join(folder, `${d.key}.png`))) })
    }
    const cards = records.map((d) => `<article><img src="${d.key}.png" alt="${escapeHtml(d.name)} direction"><h2>${escapeHtml(d.name)}</h2><p>${escapeHtml(d.reason)}</p><p><b>Trade-off:</b> ${escapeHtml(d.tradeoff)}</p><p>${escapeHtml(d.visual.layout)} · ${escapeHtml(d.visual.motion)} · ${escapeHtml(d.visual.typography.family)}</p><p>${Object.values(d.visual.palette).map((c) => `<span style="display:inline-block;margin-right:.5em"><i style="display:block;background:${c};border:1px solid #888;height:2em"></i><code>${c}</code></span>`).join(' ')}</p></article>`).join('')
    fs.writeFileSync(path.join(folder, 'gallery.html'), `<!doctype html><meta charset="utf-8"><title>Visual directions</title><style>body{background:#fff8ef;color:#282520;font:16px/1.6 system-ui;margin:3vw}section{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:24px}article{border:1px solid #ccc;padding:16px;border-radius:16px;background:#fff}img{width:100%;border-radius:8px}</style><h1>Choose a visual direction</h1><p>Exploratory drafts. Choose, combine or provide another direction. No production or voice generation is authorized by this gallery.</p><section>${cards}</section>`)
    const result = { ...selection, choices: records, gallery: `${relative}/gallery.html`, licence: 'Native HTML/CSS compositions; no third-party media. Verify any added fonts/assets individually.' }
    writeJson(root, `${relative}/choices.json`, result)
    return result
  } finally { await browser.close() }
}

if (isMain(import.meta.url)) {
  try {
    const [command, root, file] = process.argv.slice(2)
    if (command === 'gallery') console.log(JSON.stringify(await generateDirectionGallery(root, readJson(file)), null, 2))
    else console.log('demo-styles.mjs gallery JOB DIRECTIONS.json\nProvide context and two or three tailored directions, or selected to skip an already settled choice. Draft only; no voice or capture.')
  } catch (error) { cliError(error) }
}
