import * as z from 'zod'
import type { ActorRef, ProjectRef, Task, TaskStatus } from './contracts'
import { cursorSchema, idSchema, limitSchema, markdownSchema, taskStatusSchema, taskTitleSchema } from './contracts'

// ---------- Personal Task Pads ----------
// Pad เป็นพื้นที่ส่วนตัวของคนหนึ่งคน: เข้าถึงได้เฉพาะผ่าน Client API ของเจ้าของเท่านั้น

export const PAD_BLOCK_TYPES = ['task', 'text', 'heading'] as const
export type PadBlockType = (typeof PAD_BLOCK_TYPES)[number]
/** Root blocks are depth 1; nothing may be nested deeper than this. */
export const PAD_MAX_DEPTH = 4
export const PAD_NAME_MAX = 200
export const PAD_BLOCK_TEXT_MAX = 20_000
export const PAD_BULK_MAX = 200

export const padNameSchema = z.string().trim().min(1, 'Pad name is required').max(PAD_NAME_MAX)
/** Client-generated mutation id: deduplicates retries and identifies the writer in live events. */
export const mutationIdSchema = z.string().regex(/^[A-Za-z0-9_.:-]{8,128}$/, 'mutationId must be 8-128 letters, digits, "_", ".", ":" or "-"')

export const padSegmentSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), text: z.string().max(PAD_BLOCK_TEXT_MAX) }).strict(),
  z.object({ type: z.literal('mention'), taskId: idSchema }).strict(),
])
export type PadSegment = z.infer<typeof padSegmentSchema>
export const padContentSchema = z.array(padSegmentSchema).max(1000)

const padDefaultsShape = {
  defaultProjectId: idSchema.nullable().optional(),
  defaultStatus: taskStatusSchema.nullable().optional(),
  defaultAssigneeId: idSchema.nullable().optional(),
}

export const createPadInput = z.object({ name: padNameSchema, ...padDefaultsShape, mutationId: mutationIdSchema.optional() }).strict()
export const updatePadInput = z.object({ name: padNameSchema.optional(), pinned: z.boolean().optional(), ...padDefaultsShape, mutationId: mutationIdSchema.optional() }).strict()
export const deletePadInput = z.object({ confirm: z.literal(true, { error: 'Permanent deletion requires {"confirm": true}' }) }).strict()

export const listPadsInput = z.object({
  archived: z.enum(['active', 'archived', 'all']).default('active'),
  cursor: cursorSchema,
  limit: limitSchema,
})

export const listPadBlocksInput = z.object({ cursor: cursorSchema, limit: limitSchema })

const placement = {
  /** Parent block (null/absent = top level). */
  parentId: idSchema.nullable().optional(),
  /** Sibling to insert after (null/absent = first child of the parent). */
  afterId: idSchema.nullable().optional(),
}

export const createPadBlockInput = z
  .object({
    type: z.enum(PAD_BLOCK_TYPES),
    ...placement,
    content: padContentSchema.optional(),
    /** Task block: create a new task with this title using the Pad defaults. */
    title: taskTitleSchema.optional(),
    /** Task block: place an existing task (it must not already be placed in a Pad). */
    taskId: idSchema.optional(),
    mutationId: mutationIdSchema.optional(),
  })
  .strict()

export const updatePadBlockInput = z
  .object({
    content: padContentSchema.optional(),
    collapsed: z.boolean().optional(),
    /** Task blocks write straight to the authoritative task. */
    title: taskTitleSchema.optional(),
    description: markdownSchema.optional(),
    mutationId: mutationIdSchema.optional(),
  })
  .strict()

export const movePadBlockInput = z.object({ ...placement, mutationId: mutationIdSchema.optional() }).strict()
export const convertPadBlockInput = z.object({ type: z.enum(PAD_BLOCK_TYPES), mutationId: mutationIdSchema.optional() }).strict()
export const deletePadBlockInput = z
  .object({
    /** `promote` lifts children one level (default); `subtree` removes the block and everything nested in it. */
    mode: z.enum(['promote', 'subtree']).default('promote'),
    mutationId: mutationIdSchema.optional(),
  })
  .strict()

