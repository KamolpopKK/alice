import { createContext, useContext } from 'react'

/**
 * What the shell shows at the top of the sidebar: the active workspace and how to switch it.
 * Alice Desktop provides it; the Web dashboard shows the server it was opened from.
 */
export interface ShellWorkspace {
  name: string
  kind: 'local' | 'remote'
  /** Second line: the Local alias or the Remote server address. */
  detail?: string
  insecure?: boolean
  /** Opens the workspace/server switcher (Desktop only). */
  onSwitch?: () => void
}

export const ShellWorkspaceContext = createContext<ShellWorkspace | null>(null)

export function useShellWorkspace(): ShellWorkspace {
  const provided = useContext(ShellWorkspaceContext)
  return provided ?? { name: typeof window === 'undefined' ? 'Alice' : window.location.host, kind: 'remote' }
}
