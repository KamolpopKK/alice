import { lazy, Suspense, type ReactNode } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { ArchiveRestore, Bot, ChevronLeft, ChevronRight, Info, Laptop, Monitor, Moon, Palette, Repeat, ShieldCheck, Sun, UserRound, type LucideIcon } from 'lucide-react'
import { APP_VERSION } from '../../shared/version'
import { useAuth } from '../auth'
import { CodeBlock } from '../components/CodeBlock'
import { ClientSessions } from '../components/ClientSessions'
import { useServerInfo } from '../hooks'
import { useMediaQuery } from '../pads/hooks'
import { useShellWorkspace } from '../shell/workspace'
import { Badge, Banner, Button, Icon, LinkButton, SectionHeader, SegmentedControl, Skeleton, useTheme, type ThemePreference } from '../ui'
import { useLocalWorkspace } from '../workspace-mode'

const AdminSection = lazy(() => import('./admin').then((m) => ({ default: m.AdminSection })))

type SectionId = 'general' | 'appearance' | 'agents' | 'devices' | 'workspaces' | 'backup' | 'advanced' | 'admin'
type Section = { id: SectionId; label: string; icon: LucideIcon; description: string }

/**
 * The categories this person can use here. Devices & Sessions exist only on a Remote server,
 * Workspaces only in Alice Desktop, Administration only for a Remote owner. Hidden here is never
 * the security boundary: the server enforces every one of these.
 */
function useSections(): Section[] {
  const { actor } = useAuth()
  const local = useLocalWorkspace()
  const ws = useShellWorkspace()
  const list: Array<Section | false> = [
    { id: 'general', label: 'General', icon: UserRound, description: 'Your account and this workspace.' },
    { id: 'appearance', label: 'Appearance', icon: Palette, description: 'Light, Dark or System, on this device.' },
    Boolean(ws.onSwitch) && { id: 'workspaces', label: 'Workspaces', icon: Repeat, description: 'Switch, add or rename workspaces.' },
    { id: 'agents', label: 'Agents & CLI', icon: Bot, description: 'Connect agents and the Alice CLI.' },
    !local && { id: 'devices', label: 'Devices & Sessions', icon: Laptop, description: 'Approve sign-ins and revoke apps.' },
    { id: 'backup', label: 'Backup & Recovery', icon: ArchiveRestore, description: 'How this workspace is backed up and restored.' },
    { id: 'advanced', label: 'Advanced', icon: Info, description: 'Versions and server capabilities.' },
    !local && Boolean(actor?.isOwner) && { id: 'admin', label: 'Administration', icon: ShieldCheck, description: 'People, agents, tokens and sessions.' },
  ]
  return list.filter((s): s is Section => Boolean(s))
}

const NARROW = '(max-width: 799px)'

/**
 * Settings: category list and detail side by side on wide screens; on narrow screens the list is
 * its own screen and each category opens with a Back link.
 */
