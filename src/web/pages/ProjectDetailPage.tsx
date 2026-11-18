import { useState, type FormEvent } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Archive, ArchiveRestore, FolderClosed, Pencil, Plus } from 'lucide-react'
import type { Project } from '../../shared/contracts'
import { FullPageError, isRecoverable } from '../brand'
import { client } from '../api'
import { ActivityList } from '../components/Activity'
import { Labels, LabelsInput } from '../components/LabelsInput'
import { LinkedDocuments } from '../components/LinkedDocuments'
import { Markdown, MarkdownEditor } from '../components/Markdown'
import { ActorBadge, formatDate } from '../components/ui'
import { useTaskPages } from '../tasks/hooks'
import { useCapability } from '../hooks'
import { ProjectMembers, ProjectPlan } from './projectPlan'
import { isOpen } from '../tasks/model'
import { errorText } from '../tasks/TaskDetail'
import { TaskTable } from '../tasks/views'
import { Badge, Banner, Button, EmptyState, FieldMessage, Icon, LinkButton, Skeleton, Tabs, TextField } from '../ui'

export function useProject(id: string) {
  return useQuery({ queryKey: ['project', id], queryFn: () => client.projects.get(id) })
}

const TABS = ['overview', 'tasks', 'documents', 'activity'] as const
type Tab = (typeof TABS)[number]

/** Project Detail: Overview, Tasks, Documents and Activity; the tab is in the URL (`?tab=`). */
export function ProjectDetailPage() {
  const { id = '' } = useParams()
  const project = useProject(id)
  const [params, setParams] = useSearchParams()
  const tab: Tab = TABS.includes(params.get('tab') as Tab) ? (params.get('tab') as Tab) : 'overview'
  const [editing, setEditing] = useState(false)
  const planning = useCapability('project-planning')
  const qc = useQueryClient()
  const archive = useMutation({
    mutationFn: (archived: boolean) => (archived ? client.projects.archive(id) : client.projects.restore(id)),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['project', id] })
      void qc.invalidateQueries({ queryKey: ['projects'] })
    },
  })
  if (project.isLoading)
    return (
      <div className="page resource-page">
        <Skeleton lines={6} />
      </div>
    )
  if (project.error && isRecoverable(project.error)) return <FullPageError error={project.error} onRetry={() => void project.refetch()} />
  if (project.error || !project.data)
    return (
      <div className="page resource-page">
        <Banner tone="danger" title="This project could not be opened">
          {project.error ? errorText(project.error) : 'Project not found'}
        </Banner>
      </div>
    )
  const p = project.data
  const setTab = (next: string) =>
    setParams(
      (prev) => {
        const n = new URLSearchParams(prev)
        if (next === 'overview') n.delete('tab')
        else n.set('tab', next)
        return n
      },
      { replace: true, preventScrollReset: true },
    )
  return (
    <div className="page resource-page">
      <div className="resource-head">
        <div className="resource-title">
          <span className="resource-icon">
            <Icon icon={FolderClosed} />
          </span>
          <div>
            <h1>{p.name}</h1>
            <div className="resource-meta-row">
              {p.isSystem && <Badge>Default for new tasks</Badge>}
              {p.archivedAt ? <Badge>archived</Badge> : <Badge tone="success">Active</Badge>}
              <Labels labels={p.labels} />
            </div>
            {planning && <ProjectMembers project={p} />}
          </div>
        </div>
        <div className="resource-actions">
          {!p.archivedAt && (
            <LinkButton as={Link as never} to={`/tasks/new?projectId=${p.id}`} variant="primary" icon={Plus}>
              New task
            </LinkButton>
          )}
          <Button icon={Pencil} onClick={() => setEditing((v) => !v)} aria-expanded={editing}>
            {editing ? 'Close editor' : 'Edit'}
          </Button>
          {!p.isSystem && (
            <Button icon={p.archivedAt ? ArchiveRestore : Archive} loading={archive.isPending} onClick={() => archive.mutate(!p.archivedAt)}>
              {p.archivedAt ? 'Restore' : 'Archive'}
            </Button>
          )}
        </div>
      </div>
      {archive.error && <FieldMessage tone="error">{errorText(archive.error)}</FieldMessage>}
      {editing && <EditProject project={p} onDone={() => setEditing(false)} />}
      <Tabs
        label="Project sections"
        value={tab}
        onValueChange={setTab}
        items={[
          { value: 'overview', label: 'Overview', content: <Overview project={p} onAllTasks={() => setTab('tasks')} /> },
          { value: 'tasks', label: 'Tasks', content: <ProjectTasks project={p} /> },
          { value: 'documents', label: 'Documents', content: <LinkedDocuments target={{ projectId: p.id }} title="Project documents" /> },
          { value: 'activity', label: 'Activity', content: <ProjectActivity project={p} /> },
        ]}
      />
    </div>
  )
}

