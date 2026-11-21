import * as z from 'zod'
import type { SavedView, createSavedViewInput } from '../shared/saved-views'
import type {
  ActivityEvent,
  ApprovalRequest,
  ClientCredentials,
  ClientSessionInfo,
  DeviceAuthorization,
  DeviceRequestInfo,
  deviceAuthorizeInput,
  AgentTokenInfo,
  Comment,
  DocumentDetail,
  DocumentRelation,
  DocumentRelationType,
  DocumentRevision,
  DocumentSummary,
  InviteInfo,
  ListTasksInput,
  Page,
  Milestone,
  Project,
  ProjectMember,
  ProjectProgress,
  PublicActor,
  SearchResult,
  ServerInfo,
  Task,
  TaskContext,
  TaskRelations,
  TaskStatus,
  acceptInviteInput,
  bootstrapInput,
  createInviteInput,
  createDocumentInput,
  createDocumentRelationInput,
  clearDocumentReviewInput,
  createMilestoneInput,
  listApprovalsInput,
  requestApprovalInput,
  createProjectInput,
  createTaskInput,
  listDocumentsInput,
  listDocumentRelationsInput,
  loginInput,
  reviewDocumentInput,
  removeDocumentRelationInput,
  searchInput,
  updateDocumentInput,
  updateMilestoneInput,
  updateProjectInput,
  updateTaskInput,
} from '../shared/contracts'
import { serverInfoSchema } from '../shared/contracts'
import type {
  Pad,
  PadBlockPage,
  PadBlockResult,
  PadExport,
  PadSearchResult,
  PadTaskCandidate,
  bulkPadTasksInput,
  convertPadBlockInput,
  createPadBlockInput,
  createPadInput,
  movePadBlockInput,
  updatePadBlockInput,
  updatePadInput,
} from '../shared/pads'
import { CLIENT_API_MIN_VERSION, CLIENT_API_VERSION, CLIENT_API_VERSION_HEADER, CLIENT_NAME_HEADER, IDEMPOTENCY_HEADER } from '../shared/version'
import { AliceClientError, errorFromResponse } from './errors'
import type { EventHandlers, HttpMethod, QueryValue, Transport } from './transport'

type In<S extends z.ZodType> = z.input<S>

export type TaskResult = { task: Task; activityId: string | null }
export type ProjectResult = { project: Project; activityId: string | null }
export type DocumentResult = { document: DocumentDetail; activityId: string | null }
export type LinkResult = DocumentResult & { changed: boolean }
export type DocumentRelationResult = { changed: boolean; relation: { sourceId: string; targetId: string; type: DocumentRelationType }; activityId: string | null }
export type CommentResult = { comment: Comment; activityId: string | null }
export type CompletionResult = TaskResult & { comment: Comment | null }
export type IssuedToken = { agent: PublicActor; token: AgentTokenInfo; plaintextToken: string; activityId: string | null }
export type AgentRow = PublicActor & { tokens: AgentTokenInfo[] }
export type SignedIn = { actor: PublicActor; csrfToken: string | null }
export type Board = { columns: Record<TaskStatus, Page<Task>> }
export type TaskFilter = Partial<{ [K in keyof ListTasksInput]: ListTasksInput[K] }>

interface CallOptions {
  query?: Record<string, QueryValue>
  body?: unknown
  /** Attach an Idempotency-Key so a network retry cannot duplicate the mutation. */
  idempotent?: boolean
}

export interface AliceClientOptions {
  /** e.g. `alice-web/0.2.0`, `alice-cli/0.2.0` — sent for diagnostics only. */
  clientName?: string
  /** Network retries for idempotent mutations and reads (default 2). */
  retries?: number
}

