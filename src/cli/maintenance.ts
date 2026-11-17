import fs from 'node:fs'
import path from 'node:path'
import { desktopAvailable } from './commands/workspace'

/**
 * Desktop-managed updates stop when Alice Desktop is removed; the installed Local runtime keeps working.
 * Returns the explanation to show, or null when Desktop (or no managed runtime) is present.
 */
export function maintenanceNotice(root: string, env: NodeJS.ProcessEnv): string | null {
  let current: string
  try {
    current = path.basename(fs.realpathSync(path.join(root, 'runtime', 'current')))
  } catch {
    return null
  }
  if (desktopAvailable(env)) return null
  return `Alice Desktop is not installed: the Local runtime ${current} keeps working but receives no updates. Reinstall Alice Desktop to update or repair it.`
}
