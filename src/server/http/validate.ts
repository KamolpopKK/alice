import type * as z from 'zod'
import { AliceError } from '../../shared/errors'

/** Parses untrusted input into a typed value or throws a stable VALIDATION_ERROR. */
export function parse<S extends z.ZodType>(schema: S, value: unknown): z.infer<S> {
  const result = schema.safeParse(value ?? {})
  if (!result.success) {
    throw new AliceError(
      'VALIDATION_ERROR',
      result.error.issues.map((i) => (i.path.length ? `${i.path.join('.')}: ${i.message}` : i.message)).join('; '),
      result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    )
  }
  return result.data
}
