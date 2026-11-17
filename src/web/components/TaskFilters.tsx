import { useSearchParams } from 'react-router-dom'
import { STATUS_LABELS, TASK_PRIORITIES, TASK_STATUSES } from '../../shared/contracts'
import { useActors } from '../hooks'
import { useProjects } from '../pages/ProjectsPage'
import { Field } from './ui'

export const FILTER_KEYS = ['projectId', 'assigneeId', 'status', 'priority', 'label', 'dueAfter', 'dueBefore', 'archived', 'q', 'sort', 'order'] as const

/** Current filter values from the URL, ready for the API query string. */
export function useFilterParams(): [Record<string, string>, (key: string, value: string) => void, () => void] {
  const [params, setParams] = useSearchParams()
  const values: Record<string, string> = {}
  for (const key of FILTER_KEYS) {
    const v = params.get(key)
    if (v) values[key] = v
  }
  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value)
    else next.delete(key)
    setParams(next, { replace: true })
  }
  const clear = () => setParams(new URLSearchParams(), { replace: true })
  return [values, set, clear]
}

function FilterSelect({ label, value, onChange, children }: { label: string; value: string; onChange: (v: string) => void; children: React.ReactNode }) {
  return (
    <Field label={label}>
      {(id) => (
        <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
          {children}
        </select>
      )}
    </Field>
  )
}

export function TaskFilters({ showStatus = true, showSort = false, showArchived = false }: { showStatus?: boolean; showSort?: boolean; showArchived?: boolean }) {
  const [values, set, clear] = useFilterParams()
  const projects = useProjects()
  const actors = useActors()
  return (
    <form className="filters" role="search" aria-label="Filter tasks" onSubmit={(e) => e.preventDefault()}>
      <Field label="Search">{(id) => <input id={id} type="search" value={values.q ?? ''} onChange={(e) => set('q', e.target.value)} placeholder="Title or description" />}</Field>
      <FilterSelect label="Project" value={values.projectId ?? ''} onChange={(v) => set('projectId', v)}>
        <option value="">All projects</option>
        {projects.data?.items.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </FilterSelect>
      <FilterSelect label="Assignee" value={values.assigneeId ?? ''} onChange={(v) => set('assigneeId', v)}>
        <option value="">Anyone</option>
        <option value="me">Me</option>
        <option value="none">Unassigned</option>
        {actors.data?.map((a) => (
          <option key={a.id} value={a.id}>
            {a.displayName}
            {a.kind === 'agent' ? ' (agent)' : ''}
          </option>
        ))}
      </FilterSelect>
      {showStatus && (
        <FilterSelect label="Status" value={values.status ?? ''} onChange={(v) => set('status', v)}>
          <option value="">Any status</option>
          {TASK_STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s]}
            </option>
          ))}
        </FilterSelect>
      )}
      <FilterSelect label="Priority" value={values.priority ?? ''} onChange={(v) => set('priority', v)}>
        <option value="">Any priority</option>
        {TASK_PRIORITIES.map((p) => (
          <option key={p} value={p}>
            {p}
          </option>
        ))}
      </FilterSelect>
      <Field label="Label">{(id) => <input id={id} value={values.label ?? ''} onChange={(e) => set('label', e.target.value)} placeholder="e.g. backend" />}</Field>
      <Field label="Due after">{(id) => <input id={id} type="date" value={values.dueAfter ?? ''} onChange={(e) => set('dueAfter', e.target.value)} />}</Field>
      <Field label="Due before">{(id) => <input id={id} type="date" value={values.dueBefore ?? ''} onChange={(e) => set('dueBefore', e.target.value)} />}</Field>
      {showArchived && (
        <FilterSelect label="Archived" value={values.archived ?? 'active'} onChange={(v) => set('archived', v === 'active' ? '' : v)}>
          <option value="active">Active only</option>
          <option value="archived">Archived only</option>
          <option value="all">All</option>
        </FilterSelect>
      )}
      {showSort && (
        <>
          <FilterSelect label="Sort by" value={values.sort ?? 'updated'} onChange={(v) => set('sort', v === 'updated' ? '' : v)}>
            <option value="updated">Last updated</option>
            <option value="created">Created</option>
            <option value="priority">Priority</option>
            <option value="due">Due date</option>
            <option value="title">Title</option>
          </FilterSelect>
          <FilterSelect label="Order" value={values.order ?? ''} onChange={(v) => set('order', v)}>
            <option value="">Default</option>
            <option value="asc">Ascending</option>
            <option value="desc">Descending</option>
          </FilterSelect>
        </>
      )}
      <div className="filters-actions">
        <button type="button" onClick={clear}>
          Clear filters
        </button>
      </div>
    </form>
  )
}