export const bulkPadTasksInput = z
  .object({
    ...placement,
    titles: z.array(z.string().max(10_000)).min(1).max(PAD_BULK_MAX),
    mutationId: mutationIdSchema,
  })
  .strict()

export const turnIntoDescriptionInput = z.object({ targetTaskId: idSchema, mutationId: mutationIdSchema.optional() }).strict()
export const padBlockActionInput = z.object({ mutationId: mutationIdSchema.optional() }).strict()
/** Undo of task capture: archives each block's task and removes the blocks, atomically. */
export const undoTaskCaptureInput = z.object({ blockIds: z.array(idSchema).min(1).max(PAD_BULK_MAX), mutationId: mutationIdSchema.optional() }).strict()

export const padSearchInput = z.object({
  q: z.string().trim().min(1).max(200),
  archived: z.enum(['active', 'all']).default('active'),
  cursor: cursorSchema,
  limit: limitSchema,
})
export const padTaskSearchInput = z.object({ q: z.string().trim().max(200).default(''), limit: limitSchema })

export interface PadDefaults {
  project: ProjectRef | null
  status: TaskStatus | null
  assignee: ActorRef | null
}

export interface Pad {
  id: string
  name: string
  pinned: boolean
  pinnedAt: string | null
  archivedAt: string | null
  defaults: PadDefaults
  blockCount: number
  createdAt: string
  updatedAt: string
}

export interface PadBlock {
  id: string
  padId: string
  type: PadBlockType
  parentId: string | null
  /** 1 for top-level blocks, up to PAD_MAX_DEPTH. */
  depth: number
  /** Plain text and mention segments (empty for Task blocks, whose text is the task title). */
  content: PadSegment[]
  collapsed: boolean
  /** The referenced task for Task blocks (authoritative task data). */
  task: Task | null
  /** Status to restore when a task completed from this Pad is reopened. */
  previousStatus: TaskStatus | null
  revision: number
  lastMutationId: string | null
  createdAt: string
  updatedAt: string
}

/** Current state of a task referenced by a mention, keyed by task id. */
export interface PadMentionInfo {
  id: string
  title: string
  status: TaskStatus
  archivedAt: string | null
}

export interface PadBlockPage {
  items: PadBlock[]
  mentions: Record<string, PadMentionInfo>
  nextCursor: string | null
}

export interface PadBlockResult {
  block: PadBlock
  /** Other blocks whose position or depth changed (e.g. promoted children). */
  affected?: string[]
  mentions: Record<string, PadMentionInfo>
}

export interface PadSearchResult {
  padId: string
  padName: string
  padArchived: boolean
  /** null when the Pad name matched. */
  blockId: string | null
  blockType: PadBlockType | null
  snippet: string
  /** Ancestors from the top level down, so collapsed sections can be expanded. */
  ancestorIds: string[]
}

export interface PadTaskCandidate {
  task: Task
  /** True when the task already has a Task block (selecting it then inserts a mention). */
  placed: boolean
  /** Where the task is placed, only when that Pad belongs to the requesting human. */
  placement: { padId: string; padName: string; blockId: string } | null
}

export interface PadExport {
  format: 'alice-pad-export'
  formatVersion: 1
  exportedAt: string
  owner: { id: string; displayName: string }
  pads: Array<{
    id: string
    name: string
    pinnedAt: string | null
    archivedAt: string | null
    defaults: { projectId: string | null; status: TaskStatus | null; assigneeId: string | null }
    createdAt: string
    updatedAt: string
    blocks: Array<{ id: string; type: PadBlockType; parentId: string | null; depth: number; content: PadSegment[]; taskId: string | null; collapsed: boolean }>
  }>
}

/** Plain text of a segment list (mentions rendered by the caller). */
export function segmentsText(segments: PadSegment[]): string {
  return segments.map((s) => (s.type === 'text' ? s.text : '')).join('')
}
