import * as z from 'zod'

// ---------- Identity ----------
export const ACTOR_KINDS = ['human', 'agent'] as const
export type ActorKind = (typeof ACTOR_KINDS)[number]

export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9._-]{1,31}$/, 'Username must be 2–32 characters: letters, digits, dot, dash or underscore')
export const displayNameSchema = z.string().trim().min(1, 'Display name is required').max(80)
export const passwordSchema = z.string().min(10, 'Password must be at least 10 characters').max(256)

export const bootstrapInput = z.object({
  bootstrapToken: z.string().min(1).max(512),
  username: usernameSchema,
  displayName: displayNameSchema,
  password: passwordSchema,
})
export const loginInput = z.object({ username: z.string().trim().min(1).max(64), password: z.string().min(1).max(256) })
export const createInviteInput = z.object({
  note: z.string().trim().max(200).default(''),
  expiresInHours: z.number().int().min(1).max(24 * 30).default(72),
})
export const acceptInviteInput = z.object({
  token: z.string().min(1).max(512),
  username: usernameSchema,
  displayName: displayNameSchema,
  password: passwordSchema,
})
export const tokenNameSchema = z.string().trim().min(1).max(80)
export const createAgentInput = z.object({ displayName: displayNameSchema, tokenName: tokenNameSchema.default('default') })
export const issueTokenInput = z.object({ name: tokenNameSchema })

export interface PublicActor {
  id: string
  kind: ActorKind
  displayName: string
  isOwner: boolean
  username: string | null
  createdAt: string
  deactivatedAt: string | null
}

export interface AgentTokenInfo {
  id: string
  name: string
  hint: string
  createdAt: string
  lastUsedAt: string | null
  revokedAt: string | null
}

export interface InviteInfo {
  id: string
  note: string
  createdAt: string
  expiresAt: string
  usedAt: string | null
  revokedAt: string | null
  status: 'pending' | 'used' | 'expired' | 'revoked'
}

export interface SessionInfo {
  actor: PublicActor
  csrfToken: string
}

// ---------- Activity ----------
export interface ActivityEvent {
  id: string
  actor: { id: string; kind: ActorKind; displayName: string } | null
  verb: string
  resourceType: string
  resourceId: string
  data: Record<string, unknown>
  createdAt: string
}

// ---------- Shared building blocks ----------
export interface ActorRef {
  id: string
  kind: ActorKind
  displayName: string
}

