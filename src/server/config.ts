import path from 'node:path'
import { fileURLToPath } from 'node:url'

export interface AliceConfig {
  env: 'development' | 'production' | 'test'
  dataDir: string
  dbPath: string
  host: string
  port: number
  publicUrl: URL
  /** False when publicUrl was derived; serve() then replaces it with the real listen address. */
  publicUrlExplicit: boolean
  cookieSecure: boolean
  bootstrapToken: string | null
  webDir: string
  /** Standalone agent tooling served under `/downloads/`. */
  downloadsDir: string
  logLevel: string
  /** Log to this file instead of stdout (Local daemons). */
  logFile?: string
  trustProxy: boolean
  authRateLimitPerMinute: number
  logRequests: boolean
  mcpRateLimitPerMinute: number
  /** Requests per minute per Client API session (or address when anonymous). */
  clientRateLimitPerMinute: number
  /** Device authorization requests, polls and code lookups per minute per address. */
  deviceRateLimitPerMinute: number
  /** Seconds a device client waits between token polls. */
  devicePollIntervalSeconds: number
  /** How long resumable client event positions stay available. */
  clientEventRetentionHours: number
  /** How long idempotency results are remembered. */
  idempotencyRetentionHours: number
}

export class ConfigError extends Error {
  readonly problems: string[]
  constructor(problems: string[]) {
    super(`Invalid configuration:\n${problems.map((p) => `  - ${p}`).join('\n')}`)
    this.name = 'ConfigError'
    this.problems = problems
  }
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1'])

function packageRoot(): string {
  // dist/cli.js และ src/server/config.ts อยู่ลึกไม่เท่ากัน จึงไล่หา package.json ขึ้นไป
  const here = path.dirname(fileURLToPath(import.meta.url))
  return here.includes(`${path.sep}src${path.sep}`) ? path.resolve(here, '../..') : path.resolve(here, '..')
}

function parseBool(name: string, raw: string | undefined, problems: string[]): boolean {
  if (raw === undefined || raw === '') return false
  if (['1', 'true', 'yes'].includes(raw.toLowerCase())) return true
  if (['0', 'false', 'no'].includes(raw.toLowerCase())) return false
  problems.push(`${name} must be "true" or "false"`)
  return false
}

/**
 * Validates environment configuration. Messages name the variable and the rule
 * but never echo values, so secrets cannot leak into logs.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AliceConfig {
  const problems: string[] = []
  const nodeEnv = env.NODE_ENV === 'production' ? 'production' : env.NODE_ENV === 'test' ? 'test' : 'development'

  const dataDir = path.resolve(env.ALICE_DATA_DIR || './data')

  const port = env.ALICE_PORT === undefined || env.ALICE_PORT === '' ? 8080 : Number(env.ALICE_PORT)
  if (!Number.isInteger(port) || port < 0 || port > 65535) problems.push('ALICE_PORT must be an integer between 0 and 65535')

  const host = env.ALICE_HOST || '127.0.0.1'
  const allowInsecure = parseBool('ALICE_ALLOW_INSECURE_HTTP', env.ALICE_ALLOW_INSECURE_HTTP, problems)
  const trustProxy = parseBool('ALICE_TRUST_PROXY', env.ALICE_TRUST_PROXY, problems)
  const logRequests = env.ALICE_LOG_REQUESTS === undefined ? nodeEnv !== 'test' : parseBool('ALICE_LOG_REQUESTS', env.ALICE_LOG_REQUESTS, problems)

  let publicUrl: URL | null = null
  const rawPublicUrl = env.ALICE_PUBLIC_URL
  if (!rawPublicUrl) {
    if (nodeEnv === 'production') {
      problems.push('ALICE_PUBLIC_URL is required in production (the external https:// URL users open, e.g. https://alice.example.com)')
    }
  } else {
    try {
      publicUrl = new URL(rawPublicUrl)
      if (!['http:', 'https:'].includes(publicUrl.protocol)) {
        problems.push('ALICE_PUBLIC_URL must use http:// or https://')
      } else if (
        nodeEnv === 'production' &&
        publicUrl.protocol === 'http:' &&
        !LOCAL_HOSTS.has(publicUrl.hostname) &&
        !allowInsecure
      ) {
        problems.push('ALICE_PUBLIC_URL must use https:// in production (set ALICE_ALLOW_INSECURE_HTTP=true only behind a trusted private network)')
      }
      if (publicUrl.pathname !== '/' || publicUrl.search || publicUrl.hash) {
        problems.push('ALICE_PUBLIC_URL must be an origin without path, query or fragment')
      }
    } catch {
      problems.push('ALICE_PUBLIC_URL must be a valid absolute URL')
    }
  }

  const bootstrapToken = env.ALICE_BOOTSTRAP_TOKEN || null
  if (bootstrapToken !== null && bootstrapToken.length < 24) {
    problems.push('ALICE_BOOTSTRAP_TOKEN must be at least 24 characters (generate one with: openssl rand -hex 24)')
  }

  const positiveInt = (name: string, raw: string | undefined, fallback: number) => {
    if (raw === undefined || raw === '') return fallback
    const n = Number(raw)
    if (!Number.isInteger(n) || n < 1) problems.push(`${name} must be a positive integer`)
    return n
  }
  const authRateLimitPerMinute = positiveInt('ALICE_AUTH_RATE_LIMIT', env.ALICE_AUTH_RATE_LIMIT, 20)
  const mcpRateLimitPerMinute = positiveInt('ALICE_MCP_RATE_LIMIT', env.ALICE_MCP_RATE_LIMIT, 600)
  const clientRateLimitPerMinute = positiveInt('ALICE_CLIENT_RATE_LIMIT', env.ALICE_CLIENT_RATE_LIMIT, 1200)
  const deviceRateLimitPerMinute = positiveInt('ALICE_DEVICE_RATE_LIMIT', env.ALICE_DEVICE_RATE_LIMIT, 60)
  const devicePollIntervalSeconds = positiveInt('ALICE_DEVICE_POLL_INTERVAL', env.ALICE_DEVICE_POLL_INTERVAL, 5)
  const clientEventRetentionHours = positiveInt('ALICE_CLIENT_EVENT_RETENTION_HOURS', env.ALICE_CLIENT_EVENT_RETENTION_HOURS, 24)
  const idempotencyRetentionHours = positiveInt('ALICE_IDEMPOTENCY_RETENTION_HOURS', env.ALICE_IDEMPOTENCY_RETENTION_HOURS, 24)

  if (problems.length > 0) throw new ConfigError(problems)

  const resolvedPublicUrl = publicUrl ?? new URL(`http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`)

  return {
    env: nodeEnv,
    dataDir,
    dbPath: path.join(dataDir, 'alice.db'),
    host,
    port,
    publicUrl: resolvedPublicUrl,
    publicUrlExplicit: publicUrl !== null,
    cookieSecure: resolvedPublicUrl.protocol === 'https:',
    bootstrapToken,
    webDir: path.resolve(env.ALICE_WEB_DIR || path.join(packageRoot(), 'dist', 'web')),
    downloadsDir: path.resolve(env.ALICE_DOWNLOADS_DIR || path.join(packageRoot(), 'dist', 'downloads')),
    logLevel: env.ALICE_LOG_LEVEL || (nodeEnv === 'test' ? 'warn' : 'info'),
    trustProxy,
    authRateLimitPerMinute,
    logRequests,
    mcpRateLimitPerMinute,
    clientRateLimitPerMinute,
    deviceRateLimitPerMinute,
    devicePollIntervalSeconds,
    clientEventRetentionHours,
    idempotencyRetentionHours,
  }
}
