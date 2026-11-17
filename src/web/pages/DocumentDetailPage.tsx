import { useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { ActivityEvent, DocumentDetail, DocumentRevision, Page } from '../../shared/contracts'
import { FullPageError, isRecoverable } from '../brand'
import { client } from '../api'
import { ActivityList } from '../components/Activity'
import { Markdown, MarkdownEditor } from '../components/Markdown'
import { StatusPill } from '../components/TaskFields'
import { ActorBadge, ErrorMessage, Loading, TextInput, formatDate } from '../components/ui'

export function useDocument(id: string) {
  return useQuery({ queryKey: ['document', id], queryFn: () => client.documents.get(id) })
}

function invalidateDoc(qc: ReturnType<typeof useQueryClient>, id: string) {
  void qc.invalidateQueries({ queryKey: ['document', id] })
  void qc.invalidateQueries({ queryKey: ['documents'] })
}

export function DocumentDetailPage() {
  const { id = '' } = useParams()
  const doc = useDocument(id)
  const [mode, setMode] = useState<'view' | 'edit' | 'history'>('view')
  const qc = useQueryClient()
  const archive = useMutation({
    mutationFn: (archived: boolean) => (archived ? client.documents.archive(id) : client.documents.restore(id)),
    onSuccess: () => invalidateDoc(qc, id),
  })
  if (doc.isLoading) return <Loading />
  if (doc.error && isRecoverable(doc.error)) return <FullPageError error={doc.error} onRetry={() => void doc.refetch()} />
  if (!doc.data) return <div className="page"><ErrorMessage error={doc.error ?? 'Document not found'} /></div>
  const d = doc.data
  const archived = d.archivedAt !== null
  return (
    <div className="page">
      <nav className="breadcrumbs small" aria-label="Breadcrumb">
        <Link to="/documents">Documents</Link> <span aria-hidden="true">/</span> <span className="muted">{d.id}</span>
      </nav>
      <div className="page-head">
        <h1>
          {d.title} {archived && <span className="pill pill-archived">archived</span>}
        </h1>
        <div className="row" role="group" aria-label="Document actions">
          <button type="button" aria-pressed={mode === 'view'} onClick={() => setMode('view')}>
            View
          </button>
          {!archived && (
            <button type="button" aria-pressed={mode === 'edit'} onClick={() => setMode('edit')}>
              Edit
            </button>
          )}
          <button type="button" aria-pressed={mode === 'history'} onClick={() => setMode('history')}>
            History
          </button>
          <button type="button" onClick={() => archive.mutate(!archived)}>
            {archived ? 'Restore' : 'Archive'}
          </button>
        </div>
      </div>
      <ErrorMessage error={archive.error} />
      <p className="muted small">
        Revision {d.revision} · updated {formatDate(d.updatedAt)} by <ActorBadge actor={d.updatedBy} />
      </p>
      {d.sourceUrl && (
        <p>
          Source:{' '}
          <a href={d.sourceUrl} target="_blank" rel="noopener noreferrer nofollow" className="source">
            {d.sourceUrl}
          </a>
        </p>
      )}
      {mode === 'edit' && <EditDocument doc={d} onDone={() => setMode('view')} />}
      {mode === 'history' && <History doc={d} onRestored={() => setMode('view')} />}
      {mode === 'view' && (d.body ? <Markdown source={d.body} /> : <p className="muted">This document only references its source.</p>)}
      <Links doc={d} />
      <DocumentActivity id={d.id} />
    </div>
  )
}

function EditDocument({ doc, onDone }: { doc: DocumentDetail; onDone: () => void }) {
  const qc = useQueryClient()
  const [title, setTitle] = useState(doc.title)
  const [body, setBody] = useState(doc.body)
  const [sourceUrl, setSourceUrl] = useState(doc.sourceUrl ?? '')
  const save = useMutation({
    mutationFn: () => client.documents.update(doc.id, { title, body, sourceUrl: sourceUrl.trim() || null }),
    onSuccess: () => {
      invalidateDoc(qc, doc.id)
      onDone()
    },
  })
  return (
    <form
      className="panel stack"
      onSubmit={(e: FormEvent) => {
        e.preventDefault()
        save.mutate()
      }}
    >
      <TextInput label="Document title" value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={200} />
      <MarkdownEditor id="doc-body" label="Body (Markdown)" value={body} onChange={setBody} rows={18} />
      <TextInput label="Source URL (optional)" type="url" value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} />
      <p className="hint">Saving creates revision {doc.revision + 1}. Earlier revisions stay available in History.</p>
      <ErrorMessage error={save.error} />
      <div className="row">
        <button className="primary" type="submit" disabled={save.isPending}>
          Save revision
        </button>
        <button type="button" onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  )
}

