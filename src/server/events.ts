import { EventEmitter } from 'node:events'

export interface ResourceRef {
  type: string
  id: string
}

/** Invalidation notice sent to browsers; never carries the canonical resource payload. */
export interface InvalidationEvent {
  activityId: string | null
  resources: ResourceRef[]
  /** Positioned Client API events written in the same transaction (one per resource). */
  events: ClientEventRecord[]
}

/** One resumable Client API invalidation. */
export interface ClientEventRecord {
  position: number
  activityId: string | null
  kind: string
  id: string
  mutation: string
  /** Private invalidation: delivered and replayed only to this actor's sessions (never serialized). */
  audience?: string | null
  /** Client mutation id that caused the change, so a client can recognize its own write. */
  origin?: string | null
}

/** The wire shape of an event: audience is a routing detail and never leaves the server. */
export function publicEvent(e: ClientEventRecord): Omit<ClientEventRecord, 'audience'> {
  const { audience: _audience, origin, ...rest } = e
  return origin ? { ...rest, origin } : rest
}

export class EventBus {
  private emitter = new EventEmitter()

  constructor() {
    this.emitter.setMaxListeners(0)
  }

  publish(event: InvalidationEvent): void {
    this.emitter.emit('invalidate', event)
  }

  subscribe(listener: (event: InvalidationEvent) => void): () => void {
    this.emitter.on('invalidate', listener)
    return () => this.emitter.off('invalidate', listener)
  }

  listenerCount(): number {
    return this.emitter.listenerCount('invalidate')
  }
}
