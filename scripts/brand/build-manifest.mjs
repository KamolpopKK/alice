#!/usr/bin/env node
// เขียน brand-assets.json: เวอร์ชัน, path, ขนาด, หน้าที่, ใช้บนพื้นสว่าง/มืด และ palette
import fs from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'
import { COLORS } from './mark-art.mjs'

const DIR = 'src/web/public/brand'
const ASSETS = [
  ['logoLight', 'alice-logo-horizontal-light.svg', ['auth', 'readme'], ['light']],
  ['logoDark', 'alice-logo-horizontal-dark.svg', ['auth'], ['dark']],
  ['mark', 'alice-mark.svg', ['header', 'compact'], ['light', 'dark']],
  ['markMonochrome', 'alice-mark-monochrome.svg', ['single-colour contexts'], ['light', 'dark']],
  ['mascotFriendly', 'alice-mascot-friendly.webp', ['login', 'setup', 'invite'], ['light', 'dark']],
  ['mascotPeek', 'alice-mascot-peek.webp', ['login', 'setup', 'invite'], ['light', 'dark']],
  ['mascotPeekPng', 'alice-mascot-peek.png', ['design source', 'fallback'], ['light', 'dark']],
  ['mascotNeutral', 'alice-mascot-neutral.webp', ['my-tasks-empty'], ['light', 'dark']],
  ['mascotCurious', 'alice-mascot-curious.webp', ['projects-empty'], ['light', 'dark']],
  ['mascotFocused', 'alice-mascot-focused.webp', ['documents-empty'], ['light', 'dark']],
  ['mascotConcerned', 'alice-mascot-concerned.webp', ['not-found', 'full-page-error'], ['light', 'dark']],
  ['authWorkspaceDark', 'alice-auth-workspace-dark.webp', ['authentication background'], ['dark']],
  ['authWorkspaceLight', 'alice-auth-workspace-light.webp', ['authentication background'], ['light']],
  ['favicon', 'favicon.svg', ['favicon'], ['light', 'dark']],
  ['favicon32', 'favicon-32.png', ['favicon fallback'], ['light', 'dark']],
  ['appleTouchIcon', 'apple-touch-icon.png', ['apple-touch-icon'], ['light', 'dark']],
  ['icon192', 'icon-192.png', ['web manifest'], ['light', 'dark']],
  ['icon512', 'icon-512.png', ['web manifest'], ['light', 'dark']],
]

const assets = {}
for (const [key, file, surfaces, schemes] of ASSETS) {
  const full = path.join(DIR, file)
  const meta = await sharp(full).metadata()
  assets[key] = {
    path: `/brand/${file}`,
    width: meta.width,
    height: meta.height,
    bytes: fs.statSync(full).size,
    surfaces,
    schemes,
  }
}
const manifest = {
  version: '1.1.0',
  source: 'Approved Alice concept boards and workspace-peek reference; workflow and regeneration in docs/brand-assets.md',
  palette: {
    'brand-navy-900': COLORS.navy900,
    'brand-navy-700': COLORS.navy700,
    'brand-ivory': COLORS.ivory,
    'brand-cocoa': COLORS.cocoa,
    'brand-coral': COLORS.coral,
    'brand-coral-accessible': COLORS.coralAccessible,
  },
  assets,
}
fs.writeFileSync(path.join(DIR, 'brand-assets.json'), JSON.stringify(manifest, null, 2) + '\n')
fs.rmSync(path.join(DIR, '.mascots.json'), { force: true })
for (const [k, a] of Object.entries(assets)) console.log(`${k.padEnd(16)} ${a.path.padEnd(40)} ${a.width}×${a.height} ${(a.bytes / 1024).toFixed(1)} KiB`)
