import fs from 'node:fs'
import type { AliceConfig } from './config'
import { migrate, openDatabase } from './db/database'
import { ensureWorkspace } from './domain/workspace'
import { EventBus } from './events'
import { buildApp } from './http/app'
import { ROUTES, STARTUP_HOOKS } from './http/routes'
import type { AppContext } from './context'
import { acquireInstanceLock } from './ops/lock'

export async function serve(config: AliceConfig): Promise<void> {
  fs.mkdirSync(config.dataDir, { recursive: true })
  const releaseLock = acquireInstanceLock(config.dataDir)
  process.on('exit', releaseLock)
  const db = openDatabase(config.dbPath)
  migrate(db)
  const workspaceId = ensureWorkspace(db)
  const ctx: AppContext = { config, db, workspaceId, bus: new EventBus() }
  const app = await buildApp(ctx, ROUTES)
  const address = await app.listen({ host: config.host, port: config.port })
  if (!config.publicUrlExplicit) {
    const actual = new URL(address)
    if (config.host === '0.0.0.0' || config.host === '::') actual.hostname = 'localhost'
    config.publicUrl = actual
  }
  for (const hook of STARTUP_HOOKS) await hook(ctx)
  app.log.info({ url: address, publicUrl: config.publicUrl.origin }, 'alice.listening')

  let closing = false
  const shutdown = async (signal: string) => {
    if (closing) return
    closing = true
    app.log.info({ signal }, 'alice.shutdown')
    try {
      await app.close()
    } finally {
      db.close()
      releaseLock()
      process.exit(0)
    }
  }
  process.on('SIGTERM', () => void shutdown('SIGTERM'))
  process.on('SIGINT', () => void shutdown('SIGINT'))
}
