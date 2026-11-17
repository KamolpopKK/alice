import manifest from '../public/brand/brand-assets.json'

// ทุก path ของแบรนด์มาจาก manifest ที่ build script เขียน — ห้าม hard-code ชื่อไฟล์ในหน้าต่าง ๆ
type AssetKey = keyof typeof manifest.assets

export interface BrandAsset {
  src: string
  width: number
  height: number
}

function asset(key: AssetKey): BrandAsset {
  const a = manifest.assets[key]
  return { src: a.path, width: a.width, height: a.height }
}

export const MASCOTS = {
  friendly: asset('mascotFriendly'),
  peek: asset('mascotPeek'),
  neutral: asset('mascotNeutral'),
  curious: asset('mascotCurious'),
  focused: asset('mascotFocused'),
  concerned: asset('mascotConcerned'),
} as const

export type MascotPose = keyof typeof MASCOTS

export const LOGOS = {
  light: asset('logoLight'),
  dark: asset('logoDark'),
  mark: asset('mark'),
} as const

/** Ambient workspace backdrop of the authentication scene (decorative). */
export const AUTH_BACKGROUNDS = {
  dark: asset('authWorkspaceDark'),
  light: asset('authWorkspaceLight'),
} as const

export const BRAND_PALETTE = manifest.palette
