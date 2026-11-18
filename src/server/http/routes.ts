import { CLIENT_API_PREFIX } from '../../shared/version'
import type { AppContext } from '../context'
import type { RouteRegistrar } from './app'
import { registerAuth } from './auth'
import { registerClientApi, registerLegacyEvents } from './client-api'
import { registerIdentityRoutes } from './identity-routes'
import { registerProjectRoutes } from './project-routes'
import { registerApprovalRoutes } from './approval-routes'
import { registerTaskRoutes } from './task-routes'
import { registerDocumentRoutes } from './document-routes'
import { registerCommentRoutes } from './comment-routes'
import { registerRelationshipRoutes } from './relationship-routes'
import { registerWorkspaceRoutes } from './workspace-routes'
import { registerDeviceRoutes } from './device-routes'
import { registerPadRoutes } from './pad-routes'
import { registerSavedViewRoutes } from './saved-view-routes'
import { registerDownloadRoutes } from './download-routes'
import { registerMcp } from '../mcp/server'
import { prepareBootstrap } from '../domain/identity'

/** Human workflow routes, written without a prefix and mounted under each supported surface. */
export const HUMAN_ROUTES: RouteRegistrar[] = [
  registerIdentityRoutes,
  registerProjectRoutes,
  registerTaskRoutes,
  registerDocumentRoutes,
  registerCommentRoutes,
  registerRelationshipRoutes,
  registerWorkspaceRoutes,
  registerApprovalRoutes,
]

/**
 * `/client/v1` is the supported Client API. `/api` is the legacy internal API kept for the
 * documented compatibility window; both delegate to the same handlers and domain services.
 */
export const HUMAN_ROUTE_PREFIXES = [CLIENT_API_PREFIX, '/api'] as const

const registerHumanRoutes: RouteRegistrar = async (app, ctx) => {
  // device flow และ client session มีเฉพาะใน Client API
  await app.register(async (child) => registerDeviceRoutes(child, ctx), { prefix: CLIENT_API_PREFIX })
  // Task Pads เป็นข้อมูลส่วนตัว: มีเฉพาะใน Client API ไม่มีใน /api เดิม
  await app.register(async (child) => registerPadRoutes(child, ctx), { prefix: CLIENT_API_PREFIX })
  // saved views ของแต่ละคน: Client API เท่านั้น
  await app.register(async (child) => registerSavedViewRoutes(child, ctx), { prefix: CLIENT_API_PREFIX })
  for (const prefix of HUMAN_ROUTE_PREFIXES) {
    await app.register(
      async (child) => {
        for (const register of HUMAN_ROUTES) await register(child, ctx)
      },
      { prefix },
    )
  }
}

// ลำดับการลงทะเบียน route ของทั้งแอป
export const ROUTES: RouteRegistrar[] = [registerAuth, registerClientApi, registerHumanRoutes, registerLegacyEvents, registerMcp, registerDownloadRoutes]

/** Hooks that run after migrations and before listening (e.g. bootstrap preparation). */
export const STARTUP_HOOKS: Array<(ctx: AppContext) => void | Promise<void>> = [prepareBootstrap]
