import { ChevronsLeft, ChevronsRight, Compass, FilePlus2, FolderPlus, LogOut, Menu as MenuIcon, NotebookPen, Plus, Search, SquarePlus } from 'lucide-react'
import { guarded } from '../documents/leave'
import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAuth, useMe } from '../auth'
import { BrandLogo } from '../brand'
import { useCapability } from '../hooks'
import { useLiveUpdates } from '../live'
import { useWebCaptureShortcuts } from '../pads/capture'
import { useNewPad } from '../pads/PadSidebar'
import { isDesktop } from '../platform'
import { Avatar, Badge, Button, IconButton, Menu, Sheet, Tooltip, type MenuItem } from '../ui'
import { useLocalWorkspace } from '../workspace-mode'
import { CommandPalette, usePaletteShortcut } from './CommandPalette'
import { Tour, openTour } from './Tour'
import { available, isCurrent, PRIMARY, SECONDARY, type Destination } from './nav'
import { useShellWorkspace } from './workspace'

const COLLAPSE_KEY = 'alice.ui.sidebar'
const WIDE = '(min-width: 1024px)'
const MOBILE = '(max-width: 767px)'

function useMedia(query: string): boolean {
  const get = () => typeof window !== 'undefined' && !!window.matchMedia?.(query).matches
  const [matches, setMatches] = useState(get)
  useEffect(() => {
    const mql = window.matchMedia(query)
    const on = () => setMatches(mql.matches)
    on()
    mql.addEventListener('change', on)
    return () => mql.removeEventListener('change', on)
  }, [query])
  return matches
}

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === 'collapsed'
  } catch {
    return false
  }
}

/**
 * The application shell: workspace-aware sidebar (expanded or remembered rail on wide screens, rail
 * plus overlay on tablets, top bar plus navigation sheet on phones), global New, command palette,
 * connection state and the page outlet.
 */