export const labelSchema = z.string().trim().min(1).max(40)
/** Labels are free-form, trimmed and de-duplicated case-insensitively (first spelling wins). */
export const labelsSchema = z
  .array(labelSchema)
  .max(20)
  .transform((labels) => {
    const seen = new Set<string>()
    return labels.filter((l) => {
      const key = l.toLowerCase()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  })
export const markdownSchema = z.string().max(100_000)
export const idSchema = z.string().trim().min(1).max(64)
export const cursorSchema = z.string().max(512).nullish()
export const limitSchema = z.coerce.number().int().min(1).max(200).optional()

export interface Page<T> {
  items: T[]
  nextCursor: string | null
}

// ---------- Projects ----------
export const UNTITLED_PROJECT_NAME = 'Untitled'
export const projectNameSchema = z.string().trim().min(1, 'Project name is required').max(120)

export const createProjectInput = z.object({
  name: projectNameSchema,
  description: markdownSchema.default(''),
  labels: labelsSchema.default([]),
})
/** A calendar date (YYYY-MM-DD) without time or time zone, for project and milestone planning. */
export const calendarDateSchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-03-31')
  .refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().startsWith(v), 'Not a real calendar date')

export const updateProjectInput = z
  .object({
    name: projectNameSchema.optional(),
    description: markdownSchema.optional(),
    labels: labelsSchema.optional(),
    /** Planning dates (capability `project-planning`); `null` clears. */
    startDate: calendarDateSchema.nullable().optional(),
    targetDate: calendarDateSchema.nullable().optional(),
  })
  .strict()
export const ARCHIVE_FILTERS = ['active', 'archived', 'all'] as const
export const archiveFilterSchema = z.enum(ARCHIVE_FILTERS).default('active')

export interface Project {
  id: string
  name: string
  description: string
  labels: string[]
  isSystem: boolean
  systemKey: string | null
  archivedAt: string | null
  /** Planning dates (YYYY-MM-DD) or null. */
  startDate: string | null
  targetDate: string | null
  createdAt: string
  updatedAt: string
  createdBy: ActorRef | null
  updatedBy: ActorRef | null
}

/** Someone who works on a project. Membership is informational: it grants and removes no access. */
export interface ProjectMember {
  actor: ActorRef
  addedAt: string
  addedBy: ActorRef | null
}

export const milestoneTitleSchema = z.string().trim().min(1, 'Title is required').max(200)
export const createMilestoneInput = z.object({ title: milestoneTitleSchema, dueDate: calendarDateSchema.nullish() }).strict()
export const updateMilestoneInput = z
  .object({ title: milestoneTitleSchema.optional(), dueDate: calendarDateSchema.nullable().optional(), completed: z.boolean().optional() })
  .strict()

/** A dated checkpoint in a project, completed by hand. */
export interface Milestone {
  id: string
  projectId: string
  title: string
  dueDate: string | null
  completedAt: string | null
  createdAt: string
  updatedAt: string
  createdBy: ActorRef | null
  updatedBy: ActorRef | null
}

/** Task counts of a project (archived tasks excluded). Progress is done / (total - canceled). */
export interface ProjectProgress {
  total: number
  done: number
  canceled: number
  open: number
}

// ---------- Tasks ----------
export const TASK_STATUSES = ['backlog', 'ready', 'in_progress', 'blocked', 'done', 'canceled'] as const
export type TaskStatus = (typeof TASK_STATUSES)[number]
export const TASK_PRIORITIES = ['none', 'low', 'medium', 'high', 'urgent'] as const
export type TaskPriority = (typeof TASK_PRIORITIES)[number]
export const PRIORITY_RANK: Record<TaskPriority, number> = { none: 0, low: 1, medium: 2, high: 3, urgent: 4 }
export const STATUS_LABELS: Record<TaskStatus, string> = {
  backlog: 'Backlog',
  ready: 'Ready',
  in_progress: 'In progress',
  blocked: 'Blocked',
  done: 'Done',
  canceled: 'Canceled',
}

export const taskStatusSchema = z.enum(TASK_STATUSES)
export const taskPrioritySchema = z.enum(TASK_PRIORITIES)
export const taskTitleSchema = z.string().trim().min(1, 'Title is required').max(300)

/** Accepts an ISO date (YYYY-MM-DD, treated as end of day UTC) or ISO date-time; normalizes to ISO UTC. */
export const dueAtSchema = z
  .string()
  .trim()
  .refine((v) => /^\d{4}-\d{2}-\d{2}$/.test(v) || !Number.isNaN(Date.parse(v)), 'Due date must be an ISO date or date-time')
  .transform((v) => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T23:59:59.999Z` : new Date(v).toISOString()))

export const createTaskInput = z
  .object({
    title: taskTitleSchema,
    description: markdownSchema.default(''),
    projectId: idSchema.nullish(),
    status: taskStatusSchema.default('backlog'),
    priority: taskPrioritySchema.default('none'),
    dueAt: dueAtSchema.nullish(),
    assigneeId: idSchema.nullish(),
    labels: labelsSchema.default([]),
    parentId: idSchema.nullish(),
  })
  .strict()

export const updateTaskInput = z
  .object({
    title: taskTitleSchema.optional(),
    description: markdownSchema.optional(),
    projectId: idSchema.optional(),
    status: taskStatusSchema.optional(),
    priority: taskPrioritySchema.optional(),
    dueAt: dueAtSchema.nullable().optional(),
    assigneeId: idSchema.nullable().optional(),
    labels: labelsSchema.optional(),
  })
  .strict()

export const TASK_SORTS = ['updated', 'created', 'priority', 'due', 'title'] as const
export type TaskSort = (typeof TASK_SORTS)[number]

const listOf = <T extends z.ZodType>(item: T) =>
  z.preprocess((v) => (v === undefined || v === null || v === '' ? undefined : Array.isArray(v) ? v : String(v).split(',')), z.array(item).max(50).optional())

export const listTasksInput = z.object({
  projectId: listOf(idSchema),
  status: listOf(taskStatusSchema),
  priority: listOf(taskPrioritySchema),
  /** Actor ids; the literal `none` matches unassigned tasks. */
  assigneeId: listOf(idSchema),
  label: listOf(labelSchema),
  dueBefore: dueAtSchema.optional(),
  dueAfter: dueAtSchema.optional(),
  archived: archiveFilterSchema,
  q: z.string().trim().max(200).optional(),
  /** Direct children of this task. */
  parentId: idSchema.optional(),
  /** Tasks that block this task (its blockers). */
  blockersOf: idSchema.optional(),
  /** Tasks that this task blocks (its dependents). */
  dependentsOf: idSchema.optional(),
  sort: z.enum(TASK_SORTS).default('updated'),
  order: z.enum(['asc', 'desc']).optional(),
  cursor: cursorSchema,
  limit: limitSchema,
})
export type ListTasksInput = z.infer<typeof listTasksInput>

export interface ProjectRef {
  id: string
  name: string
  isSystem: boolean
  archivedAt: string | null
}

export interface Task {
  id: string
  title: string
  description: string
  project: ProjectRef
  status: TaskStatus
  priority: TaskPriority
  dueAt: string | null
  assignee: ActorRef | null
  labels: string[]
  completedAt: string | null
  archivedAt: string | null
  createdAt: string
  updatedAt: string
  createdBy: ActorRef
  updatedBy: ActorRef
  parentId: string | null
  childCount: number
  /** Number of blockers that are not done or canceled. */
  openBlockerCount: number
}

// ---------- Search ----------
export const SEARCH_KINDS = ['task', 'document', 'comment'] as const
export type SearchKind = (typeof SEARCH_KINDS)[number]
/** Snippet highlight delimiters (control characters, never valid in user text rendering). */
export const HIGHLIGHT_START = '\u0001'
export const HIGHLIGHT_END = '\u0002'

export const searchInput = z.object({
  q: z.string().trim().min(1, 'Enter a search term').max(200),
  kind: z.preprocess((v) => (v === undefined || v === '' ? undefined : Array.isArray(v) ? v : String(v).split(',')), z.array(z.enum(SEARCH_KINDS)).optional()),
  tag: listOf(z.string().trim().min(1).max(40)),
  status: listOf(z.enum(['unreviewed', 'draft', 'current', 'superseded'])),
  /** Actor ids; the literal `none` matches documents without an owner. */
  ownerId: listOf(idSchema),
  projectId: listOf(idSchema),
  knowledgeProjectId: idSchema.optional(),
  topicId: idSchema.optional(),
  curatedOnly: z.preprocess((v) => v === 'true' ? true : v === 'false' ? false : v, z.boolean().optional()),
  archived: archiveFilterSchema,
  cursor: cursorSchema,
  limit: limitSchema,
})

export interface DocumentSearchMatch {
  field: 'title' | 'keyword' | 'tag' | 'body' | 'sourceUrl'
  value?: string
  excerpt: string
}

interface SearchResultBase {
  id: string
  title: string
  snippet: string
  archived: boolean
}

export interface TaskOrCommentSearchResult extends SearchResultBase {
  kind: 'task' | 'comment'
  taskId: string
}

export interface DocumentSearchResult extends SearchResultBase {
  kind: 'document'
  taskId: null
  match: DocumentSearchMatch
  tags: string[]
  status: DocumentKnowledgeStatus
  owner: ActorRef | null
  reviewedAt: string | null
  projectContext: { items: ProjectRef[]; total: number }
  topicContext?: DocumentTopicContext
}

export type SearchResult = TaskOrCommentSearchResult | DocumentSearchResult

// ---------- Documents ----------
export const documentTitleSchema = z.string().trim().min(1, 'Title is required').max(200)
export const sourceUrlSchema = z
  .string()
  .trim()
  .max(2000)
  .url('Source URL must be an absolute URL')
  .refine((v) => /^https?:\/\//i.test(v), 'Source URL must use http:// or https://')

const hasContent = (d: { body?: string; sourceUrl?: string | null }) => (d.body ?? '').trim().length > 0 || !!d.sourceUrl
export const DOCUMENT_CONTENT_MESSAGE = 'A document needs a Markdown body or a source URL'
export const DOCUMENT_KNOWLEDGE_STATUSES = ['unreviewed', 'draft', 'current', 'superseded'] as const
export type DocumentKnowledgeStatus = (typeof DOCUMENT_KNOWLEDGE_STATUSES)[number]
export const documentKnowledgeStatusSchema = z.enum(DOCUMENT_KNOWLEDGE_STATUSES)
export const documentTagSchema = z.string().trim().min(1, 'Tag cannot be empty').max(40)
export const documentKeywordSchema = z.string().trim().min(1, 'Search keyword cannot be empty').max(100)
export const documentTagsSchema = z.array(documentTagSchema).max(20)
export const documentKeywordsSchema = z.array(documentKeywordSchema).max(40)

export const createDocumentInput = z
  .object({
    title: documentTitleSchema,
    body: markdownSchema.default(''),
    sourceUrl: sourceUrlSchema.nullish(),
    tags: documentTagsSchema.optional(),
    searchKeywords: documentKeywordsSchema.optional(),
    status: documentKnowledgeStatusSchema.optional(),
    ownerId: idSchema.nullable().optional(),
  })
  .strict()
  .refine(hasContent, { message: DOCUMENT_CONTENT_MESSAGE, path: ['body'] })

export const updateDocumentInput = z
  .object({
    title: documentTitleSchema.optional(),
    body: markdownSchema.optional(),
    sourceUrl: sourceUrlSchema.nullable().optional(),
    tags: documentTagsSchema.optional(),
    searchKeywords: documentKeywordsSchema.optional(),
    status: documentKnowledgeStatusSchema.optional(),
    ownerId: idSchema.nullable().optional(),
  })
  .strict()

export const reviewDocumentInput = z
  .object({
    expectedRevision: z.number().int().min(1),
    markCurrent: z.boolean().default(true),
  })
  .strict()

export const clearDocumentReviewInput = z.object({ expectedRevision: z.number().int().min(1) }).strict()

export const listDocumentsInput = z.object({
  knowledgeProjectId: idSchema.optional(),
  topicId: idSchema.optional(),
  curatedOnly: z.preprocess((v) => v === 'true' ? true : v === 'false' ? false : v, z.boolean().optional()),
  q: z.string().trim().max(200).optional(),
  taskId: idSchema.optional(),
  projectId: listOf(idSchema),
  tag: listOf(documentTagSchema),
  status: listOf(documentKnowledgeStatusSchema),
  /** Actor ids; the literal `none` matches documents without an owner. */
  ownerId: listOf(idSchema),
  archived: archiveFilterSchema,
  cursor: cursorSchema,
  limit: limitSchema,
})

/** Exactly one link target. */
export const documentLinkInput = z
  .object({ taskId: idSchema.optional(), projectId: idSchema.optional() })
  .strict()
  .refine((v) => (v.taskId ? 1 : 0) + (v.projectId ? 1 : 0) === 1, { message: 'Provide exactly one of taskId or projectId' })

export interface TaskRef {
  id: string
  title: string
  status: TaskStatus
  archivedAt: string | null
}

export interface DocumentSummary {
  topicContext?: DocumentTopicContext
  projectContext?: { items: ProjectRef[]; total: number }
  id: string
  title: string
  sourceUrl: string | null
  excerpt: string
  bodyLength: number
  revision: number
  tags: string[]
  searchKeywords: string[]
  status: DocumentKnowledgeStatus
  owner: ActorRef | null
  reviewedAt: string | null
  reviewedBy: ActorRef | null
  reviewedRevision: number | null
  /** Present when this summary came from a text query. */
  match: DocumentSearchMatch | null
  archivedAt: string | null
  updatedAt: string
  updatedBy: ActorRef
}

export interface DocumentDetail extends Omit<DocumentSummary, 'excerpt'> {
  body: string
  createdAt: string
  createdBy: ActorRef
  links: { tasks: TaskRef[]; projects: ProjectRef[] }
}

export interface DocumentRevision {
  id: string
  number: number
  title: string
  body: string
  sourceUrl: string | null
  restoredFrom: number | null
  createdAt: string
  createdBy: ActorRef
}

export const DOCUMENT_RELATION_TYPES = ['references', 'related', 'supersedes'] as const
export type DocumentRelationType = (typeof DOCUMENT_RELATION_TYPES)[number]
export const documentRelationTypeSchema = z.enum(DOCUMENT_RELATION_TYPES)
export const documentRelationDirectionSchema = z.enum(['outgoing', 'incoming'])

export const createDocumentRelationInput = z
  .object({
    targetId: idSchema,
    type: documentRelationTypeSchema,
    /** Required and true when type is supersedes because the target becomes superseded. */
    acknowledgeSupersedes: z.boolean().optional(),
  })
  .strict()

export const removeDocumentRelationInput = z.object({ targetId: idSchema, type: documentRelationTypeSchema }).strict()

export const listDocumentRelationsInput = z.object({
  direction: documentRelationDirectionSchema.default('outgoing'),
  type: listOf(documentRelationTypeSchema),
  cursor: cursorSchema,
  limit: limitSchema,
})

export interface DocumentRelationRef {
  id: string
  title: string
  status: DocumentKnowledgeStatus
  archivedAt: string | null
}

export interface DocumentRelation {
  type: DocumentRelationType
  direction: 'outgoing' | 'incoming'
  document: DocumentRelationRef
  createdAt: string
  createdBy: ActorRef
}

// ---------- Comments, completion and context ----------
export const COMMENT_KINDS = ['comment', 'completion_summary'] as const
export type CommentKind = (typeof COMMENT_KINDS)[number]
export const commentBodySchema = z.string().trim().min(1, 'Comment cannot be empty').max(20_000)
export const addCommentInput = z.object({ body: commentBodySchema }).strict()
export const listCommentsInput = z.object({
  order: z.enum(['asc', 'desc']).default('asc'),
  cursor: cursorSchema,
  limit: limitSchema,
})
export const completeTaskInput = z.object({ summary: z.string().trim().max(20_000).optional() }).strict()

export interface Comment {
  id: string
  taskId: string
  kind: CommentKind
  body: string
  author: ActorRef
  createdAt: string
}

export const taskContextInput = z
  .object({
    maxChars: z.number().int().min(2_000).max(200_000).default(40_000),
    commentLimit: z.number().int().min(0).max(50).default(10),
    documentLimit: z.number().int().min(0).max(25).default(10),
    relationLimit: z.number().int().min(0).max(100).default(20),
  })
  .strict()

export interface Continuation {
  tool: string
  args: Record<string, unknown>
}

/** Every omission from a context response is reported here; nothing is dropped silently. */
export interface Truncation {
  path: string
  kind: 'text' | 'collection'
  total: number
  returned: number
  continuation: Continuation
}

export interface TaskContext {
  task: Task
  project: Project
  parent: TaskRef | null
  children: { items: TaskRef[]; total: number }
  blockers: { items: TaskRef[]; total: number }
  blocking: { items: TaskRef[]; total: number }
  documents: { items: Array<DocumentSummary & { body: string }>; total: number }
  comments: { items: Comment[]; total: number }
  budget: { maxChars: number; usedChars: number; truncations: Truncation[] }
}

// ---------- Approval requests (capability `approvals`) ----------
export const APPROVAL_STATUSES = ['pending', 'approved', 'rejected', 'canceled'] as const
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number]
export const approvalQuestionSchema = z.string().trim().min(1, 'Say what needs approval').max(2000)
export const requestApprovalInput = z.object({ question: approvalQuestionSchema, requestedOfId: idSchema.nullish() }).strict()
export const decideApprovalInput = z.object({ note: z.string().trim().max(2000).optional() }).strict()
export const listApprovalsInput = z
  .object({
    status: z.enum(APPROVAL_STATUSES).optional(),
    taskId: idSchema.optional(),
    /** `me`: pending requests this person may decide (asked of them, or of anyone). */
    for: z.literal('me').optional(),
    limit: limitSchema,
  })
  .strict()

/**
 * A question someone (usually an agent) asks a person before going on with a task. Only people
 * decide, never the one who asked; when it names a person, only that person or the owner decides.
 */
export interface ApprovalRequest {
  id: string
  task: TaskRef
  question: string
  status: ApprovalStatus
  requestedBy: ActorRef | null
  requestedOf: ActorRef | null
  decidedBy: ActorRef | null
  decidedAt: string | null
  note: string | null
  createdAt: string
}

// ---------- Relationships ----------
export const setParentInput = z.object({ parentId: idSchema.nullable() }).strict()
export const blockerInput = z.object({ blockerId: idSchema }).strict()

export interface TaskRelations {
  parent: TaskRef | null
  children: TaskRef[]
  blockers: TaskRef[]
  blocking: TaskRef[]
}

// ---- Client API v1 ----

export interface ClientEventsInfo {
  /** Hours a resumable event position stays available. */
  retentionHours: number
  /** Resuming further back than this many events yields a reset. */
  maxReplay: number
}

/** `GET /client/v1/info` — public, contains no workspace data. */
export const serverInfoSchema = z.object({
  product: z.literal('alice'),
  name: z.string(),
  serverVersion: z.string(),
  publicUrl: z.string(),
  clientApi: z.object({ current: z.number().int(), minimum: z.number().int(), prefix: z.string() }),
  capabilities: z.array(z.string()),
  events: z.object({ retentionHours: z.number(), maxReplay: z.number() }),
})
export type ServerInfo = z.infer<typeof serverInfoSchema>

/** One invalidation on `/client/v1/events`: identifies what changed, never carries the data. */
export const clientEventSchema = z.object({
  position: z.number().int(),
  activityId: z.string().nullable(),
  kind: z.string(),
  id: z.string(),
  mutation: z.string(),
  /** Client mutation id behind a private Pad change (lets a client recognize its own write). */
  origin: z.string().optional(),
})
export type ClientEvent = z.infer<typeof clientEventSchema>

/** Sent when the requested resume position is unavailable; clients refetch everything. */
export interface ClientEventReset {
  position: number
  reason: 'position_expired' | 'position_ahead_of_server' | 'too_many_events'
}

// ---- Device authorization and client sessions ----

export const CLIENT_KINDS = ['desktop', 'cli'] as const
export type ClientKind = (typeof CLIENT_KINDS)[number]

export const deviceAuthorizeInput = z
  .object({
    clientKind: z.enum(CLIENT_KINDS),
    clientName: z.string().trim().min(1).max(80),
    deviceName: z.string().trim().min(1).max(120),
    clientVersion: z.string().trim().min(1).max(40),
  })
  .strict()

export interface DeviceAuthorization {
  /** Secret the client polls with; shown to nobody. */
  deviceCode: string
  /** Short code the human confirms in the browser. */
  userCode: string
  verificationUri: string
  verificationUriComplete: string
  expiresIn: number
  interval: number
}

export const deviceTokenInput = z.object({ deviceCode: z.string().min(1).max(200) }).strict()
export const userCodeInput = z.object({ userCode: z.string().trim().min(1).max(20) }).strict()
export const refreshInput = z.object({ refreshToken: z.string().min(1).max(200) }).strict()

export interface DeviceRequestInfo {
  clientKind: ClientKind
  clientName: string
  deviceName: string
  clientVersion: string
  createdAt: string
  expiresAt: string
  status: 'pending' | 'approved' | 'denied' | 'exchanged'
}

export interface ClientSessionInfo {
  id: string
  actor: ActorRef
  clientKind: ClientKind
  clientName: string
  deviceName: string
  clientVersion: string
  createdAt: string
  lastUsedAt: string
  lastRefreshedAt: string | null
  revokedAt: string | null
  revokeReason: string | null
  /** True for the session making the request. */
  current: boolean
}

/** Returned once by device exchange and by every refresh. */
export interface ClientCredentials {
  accessToken: string
  accessExpiresAt: string
  refreshToken: string
  refreshExpiresAt: string
  session: ClientSessionInfo
  actor: PublicActor
}

// ---------- Project knowledge ----------
export interface KnowledgeTopic {
  id: string
  projectId: string
  name: string
  description: string
  revision: number
  archivedAt: string | null
  createdAt: string
  updatedAt: string
  createdBy: ActorRef | null
  updatedBy: ActorRef | null
}
export const knowledgeMutationIdSchema = z.string().regex(/^[A-Za-z0-9_.:-]{8,128}$/, 'Invalid mutationId')
export const topicMutationInput = z.object({ mutationId: knowledgeMutationIdSchema, expectedRevision: z.number().int().min(1) }).strict()
export type TopicMutationInput = z.infer<typeof topicMutationInput>
export const createKnowledgeTopicInput = z.object({ name: documentTitleSchema, description: z.string().trim().max(2000).default(''), mutationId: knowledgeMutationIdSchema }).strict()
export const updateKnowledgeTopicInput = topicMutationInput.extend({ name: documentTitleSchema.optional(), description: z.string().trim().max(2000).optional() }).strict()
export const listKnowledgeTopicsInput = z.object({ archived: archiveFilterSchema, cursor: cursorSchema, limit: limitSchema })
export type KnowledgeTopicResult = { topic: KnowledgeTopic; changed: boolean; activityId: string | null }

export const listTopicDocumentsInput = z.object({ cursor: cursorSchema, limit: limitSchema })
export const putTopicDocumentInput = topicMutationInput.extend({ beforeDocumentId: idSchema.optional() }).strict()
export interface TopicDocument {
  document: DocumentSummary
  orderKey: string
  projectContext: { items: ProjectRef[]; total: number }
}
export type TopicDocumentPage = Page<TopicDocument> & { topic: KnowledgeTopic }

export const listDocumentBacklinksInput = z.object({ archived: archiveFilterSchema, cursor: cursorSchema, limit: limitSchema })
export interface DocumentBacklink {
  document: DocumentSummary
  provenance: ('inline' | 'references')[]
  projectContext: { items: ProjectRef[]; total: number }
}
export interface DocumentTopicMembership { topic: KnowledgeTopic; project: ProjectRef }

export const documentContentInput = z.object({ expectedRevision: z.coerce.number().int().min(1).optional(), offset: z.coerce.number().int().min(0).default(0), maxChars: z.coerce.number().int().min(100).max(100_000).default(20_000) }).strict()
export const documentOutlineInput = z.object({ expectedRevision: z.coerce.number().int().min(1).optional(), cursor: cursorSchema, limit: limitSchema }).strict()
export const documentPreviewInput = z.object({ expectedRevision: z.coerce.number().int().min(1).optional() }).strict()
export interface DocumentBodyWindow { offset: number; returnedChars: number; totalChars: number; truncated: boolean; nextOffset: number | null }
export type DocumentContent = { document: DocumentSummary & { body: string; bodyWindow: DocumentBodyWindow } }
export type DocumentOutline = Page<import('./document-links').DocumentHeading> & { document: DocumentSummary }
export interface DocumentPreview { state: 'available' | 'archived' | 'unavailable'; document: DocumentSummary | null; body: string | null; bodyWindow: DocumentBodyWindow | null }

export interface DocumentTopicContext {
  items: Pick<KnowledgeTopic, 'id' | 'projectId' | 'name' | 'archivedAt'>[]
  total: number
  nextCursor: string | null
}
