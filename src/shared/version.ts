// เวอร์ชันของแอป, MCP contract และ skill ต้องเดินไปด้วยกัน
export const APP_VERSION = '0.2.3'
export const MCP_CONTRACT_VERSION = '1'
export const MCP_ENDPOINT_PATH = `/mcp/v${MCP_CONTRACT_VERSION}`

// Human Client API: เวอร์ชัน protocol แยกจากเวอร์ชันแอป (client กับ server ออก release แยกกันได้)
export const CLIENT_API_VERSION = 1
export const CLIENT_API_MIN_VERSION = 1
export const CLIENT_API_PREFIX = `/client/v${CLIENT_API_VERSION}`
/** Request header a client uses to declare the Client API version it speaks. */
export const CLIENT_API_VERSION_HEADER = 'alice-client-api'
/** Request header naming the client product and version, e.g. `alice-cli/0.2.0`. */
export const CLIENT_NAME_HEADER = 'alice-client'
export const IDEMPOTENCY_HEADER = 'idempotency-key'
export const CLIENT_CAPABILITIES = ['projects', 'tasks', 'documents', 'comments', 'relationships', 'activity', 'search', 'admin', 'idempotency', 'events.resume', 'device-auth', 'client-sessions', 'task-pads', 'saved-views', 'project-planning', 'approvals'] as const