function Overview({ project, onAllTasks }: { project: Project; onAllTasks: () => void }) {
  const planning = useCapability('project-planning')
  const query = useTaskPages(`project-${project.id}-next`, { projectId: project.id, sort: 'priority' }, 50)
  const tasks = query.data?.pages.flatMap((p) => p.items) ?? []
  const open = tasks.filter(isOpen)
  return (
    <div className="project-overview">
      <section className="resource-panel" aria-labelledby="project-summary">
        <h2 id="project-summary" className="resource-panel-title">
          Summary
        </h2>
        <Markdown source={project.description} />
        <p className="resource-meta">
          Created {formatDate(project.createdAt)} {project.createdBy && <>by <ActorBadge actor={project.createdBy} /></>} · Updated {formatDate(project.updatedAt)}
          {project.updatedBy && (
            <>
              {' '}
              by <ActorBadge actor={project.updatedBy} />
            </>
          )}
        </p>
      </section>
      {planning && <ProjectPlan project={project} />}
      <section className="resource-panel" aria-labelledby="project-next">
        <div className="resource-panel-head">
          <h2 id="project-next" className="resource-panel-title">
            Next tasks
          </h2>
          <Button size="sm" variant="ghost" onClick={onAllTasks}>
            View all tasks
          </Button>
        </div>
        {query.isLoading ? (
          <Skeleton lines={3} />
        ) : open.length === 0 ? (
          <EmptyState title="No open tasks">Everything in this project is done or not started yet.</EmptyState>
        ) : (
          <TaskTable tasks={open.slice(0, 5)} showProject={false} caption={`Next tasks in ${project.name}`} />
        )}
        <p className="resource-meta">
          {query.isLoading ? '' : `${open.length}${query.hasNextPage ? '+' : ''} open · ${tasks.length - open.length} done or canceled`}
        </p>
      </section>
    </div>
  )
}

function ProjectTasks({ project }: { project: Project }) {
  const query = useTaskPages(`project-${project.id}`, { projectId: project.id, sort: 'priority' }, 50)
  const tasks = query.data?.pages.flatMap((p) => p.items) ?? []
  if (query.isLoading) return <Skeleton lines={4} />
  if (query.error && !query.data)
    return (
      <Banner tone="danger" title="Tasks could not be loaded" action={<Button size="sm" onClick={() => void query.refetch()}>Try again</Button>}>
        {errorText(query.error)}
      </Banner>
    )
  return (
    <section aria-label={`Tasks in ${project.name}`} className="resource-section">
      {tasks.length === 0 ? (
        <EmptyState title="No active tasks" action={<LinkButton as={Link as never} to={`/tasks/new?projectId=${project.id}`} size="sm">New task in project</LinkButton>} />
      ) : (
        <TaskTable tasks={tasks} showProject={false} caption={`Tasks in ${project.name}`} />
      )}
      {query.hasNextPage && (
        <Button size="sm" loading={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>
          Load more
        </Button>
      )}
    </section>
  )
}

/** Changes to the project itself; task activity stays on each task and in Activity. */
function ProjectActivity({ project }: { project: Project }) {
  const activity = useQuery({ queryKey: ['activity', 'project', project.id], queryFn: () => client.activity({ resourceType: 'project', limit: 200 }) })
  const events = (activity.data?.items ?? []).filter((e) => e.resourceId === project.id)
  if (activity.isLoading) return <Skeleton lines={3} />
  if (activity.error) return <FieldMessage tone="error">{errorText(activity.error)}</FieldMessage>
  return (
    <section aria-label="Project activity" className="resource-section">
      <ActivityList events={events} />
      <p className="resource-meta">
        Task changes are listed on each task and in <Link to="/activity">Activity</Link>.
      </p>
    </section>
  )
}

function EditProject({ project, onDone }: { project: Project; onDone: () => void }) {
  const qc = useQueryClient()
  const [name, setName] = useState(project.name)
  const [description, setDescription] = useState(project.description)
  const [labels, setLabels] = useState(project.labels)
  const planning = useCapability('project-planning')
  const [startDate, setStartDate] = useState(project.startDate ?? '')
  const [targetDate, setTargetDate] = useState(project.targetDate ?? '')
  const save = useMutation({
    mutationFn: () =>
      client.projects.update(project.id, {
        ...(project.isSystem ? {} : { name }),
        description,
        labels,
        ...(planning ? { startDate: startDate || null, targetDate: targetDate || null } : {}),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['project', project.id] })
      void qc.invalidateQueries({ queryKey: ['projects'] })
      onDone()
    },
  })
  return (
    <form
      className="resource-panel resource-form"
      aria-label="Edit project"
      onSubmit={(e: FormEvent) => {
        e.preventDefault()
        save.mutate()
      }}
    >
      <TextField
        label="Project name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        disabled={project.isSystem}
        hint={project.isSystem ? 'The Untitled project cannot be renamed.' : undefined}
        required
        autoFocus={!project.isSystem}
      />
      <MarkdownEditor id="project-description" label="Description (Markdown)" value={description} onChange={setDescription} />
      <LabelsInput value={labels} onChange={setLabels} />
      {planning && (
        <div className="project-dates">
          <TextField label="Start date" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          <TextField label="Target date" type="date" value={targetDate} min={startDate || undefined} onChange={(e) => setTargetDate(e.target.value)} />
        </div>
      )}
      {save.error && <FieldMessage tone="error">{errorText(save.error)}</FieldMessage>}
      <div className="resource-actions">
        <Button variant="primary" type="submit" loading={save.isPending}>
          Save
        </Button>
        <Button onClick={onDone}>Cancel</Button>
      </div>
    </form>
  )
}
