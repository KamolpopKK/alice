import { fork } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { testDir } from '../helpers/tmp'
import {
  createWorkspace,
  ensureDefaultWorkspace,
  ensureIntegration,
  findWorkspace,
  listWorkspaces,
  prepareDelete,
  prepareReplace,
  readRegistry,
  registerRestoredWorkspace,
  registryFile,
  renameWorkspace,
  resolveWorkspace,
  setWorkspaceAlias,
} from '../../src/local/registry'
import { workspacePaths } from '../../src/local/paths'

// โฟลเดอร์ชั่วคราวผ่าน testDir เท่านั้น: ถูกลบเมื่อไฟล์ test จบ
const root = (): string => testDir('alice-home-')

const mode = (p: string) => fs.statSync(p).mode & 0o777

describe('Local workspace registry', () => {
  it('first run creates exactly one Personal workspace, idempotently', () => {
    const home = root()
    const first = ensureDefaultWorkspace(home)
    const again = ensureDefaultWorkspace(home)
    expect(first.created).toBe(true)
    expect(again.created).toBe(false)
    expect(again.workspace.id).toBe(first.workspace.id)
    expect(listWorkspaces(home)).toHaveLength(1)
    expect(first.workspace).toMatchObject({ name: 'Personal', alias: 'personal', kind: 'local', state: 'active' })
    expect(first.workspace.id).toMatch(/^wsp_[0-9a-z]{20}$/)
  })

  it('stores metadata only, with owner-only permissions and per-workspace directories', () => {
    const home = root()
    const a = createWorkspace(home, { name: 'Work' })
    const b = createWorkspace(home, { name: 'Work' })
    expect(a.id).not.toBe(b.id)
    expect(a.alias).toBe('work')
    expect(b.alias).toBe('work-2')
    expect(workspacePaths(home, a.id).db).not.toBe(workspacePaths(home, b.id).db)
    if (process.platform !== 'win32') {
      expect(mode(registryFile(home))).toBe(0o600)
      expect(mode(workspacePaths(home, a.id).dir)).toBe(0o700)
      expect(mode(home)).toBe(0o700)
    }
    const raw = fs.readFileSync(registryFile(home), 'utf8')
    expect(raw).not.toMatch(/token|secret|capability|password|port/i)
    expect(Object.keys(JSON.parse(raw).workspaces[0]).sort()).toEqual(['alias', 'createdAt', 'id', 'kind', 'lastUsedAt', 'name', 'restoredFrom', 'state'])
  })

  it('aliases are case-insensitively unique; names may repeat; rename and alias change keep the id', () => {
    const home = root()
    const a = createWorkspace(home, { name: 'Side', alias: 'Side' })
    expect(() => createWorkspace(home, { name: 'Other', alias: 'side' })).toThrow(/already used/)
    expect(() => createWorkspace(home, { name: 'x', alias: '-bad' })).toThrow(/Aliases use/)
    expect(() => createWorkspace(home, { name: 'x', alias: 'wsp_abcd1234' })).toThrow(/look like a workspace id/)
    expect(() => createWorkspace(home, { name: 'x', alias: 'team' , reservedAliases: ['Team'] })).toThrow(/already used/)
    const renamed = renameWorkspace(home, 'side', 'Side projects')
    const realiased = setWorkspaceAlias(home, a.id, 'hobby')
    expect(renamed.id).toBe(a.id)
    expect(realiased).toMatchObject({ id: a.id, name: 'Side projects', alias: 'hobby' })
    expect(resolveWorkspace(home, 'HOBBY').id).toBe(a.id)
    expect(resolveWorkspace(home, a.id).alias).toBe('hobby')
  })

  it('selects by id or alias and rejects display names, listing the aliases instead', () => {
    const home = root()
    createWorkspace(home, { name: 'Notes', alias: 'notes-a' })
    createWorkspace(home, { name: 'Notes', alias: 'notes-b' })
    const registry = readRegistry(home)
    expect(() => findWorkspace(registry, 'Notes')).toThrow(/display name.*notes-a, notes-b/)
    expect(() => findWorkspace(registry, 'missing')).toThrow(/No Local workspace/)
  })

  it('restore registers a new identity; replace needs the exact id; delete needs the typed name and no live lock', () => {
    const home = root()
    const ws = createWorkspace(home, { name: 'Personal' })
    const restored = registerRestoredWorkspace(home, { workspaceId: ws.id, name: ws.name, backupCreatedAt: '2026-11-01T00:00:00.000Z' })
    expect(restored.id).not.toBe(ws.id)
    expect(restored.alias).not.toBe(ws.alias)
    expect(restored).toMatchObject({ name: 'Personal (restored)', state: 'restoring', restoredFrom: { workspaceId: ws.id } })
    expect(() => prepareReplace(home, ws.alias)).toThrow(/exact workspace id/)
    expect(prepareReplace(home, ws.id).id).toBe(ws.id)

    expect(() => prepareDelete(home, ws.alias, 'personal')).toThrow(/Type the workspace name "Personal"/)
    // lock ของ process ที่ยังมีชีวิต (ใช้ pid ของ parent ของ test) ต้องทำให้ลบไม่ได้
    fs.writeFileSync(workspacePaths(home, ws.id).lock, String(process.ppid))
    expect(() => prepareDelete(home, ws.alias, 'Personal')).toThrow(/running Alice process/)
    fs.writeFileSync(workspacePaths(home, ws.id).lock, '999999999')
    expect(prepareDelete(home, ws.alias, 'Personal').id).toBe(ws.id)
  })

  it('a damaged registry is reported, never silently reset', () => {
    const home = root()
    createWorkspace(home)
    fs.writeFileSync(registryFile(home), '{ not json')
    expect(() => listWorkspaces(home)).toThrow(/damaged/)
    expect(() => createWorkspace(home)).toThrow(/damaged/)
    expect(fs.readFileSync(registryFile(home), 'utf8')).toBe('{ not json')
  })

  it('integration ids are stable per client and machine', () => {
    const home = root()
    const codex = ensureIntegration(home, 'codex')
    expect(ensureIntegration(home, 'codex').id).toBe(codex.id)
    expect(ensureIntegration(home, 'claude-code').id).not.toBe(codex.id)
    expect(codex.id).toMatch(/^int_/)
  })

  it('concurrent processes never lose a registry write', async () => {
    const home = root()
    const script = path.join(home, 'writer.mjs')
    // แต่ละ child process โหลด registry module จริงผ่าน tsx แล้วเขียนพร้อมกัน
    fs.writeFileSync(script, `const { createWorkspace } = await import(${JSON.stringify(path.resolve('src/local/registry.ts'))}); for (let i = 0; i < 5; i++) createWorkspace(process.argv[2], { name: 'W' })`)
    await Promise.all(
      Array.from({ length: 4 }, () =>
        new Promise<void>((resolve, reject) => {
          const child = fork(script, [home], { execArgv: ['--import', 'tsx'], stdio: 'inherit' })
          child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`writer exited ${code}`))))
        }),
      ),
    )
    const all = listWorkspaces(home)
    expect(all).toHaveLength(20)
    expect(new Set(all.map((w) => w.alias.toLowerCase())).size).toBe(20)
  })
})
