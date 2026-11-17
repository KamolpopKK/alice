#!/usr/bin/env node
// สร้างฉากพื้นหลังโหมดสว่างจากฉากโหมดมืดที่อนุมัติแล้ว (โครงเดียวกัน โทนงาช้าง)
// "smart invert": กลับค่าความสว่างแต่คง hue แล้วผสมเข้าหาสีงาช้างเพื่อให้ความต่างนุ่ม ๆ
import sharp from 'sharp'

const SRC = 'src/web/public/brand/alice-auth-workspace-dark.webp'
const OUT = 'src/web/public/brand/alice-auth-workspace-light.webp'
const IVORY = [250, 243, 232]
const STRENGTH = 0.6 // สัดส่วนของภาพกลับค่าที่ผสมกับพื้นงาช้าง

function rgbToHsl(r, g, b) {
  r /= 255, g /= 255, b /= 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  let h = 0, s = 0
  const l = (max + min) / 2
  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4
    h /= 6
  }
  return [h, s, l]
}
function hslToRgb(h, s, l) {
  if (s === 0) return [l, l, l].map((v) => v * 255)
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  const f = (t) => {
    if (t < 0) t += 1
    if (t > 1) t -= 1
    if (t < 1 / 6) return p + (q - p) * 6 * t
    if (t < 1 / 2) return q
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
    return p
  }
  return [f(h + 1 / 3), f(h), f(h - 1 / 3)].map((v) => v * 255)
}

const { data, info } = await sharp(SRC).removeAlpha().raw().toBuffer({ resolveWithObject: true })
// ความสว่างพื้นของฉากมืด (median) — ส่วนที่สว่างกว่านี้คือ "โครง" (board, โคม, ต้นไม้)
const lums = []
for (let i = 0; i < data.length; i += 3 * 97) lums.push(rgbToHsl(data[i], data[i + 1], data[i + 2])[2])
const base = lums.sort((a, b) => a - b)[lums.length >> 1]
const INK = [118, 106, 98] // เทาอุ่นสำหรับโครงบนพื้นงาช้าง
const smooth = (x) => Math.min(1, Math.max(0, x)) ** 2 * (3 - 2 * Math.min(1, Math.max(0, x)))
const out = Buffer.alloc(data.length)
for (let i = 0; i < data.length; i += 3) {
  const [h, sat, l] = rgbToHsl(data[i], data[i + 1], data[i + 2])
  const d = Math.max(0, l - base) * STRENGTH * 3.2
  const neutral = IVORY.map((c, k) => c - d * (c - INK[k]))
  // สีคอรัลและแสงโคมไฟ: คง hue ไว้แบบนุ่ม ๆ (น้ำหนักตามความอิ่มสี)
  const w = smooth((sat - 0.25) / 0.35) * smooth((l - base) / 0.15) * 0.55
  const accent = hslToRgb(h, Math.min(1, sat), Math.min(0.82, 1 - l * 0.6))
  for (let c = 0; c < 3; c++) out[i + c] = Math.round(neutral[c] * (1 - w) + accent[c] * w)
}
await sharp(out, { raw: info }).webp({ quality: 82, effort: 6 }).toFile(OUT)
console.log('wrote', OUT)
