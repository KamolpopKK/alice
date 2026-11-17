import { createContext, useContext } from 'react'

/**
 * True when Alice Desktop shows a Local workspace. Sign-in, devices, the For agent setup and
 * user administration belong to Remote servers, so the shared layout hides them.
 */
export const LocalWorkspaceContext = createContext(false)
export const useLocalWorkspace = () => useContext(LocalWorkspaceContext)
