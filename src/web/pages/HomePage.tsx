import { useQuery } from '@tanstack/react-query'
import { ArrowRight, Bot, CalendarClock, ChevronUp, CircleDot, FilePlus2, FolderPlus, Lock, NotebookPen, SquarePlus } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import type { ActivityEvent, Task } from '../../shared/contracts'
import { client } from '../api'
import { useMe } from '../auth'
import { MascotImage } from '../brand'
import { describeActivity } from '../components/Activity'
import { useCapability } from '../hooks'
import { usePads } from '../pads/hooks'
import { useNewPad } from '../pads/PadSidebar'
import { Avatar, Badge, Banner, Button, EmptyState, IconButton, LinkButton, List, ListItem, SectionHeader, Skeleton } from '../ui'
import { LegacyTasksRedirect } from './TasksPage'
import { markWhatsNewSeen, whatsNewSeen } from '../whats-new'
import { useTaskPages } from './ListPage'

const GREETING_KEY = 'alice.home.summary'
const SHOW = 5

/** `/` is Home; an old Board link with filters (`/?project=…`) still opens the Board view. */
export function HomeRoute() {
  const location = useLocation()
  return location.search ? <LegacyTasksRedirect view="board" /> : <HomePage />
}

function partOfDay(date: Date): string {
  const h = date.getHours()
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'
}

const isOpen = (t: Task) => t.status !== 'done' && t.status !== 'canceled'
const localDay = (iso: string) => new Date(iso).toLocaleDateString('en-CA')

