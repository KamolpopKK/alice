import { NavLink, Outlet } from 'react-router-dom'
import { useAuth, useMe } from '../auth'
import { useLiveUpdates } from '../live'
import { isDesktop } from '../platform'
import { useLocalWorkspace } from '../workspace-mode'
import { ActorBadge } from './ui'
import { useCapability } from '../hooks'
import { BrandLogo } from '../brand'
import { useWebCaptureShortcuts } from '../pads/capture'

export interface NavItem {
  to: string
  label: string
  ownerOnly?: boolean
  /** Shown only when the server advertises this Client API capability. */
  capability?: string
  /** Remote server features, hidden in a Local workspace. */
  remoteOnly?: boolean
}

export const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Board' },
  { to: '/list', label: 'List' },
  { to: '/my-tasks', label: 'My tasks' },
  { to: '/pads', label: 'Task Pads', capability: 'task-pads' },
  { to: '/projects', label: 'Projects' },
  { to: '/documents', label: 'Documents' },
  { to: '/search', label: 'Search' },
  { to: '/activity', label: 'Activity' },
  { to: '/devices', label: 'Devices', remoteOnly: true },
  { to: '/for-agent', label: 'For agent', remoteOnly: true },
  { to: '/admin', label: 'Admin', ownerOnly: true, remoteOnly: true },
]

export function Layout() {
  const me = useMe()
  const { signOut } = useAuth()
  const live = useLiveUpdates(true)
  const taskPads = useCapability('task-pads')
  const local = useLocalWorkspace()
  useWebCaptureShortcuts(taskPads)
  return (
    <div className="app">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="topbar">
        <NavLink to="/" className="brand-link" end>
          <BrandLogo variant="compact" />
        </NavLink>
        <nav aria-label="Main" className="mainnav">
          {NAV_ITEMS.filter((item) => (!item.ownerOnly || me.isOwner) && (item.capability !== 'task-pads' || taskPads) && !(local && item.remoteOnly)).map((item) => (
            <NavLink key={item.to} to={item.to} end={item.to === '/'}>
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="userbox">
          <span className={`live live-${live}`} role="status" title={live === 'live' ? 'Live updates on' : 'Reconnecting…'}>
            <span className="sr-only">{live === 'live' ? 'Live updates on' : 'Live updates reconnecting'}</span>
          </span>
          <ActorBadge actor={me} />
          {!local && (
            <button type="button" className="link" onClick={() => void signOut()}>
              Sign out
            </button>
          )}
        </div>
      </header>
      {isDesktop && live === 'offline' && (
        <div className="disconnected-banner" role="status">
          Disconnected from the server. What you see may be out of date and changes are paused until the connection returns. Text you are typing is kept.
        </div>
      )}
      <main id="main" tabIndex={-1} data-offline={isDesktop && live === 'offline' ? 'true' : undefined}>
        <Outlet />
      </main>
    </div>
  )
}
