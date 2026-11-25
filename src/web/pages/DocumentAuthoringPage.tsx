import { useEffect, useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { DocumentDetail, DocumentKnowledgeStatus } from '../../shared/contracts'
import { AliceClientError, newIdempotencyKey } from '../../client'
import { client } from '../api'
import { FullPageError, isRecoverable } from '../brand'
import { DocumentKnowledgeFields } from '../components/DocumentKnowledgeFields'
import { DocumentEditor } from '../documents/DocumentEditor'
import { clearDraft, draftKey, readDraft, trackSave, useDraftScope, writeDraft, type CreatePayload, type DocumentDraft, type DocumentFields } from '../documents/drafts'
import { confirmLeave, useLeaveGuard } from '../documents/leave'
import { safeReturnPath } from '../navigation'
import { errorText } from '../tasks/TaskDetail'
import { Banner, Button, Dialog, FieldMessage, Skeleton, TextField } from '../ui'
import { ActorBadge, formatDate } from '../components/ui'

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

function fieldsOf(doc: DocumentDetail): DocumentFields {
  return {
    title: doc.title,
    body: doc.body,
    sourceUrl: doc.sourceUrl ?? '',
    tags: doc.tags,
    searchKeywords: doc.searchKeywords,
    status: doc.status,
    ownerId: doc.owner?.id ?? null,
  }
}

function fromDocument(doc: DocumentDetail): DocumentDraft {
  return {
    base: fieldsOf(doc),
    baseUpdatedAt: doc.updatedAt,
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

function createPayload(d: DocumentDraft): CreatePayload {
  return {
    title: d.title,
    body: d.body,
    sourceUrl: d.sourceUrl.trim() || null,
    tags: d.tags,
    searchKeywords: d.searchKeywords,
    status: d.status === 'current' ? 'unreviewed' : d.status,
    ownerId: d.ownerId,
  }
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/**
 * Only the fields the person changed since the edit started, so a save never writes back values it did not
 * touch (someone else may have changed them) and never sends the stale "current" status.
 */
export function changedFields(draft: DocumentFields, base: DocumentFields) {
  const patch: { title?: string; body?: string; sourceUrl?: string | null; tags?: string[]; searchKeywords?: string[]; ownerId?: string | null; status?: Exclude<DocumentDraft['status'], 'current'> } = {}
  if (draft.title !== base.title) patch.title = draft.title
  if (draft.body !== base.body) patch.body = draft.body
  if (draft.sourceUrl.trim() !== base.sourceUrl.trim()) patch.sourceUrl = draft.sourceUrl.trim() || null
  if (!same(draft.tags, base.tags)) patch.tags = draft.tags
  if (!same(draft.searchKeywords, base.searchKeywords)) patch.searchKeywords = draft.searchKeywords
  if (draft.ownerId !== base.ownerId) patch.ownerId = draft.ownerId
  if (draft.status !== base.status && draft.status !== 'current') patch.status = draft.status
  return patch
}

const uncertain = (e: unknown) => e instanceof AliceClientError && e.code === 'NETWORK_ERROR'
const UNCERTAIN_SAVE = 'Alice could not confirm the save. Your text is still here; press the button again to finish. It will not make a second copy.'

/** The draft for one Create or Edit page, kept in memory for this workspace and person until Save or Cancel. */
function useDraft(key: string | null, initial: () => DocumentDraft) {
  // draft ผูกกับคีย์ (workspace + ผู้ใช้ + เอกสาร) ที่สร้างมัน: ถ้าคีย์เปลี่ยนจากเหตุภายนอก (สลับ workspace,
  // sign-in ใหม่) draft เดิมยังอยู่ใต้คีย์เดิม และหน้านี้เริ่มจาก draft ของคีย์ใหม่ ไม่ส่งของเดิมข้าม scope
  const [state, setState] = useState(() => ({ key, draft: (key && readDraft(key)) || initial() }))
  if (state.key !== key) setState({ key, draft: (key && readDraft(key)) || initial() })
  const draft = state.key === key ? state.draft : (key && readDraft(key)) || initial()
  useEffect(() => {
    if (state.key && state.key === key) writeDraft(state.key, state.draft)
  }, [key, state])
  const setDraft = (next: DocumentDraft | ((d: DocumentDraft) => DocumentDraft)) =>
    setState((s) => ({ key: s.key, draft: typeof next === 'function' ? next(s.draft) : next }))
  const update = <K extends keyof DocumentDraft>(field: K, value: DocumentDraft[K]) => setDraft((d) => ({ ...d, [field]: value }))
  return { draft, setDraft, update, discard: () => key && clearDraft(key) }
}

function AuthoringFields({ draft, update, bodyRows, editorKey = 0, documentId }: { draft: DocumentDraft; update: ReturnType<typeof useDraft>['update']; bodyRows: number; editorKey?: number; documentId?: string }) {
  return (
    <>
      <TextField label="Document title" value={draft.title} onChange={(e) => update('title', e.target.value)} required maxLength={200} autoFocus data-autofocus />
      <DocumentEditor key={editorKey} label="Body" value={draft.body} onChange={(body) => update('body', body)} rows={bodyRows} title={draft.title} documentId={documentId} />
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
  const newKey = scope && draftKey(scope, `new:${target_}`)
  const { draft, setDraft, update, discard } = useDraft(newKey, emptyDraft)
  const [notice, setNotice] = useState('')
  const dirty = Object.keys(changedFields(draft, emptyDraft())).length > 0
  const leave = useLeaveGuard(dirty, discard)
  const create = useMutation({
    mutationFn: () =>
      trackSave(async () => {
        // ใช้ attempt เดิม (payload + key เดิม) จนกว่าจะรู้ผล: กดซ้ำหลัง network ขัดข้องจะไม่สร้างเอกสารซ้ำ
        const attempt = draft.saveAttempt ?? { key: newIdempotencyKey(), payload: createPayload(draft) }
        setDraft((d) => ({ ...d, saveAttempt: attempt }))
        if (newKey) writeDraft(newKey, { ...draft, saveAttempt: attempt })
        const created = (await client.documents.create(attempt.payload, { idempotencyKey: attempt.key })).document
        // เอกสารมีแล้ว: ย้าย draft ไปเป็น Edit ของ id นี้ (เก็บ link ที่ยังต้องทำ และสิ่งที่แก้หลังเริ่มบันทึก)
        const base: DocumentFields = { ...attempt.payload, sourceUrl: attempt.payload.sourceUrl ?? '' }
        const pendingLink = target ? { target, key: newIdempotencyKey() } : undefined
        const editDraft: DocumentDraft = { ...draft, saveAttempt: undefined, base, baseRevision: created.revision, baseUpdatedAt: created.updatedAt, pendingLink }
        if (scope) writeDraft(draftKey(scope, `doc:${created.id}`), editDraft)
        discard()
        let linked = true
        if (pendingLink) {
          try {
            await client.documents.link(created.id, pendingLink.target, { idempotencyKey: pendingLink.key })
            if (scope) writeDraft(draftKey(scope, `doc:${created.id}`), { ...editDraft, pendingLink: undefined })
          } catch {
            linked = false
          }
        }
        const unsaved = Object.keys(changedFields(editDraft, base)).length > 0
        return { created, linked, unsaved }
      }),
    onSuccess: ({ created, linked, unsaved }) => {
      void qc.invalidateQueries({ queryKey: ['documents'] })
      if (target && 'taskId' in target) void qc.invalidateQueries({ queryKey: ['task', target.taskId] })
      leave.allowNext()
      if (linked && !unsaved) {
        if (scope) clearDraft(draftKey(scope, `doc:${created.id}`))
        navigate(`/documents/${created.id}`, { replace: true })
      } else {
        // link ไม่สำเร็จหรือมีสิ่งที่แก้หลังเริ่มบันทึก: ต่อที่หน้า Edit ของเอกสารนี้ ไม่สร้างใหม่
        navigate(`/documents/${created.id}/edit${back !== '/documents' ? `?returnTo=${encodeURIComponent(back)}` : ''}`, { replace: true })
      }
    },
    onError: (error) => {
      if (uncertain(error)) return setNotice(UNCERTAIN_SAVE)
      // server ปฏิเสธ: ไม่มีเอกสารถูกสร้าง เริ่ม attempt ใหม่ได้
      setNotice('')
      setDraft((d) => ({ ...d, saveAttempt: undefined }))
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
          if (!create.isPending) create.mutate()
        }}
      >
        <AuthoringFields draft={draft} update={update} bodyRows={16} />
        {create.error && <FieldMessage tone="error">{uncertain(create.error) ? notice : errorText(create.error)}</FieldMessage>}
        <div className="resource-actions">
          <Button variant="primary" type="submit" loading={create.isPending}>
            Create document
          </Button>
          <Button
            onClick={() =>
              void confirmLeave('cancel').then((ok) => {
                if (!ok) return
                discard()
                leave.allowNext()
                navigate(back)
              })
            }
          >
            Cancel
          </Button>
        </div>
      </form>
    </div>
  )
}

function PendingLink({ pending, retry, busy }: { pending: NonNullable<DocumentDraft['pendingLink']>; retry: () => void; busy: boolean }) {
  const isTask = 'taskId' in pending.target
  const id = 'taskId' in pending.target ? pending.target.taskId : pending.target.projectId
  const task = useQuery({ queryKey: ['task', id], queryFn: () => client.tasks.get(id), enabled: isTask })
  const project = useQuery({ queryKey: ['project', id], queryFn: () => client.projects.get(id), enabled: !isTask })
  const name = isTask ? task.data?.title : project.data?.name
  return (
    <Banner
      tone="warning"
      title="The document was created but is not linked yet"
      action={
        <Button size="sm" loading={busy} onClick={retry}>
          Retry link
        </Button>
      }
    >
      It still needs to be linked to the {isTask ? 'task' : 'project'} “{name ?? '…'}”. Retrying links it without creating another copy.
    </Banner>
  )
}

function EditForm({ doc, scope, back }: { doc: DocumentDetail; scope: string | null; back: string }) {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { draft, setDraft, update, discard } = useDraft(scope && draftKey(scope, `doc:${doc.id}`), () => fromDocument(doc))
  const base = draft.base ?? fieldsOf(doc)
  const patch = changedFields(draft, base)
  const dirty = Object.keys(patch).length > 0
  const contentChanged = 'title' in patch || 'body' in patch || 'sourceUrl' in patch
  const [editorKey, setEditorKey] = useState(0)
  const [conflict, setConflict] = useState<DocumentDetail | null>(null)
  const [confirmLoad, setConfirmLoad] = useState(false)
  const baseUpdatedAt = draft.baseUpdatedAt ?? doc.updatedAt
  // server มีฉบับใหม่ (SSE/refetch): ถ้ายังไม่ได้แก้อะไร รับฉบับใหม่เลย; ถ้าแก้แล้ว เก็บ draft ไว้และเตือน
  const newer = doc.updatedAt !== baseUpdatedAt
  useEffect(() => {
    if (newer && !dirty && !draft.pendingLink) {
      setDraft(fromDocument(doc))
      setEditorKey((k) => k + 1)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc.updatedAt])
  const loadLatest = (latest: DocumentDetail) => {
    setDraft({ ...fromDocument(latest), pendingLink: draft.pendingLink })
    setEditorKey((k) => k + 1)
    setConflict(null)
    setConfirmLoad(false)
    void qc.invalidateQueries({ queryKey: ['document', doc.id] })
  }
  const leave = useLeaveGuard(dirty, discard)
  const done = () => {
    leave.allowNext()
    discard()
    void qc.invalidateQueries({ queryKey: ['document', doc.id] })
    void qc.invalidateQueries({ queryKey: ['documents'] })
    navigate(`/documents/${doc.id}`, { replace: true })
  }
  const linkNow = async () => {
    const pending = draft.pendingLink
    if (!pending) return
    await client.documents.link(doc.id, pending.target, { idempotencyKey: pending.key })
    setDraft((d) => ({ ...d, pendingLink: undefined }))
    if ('taskId' in pending.target) void qc.invalidateQueries({ queryKey: ['task', pending.target.taskId] })
  }
  const save = useMutation({
    mutationFn: ({ overwrite }: { overwrite: boolean }) =>
      trackSave(async () => {
        if (dirty && !overwrite) {
          // อ่านฉบับล่าสุดก่อนบันทึก: ถ้ามีคนแก้ตั้งแต่เริ่ม ให้คนเลือกเอง (ไม่ merge อัตโนมัติ)
          const latest = await client.documents.get(doc.id)
          if (latest.updatedAt !== baseUpdatedAt) return { conflict: latest }
        }
        if (dirty) {
          const updated = (await client.documents.update(doc.id, patch)).document
          // บันทึกแล้ว: ฐานใหม่คือค่าที่เพิ่งบันทึก ถ้า link ล้มต่อจากนี้ กด Save อีกครั้งจะไม่ส่งซ้ำ
          setDraft((d) => ({ ...d, base: fieldsOf(updated), baseRevision: updated.revision }))
        }
        await linkNow()
        return { conflict: null }
      }),
    onSuccess: ({ conflict: latest }) => {
      if (latest) return setConflict(latest)
      setConflict(null)
      done()
    },
  })
  const retryLink = useMutation({
    mutationFn: () => trackSave(linkNow),
    onSuccess: () => {
      if (Object.keys(patch).length === 0) done()
    },
  })
  return (
    <form
      className="resource-form"
      aria-label="Edit document"
      onSubmit={(e: FormEvent) => {
        e.preventDefault()
        if (!save.isPending) save.mutate({ overwrite: false })
      }}
    >
      {newer && dirty && !conflict && (
        <Banner
          tone="warning"
          title="This document changed while you were editing"
          action={
            <Button size="sm" onClick={() => setConfirmLoad(true)}>
              Load latest
            </Button>
          }
        >
          Revision {doc.revision} was saved {formatDate(doc.updatedAt)} by <ActorBadge actor={doc.updatedBy} />. Your text is kept here; saving will ask
          whether to replace their version.
        </Banner>
      )}
      <Dialog open={confirmLoad} onOpenChange={setConfirmLoad} title="Load the latest version?">
        <p>Your unsaved changes to this document will be discarded and the latest saved version opened instead.</p>
        <div className="resource-actions">
          <Button variant="danger" onClick={() => void client.documents.get(doc.id).then(loadLatest)}>
            Discard my changes and load latest
          </Button>
          <Button onClick={() => setConfirmLoad(false)}>Keep editing</Button>
        </div>
      </Dialog>
      <Dialog open={conflict !== null} onOpenChange={(o) => !o && setConflict(null)} title="Someone saved a newer version">
        {conflict && (
          <>
            <p>
              Revision {conflict.revision} was saved {formatDate(conflict.updatedAt)} by <ActorBadge actor={conflict.updatedBy} /> after you started editing. Alice
              does not merge the two. Choose which version to keep.
            </p>
            <div className="resource-actions">
              <Button variant="primary" loading={save.isPending} onClick={() => save.mutate({ overwrite: true })}>
                Save mine over theirs
              </Button>
              <Button variant="danger" onClick={() => loadLatest(conflict)}>
                Discard mine and load theirs
              </Button>
              <Button onClick={() => setConflict(null)}>Keep editing</Button>
            </div>
          </>
        )}
      </Dialog>
      {draft.pendingLink && <PendingLink pending={draft.pendingLink} retry={() => retryLink.mutate()} busy={retryLink.isPending} />}
      {retryLink.error && <FieldMessage tone="error">Still not linked: {errorText(retryLink.error)}</FieldMessage>}
      <AuthoringFields draft={draft} update={update} bodyRows={20} editorKey={editorKey} documentId={doc.id} />
      <p className="ui-text-muted">
        {contentChanged
          ? 'Saving content creates revision ' + (doc.revision + 1) + ' and clears its review. Earlier revisions stay available in History.'
          : 'Metadata-only changes keep the current content revision and review.'}
      </p>
      {save.error && <FieldMessage tone="error">{uncertain(save.error) ? UNCERTAIN_SAVE : errorText(save.error)}</FieldMessage>}
      <div className="resource-actions">
        <Button variant="primary" type="submit" loading={save.isPending}>
          Save changes
        </Button>
        <Button
          onClick={() =>
            void confirmLeave('cancel').then((ok) => {
              if (!ok) return
              discard()
              leave.allowNext()
              navigate(back)
            })
          }
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
