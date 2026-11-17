import type { FastifyBaseLogger } from 'fastify'
import type { AliceConfig } from './config'
import type { DB } from './db/database'
import type { EventBus } from './events'

export interface AppContext {
  config: AliceConfig
  db: DB
  workspaceId: string
  bus: EventBus
  log?: FastifyBaseLogger
}
