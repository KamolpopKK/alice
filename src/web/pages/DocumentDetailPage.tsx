import { useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { ActivityEvent, DocumentDetail, DocumentKnowledgeStatus, DocumentRevision, Page } from '../../shared/contracts'
import { FullPageError, isRecoverable } from '../brand'
import { ApiError, client } from '../api'
import { ActivityList } from '../components/Activity'
import { Markdown } from '../components/Markdown'
import { DocumentEditor } from '../documents/DocumentEditor'
import { DocumentKnowledgeFields, KNOWLEDGE_STATUS_LABELS } from '../components/DocumentKnowledgeFields'
import { DocumentRelations } from '../components/DocumentRelations'
import { ActorBadge, formatDate } from '../components/ui'
import { STATUS_LABELS } from '../../shared/contracts'
import { STATUS_TONE } from '../tasks/model'
import { errorText } from '../tasks/TaskDetail'
import { Archive, ArchiveRestore, History as HistoryIcon, Pencil } from 'lucide-react'
import { Badge, Banner, Button, FieldMessage, Skeleton, TextField } from '../ui'

export function useDocument(id: string) {
  return useQuery({ queryKey: ['document', id], queryFn: () => client.documents.get(id) })
}

function invalidateDoc(qc: ReturnType<typeof useQueryClient>, id: string) {
  void qc.invalidateQueries({ queryKey: ['document', id] })
  void qc.invalidateQueries({ queryKey: ['documents'] })
}

const KNOWLEDGE_TONE: Record<DocumentKnowledgeStatus, 'warning' | 'info' | 'success' | 'danger'> = {
  unreviewed: 'warning',
  draft: 'info',
  current: 'success',
  superseded: 'danger',
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
  if (doc.isLoading)
    return (
      <div className="page resource-page">
        <Skeleton lines={8} />
      </div>
    )
  if (doc.error && isRecoverable(doc.error)) return <FullPageError error={doc.error} onRetry={() => void doc.refetch()} />
  if (!doc.data)
    return (
      <div className="page resource-page">
        <Banner tone="danger" title="This document could not be opened">
          {doc.error ? errorText(doc.error) : 'Document not found'}
        </Banner>
      </div>
    )
  const d = doc.data
  const archived = d.archivedAt !== null
  return (
    <div className="page resource-page document-page">
      <nav className="task-detail-crumbs" aria-label="Breadcrumb">
        <Link to="/documents">Documents</Link> <span aria-hidden="true">/</span> <span className="ui-text-muted">{d.id}</span>
      </nav>
      <div className="resource-head">
        <div>
          <h1>{d.title}</h1>
          <div className="resource-meta-row">
            {archived && <Badge>archived</Badge>}
            <Badge tone={KNOWLEDGE_TONE[d.status]}>{KNOWLEDGE_STATUS_LABELS[d.status]}</Badge>
            <span>
              Revision {d.revision} · updated {formatDate(d.updatedAt)} by <ActorBadge actor={d.updatedBy} />
            </span>
            <span>Owner: {d.owner ? <ActorBadge actor={d.owner} /> : 'Unassigned'}</span>
          </div>
        </div>
        <div className="resource-actions" role="group" aria-label="Document actions">
          <Button size="sm" variant={mode === 'view' ? 'primary' : 'secondary'} aria-pressed={mode === 'view'} onClick={() => setMode('view')}>
            View
          </Button>
          {!archived && (
            <Button size="sm" icon={Pencil} variant={mode === 'edit' ? 'primary' : 'secondary'} aria-pressed={mode === 'edit'} onClick={() => setMode('edit')}>
              Edit
            </Button>
          )}
          <Button size="sm" icon={HistoryIcon} variant={mode === 'history' ? 'primary' : 'secondary'} aria-pressed={mode === 'history'} onClick={() => setMode('history')}>
            History
          </Button>
          <Button size="sm" icon={archived ? ArchiveRestore : Archive} loading={archive.isPending} onClick={() => archive.mutate(!archived)}>
            {archived ? 'Restore' : 'Archive'}
          </Button>
        </div>
      </div>
      {archive.error && <FieldMessage tone="error">{errorText(archive.error)}</FieldMessage>}
      {archived && <Banner tone="info">This document is archived. Restore it to edit.</Banner>}
      {d.status === 'unreviewed' && (
        <Banner tone="warning" title="This document is unreviewed">
          Check its source and content before treating it as authoritative.
        </Banner>
      )}
      {d.status === 'superseded' && (
        <Banner tone="danger" title="This document has been superseded">
          Use it as historical context and check its document relationships for a newer source.
        </Banner>
      )}
      {d.sourceUrl && (
        <p className="resource-meta">
          Source:{' '}
          <a href={d.sourceUrl} target="_blank" rel="noopener noreferrer nofollow" className="resource-source">
            {d.sourceUrl}
          </a>
        </p>
      )}
      <div className="document-layout">
        <div className="document-main">
          {mode === 'edit' && <EditDocument doc={d} onDone={() => setMode('view')} />}
          {mode === 'history' && <History doc={d} onRestored={() => setMode('view')} />}
          {mode === 'view' && (d.body ? <Markdown source={d.body} className="document-body" /> : <p className="ui-text-muted">This document only references its source.</p>)}
        </div>
        <aside className="document-side" aria-label="Links and activity">
          <KnowledgeLifecycle doc={d} />
          <DocumentRelations doc={d} />
          <Links doc={d} />
          <DocumentActivity id={d.id} />
        </aside>
      </div>
    </div>
  )
}

function KnowledgeLifecycle({ doc }: { doc: DocumentDetail }) {
  const qc = useQueryClient()
  const [notice, setNotice] = useState<string | null>(null)
  const handleError = (error: unknown) => {
    if (error instanceof ApiError && error.code === 'CONFLICT') {
      setNotice('The document changed before the review was saved. The latest revision has been loaded; review it again.')
      invalidateDoc(qc, doc.id)
    }
  }
  const review = useMutation({
    mutationFn: (markCurrent: boolean) => client.documents.review(doc.id, { expectedRevision: doc.revision, markCurrent }),
    onSuccess: (result) => {
      setNotice(result.document.status === 'current' ? 'Review recorded and this revision is now current.' : 'Review recorded for this revision.')
      invalidateDoc(qc, doc.id)
    },
    onError: handleError,
  })
  const clear = useMutation({
    mutationFn: () => client.documents.clearReview(doc.id, { expectedRevision: doc.revision }),
    onSuccess: () => {
      setNotice('Review cleared. A current document returns to unreviewed.')
      invalidateDoc(qc, doc.id)
    },
    onError: handleError,
  })
  const error = review.error ?? clear.error
  const conflict = error instanceof ApiError && error.code === 'CONFLICT'
  return (
    <section className="task-section document-knowledge" aria-labelledby="knowledge-heading">
      <h2 id="knowledge-heading" className="task-section-title">
        Knowledge lifecycle
      </h2>
      <dl className="document-knowledge-list">
        <div>
          <dt>Status</dt>
          <dd>
            <Badge tone={KNOWLEDGE_TONE[doc.status]}>{KNOWLEDGE_STATUS_LABELS[doc.status]}</Badge>
          </dd>
        </div>
        <div>
          <dt>Owner</dt>
          <dd>{doc.owner ? <ActorBadge actor={doc.owner} /> : 'Unassigned'}</dd>
        </div>
        <div>
          <dt>Reviewed</dt>
          <dd>
            {doc.reviewedAt && doc.reviewedBy && doc.reviewedRevision ? (
              <>
                Revision {doc.reviewedRevision}, {formatDate(doc.reviewedAt)} by <ActorBadge actor={doc.reviewedBy} />
              </>
            ) : (
              'Not reviewed'
            )}
          </dd>
        </div>
      </dl>
      {doc.tags.length > 0 && (
        <div className="document-chip-row" aria-label="Tags">
          {doc.tags.map((tag) => (
            <Badge key={tag}>{tag}</Badge>
          ))}
        </div>
      )}
      {doc.searchKeywords.length > 0 && <p className="ui-text-muted">Search keywords: {doc.searchKeywords.join(', ')}</p>}
      {notice && <FieldMessage tone="info">{notice}</FieldMessage>}
      {error && !conflict ? <FieldMessage tone="error">{errorText(error)}</FieldMessage> : null}
      <div className="resource-actions">
        <Button size="sm" variant="primary" loading={review.isPending} disabled={doc.archivedAt !== null || clear.isPending} onClick={() => review.mutate(true)}>
          Review and mark current
        </Button>
        <Button size="sm" loading={review.isPending} disabled={doc.archivedAt !== null || clear.isPending} onClick={() => review.mutate(false)}>
          Record review
        </Button>
        {doc.reviewedAt && (
          <Button size="sm" variant="ghost" loading={clear.isPending} disabled={doc.archivedAt !== null || review.isPending} onClick={() => clear.mutate()}>
            Clear review
          </Button>
        )}
      </div>
    </section>
  )
}

function EditDocument({ doc, onDone }: { doc: DocumentDetail; onDone: () => void }) {
  const qc = useQueryClient()
  const [title, setTitle] = useState(doc.title)
  const [body, setBody] = useState(doc.body)
  const [sourceUrl, setSourceUrl] = useState(doc.sourceUrl ?? '')
  const [tags, setTags] = useState(doc.tags)
  const [searchKeywords, setSearchKeywords] = useState(doc.searchKeywords)
  const [status, setStatus] = useState<DocumentKnowledgeStatus>(doc.status)
  const [ownerId, setOwnerId] = useState<string | null>(doc.owner?.id ?? null)
  const contentChanged = title !== doc.title || body !== doc.body || (sourceUrl.trim() || null) !== doc.sourceUrl
  const save = useMutation({
    mutationFn: () =>
      client.documents.update(doc.id, {
        title,
        body,
        sourceUrl: sourceUrl.trim() || null,
        tags,
        searchKeywords,
        ownerId,
        ...(status === doc.status ? {} : { status }),
      }),
    onSuccess: () => {
      invalidateDoc(qc, doc.id)
      onDone()
    },
  })
  return (
    <form
      className="resource-panel resource-form"
      aria-label="Edit document"
      onSubmit={(e: FormEvent) => {
        e.preventDefault()
        save.mutate()
      }}
    >
      <TextField label="Document title" value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={200} />
      <DocumentEditor label="Body" value={body} onChange={setBody} rows={18} />
      <TextField label="Source URL (optional)" type="url" value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} />
      <DocumentKnowledgeFields
        tags={tags}
        onTagsChange={setTags}
        searchKeywords={searchKeywords}
        onSearchKeywordsChange={setSearchKeywords}
        status={status}
        onStatusChange={setStatus}
        ownerId={ownerId}
        onOwnerChange={setOwnerId}
      />
      <p className="ui-text-muted">
        {contentChanged
          ? 'Saving content creates revision ' + (doc.revision + 1) + ' and clears its review. Earlier revisions stay available in History.'
          : 'Metadata-only changes keep the current content revision and review.'}
      </p>
      {save.error && <FieldMessage tone="error">{errorText(save.error)}</FieldMessage>}
      <div className="resource-actions">
        <Button variant="primary" type="submit" loading={save.isPending}>
          Save changes
        </Button>
        <Button onClick={onDone}>Cancel</Button>
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
  if (revisions.isLoading) return <Skeleton lines={4} />
  const items = revisions.data?.items ?? []
  const current = items.find((r) => r.number === selected)
  return (
    <section className="resource-panel" aria-labelledby="history-heading">
      <h2 id="history-heading" className="resource-panel-title">
        Revision history
      </h2>
      {restore.error && <FieldMessage tone="error">{errorText(restore.error)}</FieldMessage>}
      <ol className="revisions">
        {items.map((r) => (
          <li key={r.id}>
            <Button size="sm" variant="ghost" aria-expanded={selected === r.number} onClick={() => setSelected(selected === r.number ? null : r.number)}>
              Revision {r.number}
            </Button>{' '}
            {r.number === doc.revision && <Badge tone="info">current</Badge>}
            {r.restoredFrom && <span className="ui-text-muted"> restored from {r.restoredFrom}</span>}
            <span className="ui-text-muted">
              {' '}
              · {formatDate(r.createdAt)} by <ActorBadge actor={r.createdBy} />
            </span>
            {r.number !== doc.revision && (
              <Button size="sm" onClick={() => restore.mutate(r.number)} disabled={restore.isPending || doc.archivedAt !== null}>
                Restore revision {r.number}
              </Button>
            )}
          </li>
        ))}
      </ol>
      {current && (
        <div className="revision-preview">
          <h3>{current.title}</h3>
          {current.sourceUrl && <p className="resource-source">{current.sourceUrl}</p>}
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
    <section className="task-section" aria-labelledby="links-heading">
      <h2 id="links-heading" className="task-section-title">
        Linked to
      </h2>
      {doc.links.tasks.length === 0 && doc.links.projects.length === 0 && <p className="ui-text-muted">Not linked to any task or project.</p>}
      <ul className="document-links">
        {doc.links.projects.map((p) => (
          <li key={p.id}>
            <Badge>project</Badge> <Link to={`/projects/${p.id}`}>{p.name}</Link>{' '}
            <Button size="sm" variant="ghost" aria-label={`Unlink ${p.name}`} onClick={() => unlink.mutate({ projectId: p.id })}>
              Unlink
            </Button>
          </li>
        ))}
        {doc.links.tasks.map((t) => (
          <li key={t.id}>
            <Badge>task</Badge> <Link to={`/tasks/${t.id}`}>{t.title}</Link> <Badge tone={STATUS_TONE[t.status]}>{STATUS_LABELS[t.status]}</Badge>{' '}
            <Button size="sm" variant="ghost" aria-label={`Unlink ${t.title}`} onClick={() => unlink.mutate({ taskId: t.id })}>
              Unlink
            </Button>
          </li>
        ))}
      </ul>
      {unlink.error && <FieldMessage tone="error">{errorText(unlink.error)}</FieldMessage>}
    </section>
  )
}

function DocumentActivity({ id }: { id: string }) {
  const activity = useQuery({ queryKey: ['document', id, 'activity'], queryFn: () => client.documents.activity(id, { limit: 30 }) })
  return (
    <section className="task-section" aria-labelledby="doc-activity-heading">
      <h2 id="doc-activity-heading" className="task-section-title">
        Activity
      </h2>
      {activity.isLoading ? <Skeleton lines={3} /> : <ActivityList events={activity.data?.items ?? []} />}
    </section>
  )
}