function newIdempotencyKey(): string {
  const c = globalThis.crypto
  if (c?.randomUUID) return c.randomUUID()
  const bytes = new Uint8Array(16)
  c.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

/** Checks a server's advertised range against this client's protocol version. */
export function compatibilityOf(info: ServerInfo): { compatible: boolean; upgrade: 'client' | 'server' | null; message: string } {
  if (info.clientApi.minimum > CLIENT_API_VERSION) {
    return { compatible: false, upgrade: 'client', message: `Server requires Client API v${info.clientApi.minimum}+; this client speaks v${CLIENT_API_VERSION}. Upgrade the client.` }
  }
  if (info.clientApi.current < CLIENT_API_MIN_VERSION) {
    return { compatible: false, upgrade: 'server', message: `Server offers Client API v${info.clientApi.current}; this client needs v${CLIENT_API_MIN_VERSION}+. Upgrade the server.` }
  }
  return { compatible: true, upgrade: null, message: `Compatible (Client API v${Math.min(info.clientApi.current, CLIENT_API_VERSION)})` }
}

/**
 * Typed operations of Client API v1. Business rules stay on the server; the client only shapes
 * requests, maps errors and applies retry/idempotency policy.
 */
export class AliceClient {
  private readonly headers: Record<string, string>
  private readonly retries: number

  constructor(
    readonly transport: Transport,
    options: AliceClientOptions = {},
  ) {
    this.headers = { [CLIENT_API_VERSION_HEADER]: String(CLIENT_API_VERSION) }
    if (options.clientName) this.headers[CLIENT_NAME_HEADER] = options.clientName
    this.retries = options.retries ?? 2
  }

  async call<T>(method: HttpMethod, path: string, opts: CallOptions = {}): Promise<T> {
    const headers = { ...this.headers }
    if (opts.idempotent) headers[IDEMPOTENCY_HEADER] = newIdempotencyKey()
    // ทำซ้ำได้เฉพาะ GET หรือ mutation ที่มี idempotency key เท่านั้น
    const retryable = method === 'GET' || opts.idempotent === true
    for (let attempt = 0; ; attempt++) {
      try {
        const res = await this.transport.request({ method, path, query: opts.query, body: opts.body, headers })
        if (res.status < 200 || res.status >= 300) throw errorFromResponse(res.status, res.data)
        return res.data as T
      } catch (err) {
        const network = err instanceof AliceClientError && err.code === 'NETWORK_ERROR'
        if (!network || !retryable || attempt >= this.retries) throw err
        await new Promise((r) => setTimeout(r, 250 * (attempt + 1)))
      }
    }
  }

  private get = <T>(path: string, query?: Record<string, QueryValue>) => this.call<T>('GET', path, { query })

  /** Public server identity and protocol range; never contains workspace data. */
  async info(): Promise<ServerInfo> {
    const raw = await this.get<unknown>('/info')
    const parsed = serverInfoSchema.safeParse(raw)
    if (!parsed.success) throw new AliceClientError(0, 'PROTOCOL_ERROR', 'The server did not return Alice server information')
    return parsed.data
  }

  subscribe(after: number | null, handlers: EventHandlers): () => void {
    return this.transport.subscribe(after, handlers)
  }

  readonly auth = {
    state: () => this.get<{ bootstrapped: boolean }>('/auth/state'),
    me: () => this.get<{ actor: PublicActor; csrfToken: string | null; via?: string }>('/auth/me'),
    login: (input: In<typeof loginInput>) => this.call<SignedIn>('POST', '/auth/login', { body: input }),
    bootstrap: (input: In<typeof bootstrapInput>) => this.call<SignedIn>('POST', '/auth/bootstrap', { body: input }),
    logout: () => this.call<{ ok: true }>('POST', '/auth/logout', { body: {} }),
    /** Rotates a native client's refresh credential. */
    refresh: (refreshToken: string) => this.call<ClientCredentials>('POST', '/auth/refresh', { body: { refreshToken } }),
    /** Revokes a session using only its refresh credential (always succeeds; reveals nothing). */
    revoke: (refreshToken: string) => this.call<{ ok: true }>('POST', '/auth/revoke', { body: { refreshToken } }),
  }

  readonly device = {
    authorize: (input: In<typeof deviceAuthorizeInput>) => this.call<DeviceAuthorization>('POST', '/device/authorize', { body: input }),
    /** One poll; throws DEVICE_AUTHORIZATION_PENDING / DEVICE_SLOW_DOWN until approved. */
    token: (deviceCode: string) => this.call<ClientCredentials>('POST', '/device/token', { body: { deviceCode } }),
    lookup: (userCode: string) => this.call<{ request: DeviceRequestInfo }>('POST', '/device/lookup', { body: { userCode } }).then((r) => r.request),
    approve: (userCode: string) => this.call<{ session: ClientSessionInfo }>('POST', '/device/approve', { body: { userCode } }).then((r) => r.session),
    deny: (userCode: string) => this.call<{ denied: true }>('POST', '/device/deny', { body: { userCode } }),
  }

  readonly clientSessions = {
    list: (include: 'active' | 'all' = 'active') => this.get<{ items: ClientSessionInfo[] }>('/client-sessions', { include }).then((r) => r.items),
    revoke: (id: string) => this.call<{ session: ClientSessionInfo }>('POST', `/client-sessions/${enc(id)}/revoke`, { body: {} }).then((r) => r.session),
  }

  readonly invites = {
    list: () => this.get<{ items: InviteInfo[] }>('/invites').then((r) => r.items),
    create: (input: In<typeof createInviteInput> = {}) =>
      this.call<{ invite: InviteInfo; url: string }>('POST', '/invites', { body: input }),
    revoke: (id: string) => this.call<{ invite: InviteInfo }>('POST', `/invites/${enc(id)}/revoke`, { body: {} }),
    check: (token: string) => this.call<{ valid: boolean }>('POST', '/invites/check', { body: { token } }),
    accept: (input: In<typeof acceptInviteInput>) => this.call<SignedIn>('POST', '/invites/accept', { body: input }),
  }

  readonly actors = {
    list: () => this.get<{ items: PublicActor[] }>('/actors').then((r) => r.items),
  }

  readonly agents = {
    list: () => this.get<{ items: AgentRow[] }>('/agents').then((r) => r.items),
    create: (input: { displayName: string; tokenName?: string }) => this.call<IssuedToken>('POST', '/agents', { body: input }),
    issueToken: (agentId: string, name: string) => this.call<IssuedToken>('POST', `/agents/${enc(agentId)}/tokens`, { body: { name } }),
    deactivate: (agentId: string) => this.call<{ agent: PublicActor }>('POST', `/agents/${enc(agentId)}/deactivate`, { body: {} }),
    rotateToken: (tokenId: string) => this.call<IssuedToken>('POST', `/agent-tokens/${enc(tokenId)}/rotate`, { body: {} }),
    revokeToken: (tokenId: string) => this.call<{ token: AgentTokenInfo }>('POST', `/agent-tokens/${enc(tokenId)}/revoke`, { body: {} }),
  }

  readonly projects = {
    list: (archived: 'active' | 'archived' | 'all' = 'active') => this.get<{ items: Project[] }>('/projects', { archived }).then((r) => r.items),
    get: (id: string) => this.get<{ project: Project }>(`/projects/${enc(id)}`).then((r) => r.project),
    create: (input: In<typeof createProjectInput>) => this.call<ProjectResult>('POST', '/projects', { body: input, idempotent: true }),
    update: (id: string, patch: In<typeof updateProjectInput>) => this.call<ProjectResult>('PATCH', `/projects/${enc(id)}`, { body: patch }),
    archive: (id: string) => this.call<ProjectResult>('POST', `/projects/${enc(id)}/archive`, { body: {}, idempotent: true }),
    restore: (id: string) => this.call<ProjectResult>('POST', `/projects/${enc(id)}/restore`, { body: {}, idempotent: true }),
    members: (id: string) => this.get<{ items: ProjectMember[] }>(`/projects/${enc(id)}/members`).then((r) => r.items),
    addMember: (id: string, actorId: string) => this.call<{ members: ProjectMember[]; changed: boolean }>('PUT', `/projects/${enc(id)}/members/${enc(actorId)}`, { body: {} }),
    removeMember: (id: string, actorId: string) => this.call<{ members: ProjectMember[]; changed: boolean }>('DELETE', `/projects/${enc(id)}/members/${enc(actorId)}`, { body: {} }),
    milestones: (id: string) => this.get<{ items: Milestone[] }>(`/projects/${enc(id)}/milestones`).then((r) => r.items),
    addMilestone: (id: string, input: In<typeof createMilestoneInput>) => this.call<{ milestone: Milestone }>('POST', `/projects/${enc(id)}/milestones`, { body: input }),
    updateMilestone: (milestoneId: string, patch: In<typeof updateMilestoneInput>) => this.call<{ milestone: Milestone }>('PATCH', `/milestones/${enc(milestoneId)}`, { body: patch }),
    removeMilestone: (milestoneId: string) => this.call<{ deleted: true; id: string }>('DELETE', `/milestones/${enc(milestoneId)}`, { body: {} }),
    progress: (id: string) => this.get<{ progress: ProjectProgress }>(`/projects/${enc(id)}/progress`).then((r) => r.progress),
  }

  readonly tasks = {
    list: (filter: TaskFilter = {}) => this.get<Page<Task>>('/tasks', toQuery(filter)),
    get: (id: string) => this.get<{ task: Task }>(`/tasks/${enc(id)}`).then((r) => r.task),
    create: (input: In<typeof createTaskInput>) => this.call<TaskResult>('POST', '/tasks', { body: input, idempotent: true }),
    update: (id: string, patch: In<typeof updateTaskInput>) => this.call<TaskResult>('PATCH', `/tasks/${enc(id)}`, { body: patch }),
    claim: (id: string) => this.call<TaskResult>('POST', `/tasks/${enc(id)}/claim`, { body: {}, idempotent: true }),
    archive: (id: string) => this.call<TaskResult>('POST', `/tasks/${enc(id)}/archive`, { body: {}, idempotent: true }),
    restore: (id: string) => this.call<TaskResult>('POST', `/tasks/${enc(id)}/restore`, { body: {}, idempotent: true }),
    activity: (id: string, page: { cursor?: string | null; limit?: number } = {}) => this.get<Page<ActivityEvent>>(`/tasks/${enc(id)}/activity`, page),
    comments: (id: string, page: { cursor?: string | null; limit?: number } = {}) => this.get<Page<Comment>>(`/tasks/${enc(id)}/comments`, page),
    comment: (id: string, body: string) => this.call<CommentResult>('POST', `/tasks/${enc(id)}/comments`, { body: { body }, idempotent: true }),
    complete: (id: string, summary?: string) =>
      this.call<CompletionResult>('POST', `/tasks/${enc(id)}/complete`, { body: summary === undefined ? {} : { summary }, idempotent: true }),
    context: (id: string, opts: Record<string, string | number> = {}) => this.get<TaskContext>(`/tasks/${enc(id)}/context`, opts),
    relations: (id: string) => this.get<TaskRelations>(`/tasks/${enc(id)}/relations`),
    setParent: (id: string, parentId: string | null) => this.call<TaskResult>('PUT', `/tasks/${enc(id)}/parent`, { body: { parentId } }),
    addBlocker: (id: string, blockerId: string) => this.call<TaskResult>('POST', `/tasks/${enc(id)}/blockers`, { body: { blockerId }, idempotent: true }),
    removeBlocker: (id: string, blockerId: string) => this.call<TaskResult>('DELETE', `/tasks/${enc(id)}/blockers/${enc(blockerId)}`),
  }

  readonly documents = {
    list: (input: Partial<In<typeof listDocumentsInput>> = {}) => this.get<Page<DocumentSummary>>('/documents', toQuery(input)),
    get: (id: string) => this.get<{ document: DocumentDetail }>(`/documents/${enc(id)}`).then((r) => r.document),
    create: (input: In<typeof createDocumentInput>) => this.call<DocumentResult>('POST', '/documents', { body: input, idempotent: true }),
    update: (id: string, patch: In<typeof updateDocumentInput>) => this.call<DocumentResult>('PATCH', `/documents/${enc(id)}`, { body: patch }),
    review: (id: string, input: In<typeof reviewDocumentInput>) =>
      this.call<DocumentResult>('POST', `/documents/${enc(id)}/review`, { body: input, idempotent: true }),
    clearReview: (id: string, input: In<typeof clearDocumentReviewInput>) =>
      this.call<DocumentResult>('DELETE', `/documents/${enc(id)}/review`, { body: input }),
    relations: (id: string, input: Partial<In<typeof listDocumentRelationsInput>> = {}) =>
      this.get<Page<DocumentRelation>>(`/documents/${enc(id)}/relations`, toQuery(input)),
    relate: (id: string, input: In<typeof createDocumentRelationInput>) =>
      this.call<DocumentRelationResult>('POST', `/documents/${enc(id)}/relations`, { body: input, idempotent: true }),
    unrelate: (id: string, input: In<typeof removeDocumentRelationInput>) =>
      this.call<DocumentRelationResult>('DELETE', `/documents/${enc(id)}/relations`, { body: input }),
    archive: (id: string) => this.call<DocumentResult>('POST', `/documents/${enc(id)}/archive`, { body: {}, idempotent: true }),
    restore: (id: string) => this.call<DocumentResult>('POST', `/documents/${enc(id)}/restore`, { body: {}, idempotent: true }),
    revisions: (id: string, page: { cursor?: string | null; limit?: number } = {}) => this.get<Page<DocumentRevision>>(`/documents/${enc(id)}/revisions`, page),
    restoreRevision: (id: string, number: number) => this.call<DocumentResult>('POST', `/documents/${enc(id)}/revisions/${number}/restore`, { body: {} }),
    link: (id: string, target: { taskId?: string; projectId?: string }) => this.call<LinkResult>('POST', `/documents/${enc(id)}/links`, { body: target, idempotent: true }),
    unlink: (id: string, target: { taskId?: string; projectId?: string }) => this.call<LinkResult>('DELETE', `/documents/${enc(id)}/links`, { body: target }),
    activity: (id: string, page: { cursor?: string | null; limit?: number } = {}) => this.get<Page<ActivityEvent>>(`/documents/${enc(id)}/activity`, page),
  }

  /** Approval requests on tasks (capability `approvals`). */
  readonly approvals = {
    list: (input: In<typeof listApprovalsInput> = {}) => this.get<{ items: ApprovalRequest[] }>('/approvals', input as Record<string, QueryValue>).then((r) => r.items),
    get: (id: string) => this.get<{ approval: ApprovalRequest }>(`/approvals/${enc(id)}`).then((r) => r.approval),
    request: (taskId: string, input: In<typeof requestApprovalInput>) => this.call<{ approval: ApprovalRequest }>('POST', `/tasks/${enc(taskId)}/approvals`, { body: input }),
    approve: (id: string, note?: string) => this.call<{ approval: ApprovalRequest }>('POST', `/approvals/${enc(id)}/approve`, { body: note ? { note } : {} }),
    reject: (id: string, note?: string) => this.call<{ approval: ApprovalRequest }>('POST', `/approvals/${enc(id)}/reject`, { body: note ? { note } : {} }),
    cancel: (id: string) => this.call<{ approval: ApprovalRequest }>('POST', `/approvals/${enc(id)}/cancel`, { body: {} }),
  }

  /** Saved Tasks views (capability `saved-views`); private to the signed-in human. */
  readonly savedViews = {
    list: () => this.get<{ items: SavedView[] }>('/saved-views').then((r) => r.items),
    save: (input: In<typeof createSavedViewInput>) => this.call<{ view: SavedView }>('POST', '/saved-views', { body: input }).then((r) => r.view),
    remove: (id: string) => this.call<{ deleted: true; id: string }>('DELETE', `/saved-views/${enc(id)}`, { body: {} }),
  }

  /** Personal Task Pads (capability `task-pads`); every call is scoped to the signed-in human. */
  readonly pads = {
    list: (archived: 'active' | 'archived' | 'all' = 'active', page: { cursor?: string | null; limit?: number } = {}) =>
      this.get<Page<Pad>>('/pads', { archived, ...page }),
    get: (id: string) => this.get<{ pad: Pad }>(`/pads/${enc(id)}`).then((r) => r.pad),
    create: (input: In<typeof createPadInput>) => this.call<{ pad: Pad }>('POST', '/pads', { body: input, idempotent: true }),
    update: (id: string, patch: In<typeof updatePadInput>) => this.call<{ pad: Pad }>('PATCH', `/pads/${enc(id)}`, { body: patch }),
    archive: (id: string) => this.call<{ pad: Pad }>('POST', `/pads/${enc(id)}/archive`, { body: {}, idempotent: true }),
    restore: (id: string) => this.call<{ pad: Pad }>('POST', `/pads/${enc(id)}/restore`, { body: {}, idempotent: true }),
    /** Permanent; the referenced tasks are never changed. */
    delete: (id: string) => this.call<{ deleted: true; id: string }>('DELETE', `/pads/${enc(id)}`, { body: { confirm: true } }),
    search: (q: string, opts: { archived?: 'active' | 'all'; cursor?: string | null; limit?: number } = {}) =>
      this.get<Page<PadSearchResult>>('/pad-search', { q, ...opts }),
    export: () => this.get<PadExport>('/pads/export'),
    blocks: (padId: string, page: { cursor?: string | null; limit?: number } = {}) => this.get<PadBlockPage>(`/pads/${enc(padId)}/blocks`, page),
    createBlock: (padId: string, input: In<typeof createPadBlockInput>) =>
      this.call<PadBlockResult>('POST', `/pads/${enc(padId)}/blocks`, { body: input, idempotent: input.mutationId === undefined }),
    updateBlock: (padId: string, id: string, patch: In<typeof updatePadBlockInput>) =>
      this.call<PadBlockResult>('PATCH', `/pads/${enc(padId)}/blocks/${enc(id)}`, { body: patch }),
    moveBlock: (padId: string, id: string, input: In<typeof movePadBlockInput>) =>
      this.call<PadBlockResult>('POST', `/pads/${enc(padId)}/blocks/${enc(id)}/move`, { body: input }),
    convertBlock: (padId: string, id: string, input: In<typeof convertPadBlockInput>) =>
      this.call<PadBlockResult>('POST', `/pads/${enc(padId)}/blocks/${enc(id)}/convert`, { body: input }),
    deleteBlock: (padId: string, id: string, input: { mode?: 'promote' | 'subtree'; mutationId?: string } = {}) =>
      this.call<{ deleted: true; id: string }>('DELETE', `/pads/${enc(padId)}/blocks/${enc(id)}`, { body: input }),
    bulkTasks: (padId: string, input: In<typeof bulkPadTasksInput>) =>
      this.call<{ blocks: PadBlockResult['block'][]; mentions: PadBlockResult['mentions'] }>('POST', `/pads/${enc(padId)}/blocks/bulk`, { body: input }),
    complete: (padId: string, id: string, mutationId?: string) =>
      this.call<PadBlockResult>('POST', `/pads/${enc(padId)}/blocks/${enc(id)}/complete`, { body: mutationId ? { mutationId } : {} }),
    reopen: (padId: string, id: string, mutationId?: string) =>
      this.call<PadBlockResult>('POST', `/pads/${enc(padId)}/blocks/${enc(id)}/reopen`, { body: mutationId ? { mutationId } : {} }),
    turnIntoDescription: (padId: string, id: string, targetTaskId: string) =>
      this.call<{ task: Task; removedBlockId: string }>('POST', `/pads/${enc(padId)}/blocks/${enc(id)}/turn-into-description`, { body: { targetTaskId } }),
    undoTaskCapture: (padId: string, blockIds: string[], mutationId?: string) =>
      this.call<{ archived: string[]; removed: string[] }>('POST', `/pads/${enc(padId)}/undo-task-capture`, { body: mutationId ? { blockIds, mutationId } : { blockIds } }),
    removeCompleted: (padId: string) => this.call<{ removed: string[] }>('POST', `/pads/${enc(padId)}/remove-completed`, { body: {} }),
    taskSearch: (q: string, limit?: number) => this.get<{ items: PadTaskCandidate[] }>('/pad-task-search', { q, limit }).then((r) => r.items),
  }

  board = (filter: Omit<TaskFilter, 'status' | 'cursor'> = {}) => this.get<Board>('/board', toQuery(filter))
  search = (input: Partial<In<typeof searchInput>> & { q: string }) => this.get<Page<SearchResult>>('/search', toQuery(input))
  activity = (filter: { cursor?: string | null; limit?: number; actorId?: string; resourceType?: string } = {}) => this.get<Page<ActivityEvent>>('/activity', filter)
}

const enc = encodeURIComponent

function toQuery(input: object): Record<string, QueryValue> {
  const out: Record<string, QueryValue> = {}
  for (const [k, v] of Object.entries(input)) {
    if (v === undefined || v === null) continue
    out[k] = Array.isArray(v) ? v.map(String) : typeof v === 'object' ? JSON.stringify(v) : (v as QueryValue)
  }
  return out
}
