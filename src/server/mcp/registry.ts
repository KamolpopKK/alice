import * as z from 'zod'
import type { AppContext } from '../context'
import type { Actor } from '../domain/actors'

export interface ToolDefinition<S extends z.ZodType = z.ZodType> {
  name: string
  title: string
  description: string
  input: S
  readOnly?: boolean
  handler: (ctx: AppContext, actor: Actor, input: z.infer<S>) => unknown | Promise<unknown>
}

export function defineTool<S extends z.ZodType>(def: ToolDefinition<S>): ToolDefinition {
  return def as unknown as ToolDefinition
}

export function toolJsonSchema(tool: ToolDefinition): Record<string, unknown> {
  const schema = z.toJSONSchema(tool.input, { io: 'input', unrepresentable: 'any' }) as Record<string, unknown>
  delete schema.$schema
  return schema
}
