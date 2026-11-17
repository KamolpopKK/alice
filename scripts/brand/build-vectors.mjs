#!/usr/bin/env node
// สร้าง SVG ของแบรนด์ทั้งหมดจากต้นฉบับ vector ใน mark-art.mjs และ wordmark.mjs แล้ว export PNG icon
// usage: node scripts/brand/build-vectors.mjs
import fs from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'
import { COLORS, headArt, monochromeArt } from './mark-art.mjs'
import { WORDMARK } from './wordmark.mjs'

const OUT = 'src/web/public/brand'
const svg = (viewBox, body, extra = '') =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}"${extra}>\n  ${body.trim()}\n</svg>\n`
const write = (name, text) => fs.writeFileSync(path.join(OUT, name), text)

fs.mkdirSync(OUT, { recursive: true })

// compact mark (ตัวละครสีจริง) และ favicon (ตัวเดียวกัน ปรับให้หนาขึ้นเล็กน้อยไม่จำเป็น เพราะทดสอบที่ 16px แล้ว)
write('alice-mark.svg', svg('0 0 64 64', headArt(), ' width="64" height="64"'))
write('alice-mark-monochrome.svg', svg('0 0 64 64', monochromeArt(), ' width="64" height="64" fill="currentColor"'))
write('favicon.svg', svg('0 0 64 64', headArt(), ' width="64" height="64"'))

// horizontal logo: mark 64 + wordmark; light = navy wordmark, dark = ivory wordmark + halo รอบหัว
const logo = (ink, halo) =>
  svg(
    `0 0 ${64 + 8 + WORDMARK.width} 64`,
    `<g>${headArt({ halo })}</g>\n  <g transform="translate(72 0)">${WORDMARK.paths(ink, COLORS.coral)}</g>`,
    ` width="${64 + 8 + WORDMARK.width}" height="64" role="img" aria-label="Alice"`,
  )
write('alice-logo-horizontal-light.svg', logo(COLORS.navy900, null))
write('alice-logo-horizontal-dark.svg', logo(COLORS.ivory, COLORS.ivory))

// raster icons จาก vector (พื้นทึบ + safe padding)
async function icon(name, size, background, padding) {
  const inner = Math.round(size * (1 - padding * 2))
  const art = await sharp(Buffer.from(svg('0 0 64 64', headArt({ halo: background === COLORS.navy900 ? COLORS.ivory : null }))), { density: (72 * inner) / 64 })
    .resize(inner, inner)
    .png()
    .toBuffer()
  const base = sharp({ create: { width: size, height: size, channels: background ? 3 : 4, background: background ?? { r: 0, g: 0, b: 0, alpha: 0 } } })
  await base.composite([{ input: art, gravity: 'center' }]).png({ compressionLevel: 9 }).toFile(path.join(OUT, name))
}
await icon('favicon-32.png', 32, null, 0)
await icon('apple-touch-icon.png', 180, COLORS.navy900, 0.12)
await icon('icon-192.png', 192, COLORS.navy900, 0.12)
await icon('icon-512.png', 512, COLORS.navy900, 0.12)
// ไอคอนแอป Desktop (Tauri) ใช้ต้นฉบับเดียวกัน
await icon('../../../../src-tauri/app-icon.png', 1024, COLORS.navy900, 0.12)
console.log('vectors and icons written to', OUT)
