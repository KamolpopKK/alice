import { useEffect, useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { DocumentDetail, DocumentKnowledgeStatus } from '../../shared/contracts'
import { client } from '../api'
import { FullPageError, isRecoverable } from '../brand'
import { DocumentKnowledgeFields } from '../components/DocumentKnowledgeFields'
import { DocumentEditor } from '../documents/DocumentEditor'
import { clearDraft, draftKey, readDraft, useDraftScope, writeDraft, type DocumentDraft } from '../documents/drafts'
import { safeReturnPath } from '../navigation'
import { errorText } from '../tasks/TaskDetail'
import { Banner, Button, FieldMessage, Skeleton, TextField } from '../ui'

const TASK_ID = /^tsk_[a-z0-9]+$/
const PROJECT_ID = /^prj_[a-z0-9]+$/

/** Where a new document will be linked, from `?taskId=` or `?projectId=` (exactly one, well formed). */
export function linkTarget(params: URLSearchParams): { target: { taskId: string } | { projectId: string } | null; invalid: boolean } {
  const taskId = params.get('taskId')
  const projectId = params.get('projectId')
  if (!taskId && !projectId) return { target: null, invalid: false }
  if (taskId && !projectId && TASK_ID.test(taskId)) return { target: { taskId }, invalid: false }
  if (projectId && !taskId && PROJECT_ID.test(projectId)) return { target: { projectId }, invalid: false }
  return { target: null, invalid: true }
}

/** `?returnTo=` when it is a path inside the app; never another site. */
export function returnPath(params: URLSearchParams): string | null {
  const value = params.get('returnTo')
  if (!value) return null
  const path = safeReturnPath({ from: value })
  return path === value ? path : null
}

function emptyDraft(): DocumentDraft {
  return { title: '', body: '', sourceUrl: '', tags: [], searchKeywords: [], status: 'unreviewed', ownerId: null }
}

function fromDocument(doc: DocumentDetail): DocumentDraft {
  return {
    title: doc.title,
    body: doc.body,
    sourceUrl: doc.sourceUrl ?? '',
    tags: doc.tags,
    searchKeywords: doc.searchKeywords,
    status: doc.status,
    ownerId: doc.owner?.id ?? null,
    baseRevision: doc.revision,
  }
}

/** The draft for one Create or Edit page, kept in memory for this workspace and person until Save or Cancel. */
function useDraft(key: string | null, initial: () => DocumentDraft) {
  const [draft, setDraft] = useState<DocumentDraft>(() => (key && readDraft(key)) || initial())
  useEffect(() => {
    if (key) writeDraft(key, draft)
  }, [key, draft])
  const update = <K extends keyof DocumentDraft>(field: K, value: DocumentDraft[K]) => setDraft((d) => ({ ...d, [field]: value }))
  return { draft, update, discard: () => key && clearDraft(key) }
}

function AuthoringFields({ draft, update, bodyRows }: { draft: DocumentDraft; update: ReturnType<typeof useDraft>['update']; bodyRows: number }) {
  return (
    <>
      <TextField label="Document title" value={draft.title} onChange={(e) => update('title', e.target.value)} required maxLength={200} autoFocus data-autofocus />
      <DocumentEditor label="Body" value={draft.body} onChange={(body) => update('body', body)} rows={bodyRows} />
      <TextField
        label="Source URL (optional)"
        hint="A document needs a body, a source URL, or both."
        type="url"
        placeholder="https://…"
        value={draft.sourceUrl}
        onChange={(e) => update('sourceUrl', e.target.value)}
      />
      <DocumentKnowledgeFields
        tags={draft.tags}
        onTagsChange={(v) => update('tags', v)}
        searchKeywords={draft.searchKeywords}
        onSearchKeywordsChange={(v) => update('searchKeywords', v)}
        status={draft.status}
        onStatusChange={(v) => update('status', v as DocumentKnowledgeStatus)}
        ownerId={draft.ownerId}
        onOwnerChange={(v) => update('ownerId', v)}
      />
    </>
  )
}

function LinkContext({ target }: { target: { taskId: string } | { projectId: string } }) {
  const isTask = 'taskId' in target
  const id = isTask ? target.taskId : target.projectId
  // ใช้ query key และรูปข้อมูลเดียวกับหน้า task/project เพื่อไม่ให้ cache ชนกัน
  const task = useQuery({ queryKey: ['task', id], queryFn: () => client.tasks.get(id), enabled: isTask })
  const project = useQuery({ queryKey: ['project', id], queryFn: () => client.projects.get(id), enabled: !isTask })
  const name = isTask ? task.data?.title : project.data?.name
  return (
    <p className="resource-meta">
      Will be linked to the {isTask ? 'task' : 'project'} <strong>“{name ?? '…'}”</strong> when you create it.
    </p>
  )
}

/** Full-page Create: nothing is created on the server until Create document is pressed. */
export function NewDocumentPage() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const scope = useDraftScope()
  const { target, invalid } = linkTarget(params)
  const back = returnPath(params) ?? '/documents'
  const target_ = target ? ('taskId' in target ? `task:${target.taskId}` : `project:${target.projectId}`) : 'none'
  const { draft, update, discard } = useDraft(scope && draftKey(scope, `new:${target_}`), emptyDraft)
  const create = useMutation({
    mutationFn: async () => {
      const res = await client.documents.create({
        title: draft.title,
        body: draft.body,
        sourceUrl: draft.sourceUrl.trim() || null,
        tags: draft.tags,
        searchKeywords: draft.searchKeywords,
        status: draft.status === 'current' ? 'unreviewed' : draft.status,
        ownerId: draft.ownerId,
      })
      if (target) await client.documents.link(res.document.id, target)
      return res.document
    },
    onSuccess: (doc) => {
      discard()
      void qc.invalidateQueries({ queryKey: ['documents'] })
      if (target && 'taskId' in target) void qc.invalidateQueries({ queryKey: ['task', target.taskId] })
      navigate(`/documents/${doc.id}`, { replace: true })
    },
  })
  return (
    <div className="page resource-page document-authoring">
      <nav className="task-detail-crumbs" aria-label="Breadcrumb">
        <Link to="/documents">Documents</Link> <span aria-hidden="true">/</span> <span className="ui-text-muted">New</span>
      </nav>
      <h1>New document</h1>
      {target && <LinkContext target={target} />}
      {invalid && (
        <Banner tone="warning" title="This link target is not valid">
          The address names a task or project that cannot be used, so the new document will not be linked.
        </Banner>
      )}
      <form
        className="resource-form"
        aria-label="New document"
        onSubmit={(e: FormEvent) => {
          e.preventDefault()
          create.mutate()
        }}
      >
        <AuthoringFields draft={draft} update={update} bodyRows={16} />
        {create.error && <FieldMessage tone="error">{errorText(create.error)}</FieldMessage>}
        <div className="resource-actions">
          <Button variant="primary" type="submit" loading={create.isPending}>
            Create document
          </Button>
          <Button
            onClick={() => {
              discard()
              navigate(back)
            }}
          >
            Cancel
          </Button>
        </div>
      </form>
    </div>
  )
}

