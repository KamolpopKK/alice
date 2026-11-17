#!/usr/bin/env node
// สร้าง mascot WebP โปร่งใสจาก character sheet ที่อนุมัติแล้ว (artifacts/ เป็น input ของ script นี้เท่านั้น)
// usage: node scripts/brand/extract-mascots.mjs [--preview DIR]
//
// Workflow: crop each approved pose → remove the flat board background by flood-filling from the
// crop border (the character's closed dark outline stops the fill) → drop the floor shadow and
// fragments of neighbouring poses → un-mix anti-aliased edge pixels into real alpha → trim → WebP.
import fs from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'

const SOURCE = 'artifacts/mascot-brand/alice-character-sheet-v1.png'
const OUT = 'src/web/public/brand'
const preview = process.argv.includes('--preview') ? process.argv[process.argv.indexOf('--preview') + 1] : null

// พิกัดบน character sheet (1536×1024) ของท่าที่อนุมัติ
export const POSES = {
  friendly: { crop: [140, 0, 280, 560], note: 'front view, full body, open smile' },
  neutral: { crop: [20, 572, 262, 290], note: 'bust, calm smile' },
  focused: { crop: [512, 572, 254, 290], note: 'bust, thinking, hand to chin' },
  curious: { crop: [752, 572, 256, 290], note: 'bust, curious, finger to cheek' },
  concerned: { crop: [996, 572, 258, 290], note: 'bust, mildly worried (no tears)' },
}

const BG_TOLERANCE = 26 // RGB distance treated as board background
const SHADOW = [224, 198, 188] // floor shadow under the full-body pose
const SHADOW_TOLERANCE = 34
const EDGE_BAND = 2

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])

async function extract(name, { crop }) {
  const [left, top, width, height] = crop
  const { data } = await sharp(SOURCE).extract({ left, top, width, height }).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  const px = (i) => [data[i * 3], data[i * 3 + 1], data[i * 3 + 2]]

  // สีพื้นหลัง = median ของขอบภาพ
  const border = []
  for (let x = 0; x < width; x++) border.push(px(x), px((height - 1) * width + x))
  for (let y = 0; y < height; y++) border.push(px(y * width), px(y * width + width - 1))
  const bg = [0, 1, 2].map((c) => border.map((p) => p[c]).sort((a, b) => a - b)[border.length >> 1])

  // 1) flood fill พื้นหลังจากขอบ (หยุดที่เส้นขอบตัวละคร)
  const isBg = new Uint8Array(width * height)
  const queue = []
  const seed = (i) => {
    if (!isBg[i] && (dist(px(i), bg) < BG_TOLERANCE || dist(px(i), SHADOW) < SHADOW_TOLERANCE)) {
      isBg[i] = 1
      queue.push(i)
    }
  }
  for (let x = 0; x < width; x++) seed(x), seed((height - 1) * width + x)
  for (let y = 0; y < height; y++) seed(y * width), seed(y * width + width - 1)
  while (queue.length) {
    const i = queue.pop()
    const x = i % width
    const y = (i / width) | 0
    for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
      seed(ny * width + nx)
    }
  }

  // 2) เก็บเฉพาะชิ้นส่วนของตัวละครหลัก (ตัดเศษของท่าข้าง ๆ)
  const label = new Int32Array(width * height).fill(-1)
  const comps = []
  for (let i = 0; i < width * height; i++) {
    if (isBg[i] || label[i] >= 0) continue
    const id = comps.length
    const stack = [i]
    label[i] = id
    let count = 0
    let minX = width, maxX = 0, minY = height, maxY = 0
    while (stack.length) {
      const j = stack.pop()
      count++
      const x = j % width
      const y = (j / width) | 0
      minX = Math.min(minX, x), maxX = Math.max(maxX, x), minY = Math.min(minY, y), maxY = Math.max(maxY, y)
      for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
        const k = ny * width + nx
        if (!isBg[k] && label[k] < 0) (label[k] = id), stack.push(k)
      }
    }
    comps.push({ id, count, minX, maxX, minY, maxY })
  }
  const main = comps.reduce((a, b) => (b.count > a.count ? b : a))
  const keep = new Set(
    comps
      .filter((c) => c === main || (c.count > 12 && c.minX >= main.minX && c.maxX <= main.maxX && c.minY >= main.minY && c.maxY <= main.maxY))
      .map((c) => c.id),
  )

  // 3) alpha: พื้นหลัง = 0, ตัวละคร = 255, ขอบ anti-alias = แยกสีพื้นหลังออก
  const rgba = Buffer.alloc(width * height * 4)
  const outline = [70, 48, 46]
  const span = dist(outline, bg)
  const nearBg = (i) => {
    const x = i % width
    const y = (i / width) | 0
    for (let dy = -EDGE_BAND; dy <= EDGE_BAND; dy++)
      for (let dx = -EDGE_BAND; dx <= EDGE_BAND; dx++) {
        const nx = x + dx
        const ny = y + dy
        if (nx >= 0 && ny >= 0 && nx < width && ny < height && label[ny * width + nx] < 0) return true
      }
    return false
  }
  let minX = width, maxX = 0, minY = height, maxY = 0
  for (let i = 0; i < width * height; i++) {
    const p = px(i)
    let a = keep.has(label[i]) ? 255 : 0
    let c = p
    if (a && nearBg(i)) {
      const t = Math.min(1, dist(p, bg) / span)
      a = Math.round(255 * Math.min(1, t * 1.6))
      if (a > 0 && a < 255) {
        const k = a / 255
        c = p.map((v, ch) => Math.max(0, Math.min(255, Math.round((v - (1 - k) * bg[ch]) / k))))
      }
    }
    rgba.set([...c, a], i * 4)
    if (a > 0) {
      const x = i % width
      const y = (i / width) | 0
      minX = Math.min(minX, x), maxX = Math.max(maxX, x), minY = Math.min(minY, y), maxY = Math.max(maxY, y)
    }
  }

  const pad = 6
  const box = { left: Math.max(0, minX - pad), top: Math.max(0, minY - pad) }
  box.width = Math.min(width, maxX + pad + 1) - box.left
  box.height = Math.min(height, maxY + pad + 1) - box.top
  const image = sharp(rgba, { raw: { width, height, channels: 4 } }).extract(box)
  const file = path.join(OUT, `alice-mascot-${name}.webp`)
  await image.clone().webp({ quality: 90, alphaQuality: 100, effort: 6 }).toFile(file)
  if (preview) {
    fs.mkdirSync(preview, { recursive: true })
    // ตรวจขอบบนพื้นขาว / navy / checkerboard
    for (const [label2, background] of [['white', '#ffffff'], ['navy', '#202A44']]) {
      await image.clone().flatten({ background }).png().toFile(path.join(preview, `${name}-${label2}.png`))
    }
  }
  const size = fs.statSync(file).size
  return { name, file, width: box.width, height: box.height, bytes: size }
}

fs.mkdirSync(OUT, { recursive: true })
const results = []
for (const [name, pose] of Object.entries(POSES)) results.push(await extract(name, pose))
for (const r of results) console.log(`${r.file}  ${r.width}×${r.height}  ${(r.bytes / 1024).toFixed(1)} KiB`)
fs.writeFileSync(path.join(OUT, '.mascots.json'), JSON.stringify(results, null, 2))
