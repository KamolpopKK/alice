// Stable, machine-readable error codes shared by HTTP, MCP and the stdio adapter.
export const ERROR_CODES = [
  'VALIDATION_ERROR',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'INVALID_STATE',
  'CLAIM_FAILED',
  'RELATIONSHIP_CYCLE',
  'INVALID_RELATIONSHIP',
  'PROTECTED_RESOURCE',
  'CONFLICT',
  'IDEMPOTENCY_CONFLICT',
  'CLIENT_INCOMPATIBLE',
  'DEVICE_AUTHORIZATION_PENDING',
  'DEVICE_SLOW_DOWN',
  'DEVICE_ACCESS_DENIED',
  'DEVICE_CODE_EXPIRED',
  'RATE_LIMITED',
  'PAYLOAD_TOO_LARGE',
  'INTERNAL_ERROR',
] as const

export type ErrorCode = (typeof ERROR_CODES)[number]

export interface ErrorBody {
  error: {
    code: ErrorCode
    message: string
    details?: unknown
  }
}

export const HTTP_STATUS: Record<ErrorCode, number> = {
  VALIDATION_ERROR: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  INVALID_STATE: 409,
  CLAIM_FAILED: 409,
  RELATIONSHIP_CYCLE: 409,
  INVALID_RELATIONSHIP: 409,
  PROTECTED_RESOURCE: 409,
  CONFLICT: 409,
  IDEMPOTENCY_CONFLICT: 409,
  CLIENT_INCOMPATIBLE: 426,
  DEVICE_AUTHORIZATION_PENDING: 428,
  DEVICE_SLOW_DOWN: 429,
  DEVICE_ACCESS_DENIED: 403,
  DEVICE_CODE_EXPIRED: 410,
  RATE_LIMITED: 429,
  PAYLOAD_TOO_LARGE: 413,
  INTERNAL_ERROR: 500,
}

export class AliceError extends Error {
  readonly code: ErrorCode
  readonly details?: unknown

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message)
    this.name = 'AliceError'
    this.code = code
    this.details = details
  }

  toBody(): ErrorBody {
    return { error: { code: this.code, message: this.message, ...(this.details === undefined ? {} : { details: this.details }) } }
  }
}
