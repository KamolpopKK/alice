// Registry ของ Local workspaces: metadata ล้วน ไม่มี credential, capability, port หรือ secret ใด ๆ
// เขียนแบบ atomic ภายใต้ lock file เพื่อให้ Desktop และ CLI แก้พร้อมกันได้โดยไม่ทับกัน
import fs from 'node:fs'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import { AliceError } from '../shared/errors'
import { ensurePrivateDir, isProcessAlive, workspacePaths, writeFileAtomic } from './paths'

export const REGISTRY_SCHEMA_VERSION = 1
export const DEFAULT_WORKSPACE_NAME = 'Personal'
export const LOCAL_AGENT_CLIENTS = ['codex', 'claude-code'] as const
export type LocalAgentClient = (typeof LOCAL_AGENT_CLIENTS)[number]
export const LOCAL_AGENT_LABEL: Record<LocalAgentClient, string> = { codex: 'Codex', 'claude-code': 'Claude' }

export type WorkspaceState = 'active' | 'restoring' | 'deleting'

export interface LocalWorkspace {
  /** Immutable opaque id; also the workspace id inside the database. */
  id: string
  name: string
  /** Unique (case-insensitive) CLI handle. */
  alias: string
  kind: 'local'
  state: WorkspaceState
  createdAt: string
  lastUsedAt: string | null
  /** Set when this workspace was registered from a backup. */
  restoredFrom?: { workspaceId: string; backupCreatedAt: string } | null
}

export interface Integration {
  /** Stable machine-level id of this client's identity (`int_…`). */
  id: string
  client: LocalAgentClient
  createdAt: string
  /** The person opted this client in (onboarding or Settings); Local workspaces enable it when they open. */
  optedIn?: boolean
  /** Version of the Alice skills last installed for this client, for update refresh. */
  skillsVersion?: string | null
}

export interface Registry {
  schemaVersion: typeof REGISTRY_SCHEMA_VERSION
  workspaces: LocalWorkspace[]
  integrations: Partial<Record<LocalAgentClient, Integration>>
}

const ALIAS = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,39}$/
const WORKSPACE_ID = /^wsp_[0-9a-z]{4,60}$/
const ID_ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz'

function randomId(prefix: string): string {
  const bytes = randomBytes(20)
  let out = ''
  for (const b of bytes) out += ID_ALPHABET[b & 31]
  return `${prefix}_${out}`
}

export const isWorkspaceId = (value: string) => WORKSPACE_ID.test(value)
export const registryFile = (root: string) => path.join(root, 'registry.json')

export function validateAlias(alias: string): string {
  if (!ALIAS.test(alias)) throw new AliceError('VALIDATION_ERROR', 'Aliases use letters, digits, ".", "_" or "-" (max 40, starting with a letter or digit)')
  if (WORKSPACE_ID.test(alias)) throw new AliceError('VALIDATION_ERROR', 'An alias must not look like a workspace id')
  return alias
}

export function validateName(name: string): string {
  const clean = name.trim()
  if (!clean || clean.length > 80 || /[\u0000-\u001f]/.test(clean)) throw new AliceError('VALIDATION_ERROR', 'Workspace names are 1–80 characters without control characters')
  return clean
}

function emptyRegistry(): Registry {
  return { schemaVersion: REGISTRY_SCHEMA_VERSION, workspaces: [], integrations: {} }
}

