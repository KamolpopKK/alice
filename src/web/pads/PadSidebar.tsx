import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import type { Pad } from '../../shared/pads'
import { client } from '../api'
import { ConfirmDialog, Dialog } from '../components/Dialog'
import { Highlight } from '../components/Highlight'
import { MenuButton } from '../components/Menu'
import { ErrorMessage, Loading, formatDate } from '../components/ui'
import { defaultPadName, usePadMutations, usePadSearch, usePads } from './hooks'
import { ShortcutSettingsDialog } from './ShortcutSettings'

function relative(iso: string): string {
  const d = new Date(iso)
  const today = new Date()
  return d.toDateString() === today.toDateString()
    ? d.toLocaleTimeString(undefined, { timeStyle: 'short' })
    : d.toLocaleDateString(undefined, { dateStyle: 'medium' })
}

async function downloadExport(): Promise<void> {
  const data = await client.pads.export()
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `alice-pads-${data.exportedAt.slice(0, 10)}.json`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Starts a new date-and-time Pad and opens it with its first Task line focused. */
export function useNewPad() {
  const { create } = usePadMutations()
  const navigate = useNavigate()
  return {
    pending: create.isPending,
    error: create.error,
    start: () =>
      create.mutate(defaultPadName(), {
        onSuccess: (pad) => navigate(`/pads/${pad.id}`, { state: { focusCapture: true } }),
      }),
  }
}

export function PadSidebar({ selectedId }: { selectedId?: string }) {
  const pads = usePads('active')
  const [q, setQ] = useState('')
  const [archivedOpen, setArchivedOpen] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [exportError, setExportError] = useState<unknown>(null)
  const newPad = useNewPad()
  const items = pads.data ?? []
  const pinned = items.filter((p) => p.pinned)
  const recent = items.filter((p) => !p.pinned).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.id.localeCompare(a.id))

  return (
    <aside className="pad-sidebar" aria-label="Task pads">
      <div className="pad-sidebar-head">
        <h1 className="pad-sidebar-title">Task Pads</h1>
        <MenuButton
          label="More pad options"
          items={[
            { label: 'Archived pads', onSelect: () => setArchivedOpen(true) },
            { label: 'Capture shortcuts…', onSelect: () => setShortcutsOpen(true) },
            {
              label: 'Export my pads',
              onSelect: () => {
                setExportError(null)
                downloadExport().catch(setExportError)
              },
            },
          ]}
        />
      </div>
      <button type="button" className="primary pad-new" onClick={newPad.start} disabled={newPad.pending}>
        <span aria-hidden="true">+</span> New Pad
      </button>
      <ErrorMessage error={newPad.error ?? exportError} />
      <div className="pad-search">
        <label htmlFor="pad-search-input" className="sr-only">
          Search pads
        </label>
        <input id="pad-search-input" type="search" placeholder="Search pads" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {q.trim() ? (
        <SearchResults q={q} onNavigate={() => setQ('')} />
      ) : (
        <>
          {pads.isLoading && <Loading />}
          <ErrorMessage error={pads.error} />
          {pinned.length > 0 && <PadList title="Pinned" pads={pinned} selectedId={selectedId} />}
          {recent.length > 0 && <PadList title="Recent" pads={recent} selectedId={selectedId} />}
          {!pads.isLoading && items.length === 0 && <p className="muted small pad-empty-hint">No pads yet. New Pad starts one named with today’s date and time.</p>}
        </>
      )}
      <ArchivedPadsDialog open={archivedOpen} onClose={() => setArchivedOpen(false)} />
      <ShortcutSettingsDialog open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
    </aside>
  )
}

