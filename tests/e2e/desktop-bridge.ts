import type { Page } from '@playwright/test'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { parseDeepLink, webPath, type DeepLink } from '../../src/shared/deeplink'
import { ensureDaemon } from '../../src/local/daemon-client'
import { createWorkspace, ensureDefaultWorkspace, listWorkspaces, liveLockHolder, renameWorkspace, setWorkspaceAlias } from '../../src/local/registry'
import { capabilityAccount, localCredentialStore } from '../../src/local/capabilities'
import { SERVER_COMMAND, localEnv } from '../helpers/local'
import { inspectWorkspace, listBackups, replaceRestore } from '../../src/server/local/backups'
import { acquireWorkspaceLock } from '../../src/local/lock'
import { workspacePaths } from '../../src/local/paths'

type LocalMeta = { alias: string; displayName: string; state: string }
const REPO = path.resolve(import.meta.dirname, '../..')

/**
 * Stands in for the Rust core so the production React build can be driven in Playwright as Alice
 * Desktop. It mirrors the native command contract (src-tauri/src/commands.rs) and talks to the real
 * server; credentials stay in this Node process exactly as they stay in Rust. The Rust core itself is
 * verified against the same server by `cargo test` (src-tauri/tests).
 */
export class FakeNativeCore {
  profiles: Array<{ name: string; server: string; insecure: boolean; createdAt: string; session: { id: string; actorId: string; actorName: string } | null }> = []
  /** Local workspaces: an application-data root with real daemons, like the Rust core's runtime. */
  localHome: string | null = null
  private localConns = new Map<string, { baseUrl: string; capability: string }>()
  active: string | null = null
  private tokens = new Map<string, { access: string; refresh: string }>()
  private listeners = new Map<string, number[]>()
  private pendingDevice: { profile: string; deviceCode: string; userCode: string } | null = null
  opened: string[] = []
  calls: string[] = []
  /** Last unsaved-drafts flag the UI reported (the Rust core keeps only this, never content). */
  editorDirty = false
  leaveReplies: Array<{ requestId: string; discard: boolean }> = []
  /** A newer signed release the updater would offer (null: up to date), and how many installs ran. */
  update: { version: string } | null = null
  updateInstalls = 0

  constructor(private readonly page: Page) {}

