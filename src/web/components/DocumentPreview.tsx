import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import { BookOpen, Eye } from 'lucide-react'
import type { DocumentSummary } from '../../shared/contracts'
import { canonicalDocumentLink } from '../../shared/document-link-url'
import { ApiError, client } from '../api'
import { useCapability } from '../hooks'
import { errorText } from '../tasks/TaskDetail'
import { Badge, Banner, Button, Dialog, IconButton, Skeleton } from '../ui'
import { DocumentReader } from './DocumentReader'
import { KNOWLEDGE_STATUS_LABELS } from './DocumentKnowledgeFields'
import { useMarkdownScope } from './markdown-scope'

const FULL_WINDOW = 100_000

type ExpandedRead =
  | { state: 'available'; document: DocumentSummary; body: string }
  | { state: 'archived'; document: DocumentSummary }
  | { state: 'unavailable' }

const changedWhileLoading = () => new ApiError(409, 'CONFLICT', 'The document changed while it was loading.')

/**
 * Reads the whole current document only after the person asks to expand: check the preview state
 * and revision, then read every content window at that revision. Nothing is shown unless the whole
 * body belongs to one available revision; a change in between is a CONFLICT, never a mixed body.
 */
async function readExpanded(documentId: string): Promise<ExpandedRead> {
  const check = await client.documents.preview(documentId)
  if (check.state === 'unavailable' || !check.document) return { state: 'unavailable' }
  if (check.state === 'archived') return { state: 'archived', document: check.document }
  const revision = check.document.revision
  let body = ''
  let offset = 0
  for (;;) {
    const { document } = await client.documents.content(documentId, { expectedRevision: revision, offset, maxChars: FULL_WINDOW })
    if (document.archivedAt) return { state: 'archived', document }
    if (document.revision !== revision || document.bodyWindow.offset !== offset) throw changedWhileLoading()
    body += document.body
    if (document.bodyWindow.nextOffset === null) {
      if (body.length !== document.bodyWindow.totalChars) throw changedWhileLoading()
      const { body: _body, bodyWindow: _window, ...summary } = document
      return { state: 'available', document: summary, body }
    }
    offset = document.bodyWindow.nextOffset
  }
}

/** The same bounded preview is used by content links, backlinks and curated discovery. */
export function DocumentPreview({ documentId, href, label }: {
  documentId: string
  href: string
  label: string
}) {
  const [open, setOpen] = useState(false)
  // รอบการขยาย: ทุกครั้งเป็น query ใหม่ ผลจากรอบเก่าที่กลับมาทีหลังจึงไม่ถูกแสดง
  const [expanded, setExpanded] = useState<number | null>(null)
  const scope = useMarkdownScope()
  const supported = useCapability('project-knowledge')
  const preview = useQuery({
    queryKey: ['document-preview', documentId], enabled: supported && open,
    queryFn: () => client.documents.preview(documentId), staleTime: 0,
  })
  const full = useQuery({
    queryKey: ['document-preview', documentId, 'expanded', expanded],
    enabled: supported && expanded !== null,
    queryFn: () => readExpanded(documentId),
    staleTime: 0, gcTime: 0, retry: false,
  })
  if (!supported) return null
  // Never substitute previously cached body text while refreshing or after an error.
  const data = !preview.isFetching && !preview.error ? preview.data : undefined
  const fragment = canonicalDocumentLink(href)?.fragment || undefined
  const closePreview = (next: boolean) => {
    setOpen(next)
    if (!next) setExpanded(null)
  }
  return <Dialog open={open} onOpenChange={closePreview} title="Document preview" description="A bounded view of the original document. Curation is separate from review." size="lg"
    trigger={<IconButton icon={Eye} size="sm" label={`Preview ${label}`} />}
    actions={<>
      <Button onClick={() => closePreview(false)} data-autofocus>Close preview</Button>
      {data?.state === 'available' && <Button icon={BookOpen} aria-haspopup="dialog" onClick={() => setExpanded((n) => (n ?? 0) + 1)}>Expand to read</Button>}
      <Link className="ui-button ui-button--primary ui-button--md" to={href} onClick={() => { closePreview(false); scope?.onNavigate?.() }}>Open document</Link>
    </>}>
    {preview.isPending || preview.isFetching ? <div role="status"><p>Loading current document preview…</p><Skeleton lines={3} /></div> : preview.error ? <Banner tone="danger" title="Preview could not be loaded" action={<Button onClick={() => void preview.refetch()}>Retry preview</Button>}>{errorText(preview.error)} Open the document or retry to check its actual state.</Banner> : data && <>
      {data.state === 'unavailable' ? <Banner tone="warning" title="Document unavailable">This reference cannot be resolved in the active workspace. No content is shown.</Banner> : <>
        <h3>{data.document!.title}</h3>
        <p><Badge>{data.document!.status}</Badge> · Revision {data.document!.revision}</p>
        <p>Reviewed revision: {data.document!.reviewedRevision ?? 'Not reviewed'}{data.document!.reviewedAt ? ` · ${data.document!.reviewedAt}` : ''}{data.document!.reviewedBy ? ` by ${data.document!.reviewedBy.displayName}` : ''}</p>
        {data.document!.status === 'unreviewed' && <Banner tone="warning">This document is unreviewed. Check the source before treating it as authoritative.</Banner>}
        {data.document!.status === 'draft' && <Banner tone="warning">This is a draft.</Banner>}
        {data.document!.status === 'superseded' && <Banner tone="danger">This document is superseded. Open its relationships to find a newer source.</Banner>}
        {data.state === 'archived' ? <Banner tone="warning" title="Document archived">This reference is retained. Archived content is not included in previews.</Banner> : <>
          <pre className="document-preview-text" aria-label="Document content preview">{data.body}</pre>
          <p>{data.bodyWindow?.returnedChars ?? 0} of {data.bodyWindow?.totalChars ?? 0} characters{data.bodyWindow?.truncated ? ' · Expand to read or open the document to read more.' : ''}</p>
        </>}
      </>}
    </>}
    <ExpandedReader documentId={documentId} fallbackTitle={data?.document?.title ?? label} open={expanded !== null} onOpenChange={(next) => { if (!next) setExpanded(null) }}
      onNavigate={() => { closePreview(false); scope?.onNavigate?.() }} query={full} fragment={fragment} />
  </Dialog>
}

