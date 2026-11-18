import * as z from 'zod'

/** Tasks views a saved view can open. */
export const TASK_VIEWS = ['my-work', 'board', 'list'] as const
export type TaskViewName = (typeof TASK_VIEWS)[number]

/**
 * The filter, search and sort part of a Tasks URL (`?projectId=…&q=…`), without the view and the
 * open task. Stored as given; the web app reads it back as URL parameters.
 */
export const savedViewQuerySchema = z
  .string()
  .max(2000)
  .refine((q) => !/[\r\n]/.test(q), 'Query must be a single line')

export const savedViewNameSchema = z.string().trim().min(1, 'Name is required').max(60)

export const createSavedViewInput = z.object({ name: savedViewNameSchema, view: z.enum(TASK_VIEWS), query: savedViewQuerySchema.default('') }).strict()

/** A named Tasks view of one person. Private: only its owner can list, use or delete it. */
export interface SavedView {
  id: string
  name: string
  view: TaskViewName
  query: string
  createdAt: string
  updatedAt: string
}
