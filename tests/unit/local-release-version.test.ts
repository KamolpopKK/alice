import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { APP_VERSION } from '../../src/shared/version'

const ROOT = path.resolve(import.meta.dirname, '../..')
const read = (f: string) => fs.readFileSync(path.join(ROOT, f), 'utf8')

/** Desktop, Local runtime, CLI and embedded skills are one exact release version. */
describe('one Local release version', () => {
  it('package, server, CLI, Desktop and every skill agree', () => {
    expect(JSON.parse(read('package.json')).version).toBe(APP_VERSION)
    expect(/^version = "([^"]+)"/m.exec(read('src-tauri/Cargo.toml'))![1]).toBe(APP_VERSION)
    expect(JSON.parse(read('src-tauri/tauri.conf.json')).version).toBe(APP_VERSION)
    for (const skill of fs.readdirSync(path.join(ROOT, 'skill')).filter((d) => !d.startsWith('_'))) {
      expect([skill, /^version:\s*(\S+)/m.exec(read(`skill/${skill}/SKILL.md`))![1]]).toEqual([skill, APP_VERSION])
    }
  })

  it('pins the official Node.js release the runtime ships', () => {
    expect(JSON.parse(read('package.json')).alice.runtimeNode).toMatch(/^\d+\.\d+\.\d+$/)
  })
})