/** One deterministic sentence from real counts; never invents urgency. */
export function homeSummary(counts: { dueToday: number; inProgress: number; blocked: number }): string {
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`
  if (counts.blocked > 0) return `${plural(counts.blocked, 'of your tasks is', 'of your tasks are')} blocked.`
  if (counts.dueToday > 0) return `${plural(counts.dueToday, 'task is', 'tasks are')} due today.`
  if (counts.inProgress > 0) return `You have ${plural(counts.inProgress, 'task', 'tasks')} in progress.`
  return 'Nothing needs your attention right now.'
}

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(GREETING_KEY) === 'collapsed'
  } catch {
    return false
  }
}

export function HomePage() {
  const me = useMe()
  const taskPads = useCapability('task-pads')
  const mine = useTaskPages('home-mine', { assigneeId: 'me', sort: 'due' }, 200)
  const tasks = (mine.data?.pages.flatMap((p) => p.items) ?? []).filter(isOpen)
  const today = localDay(new Date().toISOString())
  const dueToday = tasks.filter((t) => t.dueAt && localDay(t.dueAt) === today && t.status !== 'blocked')
  const inProgress = tasks.filter((t) => t.status === 'in_progress')
  const blocked = tasks.filter((t) => t.status === 'blocked')
  const [collapsed, setCollapsed] = useState(readCollapsed)
  const toggle = () => {
    const next = !collapsed
    setCollapsed(next)
    try {
      localStorage.setItem(GREETING_KEY, next ? 'collapsed' : 'open')
    } catch {
      /* this page only */
    }
  }
  const firstName = me.displayName.split(/\s+/)[0]
  return (
    <div className="page home-page">
      <div className="home-head">
        <h1>
          {partOfDay(new Date())}, {firstName}
        </h1>
      </div>
      {collapsed ? (
        <p className="home-summary-collapsed">
          <button type="button" className="ui-link-button" onClick={toggle} aria-expanded="false">
            Show Alice’s summary
          </button>
        </p>
      ) : (
        <section className="home-greeting" aria-label="Alice’s summary">
          <MascotImage pose="friendly" width={72} loading="eager" className="home-greeting-mascot" />
          <p className="home-greeting-text" role="status">
            {mine.isLoading ? 'Looking at your work…' : mine.error ? 'Your tasks could not be loaded.' : homeSummary({ dueToday: dueToday.length, inProgress: inProgress.length, blocked: blocked.length })}
          </p>
          <IconButton icon={ChevronUp} label="Hide Alice’s summary" size="sm" onClick={toggle} aria-expanded="true" />
        </section>
      )}

      <WhatsNew />

      <QuickCreate taskPads={taskPads} />

      <div className="home-grid">
        <div className="home-column">
          {taskPads && <ContinuePad />}
          <section aria-labelledby="home-my-work" className="home-section">
            <SectionHeader title={<span id="home-my-work">My work</span>} level={2} actions={<Link to="/tasks?view=my-work">All my work</Link>} />
            {mine.error ? (
              <Banner tone="danger" title="Your tasks could not be loaded" action={<Button size="sm" onClick={() => void mine.refetch()}>Try again</Button>}>
                Check the connection, then try again.
              </Banner>
            ) : (
              <div className="home-groups">
                <TaskGroup id="due" title="Due today" icon={CalendarClock} tone="warning" loading={mine.isLoading} tasks={dueToday} more="/tasks?view=list&assigneeId=me&sort=due" empty="Nothing due today." />
                <TaskGroup id="progress" title="In progress" icon={CircleDot} tone="info" loading={mine.isLoading} tasks={inProgress} more="/tasks?view=list&assigneeId=me&status=in_progress" empty="Nothing in progress." />
                <TaskGroup id="blocked" title="Blocked" icon={Lock} tone="danger" loading={mine.isLoading} tasks={blocked} more="/tasks?view=list&assigneeId=me&status=blocked" empty="Nothing is blocked." />
              </div>
            )}
          </section>
        </div>
        <div className="home-column">
          <AgentActivity />
        </div>
      </div>
    </div>
  )
}

/** Once per device, for people who used the previous interface. Concise, factual, dismissible. */
function WhatsNew() {
  const [open, setOpen] = useState(() => !whatsNewSeen())
  if (!open) return null
  return (
    <Banner
      tone="info"
      title="What’s new in Alice"
      onDismiss={() => {
        markWhatsNewSeen()
        setOpen(false)
      }}
    >
      Navigation moved to the sidebar. Board, List and My tasks are now views in Tasks, and Admin and Devices are in Settings. Press Ctrl K (⌘K on a Mac) to find anything,
      and choose Light, Dark or System in Settings.
    </Banner>
  )
}

function QuickCreate({ taskPads }: { taskPads: boolean }) {
  const navigate = useNavigate()
  const newPad = useNewPad()
  return (
    <section aria-label="Quick create" className="home-quick">
      <span className="home-quick-label" aria-hidden="true">
        Quick create
      </span>
      <Button size="sm" icon={SquarePlus} onClick={() => navigate('/tasks/new')}>
        New task
      </Button>
      {taskPads && (
        <Button size="sm" icon={NotebookPen} onClick={() => newPad.start()} loading={newPad.pending}>
          New pad
        </Button>
      )}
      <Button size="sm" icon={FolderPlus} onClick={() => navigate('/projects', { state: { create: true } })}>
        New project
      </Button>
      <Button size="sm" icon={FilePlus2} onClick={() => navigate('/documents?new=1')}>
        New document
      </Button>
    </section>
  )
}

function ContinuePad() {
  const pads = usePads('active')
  const newPad = useNewPad()
  const latest = [...(pads.data ?? [])].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]
  return (
    <section aria-labelledby="home-pad" className="home-section">
      <SectionHeader title={<span id="home-pad">Continue your pad</span>} level={2} />
      {pads.isLoading ? (
        <Skeleton lines={2} />
      ) : latest ? (
        <div className="home-pad">
          <NotebookPen width={24} height={24} aria-hidden="true" />
          <div className="home-pad-text">
            <strong>{latest.name}</strong>
            <span className="ui-text-muted">Updated {new Date(latest.updatedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</span>
          </div>
          <LinkButton as={Link as never} to={`/pads/${latest.id}`} variant="primary" size="sm" icon={ArrowRight} aria-label={`Continue ${latest.name}`}>
            Continue
          </LinkButton>
        </div>
      ) : (
        <EmptyState title="No pads yet" action={<Button size="sm" onClick={() => newPad.start()}>Start a pad</Button>}>
          A pad is a private notepad; lines you mark as tasks go straight to Tasks.
        </EmptyState>
      )}
    </section>
  )
}

function TaskGroup({
  id,
  title,
  icon,
  tone,
  tasks,
  loading,
  more,
  empty,
}: {
  id: string
  title: string
  icon: typeof Lock
  tone: 'warning' | 'info' | 'danger'
  tasks: Task[]
  loading: boolean
  more: string
  empty: string
}) {
  const headingId = `home-group-${id}`
  return (
    <section aria-labelledby={headingId} className="home-group">
      <h3 id={headingId} className="home-group-title">
        <Badge tone={tone} icon={icon}>
          {title}
        </Badge>
        <span className="ui-text-muted">{loading ? '' : tasks.length}</span>
        {tasks.length > SHOW && <Link to={more}>View all {title.toLowerCase()}</Link>}
      </h3>
      {loading ? (
        <Skeleton lines={2} />
      ) : tasks.length === 0 ? (
        <p className="ui-text-muted home-group-empty">{empty}</p>
      ) : (
        <List label={title}>
          {tasks.slice(0, SHOW).map((t) => (
            <ListItem key={t.id} trailing={<TaskMeta task={t} />}>
              <Link to={`/tasks/${t.id}`}>{t.title}</Link>
            </ListItem>
          ))}
        </List>
      )}
    </section>
  )
}

function TaskMeta({ task }: { task: Task }): ReactNode {
  return (
    <>
      <span className="home-meta-project">{task.project.name}</span>
      {task.dueAt && <span>{new Date(task.dueAt).toLocaleDateString()}</span>}
    </>
  )
}

function AgentActivity() {
  const activity = useQuery({ queryKey: ['activity', 'home-agents'], queryFn: () => client.activity({ limit: 50 }) })
  const events: ActivityEvent[] = (activity.data?.items ?? []).filter((e) => e.actor?.kind === 'agent').slice(0, SHOW)
  return (
    <section aria-labelledby="home-agents" className="home-section">
      <SectionHeader title={<span id="home-agents">Recent agent activity</span>} level={2} actions={<Link to="/activity">All activity</Link>} />
      {activity.isLoading ? (
        <Skeleton lines={3} />
      ) : activity.error ? (
        <Banner tone="danger" action={<Button size="sm" onClick={() => void activity.refetch()}>Try again</Button>}>
          Activity could not be loaded.
        </Banner>
      ) : events.length === 0 ? (
        <EmptyState icon={Bot} title="No agent activity yet">
          <Link to="/agents">Connect an agent</Link> to see its work here.
        </EmptyState>
      ) : (
        <List label="Recent agent activity">
          {events.map((e) => (
            <ListItem key={e.id} leading={<Avatar name={e.actor?.displayName ?? 'Agent'} kind="agent" size="sm" />} trailing={<time dateTime={e.createdAt}>{new Date(e.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>}>
              <span>
                <strong>{e.actor?.displayName}</strong> {describeActivity(e)}
              </span>
            </ListItem>
          ))}
        </List>
      )}
    </section>
  )
}
