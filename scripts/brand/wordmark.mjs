// Wordmark "Alice": ตัวอักษร geometric ปลายมน สร้างจาก path ล้วน (ไม่มี font) จึง render ได้เหมือนกันทุกที่
// สูง 64 หน่วย ให้ตรงกับ mark; baseline ที่ y=53
const W = 9 // stroke width
const BASE = 53
const TOP = 15

function letters() {
  let x = W / 2
  const parts = []
  // A
  parts.push(`M${x} ${BASE}L${x + 13.5} ${TOP}L${x + 27} ${BASE}M${x + 6.6} ${BASE - 12}H${x + 20.4}`)
  x += 27 + 11
  // l
  parts.push(`M${x} ${TOP - 2}V${BASE}`)
  x += 14
  // i (stem; dot is drawn separately in coral)
  const iX = x
  parts.push(`M${x} ${TOP + 13}V${BASE}`)
  x += 9 + 13.5
  // c
  const cX = x
  parts.push(`M${cX + 11.2} ${BASE - 21.6}A13.5 13.5 0 1 0 ${cX + 11.2} ${BASE - 4.4}`)
  x += 13.5 + 10 + 13
  // e
  const eX = x
  parts.push(`M${eX - 12.5} ${BASE - 13.3}H${eX + 13}A13 13 0 1 0 ${eX + 9.4} ${BASE - 4}`)
  x += 13 + W / 2
  return { d: parts.join(''), iX, width: Math.ceil(x) }
}

const L = letters()

export const WORDMARK = {
  width: L.width,
  /** @param ink wordmark colour  @param dot accent colour for the i dot (decorative) */
  paths(ink, dot) {
    return `<path fill="none" stroke="${ink}" stroke-width="${W}" stroke-linecap="round" stroke-linejoin="round" d="${L.d}"/><circle cx="${L.iX}" cy="${TOP + 1.5}" r="${W / 2 + 1}" fill="${dot}"/>`
  },
}
