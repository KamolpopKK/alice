import { AliceClientError, classifyError, type ClientErrorCode, type ErrorClass } from '../client'
import { AliceError } from '../shared/errors'

/** Stable exit codes by error class (documented in docs/cli.md). */
export const EXIT = {
  ok: 0,
  internal: 1,
  usage: 2,
  auth: 3,
  not_found: 4,
  compatibility: 5,
  network: 6,
} as const satisfies Record<ErrorClass | 'ok', number>

/** A failure detected by the CLI itself (bad flags, missing profile, …). */
export class CliError extends Error {
  constructor(
    message: string,
    readonly kind: ErrorClass = 'usage',
    readonly hint?: string,
  ) {
    super(message)
    this.name = 'CliError'
  }
}

/** Local workspace modules throw the shared AliceError; treat it like the same code from a server. */
function asClientError(err: unknown): unknown {
  return err instanceof AliceError ? new AliceClientError(0, err.code, err.message, err.details) : err
}

export function exitCodeFor(err: unknown): number {
  if (err instanceof CliError) return EXIT[err.kind]
  return EXIT[classifyError(asClientError(err))]
}

const CLASS_CODE: Record<ErrorClass, ClientErrorCode> = {
  usage: 'VALIDATION_ERROR',
  auth: 'UNAUTHENTICATED',
  not_found: 'NOT_FOUND',
  compatibility: 'CLIENT_INCOMPATIBLE',
  network: 'NETWORK_ERROR',
  internal: 'INTERNAL_ERROR',
}

/** The stable code reported in the JSON envelope. */
export function codeFor(err: unknown): string {
  const e = asClientError(err)
  if (e instanceof AliceClientError) return e.code
  if (err instanceof CliError) return (err as CliError & { code?: string }).code ?? CLASS_CODE[err.kind]
  return 'INTERNAL_ERROR'
}

export function messageFor(err: unknown): string {
  if (err instanceof AliceError) return err.message
  if (err instanceof CliError || err instanceof AliceClientError) return err.message
  return 'Unexpected error: ' + (err instanceof Error ? err.message : String(err))
}