function PadList({ title, pads, selectedId }: { title: string; pads: Pad[]; selectedId?: string }) {
  const headingId = `pad-list-${title.toLowerCase()}`
  return (
    <section className="pad-list-section" aria-labelledby={headingId}>
      <h2 id={headingId} className="pad-list-heading">
        {title}
      </h2>
      <ul className="pad-list">
        {pads.map((pad) => (
          <li key={pad.id}>
            <Link to={`/pads/${pad.id}`} className="pad-link" aria-current={pad.id === selectedId ? 'page' : undefined}>
              <span className="pad-link-name">{pad.name}</span>
              <span className="pad-link-meta">
                <time dateTime={pad.updatedAt}>{relative(pad.updatedAt)}</time>
                {pad.pinned && <span className="sr-only">, pinned</span>}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}

function SearchResults({ q, onNavigate }: { q: string; onNavigate: () => void }) {
  const results = usePadSearch(q)
  const navigate = useNavigate()
  const items = results.data?.items ?? []
  return (
    <section className="pad-list-section" aria-label="Search results">
      <p className="sr-only" role="status">
        {results.isFetching ? 'Searching' : `${items.length} result${items.length === 1 ? '' : 's'}`}
      </p>
      <ErrorMessage error={results.error} />
      {!results.isFetching && results.data && items.length === 0 && <p className="muted small">No matches in your pads.</p>}
      <ul className="pad-list">
        {items.map((r) => (
          <li key={`${r.padId}:${r.blockId ?? 'name'}`}>
            <button
              type="button"
              className="pad-link pad-result"
              onClick={() => {
                onNavigate()
                navigate(r.blockId ? `/pads/${r.padId}?block=${r.blockId}` : `/pads/${r.padId}`, { state: { expand: r.ancestorIds } })
              }}
            >
              <span className="pad-link-name">{r.padName}</span>
              <span className="pad-link-meta snippet">
                {r.blockId ? <Highlight text={r.snippet} /> : 'Pad name'}
                {r.padArchived && ' · archived'}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

function ArchivedPadsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const archived = usePads('archived', open)
  const { restore, remove } = usePadMutations()
  const [confirm, setConfirm] = useState<Pad | null>(null)
  const navigate = useNavigate()
  return (
    <>
      <Dialog open={open && !confirm} onClose={onClose} title="Archived pads" description="Archived pads stay out of the sidebar. Restore one to keep writing in it.">
        {archived.isLoading && <Loading />}
        <ErrorMessage error={archived.error ?? restore.error} />
        {archived.data && archived.data.length === 0 && <p className="muted">No archived pads.</p>}
        <ul className="plain-list archived-pads">
          {(archived.data ?? []).map((pad) => (
            <li key={pad.id} className="row spread">
              <span>
                <strong>{pad.name}</strong>
                <span className="muted small"> · archived {formatDate(pad.archivedAt)}</span>
              </span>
              <span className="row">
                <button
                  type="button"
                  onClick={() => {
                    onClose()
                    navigate(`/pads/${pad.id}`)
                  }}
                >
                  Open<span className="sr-only"> {pad.name}</span>
                </button>
                <button type="button" onClick={() => restore.mutate(pad.id)}>
                  Restore<span className="sr-only"> {pad.name}</span>
                </button>
                <button type="button" className="danger" onClick={() => setConfirm(pad)}>
                  Delete permanently<span className="sr-only"> {pad.name}</span>
                </button>
              </span>
            </li>
          ))}
        </ul>
      </Dialog>
      <DeletePadDialog
        pad={confirm}
        busy={remove.isPending}
        error={remove.error}
        onCancel={() => setConfirm(null)}
        onConfirm={(pad) => remove.mutate(pad.id, { onSuccess: () => setConfirm(null) })}
      />
    </>
  )
}

export function DeletePadDialog({
  pad,
  busy,
  error,
  onCancel,
  onConfirm,
}: {
  pad: Pad | null
  busy: boolean
  error: unknown
  onCancel: () => void
  onConfirm: (pad: Pad) => void
}) {
  return (
    <ConfirmDialog
      open={pad !== null}
      title="Delete pad permanently?"
      message={
        <>
          “{pad?.name}” and all of its notes will be removed for good. Tasks created from it stay on the Board unchanged. Archive keeps the pad recoverable instead.
        </>
      }
      confirmLabel="Delete pad permanently"
      danger
      busy={busy}
      error={<ErrorMessage error={error} />}
      onCancel={onCancel}
      onConfirm={() => pad && onConfirm(pad)}
    />
  )
}
