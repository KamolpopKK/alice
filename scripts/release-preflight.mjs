#!/usr/bin/env node
// ตรวจก่อน build release: ล้มทันทีพร้อมบอกชื่อสิ่งที่ขาด ก่อนเสียเวลา build ทุก platform
//   node scripts/release-preflight.mjs --tag v0.2.0     (ใน release workflow: ตรวจ secret/variable ด้วย)
//   node scripts/release-preflight.mjs --dry-run        (CI ทุก push: ตรวจเฉพาะเวอร์ชันและ CHANGELOG)
// พิมพ์เฉพาะ "ชื่อ" ของ secret ที่ขาด ไม่เคยพิมพ์ค่า
import fs from 'node:fs'
import path from 'node:path'
import { releaseNotes } from './release-notes.mjs'

export const REQUIRED_SECRETS = ['TAURI_SIGNING_PRIVATE_KEY', 'TAURI_SIGNING_PRIVATE_KEY_PASSWORD', 'ALICE_MACOS_CERTIFICATE', 'ALICE_MACOS_CERTIFICATE_PASSWORD']
export const REQUIRED_VARIABLES = ['ALICE_UPDATER_PUBKEY', 'ALICE_UPDATE_URL', 'ALICE_DOWNLOAD_BASE_URL']

/** Returns the list of problems; empty means the release may build. */
export function preflight({ root = '.', tag, dryRun = false, env = process.env, repository = env.GITHUB_REPOSITORY }) {
  const read = (f) => fs.readFileSync(path.join(root, f), 'utf8')
  const problems = []
  const version = JSON.parse(read('package.json')).version
  if (!dryRun && tag !== `v${version}`) problems.push(`tag ${tag ?? '(none)'} does not match package.json version ${version} (expected v${version})`)
  if (!releaseNotes(read('CHANGELOG.md'), version)) problems.push(`CHANGELOG.md has no "## ${version}" section`)
  const composeVersion = /image: ghcr\.io\/[\w/-]+:\$\{ALICE_VERSION:-([^}]+)\}/.exec(read('compose.yaml'))?.[1]
  if (composeVersion !== version) problems.push(`compose.yaml defaults to image ${composeVersion ?? '(none)'}, not ${version}`)
  const desktop = JSON.parse(read('src-tauri/tauri.conf.json')).version
  if (desktop !== version) problems.push(`src-tauri/tauri.conf.json is ${desktop}, not ${version}`)
  const crate = /^version = "([^"]+)"/m.exec(read('src-tauri/Cargo.toml'))?.[1]
  if (crate !== version) problems.push(`src-tauri/Cargo.toml is ${crate ?? '(none)'}, not ${version}`)
  const envVersion = /^ALICE_VERSION=(.*)$/m.exec(read('.env.example'))?.[1]
  if (envVersion !== version) problems.push(`.env.example pins ALICE_VERSION=${envVersion ?? '(none)'}, not ${version}`)
  if (dryRun) return problems

  for (const name of REQUIRED_SECRETS) if (!env[name]) problems.push(`missing secret ${name}`)
  for (const name of REQUIRED_VARIABLES) if (!env[name]) problems.push(`missing variable ${name}`)
  // ทุก URL ต้องตาม release ที่ publish ล่าสุด (draft จะไม่หลุดถึงผู้ใช้)
  const latest = repository ? `https://github.com/${repository}/releases/latest/download` : null
  if (env.ALICE_DOWNLOAD_BASE_URL && latest && env.ALICE_DOWNLOAD_BASE_URL !== latest) problems.push(`ALICE_DOWNLOAD_BASE_URL should be ${latest}`)
  if (env.ALICE_UPDATE_URL && latest && env.ALICE_UPDATE_URL !== `${latest}/latest.json`) problems.push(`ALICE_UPDATE_URL should be ${latest}/latest.json`)
  return problems
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2)
  const tag = args.includes('--tag') ? args[args.indexOf('--tag') + 1] : process.env.GITHUB_REF_NAME
  const problems = preflight({ tag, dryRun: args.includes('--dry-run') })
  if (problems.length) {
    console.error('Release preflight failed:')
    for (const p of problems) console.error(`  ✗ ${p}`)
    process.exit(1)
  }
  console.log(args.includes('--dry-run') ? 'Release preflight (dry run): versions and CHANGELOG agree' : `Release preflight: ${tag} is ready to build`)
}
