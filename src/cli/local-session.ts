// Session ของ Local workspace: สตาร์ท daemon เมื่อจำเป็น (progress ไป stderr) แล้วคุยผ่าน Client API เดิม
// capability อ่านจาก OS credential store ทุกครั้งที่ต้องใช้ ไม่ผ่าน argv หรือ environment
import { AliceClient, type EventHandlers, type Transport, type TransportRequest, type TransportResponse } from '../client'
import { capabilityAccount, localCredentialStore } from '../local/capabilities'
import { defaultServerCommand, ensureDaemon, type DaemonEndpoint } from '../local/daemon-client'
import { LOCAL_AGENT_LABEL, touchWorkspace, type LocalAgentClient, type LocalWorkspace } from '../local/registry'
import { CliError } from './errors'
import { maintenanceNotice } from './maintenance'
import type { Output } from './output'
import { NodeTransport } from './transport'
import { CLI_CLIENT_NAME } from './version'

/** `ALICE_RUNTIME_COMMAND` (a JSON array, for development and tests), else alice-server.js beside this CLI. */
export function runtimeServerCommand(env: NodeJS.ProcessEnv): string[] {
  return env.ALICE_RUNTIME_COMMAND ? (JSON.parse(env.ALICE_RUNTIME_COMMAND) as string[]) : defaultServerCommand(env)
}

export class LocalSession {
  private endpoint: Promise<DaemonEndpoint> | null = null
  private transport: NodeTransport | null = null

  constructor(
    readonly workspace: LocalWorkspace,
    readonly root: string,
    readonly agent: LocalAgentClient | null,
    private readonly env: NodeJS.ProcessEnv,
    private readonly out: Output,
  ) {}

  get holder() {
    return this.agent ?? 'owner'
  }

  /** Starts (or reuses) the workspace daemon once per command. */
  connect(): Promise<DaemonEndpoint> {
    this.endpoint ??= (async () => {
      const endpoint = await ensureDaemon(this.root, this.workspace, {
        env: this.env,
        command: runtimeServerCommand(this.env),
        progress: (m) => this.out.info(m),
      })
      if (endpoint.started) {
        const notice = maintenanceNotice(this.root, this.env)
        if (notice) this.out.warn(notice)
      }
      try {
        touchWorkspace(this.root, this.workspace.id)
      } catch {
        /* last-used time is cosmetic */
      }
      return endpoint
    })()
    return this.endpoint
  }

  private capability(): string {
    const secret = localCredentialStore(this.root, this.env).get(capabilityAccount(this.workspace.id, this.holder))
    if (secret) return secret
    if (this.agent) {
      throw new CliError(
        `The ${LOCAL_AGENT_LABEL[this.agent]} integration is not enabled for workspace "${this.workspace.alias}"`,
        'auth',
        `Enable it in Alice Desktop → Settings → Agents, or run: alice integration enable ${this.agent} --workspace ${this.workspace.alias}`,
      )
    }
    throw new CliError(`No Local capability for workspace "${this.workspace.alias}"`, 'auth', 'Run: alice doctor')
  }

  private async node(): Promise<NodeTransport> {
    if (this.transport) return this.transport
    const { baseUrl } = await this.connect()
    this.transport = new NodeTransport(baseUrl, { current: async () => this.capability(), renew: async () => this.capability() })
    return this.transport
  }

  authenticatedClient(): AliceClient {
    const session = this
    const transport: Transport = {
      async request(req: TransportRequest): Promise<TransportResponse> {
        session.announce(req.method)
        return (await session.node()).request(req)
      },
      subscribe(after: number | null, handlers: EventHandlers) {
        let stop: (() => void) | null = null
        let cancelled = false
        void session.node().then((t) => {
          if (!cancelled) stop = t.subscribe(after, handlers)
        }, () => handlers.onDisconnect())
        return () => {
          cancelled = true
          stop?.()
        }
      },
    }
    return new AliceClient(transport, { clientName: CLI_CLIENT_NAME })
  }

  private announced = false
  /** Human-readable mutations name their workspace (stderr, once per command). */
  announce(method: string): void {
    if (this.announced || method === 'GET' || this.out.machine) return
    this.announced = true
    const who = this.agent ? ` as ${LOCAL_AGENT_LABEL[this.agent]}` : ''
    this.out.info(`Workspace: ${this.workspace.name} (${this.workspace.alias}, Local)${who}`)
  }

  /** Calls a `/local/v1` route of the daemon with this session's capability. */
  async local<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const { baseUrl } = await this.connect()
    const res = await fetch(`${baseUrl}/local/v1${path}`, {
      method,
      headers: { authorization: `Bearer ${this.capability()}`, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30_000),
    })
    const data = (await res.json()) as T & { error?: { code: string; message: string } }
    if (!res.ok) throw new CliError(data.error?.message ?? `Local request failed (${res.status})`, res.status === 401 || res.status === 403 ? 'auth' : res.status === 404 ? 'not_found' : 'internal')
    return data
  }
}
