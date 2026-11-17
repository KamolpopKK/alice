import { AliceClient, AliceClientError, type EventHandlers, type Transport, type TransportRequest } from '../client'
import { APP_VERSION } from '../shared/version'
import { isDesktop } from './platform'
import { CookieTransport } from './transport'

export const cookieTransport = new CookieTransport()

/** Delegates to the current transport: cookies on the Web, the Rust core on Desktop. */
class SwitchableTransport implements Transport {
  current: Transport = cookieTransport
  request(req: TransportRequest) {
    return this.current.request(req)
  }
  subscribe(after: number | null, handlers: EventHandlers) {
    return this.current.subscribe(after, handlers)
  }
}

const switchable = new SwitchableTransport()

/** The UI's only route to the server: the shared client over Client API v1. */
export const client = new AliceClient(switchable, { clientName: `alice-${isDesktop ? 'desktop-ui' : 'web'}/${APP_VERSION}` })

/** Desktop swaps in the native transport for the active profile. */
export function setTransport(transport: Transport) {
  switchable.current = transport
}

export { AliceClientError as ApiError }

export function setCsrfToken(token: string | null) {
  cookieTransport.csrfToken = token
}