  static async attach(page: Page, options: { localHome?: string } = {}): Promise<FakeNativeCore> {
    const core = new FakeNativeCore(page)
    core.localHome = options.localHome ?? null
    await page.exposeFunction('__aliceNative', async (cmd: string, args: Record<string, unknown>) => {
      core.calls.push(cmd)
      try {
        return { value: await core.handle(cmd, args) }
      } catch (err) {
        const e = err as { code?: string; message?: string; details?: unknown }
        return { error: { code: e.code ?? 'INTERNAL_ERROR', message: e.message ?? String(err), details: e.details } }
      }
    })
    await page.addInitScript(() => {
      const callbacks = new Map<number, (e: unknown) => void>()
      let next = 1
      const w = window as unknown as Record<string, unknown>
      w.__TAURI_INTERNALS__ = {
        transformCallback(cb: (e: unknown) => void) {
          const id = next++
          callbacks.set(id, cb)
          return id
        },
        unregisterCallback(id: number) {
          callbacks.delete(id)
        },
        async invoke(cmd: string, args: unknown) {
          const res = (await (w.__aliceNative as (c: string, a: unknown) => Promise<{ value?: unknown; error?: unknown }>)(cmd, JSON.parse(JSON.stringify(args ?? {}))))
          if (res.error) throw res.error
          return res.value
        },
        convertFileSrc: (p: string) => p,
        metadata: { currentWindow: { label: 'main' }, currentWebview: { windowLabel: 'main', label: 'main' } },
      }
      w.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} }
      w.__aliceEmit = (id: number, event: string, payload: unknown) => callbacks.get(id)?.({ event, payload, id })
    })
    return core
  }

  async emit(event: string, payload: unknown) {
    const ids = this.listeners.get(event) ?? []
    await this.page.evaluate(([list, ev, data]) => {
      for (const id of list as number[]) (window as unknown as { __aliceEmit: (i: number, e: string, p: unknown) => void }).__aliceEmit(id, ev as string, data)
    }, [ids, event, payload] as const).catch(() => {})
  }

  private localProfiles() {
    if (!this.localHome) return []
    return listWorkspaces(this.localHome).map((w) => ({
      name: w.id,
      server: '',
      insecure: false,
      createdAt: w.createdAt,
      session: null,
      local: { alias: w.alias, displayName: w.name, state: w.state } as LocalMeta,
    }))
  }

  private view() {
    return {
      active: this.active,
      localAvailable: this.localHome !== null,
      profiles: [
        ...this.localProfiles().map((p) => ({ ...p, active: p.name === this.active, signedIn: true })),
        ...this.profiles.map((p) => ({ ...p, active: p.name === this.active, signedIn: this.tokens.has(p.name) })),
      ],
    }
  }

  private isLocal(name: string | null) {
    return !!name && name.startsWith('wsp_')
  }

  /** Mirrors Core::endpoint for a Local workspace: start or reuse its daemon, read the owner capability. */
  async localConnect(id: string, reconnect = false) {
    if (!reconnect && this.localConns.has(id)) return this.localConns.get(id)!
    const ws = listWorkspaces(this.localHome!).find((w) => w.id === id)
    if (!ws) throw { code: 'NO_WORKSPACE', message: 'That Local workspace no longer exists' }
    const env = localEnv(this.localHome!)
    const { baseUrl } = await ensureDaemon(this.localHome!, ws, { env, command: SERVER_COMMAND })
    const capability = localCredentialStore(this.localHome!, env).get(capabilityAccount(id, 'owner'))!
    const conn = { baseUrl, capability }
    this.localConns.set(id, conn)
    return conn
  }

  private async useWorkspace(name: string) {
    this.stream?.abort()
    this.stream = null
    // capture ที่ค้างเป็นของ workspace เดิม
    this.pendingCapture = null
    this.active = name
    await this.emit('alice://profile', { active: this.active })
    return this.view()
  }

  private profile(name: string) {
    if (this.isLocal(name)) {
      const p = this.localProfiles().find((x) => x.name === name)
      if (!p) throw { code: 'NO_WORKSPACE', message: 'That Local workspace no longer exists' }
      return p as unknown as (typeof this.profiles)[number]
    }
    const p = this.profiles.find((x) => x.name === name)
    if (!p) throw { code: 'NO_PROFILE', message: `No profile named "${name}"` }
    return p
  }

  private async call(server: string, method: string, path: string, body?: unknown, bearer?: string) {
    let res: Response
    try {
      res = await fetch(`${server}/client/v1${path}`, {
        method,
        headers: { 'content-type': 'application/json', 'alice-client-api': '1', ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
    } catch {
      throw { code: 'NETWORK_ERROR', message: `Could not connect to ${server}` }
    }
    const text = await res.text()
    return { status: res.status, data: text ? JSON.parse(text) : null }
  }

  /** Approves the pending sign-in as `approve(userCode)` would in a browser. */
  pendingCapture: { id: number; intent: 'open-last' | 'new-pad' } | null = null
  private captureSeq = 0
  shortcuts = { enabled: true, openLast: 'Alt+Space', newPad: 'Alt+Shift+Space' }
  /** Accelerators the fake OS refuses, to exercise conflict reporting. */
  takenShortcuts = new Set<string>()

  /** Mirrors Rust: the global shortcut handler focuses Alice and queues one capture intent. */
  async pressShortcut(intent: 'open-last' | 'new-pad') {
    this.pendingCapture = { id: ++this.captureSeq, intent }
    await this.emit('alice://capture', this.pendingCapture)
  }

  private shortcutView() {
    const status = (accel: string) =>
      !this.shortcuts.enabled
        ? { state: 'disabled', message: null }
        : this.takenShortcuts.has(accel)
          ? { state: 'conflict', message: `${accel} could not be registered (HotKey already registered). Another app may already use it; choose another shortcut.` }
          : { state: 'registered', message: null }
    return {
      platform: 'macos',
      ...this.shortcuts,
      defaults: { openLast: 'Alt+Space', newPad: 'Alt+Shift+Space' },
      status: { openLast: status(this.shortcuts.openLast), newPad: status(this.shortcuts.newPad) },
    }
  }

  get pendingUserCode() {
    return this.pendingDevice?.userCode ?? null
  }

  async handle(cmd: string, args: Record<string, any>): Promise<unknown> {
    switch (cmd) {
      case 'plugin:event|listen': {
        const list = this.listeners.get(args.event) ?? []
        list.push(args.handler)
        this.listeners.set(args.event, list)
        return args.handler
      }
      case 'plugin:event|unlisten':
        return null
      case 'app_info':
        return { version: '0.0.0-test', clientApi: 1, credentialStore: 'fake' }
      case 'profiles_list':
        return this.view()
      case 'profile_add': {
        const { name, server, insecureDev } = args.input
        const url = new URL(server)
        const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
        if (url.protocol === 'http:' && !loopback && !insecureDev) throw { code: 'INVALID_REQUEST', message: `Refusing plain HTTP to ${url.host}: credentials would travel unencrypted.` }
        if (this.profiles.some((p) => p.name === name)) throw { code: 'INVALID_REQUEST', message: 'exists' }
        this.profiles.push({ name, server: url.origin, insecure: url.protocol === 'http:', createdAt: new Date().toISOString(), session: null })
        this.active = name
        await this.emit('alice://profile', { active: this.active })
        return this.view()
      }
      case 'profile_use':
        this.profile(args.name)
        return this.useWorkspace(args.name)
      case 'local_first_run': {
        const { workspace } = ensureDefaultWorkspace(this.localHome!)
        return this.useWorkspace(workspace.id)
      }
      case 'workspace_create': {
        const ws = createWorkspace(this.localHome!, { name: args.name, reservedAliases: this.profiles.map((p) => p.name) })
        return this.useWorkspace(ws.id)
      }
      case 'workspace_rename':
        renameWorkspace(this.localHome!, args.id, args.name)
        await this.emit('alice://profile', { active: this.active })
        return this.view()
      case 'workspace_alias':
        if (this.profiles.some((p) => p.name === args.alias)) throw { code: 'INVALID_REQUEST', message: `"${args.alias}" is already a Remote profile name` }
        setWorkspaceAlias(this.localHome!, args.id, args.alias)
        await this.emit('alice://profile', { active: this.active })
        return this.view()
      case 'owner_rename': {
        const conn = await this.localConnect(this.active!)
        const res = await fetch(`${conn.baseUrl}/local/v1/owner`, { method: 'PATCH', headers: { 'content-type': 'application/json', authorization: `Bearer ${conn.capability}` }, body: JSON.stringify({ displayName: args.displayName }) })
        return res.json()
      }
      case 'local_open_folder':
        this.opened.push(`folder:${args.id}`)
        return true
      case 'tools_apply': {
        const installed: string[] = []
        if (args.input.cli) {
          this.runCli(['local', 'install-launcher'])
          installed.push('cli')
        }
        for (const [wanted, client] of [[args.input.codex, 'codex'], [args.input.claude, 'claude-code']] as const) {
          if (!wanted) continue
          this.runCli(['integration', 'enable', client])
          installed.push(client)
        }
        return { installed }
      }
      case 'integrations_status':
        return this.runCli(['integration', 'list'])
      case 'integration_set':
        return this.runCli(['integration', args.enabled ? 'enable' : 'disable', args.client])
      case 'integration_unassign':
        return this.runCli(['integration', 'unassign', args.client, '--workspace', args.workspace, '--yes'])
      case 'local_diagnostics': {
        const inspect = inspectWorkspace(this.localHome!, args.id)
        return [
          { id: 'sqlite', status: inspect.quickCheck === 'ok' ? 'ok' : 'fail', summary: `SQLite quick_check: ${inspect.quickCheck}`, workspace: listWorkspaces(this.localHome!).find((w) => w.id === args.id)?.alias },
          { id: 'schema', status: 'ok', summary: `Schema v${inspect.schemaVersion}`, workspace: listWorkspaces(this.localHome!).find((w) => w.id === args.id)?.alias },
        ]
      }
      case 'local_restore_latest': {
        // เหมือน Rust → runtime: หยุด daemon (graceful) แล้วแทนที่ด้วย backup ล่าสุดโดยถือ lock
        const conn = this.localConns.get(args.id)
        if (conn) await fetch(`${conn.baseUrl}/local/v1/shutdown`, { method: 'POST', headers: { authorization: `Bearer ${conn.capability}`, 'content-type': 'application/json' }, body: '{}' }).catch(() => {})
        this.localConns.delete(args.id)
        const paths = workspacePaths(this.localHome!, args.id)
        for (let i = 0; i < 200 && liveLockHolder(this.localHome!, args.id); i++) await new Promise((r) => setTimeout(r, 50))
        const latest = listBackups(paths).find((b) => b.kind !== 'pre-restore')
        if (!latest) throw { code: 'NOT_FOUND', message: 'No backup to restore from' }
        const release = acquireWorkspaceLock(paths)
        try {
          await replaceRestore(this.localHome!, args.id, latest.dir)
        } finally {
          release()
        }
        this.failLocal = null
        await this.emit('alice://profile', { active: this.active })
        return this.view()
      }
      case 'profile_remove': {
        const p = this.profile(args.name)
        const t = this.tokens.get(p.name)
        if (t) await this.call(p.server, 'POST', '/auth/revoke', { refreshToken: t.refresh }).catch(() => {})
        this.tokens.delete(p.name)
        this.profiles = this.profiles.filter((x) => x.name !== p.name)
        if (this.active === p.name) this.active = null
        await this.emit('alice://profile', { active: this.active })
        return this.view()
      }
      case 'profile_test': {
        await this.holdTest.get(args.name)
        if (this.isLocal(args.name)) {
          const p = this.profile(args.name) as unknown as { name: string; local: LocalMeta }
          if (this.failLocal) throw { code: 'RUNTIME_FAILED', message: this.failLocal }
          await this.localConnect(p.name, true)
          return { profile: p.name, server: '', tls: 'local', serverName: p.local.displayName, serverVersion: '0.0.0-test', clientApi: { current: 1, minimum: 1 }, compatible: true, upgrade: null, message: 'Local workspace' }
        }
        const p = this.profile(args.name)
        const { status, data } = await this.call(p.server, 'GET', '/info')
        if (status !== 200) throw { code: 'PROTOCOL_ERROR', message: 'not alice' }
        const compatible = data.clientApi.minimum <= 1 && data.clientApi.current >= 1
        return {
          profile: p.name,
          server: p.server,
          tls: p.insecure ? 'none' : 'verified',
          serverName: data.name,
          serverVersion: data.serverVersion,
          clientApi: data.clientApi,
          compatible,
          upgrade: compatible ? null : data.clientApi.minimum > 1 ? 'client' : 'server',
          message: compatible ? 'Compatible (Client API v1)' : `This server requires Client API v${data.clientApi.minimum}+; update Alice Desktop.`,
        }
      }
      case 'auth_login_start': {
        const p = this.profile(args.profile)
        const res = await this.call(p.server, 'POST', '/device/authorize', { clientKind: 'desktop', clientName: 'Alice Desktop', deviceName: 'playwright', clientVersion: '0.0.0' })
        this.pendingDevice = { profile: p.name, deviceCode: res.data.deviceCode, userCode: res.data.userCode }
        this.opened.push(res.data.verificationUriComplete)
        void this.poll(p.name, p.server, res.data.deviceCode)
        await this.emit('alice://auth', { profile: p.name, status: 'pending', userCode: res.data.userCode })
        return { profile: p.name, userCode: res.data.userCode, verificationUri: res.data.verificationUriComplete, expiresIn: res.data.expiresIn }
      }
      case 'auth_login_cancel':
        this.pendingDevice = null
        return null
      case 'auth_logout': {
        const p = this.profile(args.profile)
        const t = this.tokens.get(p.name)
        if (t) await this.call(p.server, 'POST', '/auth/revoke', { refreshToken: t.refresh })
        this.tokens.delete(p.name)
        p.session = null
        await this.emit('alice://auth', { profile: p.name, status: 'signed_out', reason: 'logout' })
        return true
      }
      case 'api_request': {
        if (this.offline) throw { code: 'NETWORK_ERROR', message: 'Could not connect' }
        const { profile, method, path, query, body, headers } = args.input
        if (profile !== this.active) throw { code: 'PROFILE_CHANGED', message: 'The active profile changed' }
        if (this.isLocal(profile)) {
          const conn = await this.localConnect(profile)
          const qs = new URLSearchParams(query as Array<[string, string]>).toString()
          const res = await fetch(`${conn.baseUrl}/client/v1${path}${qs ? `?${qs}` : ''}`, {
            method,
            headers: { 'content-type': 'application/json', 'alice-client-api': '1', authorization: `Bearer ${conn.capability}`, ...(headers ?? {}) },
            body: body === undefined || body === null ? undefined : JSON.stringify(body),
          })
          const text = await res.text()
          return { status: res.status, data: text ? JSON.parse(text) : null }
        }
        const p = this.profile(profile)
        const t = this.tokens.get(p.name)
        if (!t) throw { code: 'NOT_SIGNED_IN', message: 'Sign in first' }
        const qs = new URLSearchParams(query as Array<[string, string]>).toString()
        let res = await fetch(`${p.server}/client/v1${path}${qs ? `?${qs}` : ''}`, {
          method,
          headers: { 'content-type': 'application/json', 'alice-client-api': '1', authorization: `Bearer ${t.access}`, ...(headers ?? {}) },
          body: body === undefined || body === null ? undefined : JSON.stringify(body),
        })
        if (res.status === 401) {
          const refreshed = await this.call(p.server, 'POST', '/auth/refresh', { refreshToken: t.refresh })
          if (refreshed.status !== 200) {
            this.tokens.delete(p.name)
            p.session = null
            await this.emit('alice://auth', { profile: p.name, status: 'signed_out', reason: 'revoked' })
            throw { code: 'NOT_SIGNED_IN', message: 'The session expired or was revoked; sign in again' }
          }
          this.tokens.set(p.name, { access: refreshed.data.accessToken, refresh: refreshed.data.refreshToken })
          res = await fetch(`${p.server}/client/v1${path}${qs ? `?${qs}` : ''}`, {
            method,
            headers: { 'content-type': 'application/json', 'alice-client-api': '1', authorization: `Bearer ${refreshed.data.accessToken}` },
            body: body === undefined || body === null ? undefined : JSON.stringify(body),
          })
        }
        const text = await res.text()
        return { status: res.status, data: text ? JSON.parse(text) : null }
      }
      case 'capture_take': {
        const c = this.pendingCapture
        this.pendingCapture = null
        return c
      }
      case 'shortcuts_get':
        return this.shortcutView()
      case 'shortcuts_set': {
        const input = args.input as { enabled: boolean; openLast: string; newPad: string }
        if (!/\+/.test(input.openLast) || !/\+/.test(input.newPad)) throw { code: 'VALIDATION_ERROR', message: 'A global shortcut needs Ctrl, Alt/Option or Cmd/Super' }
        this.shortcuts = { ...input }
        return this.shortcutView()
      }
      case 'shortcuts_reset':
        this.shortcuts = { enabled: true, openLast: 'Alt+Space', newPad: 'Alt+Shift+Space' }
        return this.shortcutView()
      case 'deeplink_take': {
        const link = this.pendingLink
        if (!link || (link.profile ?? link.workspace) !== this.active) return null
        this.pendingLink = null
        return { link, path: webPath(link) }
      }
      case 'open_external': {
        const url = new URL(args.url)
        if (url.protocol !== 'https:' && url.protocol !== 'http:') throw { code: 'INVALID_REQUEST', message: 'Only http and https links can be opened' }
        this.opened.push(url.href)
        return null
      }
      case 'events_subscribe':
        this.startStream(args.profile, args.after ?? null)
        return null
      case 'events_unsubscribe':
        this.stream?.abort()
        this.stream = null
        return null
      case 'editor_dirty_set':
        this.editorDirty = Boolean(args.dirty)
        return null
      case 'update_check':
        return { configured: true, available: this.update !== null, currentVersion: '0.0.0-test', version: this.update?.version ?? null, notes: null, decision: this.update ? 'install' : 'not_newer' }
      case 'update_install':
        if (!this.update) throw { code: 'INVALID_STATE', message: 'No update is pending' }
        this.updateInstalls++
        return null
      case 'editor_leave_reply':
        this.leaveReplies.push({ requestId: args.input.requestId, discard: args.input.discard })
        return null
      default:
        throw { code: 'INVALID_REQUEST', message: `Command ${cmd} not allowed` }
    }
  }

  private async poll(profile: string, server: string, deviceCode: string) {
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 500))
      if (this.pendingDevice?.deviceCode !== deviceCode) return
      const res = await this.call(server, 'POST', '/device/token', { deviceCode }).catch(() => null)
      if (!res) continue
      if (res.status === 200) {
        this.tokens.set(profile, { access: res.data.accessToken, refresh: res.data.refreshToken })
        const p = this.profile(profile)
        p.session = { id: res.data.session.id, actorId: res.data.actor.id, actorName: res.data.actor.displayName }
        this.pendingDevice = null
        await this.emit('alice://auth', { profile, status: 'signed_in', actor: { id: res.data.actor.id, displayName: res.data.actor.displayName } })
        return
      }
      const code = res.data?.error?.code
      if (code === 'DEVICE_AUTHORIZATION_PENDING' || code === 'DEVICE_SLOW_DOWN') continue
      this.pendingDevice = null
      await this.emit('alice://auth', { profile, status: code === 'DEVICE_ACCESS_DENIED' ? 'denied' : 'expired', message: res.data?.error?.message ?? 'failed' })
      return
    }
  }

  pendingLink: DeepLink | null = null

  /** Mirrors Core::handle_deep_link (src-tauri/src/core.rs). */
  async deliverDeepLink(raw: string): Promise<'rejected' | 'unknown_profile' | 'unknown_workspace' | 'accepted'> {
    let link: DeepLink
    try {
      link = parseDeepLink(raw)
    } catch (err) {
      await this.emit('alice://deeplink', { status: 'rejected', message: (err as Error).message })
      return 'rejected'
    }
    if (link.workspace !== undefined) {
      if (!this.localProfiles().some((p) => p.name === link.workspace)) {
        this.pendingLink = null
        await this.emit('alice://deeplink', { status: 'unknown_workspace', workspace: link.workspace })
        return 'unknown_workspace'
      }
      this.pendingLink = link
      if (this.active !== link.workspace) await this.useWorkspace(link.workspace)
      await this.emit('alice://deeplink', { status: 'accepted', link, path: webPath(link) })
      return 'accepted'
    }
    if (link.profile === undefined || !this.profiles.some((p) => p.name === link.profile)) {
      this.pendingLink = null
      await this.emit('alice://deeplink', { status: 'unknown_profile', profile: link.profile })
      return 'unknown_profile'
    }
    this.pendingLink = link
    if (this.active !== link.profile) {
      this.active = link.profile
      await this.emit('alice://profile', { active: this.active })
    }
    await this.emit('alice://deeplink', { status: 'accepted', link, path: webPath(link) })
    return 'accepted'
  }

  private stream: AbortController | null = null
  private lastPosition: number | null = null
  /** When true the fake stream stays down (simulates a lost connection). */
  offline = false

  /** The user's home for skills and the launcher, inside the Local test root. */
  get userHome() {
    return path.join(this.localHome!, 'user-home')
  }

  /** Mirrors Core::run_cli: the runtime's alice CLI with Desktop's own CLI state, returning envelope data. */
  runCli(args: string[]): any {
    const env = {
      ...localEnv(this.localHome!),
      HOME: this.userHome,
      ALICE_CONFIG_DIR: path.join(this.localHome!, 'desktop-cli'),
      ALICE_LAUNCHER_PATH: path.join(this.userHome, '.local', 'bin', 'alice'),
      ALICE_RUNTIME_COMMAND: JSON.stringify(SERVER_COMMAND),
    }
    const res = spawnSync(process.execPath, ['--import', 'tsx', path.join(REPO, 'src/cli/index.ts'), ...args, '--json'], { env, encoding: 'utf8', cwd: REPO })
    const body = JSON.parse(res.stdout || '{}')
    if (!body.ok) throw { code: body.error?.code ?? 'RUNTIME_FAILED', message: body.error?.message ?? res.stderr }
    return body.data
  }

  /** Makes Local activation fail, to exercise the recovery surface. */
  failLocal: string | null = null
  /** profile_test for these profiles waits until the promise resolves (a slow daemon start or server). */
  holdTest = new Map<string, Promise<void>>()

  private startStream(profile: string, after: number | null) {
    this.stream?.abort()
    const controller = new AbortController()
    this.stream = controller
    const p = this.profile(profile)
    void (async () => {
      let position = after
      while (!controller.signal.aborted) {
        let t = this.tokens.get(profile)
        let server = p.server
        if (this.isLocal(profile)) {
          const conn = await this.localConnect(profile)
          t = { access: conn.capability, refresh: '' }
          server = conn.baseUrl
        }
        if (!t) return this.emit('alice://events', { profile, type: 'unauthorized', data: {} })
        if (this.offline) {
          await new Promise((r) => setTimeout(r, 200))
          continue
        }
        try {
          const res = await fetch(`${server}/client/v1/events`, {
            headers: { authorization: `Bearer ${t.access}`, ...(position === null ? {} : { 'last-event-id': String(position) }) },
            signal: controller.signal,
          })
          if (res.status === 401) return this.emit('alice://events', { profile, type: 'unauthorized', data: {} })
          const reader = res.body!.getReader()
          const decoder = new TextDecoder()
          let buffer = ''
          while (!this.offline) {
            const { value, done } = await reader.read()
            if (done) break
            buffer += decoder.decode(value, { stream: true })
            let idx: number
            while ((idx = buffer.indexOf('\n\n')) >= 0) {
              const block = buffer.slice(0, idx)
              buffer = buffer.slice(idx + 2)
              const event = /^event: (.*)$/m.exec(block)?.[1]
              const data = /^data: (.*)$/m.exec(block)?.[1]
              if (!event || !data) continue
              const parsed = JSON.parse(data)
              if (typeof parsed.position === 'number') position = this.lastPosition = parsed.position
              await this.emit('alice://events', { profile, type: event, data: parsed })
            }
          }
          await reader.cancel().catch(() => {})
        } catch {
          if (controller.signal.aborted) return
        }
        await this.emit('alice://events', { profile, type: 'disconnected', data: {} })
        await new Promise((r) => setTimeout(r, 300))
      }
    })()
  }

  /** Simulates losing and regaining the network between Desktop and the server. */
  async goOffline() {
    this.offline = true
    // ตัด stream ปัจจุบันทันที แล้วเริ่ม loop ใหม่ที่รอจนกว่าจะ online (resume จากตำแหน่งล่าสุด)
    this.stream?.abort()
    await this.emit('alice://events', { profile: this.active, type: 'disconnected', data: {} })
    if (this.active) this.startStream(this.active, this.lastPosition)
  }
  goOnline() {
    this.offline = false
  }

  /** Tokens are held here (like Rust); exposed to the test only to prove the page never sees them. */
  secrets(): string[] {
    return [...this.tokens.values()].flatMap((t) => [t.access, t.refresh])
  }
}