function EditForm({ doc, scope, back }: { doc: DocumentDetail; scope: string | null; back: string }) {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { draft, update, discard } = useDraft(scope && draftKey(scope, `doc:${doc.id}`), () => fromDocument(doc))
  const contentChanged = draft.title !== doc.title || draft.body !== doc.body || (draft.sourceUrl.trim() || null) !== doc.sourceUrl
  const save = useMutation({
    mutationFn: () =>
      client.documents.update(doc.id, {
        title: draft.title,
        body: draft.body,
        sourceUrl: draft.sourceUrl.trim() || null,
        tags: draft.tags,
        searchKeywords: draft.searchKeywords,
        ownerId: draft.ownerId,
        ...(draft.status === doc.status ? {} : { status: draft.status === 'current' ? undefined : draft.status }),
      }),
    onSuccess: () => {
      discard()
      void qc.invalidateQueries({ queryKey: ['document', doc.id] })
      void qc.invalidateQueries({ queryKey: ['documents'] })
      navigate(`/documents/${doc.id}`, { replace: true })
    },
  })
  return (
    <form
      className="resource-form"
      aria-label="Edit document"
      onSubmit={(e: FormEvent) => {
        e.preventDefault()
        save.mutate()
      }}
    >
      <AuthoringFields draft={draft} update={update} bodyRows={20} />
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
        <Button
          onClick={() => {
            discard()
            navigate(back)
          }}
        >
          Cancel
        </Button>
      </div>
    </form>
  )
}

/** Full-page Edit of an existing document. */
export function EditDocumentPage() {
  const { id = '' } = useParams()
  const [params] = useSearchParams()
  const scope = useDraftScope()
  const doc = useQuery({ queryKey: ['document', id], queryFn: () => client.documents.get(id) })
  const back = returnPath(params) ?? `/documents/${id}`
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
  return (
    <div className="page resource-page document-authoring">
      <nav className="task-detail-crumbs" aria-label="Breadcrumb">
        <Link to="/documents">Documents</Link> <span aria-hidden="true">/</span> <Link to={`/documents/${d.id}`}>{d.title}</Link> <span aria-hidden="true">/</span>{' '}
        <span className="ui-text-muted">Edit</span>
      </nav>
      <h1>Edit “{d.title}”</h1>
      {d.archivedAt ? (
        <Banner tone="info" title="This document is archived">
          Restore it from the <Link to={`/documents/${d.id}`}>document page</Link> to edit it.
        </Banner>
      ) : (
        <EditForm doc={d} scope={scope} back={back} />
      )}
    </div>
  )
}

/** `/documents?new=1` from older links opens the Create page. */
export function LegacyNewDocumentRedirect() {
  const [params] = useSearchParams()
  const next = new URLSearchParams()
  for (const key of ['taskId', 'projectId', 'returnTo']) {
    const value = params.get(key)
    if (value) next.set(key, value)
  }
  const query = next.toString()
  return <Navigate to={`/documents/new${query ? `?${query}` : ''}`} replace />
}