function ExpandedReader({ documentId, fallbackTitle, open, onOpenChange, onNavigate, query, fragment }: {
  documentId: string
  onNavigate: () => void
  fallbackTitle: string
  open: boolean
  onOpenChange: (open: boolean) => void
  query: UseQueryResult<ExpandedRead>
  fragment?: string
}) {
  // ระหว่างโหลดใหม่ (เช่นหลัง invalidation) หรือเมื่อ error ห้ามแสดงผลเก่า
  const result = !query.isFetching && !query.error ? query.data : undefined
  const conflict = query.error instanceof ApiError && query.error.code === 'CONFLICT'
  const doc = result && result.state !== 'unavailable' ? result.document : undefined
  const description = doc
    ? <>Saved document · {KNOWLEDGE_STATUS_LABELS[doc.status]}{doc.archivedAt ? ' · archived' : ''} · Revision {doc.revision} · Reviewed revision: {doc.reviewedRevision ?? 'Not reviewed'}</>
    : 'Loading the current saved document'
  let notice
  if (query.isPending || query.isFetching) notice = <div role="status"><p>Loading the full current document…</p><Skeleton lines={6} /></div>
  else if (conflict) notice = <Banner tone="warning" title="This document changed while loading" action={<Button onClick={() => void query.refetch()}>Load latest</Button>}>Nothing from the earlier revision is shown. Load the latest revision to read it.</Banner>
  else if (query.error) notice = <Banner tone="danger" title="The full document could not be loaded" action={<Button onClick={() => void query.refetch()}>Retry</Button>}>{errorText(query.error)}</Banner>
  else if (result?.state === 'unavailable') notice = <Banner tone="warning" title="Document unavailable">This reference cannot be resolved in the active workspace. No content is shown.</Banner>
  else if (result?.state === 'archived') notice = <Banner tone="warning" title="Document archived">Archived content is not shown here. Open the document to restore or read it.</Banner>
  else if (result?.state === 'available') {
    const status = result.document.status
    if (status === 'unreviewed') notice = <Banner tone="warning">This document is unreviewed. Check the source before treating it as authoritative.</Banner>
    else if (status === 'draft') notice = <Banner tone="warning">This is a draft.</Banner>
    else if (status === 'superseded') notice = <Banner tone="danger">This document is superseded. Open its relationships to find a newer source.</Banner>
  }
  return <DocumentReader open={open} onOpenChange={onOpenChange} title={doc?.title ?? fallbackTitle} description={description}
    body={result?.state === 'available' ? result.body : null} documentId={documentId} initialFragment={fragment} notice={notice} onNavigate={onNavigate} />
}