export function SettingsPage() {
  const { section } = useParams()
  const sections = useSections()
  const narrow = useMediaQuery(NARROW)
  const current = sections.find((s) => s.id === section)
  // หมวดที่ไม่มีหรือใช้ไม่ได้ในที่นี้: กลับไปหน้ารวม
  if (section && !current) return <Navigate to="/settings" replace />
  const shown = current ?? (narrow ? null : sections[0])
  return (
    <div className={`page settings-layout${narrow ? ' is-narrow' : ''}`}>
      {(!narrow || !current) && (
        <nav className="settings-nav" aria-label="Settings categories">
          <h1>Settings</h1>
          <ul>
            {sections.map((s) => (
              <li key={s.id}>
                <Link to={`/settings/${s.id}`} aria-current={shown?.id === s.id ? 'page' : undefined} className="settings-nav-link">
                  <Icon icon={s.icon} size="sm" />
                  <span className="settings-nav-text">
                    <span>{s.label}</span>
                    {narrow && <span className="ui-text-muted">{s.description}</span>}
                  </span>
                  {narrow && <Icon icon={ChevronRight} size="sm" />}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      )}
      {shown && (
        <section className="settings-detail" aria-labelledby={`settings-${shown.id}`}>
          {narrow && (
            <LinkButton as={Link as never} to="/settings" variant="ghost" size="sm" icon={ChevronLeft} className="settings-back">
              Settings
            </LinkButton>
          )}
          <SectionHeader title={<span id={`settings-${shown.id}`}>{shown.label}</span>} level={2} description={shown.description} />
          <SectionBody id={shown.id} />
        </section>
      )}
    </div>
  )
}

function SectionBody({ id }: { id: SectionId }) {
  switch (id) {
    case 'general':
      return <General />
    case 'appearance':
      return <Appearance />
    case 'workspaces':
      return <Workspaces />
    case 'agents':
      return <AgentsAndCli />
    case 'devices':
      return <Devices />
    case 'backup':
      return <Backup />
    case 'advanced':
      return <Advanced />
    case 'admin':
      return (
        <Suspense fallback={<Skeleton lines={6} />}>
          <AdminSection />
        </Suspense>
      )
  }
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </>
  )
}

function General() {
  const { actor } = useAuth()
  const ws = useShellWorkspace()
  return (
    <dl className="settings-facts">
      <Row label="Name">{actor?.displayName}</Row>
      {actor?.username && <Row label="Username">{actor.username}</Row>}
      <Row label="Role">{actor?.isOwner ? 'Workspace owner' : 'Member'}</Row>
      <Row label="Workspace">
        {ws.name} <Badge>{ws.kind === 'local' ? 'Local' : 'Remote'}</Badge>
      </Row>
    </dl>
  )
}

function Appearance() {
  const { preference, setPreference } = useTheme()
  return (
    <div className="settings-stack">
      <SegmentedControl
        label="Theme"
        value={preference}
        onValueChange={(v) => setPreference(v as ThemePreference)}
        options={[
          { value: 'light', label: 'Light', icon: Sun },
          { value: 'dark', label: 'Dark', icon: Moon },
          { value: 'system', label: 'System', icon: Monitor },
        ]}
      />
      <p className="ui-text-muted">System follows your device and changes with it. The choice is saved on this device only.</p>
    </div>
  )
}

function Workspaces() {
  const ws = useShellWorkspace()
  return (
    <div className="settings-stack">
      <p>
        You are in <strong>{ws.name}</strong> ({ws.kind === 'local' ? 'a Local workspace on this computer' : 'a team server'}).
      </p>
      <div>
        <Button icon={Repeat} onClick={ws.onSwitch}>
          {ws.kind === 'local' ? 'Manage workspaces…' : 'Manage servers…'}
        </Button>
      </div>
    </div>
  )
}

function AgentsAndCli() {
  const local = useLocalWorkspace()
  return (
    <div className="settings-stack">
      {local ? (
        <p>
          Agents on this computer, such as Claude Code and Codex, work through the <code>alice</code> command under their own names. There is no token: Agents has a
          prompt that lets an agent set itself up, and turns each agent on or off.
        </p>
      ) : (
        <p>
          Agents connect to this server through MCP with their own identity and token, so their work is attributed to them. Agents has a setup prompt; the workspace
          owner creates tokens in Administration. People use the Alice CLI with their own sign-in.
        </p>
      )}
      <div className="resource-actions">
        <LinkButton as={Link as never} to="/agents" icon={Bot}>
          Open Agents
        </LinkButton>
      </div>
    </div>
  )
}

function Devices() {
  return (
    <div className="settings-stack">
      <p>Alice Desktop and the Alice CLI sign in through this browser. Approve a code they show, or end a session you no longer use.</p>
      <div>
        <LinkButton as={Link as never} to="/device">
          Approve a sign-in code
        </LinkButton>
      </div>
      <ClientSessions title="Your signed-in devices" />
    </div>
  )
}

function Backup() {
  const local = useLocalWorkspace()
  const { actor } = useAuth()
  if (local)
    return (
      <div className="settings-stack">
        <p>
          Alice backs up this workspace every day and before every upgrade, and verifies each backup. It keeps 7 daily and 3 pre-upgrade backups. Run these from a
          terminal on this computer:
        </p>
        <CodeBlock label="Local backup commands" code={['alice workspace backup', 'alice workspace backups', 'alice workspace restore --from BACKUP_DIR'].join('\n')} />
        <p className="ui-text-muted">A restore creates a new workspace unless you ask to replace one by its exact name. Nothing is overwritten silently.</p>
      </div>
    )
  return (
    <div className="settings-stack">
      <p>This workspace runs on a team server. Its operator backs it up and restores it on the server.</p>
      {actor?.isOwner ? (
        <>
          <CodeBlock label="Server backup commands" code={['alice-server backup', 'alice-server backup --out /data/backups/before-upgrade'].join('\n')} />
          <p className="ui-text-muted">
            Backups include everyone’s private Task Pads, so keep them as safe as the server. Restore only into a stopped server with{' '}
            <code>alice-server restore --from BACKUP_DIR --replace-existing</code>.
          </p>
        </>
      ) : (
        <p className="ui-text-muted">Ask the workspace owner if you need something restored.</p>
      )}
    </div>
  )
}

function Advanced() {
  const info = useServerInfo()
  if (info.isLoading) return <Skeleton lines={3} />
  if (info.error || !info.data) return <Banner tone="danger">Server details could not be loaded.</Banner>
  return (
    <dl className="settings-facts">
      <Row label="This app">{APP_VERSION}</Row>
      <Row label="Server">{info.data.serverVersion}</Row>
      <Row label="Client API">
        v{info.data.clientApi.current} (oldest supported v{info.data.clientApi.minimum})
      </Row>
      <Row label="Capabilities">
        <span className="resource-meta-row">
          {info.data.capabilities.map((c) => (
            <Badge key={c}>{c}</Badge>
          ))}
        </span>
      </Row>
    </dl>
  )
}