export function AppShell() {
  const live = useLiveUpdates(true)
  const taskPads = useCapability('task-pads')
  useWebCaptureShortcuts(taskPads)
  const wide = useMedia(WIDE)
  const mobile = useMedia(MOBILE)
  const [collapsedPref, setCollapsedPref] = useState(readCollapsed)
  const [navOpen, setNavOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const location = useLocation()
  const mainRef = useRef<HTMLElement>(null)
  usePaletteShortcut(useCallback(() => setPaletteOpen(true), []))

  const collapsed = wide ? collapsedPref : !mobile
  const toggleCollapsed = () => {
    const next = !collapsedPref
    setCollapsedPref(next)
    try {
      localStorage.setItem(COLLAPSE_KEY, next ? 'collapsed' : 'expanded')
    } catch {
      /* the choice lasts for this page only */
    }
  }
  // ปลายทางที่เลือกจาก sheet: ปิด sheet แล้วให้โฟกัสอยู่ที่เนื้อหาหน้าใหม่ ไม่ใช่ปุ่มเมนู
  const navigatedFromSheet = useRef(false)
  // ห้ามปิด sheet ระหว่าง click: ลิงก์จะถูกถอดออกก่อน router รับ click และ browser โหลดหน้าใหม่ทั้งหน้า
  // จดไว้อย่างเดียว แล้วปิดเมื่อ route เปลี่ยน (effect ด้านล่าง)
  const afterNavigate = () => {
    navigatedFromSheet.current = true
  }
  useEffect(() => {
    setNavOpen(false)
    if (!navigatedFromSheet.current) return
    navigatedFromSheet.current = false
    // หลัง sheet ปิดและคืนหน้าเดิมครบแล้ว ย้ายโฟกัสไปที่เนื้อหาของหน้าใหม่
    const t = setTimeout(() => mainRef.current?.focus(), 60)
    return () => clearTimeout(t)
  }, [location.pathname])

  const offline = isDesktop && live === 'offline'
  return (
    <div className={`shell${mobile ? ' shell--mobile' : collapsed ? ' shell--rail' : ''}`}>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      {mobile ? (
        <header className="shell-topbar">
          <IconButton icon={MenuIcon} label="Open navigation" onClick={() => setNavOpen(true)} />
          <Link to="/" className="shell-topbar-brand" aria-label="Alice">
            <BrandLogo variant="compact" />
          </Link>
          <div className="shell-topbar-actions">
            <IconButton icon={Search} label="Search and commands" onClick={() => setPaletteOpen(true)} />
            <NewMenu compact />
            <AccountMenu compact />
          </div>
        </header>
      ) : (
        <aside className="shell-sidebar" aria-label="Sidebar">
          <SidebarContent collapsed={collapsed} live={live} onPalette={() => setPaletteOpen(true)} onToggle={wide ? toggleCollapsed : () => setNavOpen(true)} toggleLabel={wide ? (collapsed ? 'Expand sidebar' : 'Collapse sidebar') : 'Expand navigation'} />
        </aside>
      )}
      <Sheet open={navOpen} onOpenChange={setNavOpen} title="Navigation" side="left" hideTitle>
        <div className="shell-sheet-nav" onClickCapture={(e) => (e.target as HTMLElement).closest('a') && afterNavigate()}>
          <SidebarContent collapsed={false} live={live} onPalette={() => setPaletteOpen(true)} inSheet />
        </div>
      </Sheet>
      <div className="shell-main">
        {offline && (
          <div className="disconnected-banner" role="status">
            Disconnected from the server. What you see may be out of date and changes are paused until the connection returns. Text you are typing is kept.
          </div>
        )}
        <main id="main" ref={mainRef} tabIndex={-1} data-offline={offline ? 'true' : undefined}>
          <Outlet />
        </main>
      </div>
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
      <Tour />
    </div>
  )
}

function SidebarContent({
  collapsed,
  live,
  onPalette,
  onToggle,
  toggleLabel,
  inSheet,
}: {
  collapsed: boolean
  live: string
  onPalette: () => void
  onToggle?: () => void
  toggleLabel?: string
  inSheet?: boolean
}) {
  const taskPads = useCapability('task-pads')
  const location = useLocation()
  return (
    <div className={`shell-nav${collapsed ? ' is-collapsed' : ''}`}>
      <div className="shell-brand">
        <Link to="/" className="shell-brand-link" aria-label="Alice">
          <BrandLogo variant="compact" />
        </Link>
        {onToggle && !inSheet && <IconButton icon={collapsed ? ChevronsRight : ChevronsLeft} label={toggleLabel ?? 'Toggle sidebar'} size="sm" onClick={onToggle} />}
      </div>
      <WorkspaceCard collapsed={collapsed} />
      <div className="shell-actions">
        <NewMenu compact={collapsed} />
        {collapsed ? (
          <Tooltip content="Search and commands (Ctrl K)" side="right">
            <IconButton icon={Search} label="Search and commands" onClick={onPalette} />
          </Tooltip>
        ) : (
          <button type="button" className="shell-palette-button" onClick={onPalette}>
            <Search width={16} height={16} aria-hidden="true" />
            <span>Search or jump to…</span>
            <kbd className="ui-kbd">{navigator.platform.startsWith('Mac') ? '⌘K' : 'Ctrl K'}</kbd>
          </button>
        )}
      </div>
      <nav aria-label="Main" className="shell-navlist">
        <NavGroup items={available(PRIMARY, { taskPads })} collapsed={collapsed} pathname={location.pathname} />
      </nav>
      <nav aria-label="More" className="shell-navlist shell-navlist--secondary">
        <NavGroup items={SECONDARY} collapsed={collapsed} pathname={location.pathname} />
      </nav>
      <UserBox collapsed={collapsed} live={live} />
    </div>
  )
}

function NavGroup({ items, collapsed, pathname }: { items: Destination[]; collapsed: boolean; pathname: string }) {
  return (
    <ul>
      {items.map((d) => {
        const current = isCurrent(d, pathname)
        const link = (
          <NavLink to={d.to} end={d.to === '/'} className={`shell-link${current ? ' is-current' : ''}`} aria-current={current ? 'page' : undefined}>
            <d.icon width={20} height={20} strokeWidth={1.75} aria-hidden="true" />
            <span className={collapsed ? 'ui-visually-hidden' : 'shell-link-label'}>{d.label}</span>
          </NavLink>
        )
        return (
          <li key={d.to}>
            {collapsed ? (
              <Tooltip content={d.label} side="right">
                {link}
              </Tooltip>
            ) : (
              link
            )}
          </li>
        )
      })}
    </ul>
  )
}

function WorkspaceCard({ collapsed }: { collapsed: boolean }) {
  const ws = useShellWorkspace()
  const region = ws.kind === 'local' ? 'Workspace' : isDesktop ? 'Server profile' : 'Workspace'
  return (
    <section className={`shell-workspace${collapsed ? ' is-collapsed' : ''}`} aria-label={region}>
      <Avatar name={ws.name} size={collapsed ? 'md' : 'sm'} />
      <div className={collapsed ? 'ui-visually-hidden' : 'shell-workspace-text'}>
        <strong className="shell-workspace-name">{ws.name}</strong>
        <span className="shell-workspace-meta">
          <Badge tone={ws.kind === 'local' ? 'brand' : 'neutral'}>{ws.kind === 'local' ? 'Local' : 'Remote'}</Badge>
          {ws.detail && <span className="shell-workspace-detail">{ws.detail}</span>}
        </span>
        {ws.insecure && (
          <span className="insecure-warning" role="note">
            Unencrypted HTTP — development only
          </span>
        )}
      </div>
      {ws.onSwitch && (
        <Button size="sm" variant="ghost" onClick={ws.onSwitch} className={collapsed ? 'ui-visually-hidden' : undefined}>
          {ws.kind === 'local' ? 'Switch workspace' : 'Switch server'}
        </Button>
      )}
    </section>
  )
}

function UserBox({ collapsed, live }: { collapsed: boolean; live: string }) {
  const status = live === 'live' ? 'Connected' : live === 'offline' ? 'Offline' : 'Reconnecting'
  return (
    <div className={`shell-user${collapsed ? ' is-collapsed' : ''}`}>
      <span className={`shell-live shell-live--${live}`} role="status" data-live={live}>
        <span className="shell-live-dot" aria-hidden="true" />
        <span className={collapsed ? 'ui-visually-hidden' : undefined}>{status}</span>
      </span>
      <AccountMenu compact={collapsed} />
    </div>
  )
}

/** The signed-in person: name, and Sign out on Remote servers (a Local workspace has no sign-in). */
function AccountMenu({ compact }: { compact?: boolean }) {
  const me = useMe()
  const { signOut } = useAuth()
  const local = useLocalWorkspace()
  const items: MenuItem[] = [{ kind: 'label', label: me.displayName }]
  items.push({ kind: 'label', label: 'Help' }, { label: 'Take the tour', icon: Compass, onSelect: openTour })
  if (!local) items.push({ kind: 'separator' }, { label: 'Sign out', icon: LogOut, onSelect: () => void guarded('sign out', signOut) })
  return (
    <Menu
      trigger={
        <button type="button" className="shell-user-button" aria-label={`Account: ${me.displayName}`}>
          <Avatar name={me.displayName} kind={me.kind} size="sm" />
          {!compact && <span className="shell-user-name">{me.displayName}</span>}
        </button>
      }
      items={items}
      align={compact ? 'end' : 'start'}
    />
  )
}

/** One place to create anything: Task, Pad, Project, Document (two interactions from any page). */
export function NewMenu({ compact }: { compact?: boolean }) {
  const navigate = useNavigate()
  const taskPads = useCapability('task-pads')
  const newPad = useNewPad()
  const items: MenuItem[] = [
    { label: 'Task', icon: SquarePlus, onSelect: () => navigate('/tasks/new'), navigates: true },
    ...(taskPads ? [{ label: 'Pad', icon: NotebookPen, onSelect: () => newPad.start(), navigates: true } as MenuItem] : []),
    { label: 'Project', icon: FolderPlus, onSelect: () => navigate('/projects', { state: { create: true } }), navigates: true },
    { label: 'Document', icon: FilePlus2, onSelect: () => navigate('/documents/new'), navigates: true },
  ]
  const trigger: ReactElement = compact ? (
    <IconButton icon={Plus} label="New" variant="secondary" />
  ) : (
    <Button variant="primary" icon={Plus} className="shell-new">
      New
    </Button>
  )
  return <Menu trigger={trigger} items={items} align="start" />
}
