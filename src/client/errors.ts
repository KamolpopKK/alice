import type { ErrorCode } from '../shared/errors'

export type ClientErrorCode = ErrorCode | 'NETWORK_ERROR' | 'PROTOCOL_ERROR'

/** Every failure a client sees, mapped to one stable code with a safe message. */
export class AliceClientError extends Error {
  constructor(
    readonly status: number,
    readonly code: ClientErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message)
    this.name = 'AliceClientError'
  }
}

/** Coarse classes used for recovery guidance and CLI exit codes. */
export type ErrorClass = 'usage' | 'auth' | 'not_found' | 'compatibility' | 'network' | 'internal'

export function classifyError(err: unknown): ErrorClass {
  if (!(err instanceof AliceClientError)) return 'internal'
  switch (err.code) {
    case 'VALIDATION_ERROR':
    case 'PAYLOAD_TOO_LARGE':
    case 'IDEMPOTENCY_CONFLICT':
      return 'usage'
    case 'UNAUTHENTICATED':
    case 'FORBIDDEN':
    case 'DEVICE_AUTHORIZATION_PENDING':
    case 'DEVICE_SLOW_DOWN':
    case 'DEVICE_ACCESS_DENIED':
    case 'DEVICE_CODE_EXPIRED':
      return 'auth'
    case 'NOT_FOUND':
    case 'INVALID_STATE':
    case 'CLAIM_FAILED':
    case 'RELATIONSHIP_CYCLE':
    case 'INVALID_RELATIONSHIP':
    case 'PROTECTED_RESOURCE':
    case 'CONFLICT':
      return 'not_found'
    case 'CLIENT_INCOMPATIBLE':
    case 'PROTOCOL_ERROR':
      return 'compatibility'
    case 'NETWORK_ERROR':
    case 'RATE_LIMITED':
      return 'network'
    default:
      return 'internal'
  }
}

/** Converts an HTTP status and parsed body into a client error. */
export function errorFromResponse(status: number, body: unknown): AliceClientError {
  const err = (body as { error?: { code?: ClientErrorCode; message?: string; details?: unknown } } | null)?.error
  return new AliceClientError(status, err?.code ?? (status >= 500 ? 'INTERNAL_ERROR' : 'PROTOCOL_ERROR'), err?.message ?? `Request failed (${status})`, err?.details)
}
