// วาด head mark ของ Alice เป็น vector ล้วน (ไม่มี bitmap) — ใช้ร่วมกันใน mark, logo, favicon และ icon
// พิกัดอยู่ใน viewBox 0 0 64 64
export const COLORS = {
  navy900: '#202A44',
  navy700: '#344466',
  ivory: '#FFF8EE',
  cocoa: '#4A312E',
  coral: '#EE715F',
  coralAccessible: '#B64336',
  appIconBlue: '#1447D8',
  skin: '#FCE5D4',
  eye: '#2E201E',
  shine: '#6E4C47',
}

const C = COLORS

/** Headband + hair silhouette (also used for the halo on dark surfaces). */
export const SILHOUETTE = [
  'M14.5 21.5c-1.2-3.4.6-6.6 3.8-7.4.4-3.4 3.4-5.6 6.8-5 1.6-2.9 4.9-4 7.8-2.8 2.9-1.3 6.3-.2 7.9 2.7 3.4-.6 6.4 1.6 6.8 5 3.2.8 5 4 3.8 7.4z',
  'M32 15.5c-11.6 0-19.4 8.3-19.4 19.5 0 6 1.6 10.6 2.9 13.3 1 2.1 3.1 3.1 5 2.4l1.9-.7h19.2l1.9.7c1.9.7 4-.3 5-2.4 1.3-2.7 2.9-7.3 2.9-13.3 0-11.2-7.8-19.5-19.4-19.5z',
]

/** Full-colour head: natural character colours on any surface. `halo` adds an outline for dark surfaces. */
export function headArt({ halo = null } = {}) {
  const haloLayer = halo
    ? `<g fill="${halo}" stroke="${halo}" stroke-width="6" stroke-linejoin="round">${SILHOUETTE.map((d) => `<path d="${d}"/>`).join('')}</g>`
    : ''
  return `${haloLayer}
  <g stroke="${C.cocoa}" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round">
    <path fill="${C.ivory}" d="${SILHOUETTE[0]}"/>
    <path fill="${C.cocoa}" d="${SILHOUETTE[1]}"/>
  </g>
  <path fill="none" stroke="${C.cocoa}" stroke-width="1.2" opacity="0.55" d="M19.6 16.2l1.6 4M26 11.4l.9 5.2M33 9.6v5.4M40 11.6l-1 5M45.2 16.4l-1.8 4"/>
  <ellipse cx="32" cy="38.6" rx="11.8" ry="11.9" fill="${C.skin}"/>
  <path fill="${C.cocoa}" d="M44.2 30.6c-1.6-6.2-6.4-9.6-12.2-9.6-6.9 0-11.8 4.9-11.9 12.2l.1 5.6c2.2-3.5 5.6-6.4 10.2-8.1 4.8-1.8 9.5-1.6 13.8-.1z"/>
  <path fill="none" stroke="${C.shine}" stroke-width="1.5" stroke-linecap="round" d="M22.5 24.8c1.4-1.6 3.1-2.7 5-3.3M24.6 27.2c1.1-1 2.4-1.8 3.8-2.3"/>
  <ellipse cx="26.6" cy="39" rx="2.5" ry="3.2" fill="${C.eye}"/>
  <ellipse cx="37.6" cy="39" rx="2.5" ry="3.2" fill="${C.eye}"/>
  <circle cx="27.5" cy="37.8" r="0.95" fill="${C.ivory}"/>
  <circle cx="38.5" cy="37.8" r="0.95" fill="${C.ivory}"/>
  <ellipse cx="23.4" cy="43.6" rx="2.1" ry="1.2" fill="${C.coral}" opacity="0.6"/>
  <ellipse cx="40.8" cy="43.6" rx="2.1" ry="1.2" fill="${C.coral}" opacity="0.6"/>
  <path fill="#C2493B" d="M29.6 44.8c.5 1.9 1.3 2.8 2.4 2.8s1.9-.9 2.4-2.8z"/>`
}

/** Desktop-only app icon: a close crop of Alice's bow, hair, forehead and eyes. */
export function desktopAppIconArt() {
  return `<rect width="64" height="64" fill="${C.appIconBlue}"/>
  <path fill="${C.cocoa}" d="M1 64V45.5C1 26.9 13.5 17 32 17s31 9.9 31 28.5V64z"/>
  <path fill="${C.skin}" d="M12.5 64V50.4c11.3-.6 26.2-4.8 33.2-14.2 1.4 4.4 4.2 8.3 7.8 10.9V64z"/>
  <path fill="${C.coral}" d="M9.8 19.4c0-4.9 4.4-7.3 8.2-4.3l5.8 4.5-5.8 4.5c-3.8 3-8.2.2-8.2-4.7zM23.8 19.6l6.4-5.1c3.8-3 8-.4 8 4.7 0 5-4.2 7.7-8 4.7z"/>
  <ellipse cx="23.8" cy="19.6" rx="3.1" ry="3.4" fill="${C.coral}"/>
  <ellipse cx="24.6" cy="55.6" rx="3.1" ry="4.4" fill="${C.eye}"/>
  <ellipse cx="43.2" cy="55.6" rx="3.1" ry="4.4" fill="${C.eye}"/>`
}

/** One-colour mark: silhouette in currentColor with the face knocked out (even-odd), features filled. */
export function monochromeArt() {
  const face = 'M20.2 38.6a11.8 11.9 0 1 0 23.6 0a11.8 11.9 0 1 0 -23.6 0z'
  return `<g fill="currentColor">
    <path fill="none" stroke="currentColor" stroke-width="2.6" stroke-linejoin="round" d="${SILHOUETTE[0]}"/>
    <path fill-rule="evenodd" d="${SILHOUETTE[1]} ${face}"/>
    <path d="M44.2 30.6c-1.6-6.2-6.4-9.6-12.2-9.6-6.9 0-11.8 4.9-11.9 12.2l.1 5.6c2.2-3.5 5.6-6.4 10.2-8.1 4.8-1.8 9.5-1.6 13.8-.1z"/>
    <ellipse cx="26.6" cy="39" rx="2.5" ry="3.2"/>
    <ellipse cx="37.6" cy="39" rx="2.5" ry="3.2"/>
    <path d="M29.6 44.8c.5 1.9 1.3 2.8 2.4 2.8s1.9-.9 2.4-2.8z"/>
  </g>`
}
