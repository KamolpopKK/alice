#!/usr/bin/env node
// พิมพ์เฉพาะส่วนของเวอร์ชันนั้นจาก CHANGELOG.md เป็น release notes
//   node scripts/release-notes.mjs 0.2.0 [CHANGELOG.md]
import fs from 'node:fs'

export function releaseNotes(changelog, version) {
  const lines = changelog.split('\n')
  const start = lines.findIndex((l) => l === `## ${version}` || l.startsWith(`## ${version} `))
  if (start < 0) return null
  const end = lines.findIndex((l, i) => i > start && l.startsWith('## '))
  return lines.slice(start + 1, end < 0 ? undefined : end).join('\n').trim() + '\n'
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [version, file = 'CHANGELOG.md'] = process.argv.slice(2)
  if (!version) {
    console.error('usage: release-notes.mjs <version> [CHANGELOG.md]')
    process.exit(2)
  }
  const notes = releaseNotes(fs.readFileSync(file, 'utf8'), version)
  if (!notes) {
    console.error(`CHANGELOG has no "## ${version}" section`)
    process.exit(1)
  }
  process.stdout.write(notes)
}
