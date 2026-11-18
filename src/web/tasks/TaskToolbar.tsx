import { useState, type FormEvent } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Bookmark, Filter, LayoutGrid, List, Trash2, UserRound } from 'lucide-react'
import { STATUS_LABELS, TASK_PRIORITIES, TASK_STATUSES } from '../../shared/contracts'
import { useActors } from '../hooks'
import { useProjects } from '../pages/ProjectsPage'
import { Button, IconButton, Popover, SegmentedControl, SelectField, TextField, type SelectOption } from '../ui'
import { useFilterParams, type FilterKey } from './hooks'
import { useSavedViews } from './savedViews'

export type TaskView = 'my-work' | 'board' | 'list'

/** Filters each view understands; the others are hidden there (My Work is always "assigned to me"). */
const VIEW_FILTERS: Record<TaskView, FilterKey[]> = {
  'my-work': ['projectId', 'priority', 'label', 'dueAfter', 'dueBefore', 'order'],
  board: ['projectId', 'assigneeId', 'priority', 'label', 'dueAfter', 'dueBefore', 'order'],
  list: ['projectId', 'assigneeId', 'status', 'priority', 'label', 'dueAfter', 'dueBefore', 'archived', 'order'],
}
export const DEFAULT_SORT: Record<TaskView, string> = { 'my-work': 'due', board: 'priority', list: 'updated' }

const SORT_OPTIONS: SelectOption[] = [
  { value: 'updated', label: 'Last updated' },
  { value: 'created', label: 'Created' },
  { value: 'priority', label: 'Priority' },
  { value: 'due', label: 'Due date' },
  { value: 'title', label: 'Title' },
]

/** The filters a view actually applies, from the URL. */
export function viewFilters(view: TaskView, values: Partial<Record<FilterKey, string>>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const key of [...VIEW_FILTERS[view], 'q', 'sort'] as FilterKey[]) if (values[key]) out[key] = values[key] as string
  if (!out.sort) out.sort = DEFAULT_SORT[view]
  if (view === 'my-work') out.assigneeId = 'me'
  return out
}

function FilterPanel({ view }: { view: TaskView }) {
  const [values, set, clear] = useFilterParams()
  const projects = useProjects()
  const actors = useActors()
  const shown = new Set(VIEW_FILTERS[view])
  const select = (key: FilterKey, label: string, options: SelectOption[], fallback = '') => (
    <SelectField label={label} value={values[key] ?? fallback} options={options} onChange={(e) => set(key, e.target.value === fallback ? '' : e.target.value)} />
  )
  return (
    <form className="tasks-filter-panel" aria-label="Filter tasks" onSubmit={(e) => e.preventDefault()}>
      {shown.has('projectId') && select('projectId', 'Project', [{ value: '', label: 'All projects' }, ...(projects.data?.items ?? []).map((p) => ({ value: p.id, label: p.name }))])}
      {shown.has('assigneeId') &&
        select('assigneeId', 'Assignee', [
          { value: '', label: 'Anyone' },
          { value: 'me', label: 'Me' },
          { value: 'none', label: 'Unassigned' },
          ...(actors.data ?? []).map((a) => ({ value: a.id, label: a.kind === 'agent' ? `${a.displayName} (agent)` : a.displayName })),
        ])}
      {shown.has('status') && select('status', 'Status', [{ value: '', label: 'Any status' }, ...TASK_STATUSES.map((s) => ({ value: s, label: STATUS_LABELS[s] }))])}
      {shown.has('priority') &&
        select('priority', 'Priority', [{ value: '', label: 'Any priority' }, ...TASK_PRIORITIES.map((p) => ({ value: p, label: p === 'none' ? 'No priority' : p[0].toUpperCase() + p.slice(1) }))])}
      {shown.has('label') && <TextField label="Label" value={values.label ?? ''} placeholder="e.g. backend" onChange={(e) => set('label', e.target.value)} />}
      {shown.has('dueAfter') && <TextField label="Due after" type="date" value={values.dueAfter ?? ''} onChange={(e) => set('dueAfter', e.target.value)} />}
      {shown.has('dueBefore') && <TextField label="Due before" type="date" value={values.dueBefore ?? ''} onChange={(e) => set('dueBefore', e.target.value)} />}
      {shown.has('archived') &&
        select(
          'archived',
          'Archived',
          [
            { value: 'active', label: 'Active only' },
            { value: 'archived', label: 'Archived only' },
            { value: 'all', label: 'All' },
          ],
          'active',
        )}
      {shown.has('order') &&
        select('order', 'Order', [
          { value: '', label: 'Default' },
          { value: 'asc', label: 'Ascending' },
          { value: 'desc', label: 'Descending' },
        ])}
      <Button size="sm" variant="ghost" onClick={clear}>
        Clear filters
      </Button>
    </form>
  )
}

