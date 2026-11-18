import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
// @ts-expect-error — plain ESM release script without type declarations
import { preflight, REQUIRED_SECRETS, REQUIRED_VARIABLES } from '../../scripts/release-preflight.mjs'
// @ts-expect-error — plain ESM release script without type declarations
import { releaseNotes } from '../../scripts/release-notes.mjs'
import { testDir } from '../helpers/tmp'

const ROOT = path.resolve(import.meta.dirname, '../..')
const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version as string
const repository = 'KamolpopKK/alice'
const latest = `https://github.com/${repository}/releases/latest/download`
const fullEnv = {
  ...Object.fromEntries([...REQUIRED_SECRETS, ...REQUIRED_VARIABLES].map((n: string) => [n, 'set'])),
  ALICE_UPDATE_URL: `${latest}/latest.json`,
  ALICE_DOWNLOAD_BASE_URL: latest,
}

/** A copy of the files the preflight reads, so a test can break one. */
function fixture(edit: Record<string, (text: string) => string> = {}) {
  const dir = testDir('alice-preflight-')
  for (const f of ['package.json', 'CHANGELOG.md', 'compose.yaml', '.env.example', 'src-tauri/tauri.conf.json', 'src-tauri/Cargo.toml']) {
    const text = fs.readFileSync(path.join(ROOT, f), 'utf8')
    fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true })
    fs.writeFileSync(path.join(dir, f), (edit[f] ?? ((t) => t))(text))
  }
  return dir
}

describe('release preflight', () => {
  it('passes for this repository: versions, CHANGELOG, compose and .env.example agree', () => {
    expect(preflight({ root: ROOT, dryRun: true })).toEqual([])
    expect(preflight({ root: ROOT, tag: `v${version}`, env: fullEnv, repository })).toEqual([])
  })

  it('names every missing secret and variable, and never prints a value', () => {
    const problems: string[] = preflight({ root: ROOT, tag: `v${version}`, env: { TAURI_SIGNING_PRIVATE_KEY: 'super-secret-value' }, repository })
    for (const name of [...REQUIRED_SECRETS.slice(1), ...REQUIRED_VARIABLES]) expect(problems.join('\n')).toContain(name)
    expect(problems.join('\n')).not.toContain('TAURI_SIGNING_PRIVATE_KEY\n')
    expect(problems.join('\n')).not.toContain('super-secret-value')
  })

  it('fails on a tag that is not the package version', () => {
    expect(preflight({ root: ROOT, tag: 'v9.9.9', env: fullEnv, repository })).toEqual([`tag v9.9.9 does not match package.json version ${version} (expected v${version})`])
  })

  it('fails without a CHANGELOG section, or when compose, .env.example or Desktop carry another version', () => {
    const dir = fixture({
      'CHANGELOG.md': (t) => t.replace(`## ${version}`, '## Unreleased'),
      'compose.yaml': (t) => t.replace(`ALICE_VERSION:-${version}`, 'ALICE_VERSION:-0.0.1'),
      '.env.example': (t) => t.replace(`ALICE_VERSION=${version}`, 'ALICE_VERSION=0.0.1'),
      'src-tauri/Cargo.toml': (t) => t.replace(`version = "${version}"`, 'version = "0.0.1"'),
    })
    const problems: string[] = preflight({ root: dir, dryRun: true })
    expect(problems).toHaveLength(4)
    expect(problems[0]).toContain(`no "## ${version}" section`)
  })

  it('requires URLs that follow the latest published release, never a fixed version', () => {
    const env = { ...fullEnv, ALICE_DOWNLOAD_BASE_URL: `https://github.com/${repository}/releases/download/v${version}` }
    expect(preflight({ root: ROOT, tag: `v${version}`, env, repository })).toEqual([`ALICE_DOWNLOAD_BASE_URL should be ${latest}`])
  })

  it('release notes hold only the version being released', () => {
    const notes: string = releaseNotes(fs.readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8'), version)
    expect(notes).toContain('### Public release and getting started')
    expect(notes).not.toMatch(/^## /m)
    expect(notes).not.toContain('first release')
    expect(releaseNotes('# Changelog\n\n## 1.0.0\n\nA\n\n## 0.9.0\n\nB\n', '1.0.0')).toBe('A\n')
    expect(releaseNotes('## 1.0.0\n', '2.0.0')).toBeNull()
  })
})