function History({ doc, onRestored }: { doc: DocumentDetail; onRestored: () => void }) {
  const qc = useQueryClient()
  const revisions = useQuery({ queryKey: ['document', doc.id, 'revisions'], queryFn: () => client.documents.revisions(doc.id, { limit: 200 }) })
  const [selected, setSelected] = useState<number | null>(null)
  const restore = useMutation({
    mutationFn: (n: number) => client.documents.restoreRevision(doc.id, n),
    onSuccess: () => {
      invalidateDoc(qc, doc.id)
      onRestored()
    },
  })
  if (revisions.isLoading) return <Loading />
  const items = revisions.data?.items ?? []
  const current = items.find((r) => r.number === selected)
  return (
    <section className="panel" aria-labelledby="history-heading">
      <h2 id="history-heading">Revision history</h2>
      <ErrorMessage error={restore.error} />
      <ol className="revisions">
        {items.map((r) => (
          <li key={r.id}>
            <button type="button" className="link" aria-expanded={selected === r.number} onClick={() => setSelected(selected === r.number ? null : r.number)}>
              Revision {r.number}
            </button>{' '}
            {r.number === doc.revision && <span className="pill pill-ready">current</span>}
            {r.restoredFrom && <span className="muted small"> restored from {r.restoredFrom}</span>}
            <span className="muted small">
              {' '}
              · {formatDate(r.createdAt)} by <ActorBadge actor={r.createdBy} />
            </span>
            {r.number !== doc.revision && (
              <button type="button" onClick={() => restore.mutate(r.number)} disabled={restore.isPending || doc.archivedAt !== null}>
                Restore revision {r.number}
              </button>
            )}
          </li>
        ))}
      </ol>
      {current && (
        <div className="revision-preview">
          <h3>{current.title}</h3>
          {current.sourceUrl && <p className="small source">{current.sourceUrl}</p>}
          <Markdown source={current.body} />
        </div>
      )}
    </section>
  )
}

function Links({ doc }: { doc: DocumentDetail }) {
  const qc = useQueryClient()
  const unlink = useMutation({
    mutationFn: (target: { taskId?: string; projectId?: string }) => client.documents.unlink(doc.id, target),
    onSuccess: () => invalidateDoc(qc, doc.id),
  })
  return (
    <section className="section" aria-labelledby="links-heading">
      <h2 id="links-heading">Linked to</h2>
      {doc.links.tasks.length === 0 && doc.links.projects.length === 0 && <p className="muted">Not linked to any task or project.</p>}
      <ul className="plain-list">
        {doc.links.projects.map((p) => (
          <li key={p.id}>
            <span className="pill">project</span> <Link to={`/projects/${p.id}`}>{p.name}</Link>{' '}
            <button type="button" className="link" onClick={() => unlink.mutate({ projectId: p.id })}>
              Unlink
            </button>
          </li>
        ))}
        {doc.links.tasks.map((t) => (
          <li key={t.id}>
            <span className="pill">task</span> <Link to={`/tasks/${t.id}`}>{t.title}</Link> <StatusPill status={t.status} />{' '}
            <button type="button" className="link" onClick={() => unlink.mutate({ taskId: t.id })}>
              Unlink
            </button>
          </li>
        ))}
      </ul>
      <ErrorMessage error={unlink.error} />
    </section>
  )
}

function DocumentActivity({ id }: { id: string }) {
  const activity = useQuery({ queryKey: ['document', id, 'activity'], queryFn: () => client.documents.activity(id, { limit: 30 }) })
  return (
    <section className="section" aria-labelledby="doc-activity-heading">
      <h2 id="doc-activity-heading">Activity</h2>
      {activity.isLoading ? <Loading /> : <ActivityList events={activity.data?.items ?? []} />}
    </section>
  )
}