function SavedViews() {
  const location = useLocation()
  const navigate = useNavigate()
  const { views, save, remove } = useSavedViews()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    save(name.trim(), location.search)
    setName('')
  }
  return (
    <Popover
      label="Saved views"
      open={open}
      onOpenChange={setOpen}
      align="end"
      trigger={
        <Button size="sm" icon={Bookmark}>
          Saved views
        </Button>
      }
    >
      <div className="tasks-saved">
        {views.length === 0 ? (
          <p className="ui-text-muted">No saved views yet. Save the current view, filters and sort to come back to them.</p>
        ) : (
          <ul className="tasks-saved-list" aria-label="Saved views">
            {views.map((v) => (
              <li key={v.id}>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setOpen(false)
                    navigate(`/tasks?${v.search}`)
                  }}
                >
                  {v.name}
                </Button>
                <IconButton icon={Trash2} size="sm" label={`Delete saved view ${v.name}`} onClick={() => remove(v.id)} />
              </li>
            ))}
          </ul>
        )}
        <form className="tasks-saved-form" onSubmit={submit}>
          <TextField label="Name" hint="Saved on this device." value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
          <Button size="sm" variant="primary" type="submit" disabled={!name.trim()}>
            Save current view
          </Button>
        </form>
      </div>
    </Popover>
  )
}

/** One toolbar for every Tasks view: view switch, search, filters, sort and saved views. */
export function TaskToolbar({ view, onView }: { view: TaskView; onView: (v: TaskView) => void }) {
  const [values, set] = useFilterParams()
  const active = VIEW_FILTERS[view].filter((k) => values[k]).length
  return (
    <div className="tasks-toolbar">
      <SegmentedControl
        label="Task view"
        value={view}
        onValueChange={(v) => onView(v as TaskView)}
        options={[
          { value: 'my-work', label: 'My Work', icon: UserRound },
          { value: 'board', label: 'Board', icon: LayoutGrid },
          { value: 'list', label: 'List', icon: List },
        ]}
      />
      <div className="tasks-toolbar-controls" role="search" aria-label="Find and sort tasks">
        <div className="tasks-search">
          <TextField label="Search tasks" hideLabel type="search" placeholder="Search tasks" value={values.q ?? ''} onChange={(e) => set('q', e.target.value)} />
        </div>
        <Popover
          label="Filters"
          align="start"
          trigger={
            <Button size="sm" icon={Filter} aria-label={active ? `Filters, ${active} active` : 'Filters'}>
              {active ? `Filters · ${active}` : 'Filters'}
            </Button>
          }
        >
          <FilterPanel view={view} />
        </Popover>
        <div className="tasks-sort">
          <SelectField label="Sort by" hideLabel value={values.sort ?? DEFAULT_SORT[view]} options={SORT_OPTIONS} onChange={(e) => set('sort', e.target.value === DEFAULT_SORT[view] ? '' : e.target.value)} />
        </div>
        <SavedViews />
      </div>
    </div>
  )
}
