import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { STATUS_LABELS, TASK_STATUSES, type TaskStatus } from '../../shared/contracts'
import type { Pad } from '../../shared/pads'
import { Archive, ArchiveRestore, ChevronLeft, MoreHorizontal, Pin, PinOff, Trash2 } from 'lucide-react'
import { ErrorMessage } from '../components/ui'
import { Banner, Button, IconButton, LinkButton, Menu, type MenuItem } from '../ui'
import { useActors } from '../hooks'
import { useProjects } from '../pages/ProjectsPage'
import { usePadMutations } from './hooks'
import { DeletePadDialog } from './PadSidebar'

export function PadHeader({ pad, narrow, extraActions = [] }: { pad: Pad; narrow: boolean; extraActions?: MenuItem[] }) {
  const { update, archive, restore, remove } = usePadMutations()
  const [name, setName] = useState(pad.name)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const navigate = useNavigate()
  useEffect(() => setName(pad.name), [pad.name])
  const archived = pad.archivedAt !== null

  const saveName = () => {
    const trimmed = name.trim()
    if (!trimmed) {
      setName(pad.name)
      return
    }
    if (trimmed !== pad.name) update.mutate({ id: pad.id, patch: { name: trimmed } })
  }

  return (
    <header className="pad-header">
      {narrow && (
        <LinkButton as={Link as never} to="/pads" size="sm" variant="ghost" icon={ChevronLeft} className="pad-back">
          Back to pads
        </LinkButton>
      )}
      <div className="pad-title-row">
        <label htmlFor="pad-name" className="sr-only">
          Pad name
        </label>
        <input
          id="pad-name"
          className="pad-name"
          value={name}
          maxLength={200}
          disabled={archived}
          onChange={(e) => setName(e.target.value)}
          onBlur={saveName}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              saveName()
              ;(document.querySelector('[data-capture-target]') as HTMLElement | null)?.focus()
            } else if (e.key === 'Escape') {
              setName(pad.name)
            }
          }}
        />
        <IconButton
          icon={pad.pinned ? PinOff : Pin}
          aria-pressed={pad.pinned}
          label={pad.pinned ? 'Unpin pad' : 'Pin pad'}
          title={pad.pinned ? 'Unpin pad' : 'Pin pad'}
          onClick={() => update.mutate({ id: pad.id, patch: { pinned: !pad.pinned } })}
        />
        <Menu
          trigger={<IconButton icon={MoreHorizontal} label="Pad actions" />}
          items={[
            ...extraActions,
            archived
              ? { label: 'Restore pad', icon: ArchiveRestore, onSelect: () => restore.mutate(pad.id) }
              : { label: 'Archive pad', icon: Archive, navigates: true, onSelect: () => archive.mutate(pad.id, { onSuccess: () => navigate('/pads') }) },
            { label: 'Delete pad permanently…', icon: Trash2, destructive: true, onSelect: () => setConfirmDelete(true) },
          ]}
        />
      </div>
      {archived ? (
        <Banner tone="info" action={<Button size="sm" onClick={() => restore.mutate(pad.id)}>Restore pad</Button>}>
          This pad is archived. Restore it to keep writing.
        </Banner>
      ) : (
        <PadDefaults pad={pad} onChange={(patch) => update.mutate({ id: pad.id, patch })} />
      )}
      <ErrorMessage error={update.error ?? archive.error ?? restore.error} />
      <DeletePadDialog
        pad={confirmDelete ? pad : null}
        busy={remove.isPending}
        error={remove.error}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={(p) =>
          remove.mutate(p.id, {
            onSuccess: () => {
              setConfirmDelete(false)
              navigate('/pads')
            },
          })
        }
      />
    </header>
  )
}

/** Optional defaults copied into tasks created later from this Pad (never applied to existing tasks). */
function PadDefaults({ pad, onChange }: { pad: Pad; onChange: (patch: { defaultProjectId?: string | null; defaultStatus?: TaskStatus | null; defaultAssigneeId?: string | null }) => void }) {
  const projects = useProjects()
  const actors = useActors()
  const projectItems = projects.data?.items ?? []
  const current = pad.defaults.project
  return (
    <div className="pad-defaults" role="group" aria-label="Defaults for new tasks">
      <span className="pad-defaults-label small muted" aria-hidden="true">
        New tasks:
      </span>
      <label className="chip">
        <span className="chip-label">Project</span>
        <select aria-label="Default project for new tasks" value={current?.id ?? ''} onChange={(e) => onChange({ defaultProjectId: e.target.value || null })}>
          <option value="">Untitled</option>
          {projectItems
            .filter((p) => !p.isSystem)
            .map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          {current && !projectItems.some((p) => p.id === current.id) && <option value={current.id}>{current.name} (archived)</option>}
        </select>
      </label>
      <label className="chip">
        <span className="chip-label">Status</span>
        <select aria-label="Default status for new tasks" value={pad.defaults.status ?? ''} onChange={(e) => onChange({ defaultStatus: (e.target.value || null) as TaskStatus | null })}>
          <option value="">Backlog</option>
          {TASK_STATUSES.filter((s) => s !== 'backlog').map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s]}
            </option>
          ))}
        </select>
      </label>
      <label className="chip">
        <span className="chip-label">Assignee</span>
        <select aria-label="Default assignee for new tasks" value={pad.defaults.assignee?.id ?? ''} onChange={(e) => onChange({ defaultAssigneeId: e.target.value || null })}>
          <option value="">Unassigned</option>
          {(actors.data ?? []).map((a) => (
            <option key={a.id} value={a.id}>
              {a.displayName}
              {a.kind === 'agent' ? ' (agent)' : ''}
            </option>
          ))}
        </select>
      </label>
    </div>
  )
}
