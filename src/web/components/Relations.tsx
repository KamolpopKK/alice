import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Page, Task, TaskRef, TaskRelations } from '../../shared/contracts'
import { client } from '../api'
import { STATUS_LABELS } from '../../shared/contracts'
import { STATUS_TONE } from '../tasks/model'
import { Badge, Button, TextField } from '../ui'
import { ErrorMessage } from './ui'

function TaskPicker({ label, exclude, onPick }: { label: string; exclude: Set<string>; onPick: (task: Task) => void }) {
  const [q, setQ] = useState('')
  const results = useQuery({
    queryKey: ['tasks', 'picker', q],
    enabled: q.trim().length > 0,
    queryFn: () => client.tasks.list({ q, limit: 8 }),
  })
  return (
    <div className="stack">
      <TextField label={label} type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search tasks" autoFocus />
      <ul className="plain-list">
        {results.data?.items
          .filter((t) => !exclude.has(t.id))
          .map((t) => (
            <li key={t.id} className="row spread">
              <span>{t.title}</span>
              <Button size="sm" aria-label={`Choose ${t.title}`} onClick={() => onPick(t)}>
                Choose
              </Button>
            </li>
          ))}
      </ul>
    </div>
  )
}

function RefItem({ task, onRemove, removeLabel }: { task: TaskRef; onRemove?: () => void; removeLabel?: string }) {
  return (
    <li className="row spread">
      <span>
        <Link to={`/tasks/${task.id}`}>{task.title}</Link> <Badge tone={STATUS_TONE[task.status]}>{STATUS_LABELS[task.status]}</Badge> {task.archivedAt && <Badge>archived</Badge>}
      </span>
      {onRemove && (
        <Button size="sm" variant="ghost" aria-label={removeLabel} onClick={onRemove}>
          Remove
        </Button>
      )}
    </li>
  )
}

export function Relations({ task }: { task: Task }) {
  const qc = useQueryClient()
  const rel = useQuery({ queryKey: ['task', task.id, 'relations'], queryFn: () => client.tasks.relations(task.id) })
  const [picking, setPicking] = useState<'none' | 'parent' | 'blocker'>('none')
  const done = () => {
    setPicking('none')
    void qc.invalidateQueries({ queryKey: ['task'] })
    void qc.invalidateQueries({ queryKey: ['tasks'] })
  }
  const setParent = useMutation({ mutationFn: (parentId: string | null) => client.tasks.setParent(task.id, parentId), onSuccess: done })
  const addBlocker = useMutation({ mutationFn: (blockerId: string) => client.tasks.addBlocker(task.id, blockerId), onSuccess: done })
  const removeBlocker = useMutation({ mutationFn: (blockerId: string) => client.tasks.removeBlocker(task.id, blockerId), onSuccess: done })
  const r = rel.data
  const exclude = new Set([task.id, ...(r?.blockers.map((b) => b.id) ?? [])])
  const disabled = task.archivedAt !== null
  return (
    <section className="relations" aria-labelledby={`rel-${task.id}`}>
      <h2 id={`rel-${task.id}`} className="task-section-title">
        Relationships
      </h2>
      <h3 className="small">Parent</h3>
      {r?.parent ? (
        <ul className="plain-list">
          <RefItem task={r.parent} onRemove={disabled ? undefined : () => setParent.mutate(null)} removeLabel="Remove parent" />
        </ul>
      ) : (
        <p className="ui-text-muted">No parent.</p>
      )}
      <h3 className="small">Subtasks</h3>
      <ul className="plain-list">
        {r?.children.map((c) => <RefItem key={c.id} task={c} />)}
      </ul>
      {!disabled && (
        <Link className="small" to={`/tasks/new?parentId=${task.id}&projectId=${task.project.id}`}>
          Add subtask
        </Link>
      )}
      <h3 className="small">Blocked by</h3>
      <ul className="plain-list">
        {r?.blockers.map((b) => <RefItem key={b.id} task={b} onRemove={() => removeBlocker.mutate(b.id)} removeLabel={`Remove blocker ${b.title}`} />)}
      </ul>
      {r && r.blocking.length > 0 && (
        <>
          <h3 className="small">Blocking</h3>
          <ul className="plain-list">
            {r.blocking.map((b) => <RefItem key={b.id} task={b} />)}
          </ul>
        </>
      )}
      {!disabled && (
        <div className="row">
          <Button size="sm" aria-expanded={picking === 'parent'} onClick={() => setPicking(picking === 'parent' ? 'none' : 'parent')}>
            Set parent
          </Button>
          <Button size="sm" aria-expanded={picking === 'blocker'} onClick={() => setPicking(picking === 'blocker' ? 'none' : 'blocker')}>
            Add blocker
          </Button>
        </div>
      )}
      {picking === 'parent' && <TaskPicker label="Parent task" exclude={new Set([task.id])} onPick={(t) => setParent.mutate(t.id)} />}
      {picking === 'blocker' && <TaskPicker label="Blocking task" exclude={exclude} onPick={(t) => addBlocker.mutate(t.id)} />}
      <ErrorMessage error={setParent.error ?? addBlocker.error ?? removeBlocker.error} />
    </section>
  )
}


/** Small indicators for lists and cards. */
export function RelationIndicators({ task }: { task: Task }) {
  return (
    <>
      {task.openBlockerCount > 0 && (
        <span className="pill pill-blocked" title="Open blockers">
          blocked by {task.openBlockerCount}
        </span>
      )}
      {task.childCount > 0 && <span className="pill">{task.childCount} subtasks</span>}
    </>
  )
}