/** Reads the registry. A missing file is an empty registry; an unreadable one is an error, never silently reset. */
export function readRegistry(root: string): Registry {
  const file = registryFile(root)
  let raw: string
  try {
    raw = fs.readFileSync(file, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return emptyRegistry()
    throw err
  }
  let parsed: Registry
  try {
    parsed = JSON.parse(raw) as Registry
  } catch {
    throw new AliceError('INVALID_STATE', `The workspace registry ${file} is damaged. Run "alice doctor" to inspect it; your workspace databases are untouched.`)
  }
  if (parsed.schemaVersion !== REGISTRY_SCHEMA_VERSION || !Array.isArray(parsed.workspaces)) {
    throw new AliceError('INVALID_STATE', `The workspace registry ${file} has an unsupported format (schema ${String(parsed.schemaVersion)}). Update Alice.`)
  }
  return { schemaVersion: REGISTRY_SCHEMA_VERSION, workspaces: parsed.workspaces, integrations: parsed.integrations ?? {} }
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

/** Serialises read-modify-write of the registry across processes with an exclusive lock file. */
export function updateRegistry<T>(root: string, change: (registry: Registry) => T): T {
  ensurePrivateDir(root)
  const lock = path.join(root, 'registry.lock')
  const deadline = Date.now() + 10_000
  for (;;) {
    try {
      const fd = fs.openSync(lock, 'wx', 0o600)
      fs.writeSync(fd, String(process.pid))
      fs.closeSync(fd)
      break
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err
      let holder = NaN
      try {
        holder = Number(fs.readFileSync(lock, 'utf8'))
      } catch {
        /* ระหว่างที่อีก process กำลังเขียน pid */
      }
      // lock ค้างจาก process ที่ตายแล้วเท่านั้นที่ลบได้ — ไม่แตะ lock ของ process ที่ยังอยู่
      if (Number.isInteger(holder) && holder > 0 && !isProcessAlive(holder)) {
        fs.rmSync(lock, { force: true })
        continue
      }
      if (Date.now() > deadline) throw new AliceError('CONFLICT', 'The workspace registry is busy; try again')
      sleepSync(20)
    }
  }
  try {
    const registry = readRegistry(root)
    const result = change(registry)
    writeFileAtomic(registryFile(root), JSON.stringify(registry, null, 2) + '\n')
    return result
  } finally {
    fs.rmSync(lock, { force: true })
  }
}

const sameAlias = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

/** A free alias derived from a display name: `Personal` → `personal`, then `personal-2`, … */
export function suggestAlias(registry: Registry, name: string, reserved: string[] = []): string {
  const base =
    name
      .normalize('NFKD')
      .toLowerCase()
      .replace(/[^a-z0-9_.-]+/g, '-')
      .replace(/^[^a-z0-9]+|-+$/g, '')
      .slice(0, 32) || 'workspace'
  const taken = (a: string) => registry.workspaces.some((w) => sameAlias(w.alias, a)) || reserved.some((r) => sameAlias(r, a))
  if (!taken(base)) return base
  for (let n = 2; ; n++) if (!taken(`${base}-${n}`)) return `${base}-${n}`
}

function assertAliasFree(registry: Registry, alias: string, except?: string, reserved: string[] = []) {
  validateAlias(alias)
  if (registry.workspaces.some((w) => w.id !== except && sameAlias(w.alias, alias)) || reserved.some((r) => sameAlias(r, alias))) {
    throw new AliceError('CONFLICT', `The alias "${alias}" is already used by another workspace`)
  }
}

export interface CreateOptions {
  name?: string
  alias?: string
  /** Names another namespace already uses (for example Remote profile names) that an alias must avoid. */
  reservedAliases?: string[]
  restoredFrom?: LocalWorkspace['restoredFrom']
  state?: WorkspaceState
}

/** Registers a new Local workspace and creates its owner-only directory. The daemon bootstraps the database. */
export function createWorkspace(root: string, options: CreateOptions = {}): LocalWorkspace {
  const name = validateName(options.name ?? DEFAULT_WORKSPACE_NAME)
  return updateRegistry(root, (registry) => {
    const reserved = options.reservedAliases ?? []
    const alias = options.alias ?? suggestAlias(registry, name, reserved)
    assertAliasFree(registry, alias, undefined, reserved)
    const workspace: LocalWorkspace = {
      id: randomId('wsp'),
      name,
      alias,
      kind: 'local',
      state: options.state ?? 'active',
      createdAt: new Date().toISOString(),
      lastUsedAt: null,
      restoredFrom: options.restoredFrom ?? null,
    }
    const paths = workspacePaths(root, workspace.id)
    ensurePrivateDir(paths.dir)
    ensurePrivateDir(paths.dataDir)
    registry.workspaces.push(workspace)
    return workspace
  })
}

/** First run: an empty registry gets exactly one `Personal` workspace. Idempotent and race-safe. */
export function ensureDefaultWorkspace(root: string): { workspace: LocalWorkspace; created: boolean } {
  const existing = readRegistry(root).workspaces
  if (existing.length > 0) return { workspace: mostRecent(existing), created: false }
  return updateRegistry(root, (registry) => {
    if (registry.workspaces.length > 0) return { workspace: mostRecent(registry.workspaces), created: false }
    const workspace: LocalWorkspace = {
      id: randomId('wsp'),
      name: DEFAULT_WORKSPACE_NAME,
      alias: 'personal',
      kind: 'local',
      state: 'active',
      createdAt: new Date().toISOString(),
      lastUsedAt: null,
      restoredFrom: null,
    }
    const paths = workspacePaths(root, workspace.id)
    ensurePrivateDir(paths.dir)
    ensurePrivateDir(paths.dataDir)
    registry.workspaces.push(workspace)
    return { workspace, created: true }
  })
}

export function mostRecent(workspaces: LocalWorkspace[]): LocalWorkspace {
  return [...workspaces].sort((a, b) => (b.lastUsedAt ?? b.createdAt).localeCompare(a.lastUsedAt ?? a.createdAt))[0]
}

export function listWorkspaces(root: string): LocalWorkspace[] {
  return readRegistry(root).workspaces
}

/**
 * Resolves an id or alias. Display names are never accepted: they may repeat, so a name that matches
 * only produces a hint listing the aliases to use instead.
 */
export function findWorkspace(registry: Registry, selector: string): LocalWorkspace {
  const byId = registry.workspaces.find((w) => w.id === selector)
  if (byId) return byId
  const byAlias = registry.workspaces.find((w) => sameAlias(w.alias, selector))
  if (byAlias) return byAlias
  const byName = registry.workspaces.filter((w) => w.name.toLowerCase() === selector.toLowerCase())
  if (byName.length > 0) {
    throw new AliceError('VALIDATION_ERROR', `"${selector}" is a display name; select a workspace by alias or id (${byName.map((w) => w.alias).join(', ')})`, {
      candidates: byName.map((w) => ({ id: w.id, alias: w.alias })),
    })
  }
  throw new AliceError('NOT_FOUND', `No Local workspace with id or alias "${selector}"`)
}

export function resolveWorkspace(root: string, selector: string): LocalWorkspace {
  return findWorkspace(readRegistry(root), selector)
}

export function renameWorkspace(root: string, selector: string, name: string): LocalWorkspace {
  const clean = validateName(name)
  return updateRegistry(root, (registry) => {
    const ws = findWorkspace(registry, selector)
    ws.name = clean
    return { ...ws }
  })
}

export function setWorkspaceAlias(root: string, selector: string, alias: string, reservedAliases: string[] = []): LocalWorkspace {
  return updateRegistry(root, (registry) => {
    const ws = findWorkspace(registry, selector)
    assertAliasFree(registry, alias, ws.id, reservedAliases)
    ws.alias = alias
    return { ...ws }
  })
}

export function touchWorkspace(root: string, id: string): void {
  updateRegistry(root, (registry) => {
    const ws = registry.workspaces.find((w) => w.id === id)
    if (ws) ws.lastUsedAt = new Date().toISOString()
  })
}

export function setWorkspaceState(root: string, id: string, state: WorkspaceState): LocalWorkspace {
  return updateRegistry(root, (registry) => {
    const ws = registry.workspaces.find((w) => w.id === id)
    if (!ws) throw new AliceError('NOT_FOUND', `No Local workspace with id "${id}"`)
    ws.state = state
    return { ...ws }
  })
}

/** Default restore: always a new id and a non-conflicting alias, never an overwrite. */
export function registerRestoredWorkspace(root: string, source: { workspaceId: string; name: string; backupCreatedAt: string }, reservedAliases: string[] = []): LocalWorkspace {
  return createWorkspace(root, {
    name: `${source.name} (restored)`.slice(0, 80),
    reservedAliases,
    restoredFrom: { workspaceId: source.workspaceId, backupCreatedAt: source.backupCreatedAt },
    state: 'restoring',
  })
}

/** Replace restore targets a known identity: the exact id is required, an alias is not enough. */
export function prepareReplace(root: string, id: string): LocalWorkspace {
  if (!isWorkspaceId(id)) throw new AliceError('VALIDATION_ERROR', 'Replace restore needs the exact workspace id (wsp_…), not an alias')
  const ws = readRegistry(root).workspaces.find((w) => w.id === id)
  if (!ws) throw new AliceError('NOT_FOUND', `No Local workspace with id "${id}"`)
  return ws
}

/** PID of the live daemon that holds this workspace's lock, if any. */
export function liveLockHolder(root: string, id: string): number | null {
  try {
    const pid = Number(fs.readFileSync(workspacePaths(root, id).lock, 'utf8').trim())
    return isProcessAlive(pid) && pid !== process.pid ? pid : null
  } catch {
    return null
  }
}

/**
 * Checks a deletion request: explicit target, typed display name, no live daemon. Returns the
 * workspace; the caller then stops nothing — a running daemon makes this fail instead.
 */
export function prepareDelete(root: string, selector: string, typedName: string): LocalWorkspace {
  const ws = findWorkspace(readRegistry(root), selector)
  if (typedName !== ws.name) throw new AliceError('VALIDATION_ERROR', `Type the workspace name "${ws.name}" exactly to confirm deletion`)
  const holder = liveLockHolder(root, ws.id)
  if (holder) throw new AliceError('INVALID_STATE', `The workspace "${ws.alias}" is open in a running Alice process (pid ${holder}); stop it first`)
  return ws
}

/** Removes the registry entry only; moving the directory to the Trash is the caller's job. */
export function unregisterWorkspace(root: string, id: string): void {
  updateRegistry(root, (registry) => {
    registry.workspaces = registry.workspaces.filter((w) => w.id !== id)
  })
}

/** The stable machine-level identity of a local agent client, created on first use. */
export function ensureIntegration(root: string, client: LocalAgentClient): Integration {
  const existing = readRegistry(root).integrations[client]
  if (existing) return existing
  return updateRegistry(root, (registry) => {
    registry.integrations[client] ??= { id: randomId('int'), client, createdAt: new Date().toISOString() }
    return registry.integrations[client]!
  })
}

/** Records the machine-level opt-in of an agent client (no credentials; those live in the OS store). */
export function setIntegrationOptIn(root: string, client: LocalAgentClient, optedIn: boolean, skillsVersion?: string | null): Integration {
  ensureIntegration(root, client)
  return updateRegistry(root, (registry) => {
    const current = registry.integrations[client]!
    current.optedIn = optedIn
    if (skillsVersion !== undefined) current.skillsVersion = skillsVersion
    return { ...current }
  })
}
