import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'

// คำสั่งที่ Rust core เปิดให้ WebView ใช้ — ไม่มีคำสั่งไหนคืน refresh/access credential

export interface NativeError {
  code: string
  message: string
  details?: unknown
}

export interface DesktopProfile {
  name: string
  server: string
  insecure: boolean
  createdAt: string
  session: { id: string; actorId: string; actorName: string } | null
  /** Set for a Local workspace; `name` is then its immutable `wsp_` id and `server` is empty. */
  local?: { alias: string; displayName: string; state: string } | null
  active: boolean
  signedIn: boolean
}

export interface ProfilesView {
  active: string | null
  profiles: DesktopProfile[]
  /** This installation has the Alice runtime and can open Local workspaces. */
  localAvailable?: boolean
}

export const isLocal = (p: DesktopProfile) => !!p.local

export interface AgentIntegration {
  client: 'codex' | 'claude-code'
  label: string
  optedIn: boolean
  skills: Record<string, string | null>
  credentials: string[]
}
/** What people call a workspace: the Local display name, or the Remote profile name. */
export const workspaceLabel = (p: DesktopProfile) => p.local?.displayName ?? p.name

export interface ConnectionTest {
  profile: string
  server: string
  tls: 'verified' | 'none' | 'local'
  serverName: string
  serverVersion: string
  clientApi: { current: number; minimum: number }
  compatible: boolean
  upgrade: 'client' | 'server' | null
  message: string
}

export interface LoginStarted {
  profile: string
  userCode: string
  verificationUri: string
  expiresIn: number
}

export type AuthEvent =
  | { profile: string; status: 'pending'; userCode: string }
  | { profile: string; status: 'signed_in'; actor: { id: string; displayName: string } }
  | { profile: string; status: 'denied' | 'expired' | 'failed'; message: string }
  | { profile: string; status: 'cancelled' }
  | { profile: string; status: 'signed_out'; reason: 'logout' | 'revoked' }

export type DeepLinkEvent =
  | { status: 'rejected'; message: string }
  | { status: 'unknown_profile'; profile: string }
  | { status: 'unknown_workspace'; workspace: string }
  | { status: 'accepted'; link: DeepLinkTarget; path: string }

export interface DeepLinkTarget {
  profile?: string
  workspace?: string
  kind: string
  id: string
}

export type CaptureIntent = 'open-last' | 'new-pad'

export interface ShortcutStatus {
  state: 'registered' | 'disabled' | 'reserved' | 'conflict' | 'failed'
  message: string | null
}

export interface ShortcutsView {
  platform: 'macos' | 'windows' | 'linux'
  enabled: boolean
  openLast: string
  newPad: string
  defaults: { openLast: string; newPad: string }
  status: { openLast?: ShortcutStatus; newPad?: ShortcutStatus }
}

export const isNativeError = (e: unknown): e is NativeError => typeof e === 'object' && e !== null && 'code' in e && 'message' in e

export const native = {
  appInfo: () => invoke<{ version: string; clientApi: number; credentialStore: string }>('app_info'),
  profiles: () => invoke<ProfilesView>('profiles_list'),
  addProfile: (input: { name: string; server: string; insecureDev: boolean; makeActive?: boolean }) => invoke<ProfilesView>('profile_add', { input }),
  useProfile: (name: string) => invoke<ProfilesView>('profile_use', { name }),
  removeProfile: (name: string) => invoke<ProfilesView>('profile_remove', { name }),
  testProfile: (name: string) => invoke<ConnectionTest>('profile_test', { name }),
  loginStart: (profile: string) => invoke<LoginStarted>('auth_login_start', { profile }),
  loginCancel: () => invoke<void>('auth_login_cancel'),
  logout: (profile: string) => invoke<boolean>('auth_logout', { profile }),
  openExternal: (url: string) => invoke<void>('open_external', { url }),
  updateCheck: () =>
    invoke<{ configured: boolean; available: boolean; currentVersion: string; version: string | null; notes: string | null; decision?: 'install' | 'not_newer' | 'incompatible'; message?: string }>(
      'update_check',
    ),
  updateInstall: () => invoke<void>('update_install'),
  /** The validated pending deep link, once its profile is the active one. */
  deeplinkTake: () => invoke<{ link: DeepLinkTarget; path: string } | null>('deeplink_take'),
  // Local workspaces
  localFirstRun: () => invoke<ProfilesView>('local_first_run'),
  workspaceCreate: (name: string) => invoke<ProfilesView>('workspace_create', { name }),
  workspaceRename: (id: string, name: string) => invoke<ProfilesView>('workspace_rename', { id, name }),
  workspaceAlias: (id: string, alias: string) => invoke<ProfilesView>('workspace_alias', { id, alias }),
  ownerRename: (displayName: string) => invoke<{ actor: { id: string; displayName: string } }>('owner_rename', { displayName }),
  localOpenFolder: (id: string) => invoke<boolean>('local_open_folder', { id }),
  localRestoreLatest: (id: string) => invoke<ProfilesView>('local_restore_latest', { id }),
  localDiagnostics: (id: string) => invoke<Array<{ id: string; status: string; summary: string; workspace?: string }>>('local_diagnostics', { id }),
  /** Installs only the tools the person consented to: the alice launcher, Codex, Claude Code. */
  toolsApply: (tools: { cli: boolean; codex: boolean; claude: boolean }) => invoke<{ installed: string[] }>('tools_apply', { input: tools }),
  integrationsStatus: () => invoke<AgentIntegration[]>('integrations_status'),
  integrationSet: (client: 'codex' | 'claude-code', enabled: boolean) =>
    invoke<{ client: string; enabled: boolean; assigned?: Array<{ workspace: string; tasks: number }> }>('integration_set', { client, enabled }),
  integrationUnassign: (client: 'codex' | 'claude-code', workspace: string) => invoke<{ unassigned: string[] }>('integration_unassign', { client, workspace }),
  /** The pending capture-shortcut press, handed out once. */
  captureTake: () => invoke<{ id: number; intent: CaptureIntent } | null>('capture_take'),
  onCapture: (fn: (e: { id: number; intent: CaptureIntent }) => void): Promise<UnlistenFn> => listen<{ id: number; intent: CaptureIntent }>('alice://capture', (e) => fn(e.payload)),
  shortcutsGet: () => invoke<ShortcutsView>('shortcuts_get'),
  shortcutsSet: (input: { enabled: boolean; openLast: string; newPad: string }) => invoke<ShortcutsView>('shortcuts_set', { input }),
  shortcutsReset: () => invoke<ShortcutsView>('shortcuts_reset'),
  onDeepLink: (fn: (e: DeepLinkEvent) => void): Promise<UnlistenFn> => listen<DeepLinkEvent>('alice://deeplink', (e) => fn(e.payload)),
  onAuth: (fn: (e: AuthEvent) => void): Promise<UnlistenFn> => listen<AuthEvent>('alice://auth', (e) => fn(e.payload)),
  onProfile: (fn: (e: { active: string | null }) => void): Promise<UnlistenFn> => listen<{ active: string | null }>('alice://profile', (e) => fn(e.payload)),
}
