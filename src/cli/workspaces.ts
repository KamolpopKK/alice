// การเลือก workspace ของ CLI: Local และ Remote อยู่ในรายการเดียวกัน
// ลำดับ: --workspace/--profile/--server → ALICE_WORKSPACE → binding เฉพาะเครื่อง → binding แบบพกพา
//        → active workspace ของ actor → มี workspace เดียว — ถ้ายังกำกวมให้หยุดพร้อมรายการ ห้ามเดา
import fs from 'node:fs'
import path from 'node:path'
import { AliceError } from '../shared/errors'
import { appDataRoot } from '../local/paths'
import { findWorkspace, isWorkspaceId, readRegistry, type LocalAgentClient, type LocalWorkspace, type Registry } from '../local/registry'
import type { CliConfig, Profile } from './config'
import { CliError } from './errors'

export const BINDING_DIR = '.alice'
export const PORTABLE_BINDING = 'workspace.json'
export const LOCAL_BINDING = 'workspace.local.json'

export type Target =
  | { kind: 'local'; workspace: LocalWorkspace; root: string; source: SelectionSource }
  | { kind: 'remote'; profile: Profile; source: SelectionSource }

export type SelectionSource = 'option' | 'environment' | 'local-binding' | 'portable-binding' | 'active' | 'only-workspace'

export interface WorkspaceRef {
  id: string
  name: string
  alias: string
  kind: 'local' | 'remote'
}

export function targetRef(t: Target): WorkspaceRef {
  return t.kind === 'local'
    ? { id: t.workspace.id, name: t.workspace.name, alias: t.workspace.alias, kind: 'local' }
    : { id: `profile:${t.profile.name}`, name: t.profile.name, alias: t.profile.name, kind: 'remote' }
}

/** A failure to choose a workspace; carries the choices so agents can list them. */
export class SelectionError extends CliError {
  constructor(
    message: string,
    readonly choices: WorkspaceRef[],
    hint?: string,
  ) {
    super(message, 'usage', hint)
  }
}

export interface Binding {
  file: string
  workspace: string
}

/** Nearest `.alice/<name>` binding file from `cwd` upwards. */
export function findBinding(cwd: string, name: string): Binding | null {
  let dir = path.resolve(cwd)
  for (;;) {
    const file = path.join(dir, BINDING_DIR, name)
    if (fs.existsSync(file)) {
      let parsed: { workspace?: unknown }
      try {
        parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as { workspace?: unknown }
      } catch {
        throw new CliError(`The workspace binding ${file} is not valid JSON`, 'usage', 'Fix it or remove it with: alice workspace unbind')
      }
      if (typeof parsed.workspace !== 'string' || !parsed.workspace) throw new CliError(`The workspace binding ${file} has no "workspace" value`)
      return { file, workspace: parsed.workspace }
    }
    const parent = path.dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

export class WorkspaceResolver {
  private registryCache: Registry | null = null

  constructor(
    readonly config: CliConfig,
    readonly env: NodeJS.ProcessEnv,
    readonly cwd: string = process.cwd(),
  ) {}

  get root(): string {
    return appDataRoot(this.env)
  }

  registry(): Registry {
    this.registryCache ??= readRegistry(this.root)
    return this.registryCache
  }

  refresh(): void {
    this.registryCache = null
  }

  /** Every workspace this CLI can address: Local ones from the registry, Remote ones from profiles. */
  all(): WorkspaceRef[] {
    const local = this.registry().workspaces.map((w) => ({ id: w.id, name: w.name, alias: w.alias, kind: 'local' as const }))
    const remote = Object.values(this.config.profiles).map((p) => ({ id: `profile:${p.name}`, name: p.name, alias: p.name, kind: 'remote' as const }))
    return [...local, ...remote]
  }

  /** Resolves one selector (Local id or alias, Remote profile name). Never guesses between candidates. */
  select(selector: string, source: SelectionSource): Target {
    const remoteName = selector.startsWith('profile:') ? selector.slice(8) : selector
    const profile = this.config.profiles[remoteName]
    let local: LocalWorkspace | null = null
    let nameHint: AliceError | null = null
    if (!selector.startsWith('profile:')) {
      try {
        local = findWorkspace(this.registry(), selector)
      } catch (err) {
        if (!(err instanceof AliceError)) throw err
        if (err.code === 'VALIDATION_ERROR') nameHint = err
        else if (err.code !== 'NOT_FOUND') throw err
      }
    }
    if (local && profile) {
      throw new SelectionError(`"${selector}" names both a Local workspace and a Remote profile`, this.all(), `Use the Local id (${local.id}) or profile:${remoteName}`)
    }
    if (local) return { kind: 'local', workspace: local, root: this.root, source }
    if (profile) return { kind: 'remote', profile, source }
    if (nameHint) throw new SelectionError(nameHint.message, this.all())
    throw new SelectionError(`No workspace with id or alias "${selector}"`, this.all(), 'List them with: alice workspace list')
  }

  /**
   * The workspace a command runs against. `explicit` is --workspace (or a legacy --profile/--server
   * that the caller already turned into a profile name); `agent` selects the agent's own active workspace.
   */
  resolve(explicit: string | undefined, agent: LocalAgentClient | null): Target {
    if (explicit) return this.select(explicit, 'option')
    if (this.env.ALICE_WORKSPACE) return this.select(this.env.ALICE_WORKSPACE, 'environment')
    const machine = findBinding(this.cwd, LOCAL_BINDING)
    if (machine) return this.select(machine.workspace, 'local-binding')
    const portable = findBinding(this.cwd, PORTABLE_BINDING)
    if (portable) return this.select(portable.workspace, 'portable-binding')
    const active = agent ? this.config.agentWorkspaces?.[agent] : (this.config.activeWorkspace ?? this.config.activeProfile)
    if (active) {
      try {
        return this.select(active, 'active')
      } catch (err) {
        if (!(err instanceof SelectionError)) throw err
        // active ที่ถูกลบไปแล้วไม่ใช่เหตุให้เดา: แจ้งให้เลือกใหม่
        throw new SelectionError(`The active workspace "${active}" no longer exists`, this.all(), 'Choose one with: alice workspace use ALIAS')
      }
    }
    const all = this.all()
    if (all.length === 1) return this.select(all[0].id, 'only-workspace')
    if (all.length === 0) {
      throw new SelectionError('No workspace yet', [], 'Create a Local one with: alice workspace create, or add a server with: alice profile add NAME --server URL')
    }
    throw new SelectionError(
      `Several workspaces exist and none is selected: ${all.map((w) => `${w.alias} (${w.kind})`).join(', ')}`,
      all,
      'Pass --workspace ALIAS, set ALICE_WORKSPACE, bind this project (alice workspace bind ALIAS), or choose one with: alice workspace use ALIAS',
    )
  }
}

export function writeBinding(dir: string, name: string, workspace: string): string {
  const folder = path.join(dir, BINDING_DIR)
  fs.mkdirSync(folder, { recursive: true })
  const file = path.join(folder, name)
  fs.writeFileSync(file, JSON.stringify({ workspace }, null, 2) + '\n', { mode: name === LOCAL_BINDING ? 0o600 : 0o644 })
  return file
}

export const looksLikeWorkspaceId = isWorkspaceId
