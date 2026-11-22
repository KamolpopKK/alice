#!/usr/bin/env node
// export ภาพ concept ของ README จากร่างที่ได้รับอนุมัติ (docs/design/alice-concept-draft.png)
// usage: node scripts/brand/build-readme-concept.mjs --final   (เขียน docs/images/alice-concept.webp)
//        node scripts/brand/build-readme-concept.mjs --check   (ตรวจว่าไฟล์ที่ commit ตรงกับที่ export ได้)
import fs from 'node:fs'
import sharp from 'sharp'

const SOURCE = 'docs/design/alice-concept-draft.png'
const OUTPUT = 'docs/images/alice-concept.webp'
const MAX_BYTES = 500 * 1024
// 2 เท่าของความกว้างที่ README แสดง (720px) ให้คมบนจอ retina
const WIDTH = 1440

async function render() {
  // ลด quality ทีละขั้นจนได้ขนาดไม่เกินเพดาน; ค่าเดิมให้ผลเดิมทุกครั้ง
  for (let quality = 86; quality >= 50; quality -= 4) {
    const buffer = await sharp(SOURCE).resize({ width: WIDTH }).webp({ quality, effort: 6 }).toBuffer()
    if (buffer.length <= MAX_BYTES) return { buffer, quality }
  }
  throw new Error(`Could not fit ${SOURCE} under ${MAX_BYTES} bytes`)
}

const mode = process.argv[2]
if (mode !== '--final' && mode !== '--check') {
  console.error('usage: node scripts/brand/build-readme-concept.mjs --final | --check')
  process.exit(2)
}
const { buffer, quality } = await render()
const meta = await sharp(buffer).metadata()
if (mode === '--final') {
  fs.writeFileSync(OUTPUT, buffer)
  console.log(`${OUTPUT}: ${meta.width}x${meta.height}, ${buffer.length} bytes (quality ${quality}, limit ${MAX_BYTES})`)
} else {
  const committed = fs.readFileSync(OUTPUT)
  if (!committed.equals(buffer)) {
    console.error(`${OUTPUT} does not match an export of ${SOURCE}; run with --final`)
    process.exit(1)
  }
  console.log(`${OUTPUT} matches ${SOURCE} (${committed.length} bytes)`)
}
