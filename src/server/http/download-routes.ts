import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { AliceError } from '../../shared/errors'
import { APP_VERSION } from '../../shared/version'
import type { RouteRegistrar } from './app'

/** Files the server distributes to people setting up an agent. */
export const DOWNLOAD_FILES = ['alice.js', 'alice-mcp-stdio.js'] as const

export interface DownloadEntry {
  name: string
  path: string
  bytes: number
  sha256: string
}

export interface DownloadManifest {
  version: string
  files: DownloadEntry[]
}

interface LoadedFile extends DownloadEntry {
  body: Buffer
  etag: string
}

/** Reads the bundles once at startup; missing bundles simply are not offered. */
function loadDownloads(dir: string): Map<string, LoadedFile> {
  const files = new Map<string, LoadedFile>()
  for (const name of DOWNLOAD_FILES) {
    const file = path.join(dir, name)
    if (!fs.existsSync(file)) continue
    const body = fs.readFileSync(file)
    const sha256 = createHash('sha256').update(body).digest('hex')
    files.set(name, { name, path: `/downloads/${name}`, bytes: body.length, sha256, body, etag: `"${sha256.slice(0, 32)}"` })
  }
  return files
}

export const registerDownloadRoutes: RouteRegistrar = (app, ctx) => {
  const files = loadDownloads(ctx.config.downloadsDir)
  // ไฟล์สาธารณะ (ไม่มีข้อมูล workspace หรือ secret) แต่ยังจำกัดอัตราต่อ address
  const limit = { config: { rateLimit: { max: ctx.config.clientRateLimitPerMinute, timeWindow: '1 minute' } } }
  const unavailable = () => new AliceError('NOT_FOUND', 'Agent tooling downloads are not available on this server')

  app.get('/downloads/manifest.json', limit, async (_req, reply) => {
    if (files.size === 0) throw unavailable()
    const manifest: DownloadManifest = { version: APP_VERSION, files: [...files.values()].map(({ name, path: p, bytes, sha256 }) => ({ name, path: p, bytes, sha256 })) }
    reply.header('Cache-Control', 'no-cache')
    return manifest
  })

  app.get<{ Params: { name: string } }>('/downloads/:name', limit, async (req, reply) => {
    const file = files.get(req.params.name)
    if (!file) throw files.size === 0 ? unavailable() : new AliceError('NOT_FOUND', 'Download not found')
    reply.header('Cache-Control', 'no-cache')
    reply.header('ETag', file.etag)
    if (req.headers['if-none-match'] === file.etag) return reply.status(304).send()
    reply.header('Content-Disposition', `attachment; filename="${file.name}"`)
    return reply.type('application/javascript; charset=utf-8').send(file.body)
  })
}
