import { prepareDocumentLinks, documentLinksReady } from '../domain/document-link-index'
import fs from 'node:fs'
import path from 'node:path'
import Fastify, { LogController, type FastifyInstance, type FastifyRequest } from 'fastify'
import fastifyStatic from '@fastify/static'
import { ZodError } from 'zod'
import { AliceError, HTTP_STATUS } from '../../shared/errors'
import { APP_VERSION } from '../../shared/version'
import { currentSchemaVersion, isSchemaCurrent } from '../db/database'
import type { AppContext } from '../context'
import { recordForbidden } from '../domain/identity'

/** Release that removes the legacy `/api` routes (announced in docs/client-api.md). */
export const API_REMOVAL_RELEASE = '0.4.0'

const SECRET_PATH_PATTERNS: RegExp[] = [/(\/invite\/)[^/?#]+/g, /(\/api\/invites\/)[^/?#]+(\/accept)/g]

/** Strip query strings and one-time tokens embedded in paths before logging. */
export function redactUrl(url: string): string {
  let clean = url.split('?')[0]
  for (const pattern of SECRET_PATH_PATTERNS) clean = clean.replace(pattern, (_m, a: string, b?: string) => `${a}[redacted]${b ?? ''}`)
  return clean
}

const FALLBACK_SHELL = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Alice</title></head>
<body><div id="root"><main><h1>Alice</h1><p>The web client has not been built. Run <code>npm run build</code>.</p></main></div></body></html>`

export type RouteRegistrar = (app: FastifyInstance, ctx: AppContext) => void | Promise<void>

export async function buildApp(ctx: AppContext, registrars: RouteRegistrar[] = []): Promise<FastifyInstance> {
  const app = Fastify({
    trustProxy: ctx.config.trustProxy,
    bodyLimit: 2 * 1024 * 1024,
    forceCloseConnections: true,
    logger: {
      level: ctx.config.logLevel,
      ...(ctx.config.logFile ? { file: ctx.config.logFile } : {}),
      redact: {
        paths: ['req.headers.authorization', 'req.headers.cookie', 'req.headers["x-csrf-token"]', 'res.headers["set-cookie"]'],
        censor: '[redacted]',
      },
      serializers: {
        req(req: FastifyRequest) {
          return { method: req.method, url: redactUrl(req.url), remoteAddress: req.ip }
        },
      },
    },
    logController: new LogController({ disableRequestLogging: !ctx.config.logRequests }),
  })
  ctx.log = app.log
  await prepareDocumentLinks(ctx.db, app.log)

  app.setErrorHandler(async (err, req, reply) => {
    if (err instanceof AliceError) {
      if (err.code === 'FORBIDDEN' && req.auth) recordForbidden(ctx, req.auth.actor, `${req.method} ${req.routeOptions.url ?? 'unknown'}`)
      return reply.status(HTTP_STATUS[err.code]).send(err.toBody())
    }
    if (err instanceof ZodError) {
      const body = new AliceError('VALIDATION_ERROR', 'Request is invalid', err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })))
      return reply.status(400).send(body.toBody())
    }
    const fastifyErr = err as { statusCode?: number; code?: string; message: string }
    if (fastifyErr.code === 'FST_ERR_CTP_BODY_TOO_LARGE') {
      // อ่าน body ที่เหลือทิ้งให้จบก่อนตอบ (มีเพดานขนาดและเวลา) เพื่อให้ client ได้ 413 แทน ECONNRESET
      const declared = Number(req.headers['content-length'] ?? 0)
      if (!req.raw.readableEnded && declared > 0 && declared <= 16 * 1024 * 1024) {
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, 5_000)
          const done = () => {
            clearTimeout(timer)
            resolve()
          }
          req.raw.once('end', done)
          req.raw.once('error', done)
          req.raw.resume()
        })
      }
      return reply.status(413).send(new AliceError('PAYLOAD_TOO_LARGE', 'Request body is too large').toBody())
    }
    if (fastifyErr.statusCode === 429) {
      return reply.status(429).send(new AliceError('RATE_LIMITED', 'Too many requests; retry later').toBody())
    }
    if (fastifyErr.statusCode && fastifyErr.statusCode >= 400 && fastifyErr.statusCode < 500) {
      return reply.status(400).send(new AliceError('VALIDATION_ERROR', fastifyErr.message).toBody())
    }
    req.log.error({ err }, 'unhandled error')
    return reply.status(500).send(new AliceError('INTERNAL_ERROR', 'Internal server error').toBody())
  })

  // ความปลอดภัยพื้นฐานของทุก response
  app.addHook('onSend', async (req, reply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff')
    reply.header('Referrer-Policy', 'no-referrer')
    reply.header('X-Frame-Options', 'DENY')
    reply.header('Cross-Origin-Opener-Policy', 'same-origin')
    if (!reply.hasHeader('Content-Security-Policy')) {
      reply.header(
        'Content-Security-Policy',
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'",
      )
    }
    if (ctx.config.cookieSecure) reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
    if ((req.url.startsWith('/api/') || req.url.startsWith('/client/')) && !reply.hasHeader('Cache-Control')) reply.header('Cache-Control', 'no-store')
    if (req.url.startsWith('/api/')) {
      // API เดิม (`/api`) อยู่ในช่วง compatibility window: บอกเส้นทางใหม่และ release ที่จะถอดออก
      reply.header('Deprecation', 'true')
      reply.header('Link', `</client/v1${req.url.slice(4).split('?')[0]}>; rel="successor-version"`)
      reply.header('Alice-Removal', API_REMOVAL_RELEASE)
    }
    return payload
  })

  app.get('/livez', async () => ({ status: 'ok', version: APP_VERSION }))

  app.get('/readyz', async (_req, reply) => {
    try {
      ctx.db.prepare('SELECT 1').get()
      const schemaVersion = currentSchemaVersion(ctx.db)
      if (!isSchemaCurrent(ctx.db)) {
        return reply.status(503).send({ status: 'migrating', schemaVersion, version: APP_VERSION })
      }
      if (!documentLinksReady(ctx.db)) return reply.status(503).send({ status: 'preparing-knowledge', schemaVersion, version: APP_VERSION })
      return { status: 'ready', schemaVersion, version: APP_VERSION }
    } catch {
      return reply.status(503).send({ status: 'unavailable', version: APP_VERSION })
    }
  })

  for (const register of registrars) await register(app, ctx)

  const indexFile = path.join(ctx.config.webDir, 'index.html')
  const hasWeb = fs.existsSync(indexFile)
  if (hasWeb) {
    await app.register(fastifyStatic, { root: ctx.config.webDir, wildcard: true, index: false })
  }
  const sendShell = (reply: import('fastify').FastifyReply) => {
    reply.header('Cache-Control', 'no-cache')
    if (hasWeb) return reply.type('text/html').sendFile('index.html')
    return reply.type('text/html').send(FALLBACK_SHELL)
  }
  app.get('/', (_req, reply) => sendShell(reply))

  app.setNotFoundHandler((req, reply) => {
    const isApi = req.url.startsWith('/api/') || req.url.startsWith('/mcp') || req.url.startsWith('/client/')
    // asset ที่ไม่มีอยู่ต้องได้ 404 จริง ไม่ใช่ index.html (ไม่งั้น browser จะได้ HTML แทน JS)
    const isAsset = req.url.startsWith('/assets/') || /\.[a-z0-9]{1,8}(\?|$)/i.test(req.url)
    if (req.method !== 'GET' || isApi || isAsset) {
      return reply.status(404).send(new AliceError('NOT_FOUND', 'Route not found').toBody())
    }
    return sendShell(reply)
  })

  return app
}
