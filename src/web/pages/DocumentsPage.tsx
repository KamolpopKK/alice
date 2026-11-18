import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { keepPreviousData, useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { FileText, Link2, Plus } from 'lucide-react'
import type { DocumentDetail, DocumentSummary, Page } from '../../shared/contracts'
import { client } from '../api'
import { MarkdownEditor } from '../components/Markdown'
import { ActorBadge, formatDate } from '../components/ui'
import { errorText } from '../tasks/TaskDetail'
import { Badge, Banner, Button, Dialog, EmptyState, FieldMessage, ResourceItem, ResourceList, SegmentedControl, Skeleton, TextField } from '../ui'
import { IllustratedState } from '../brand'

export function DocumentsPage() {
  const [params, setParams] = useSearchParams()
  const q = params.get('q') ?? ''
  const archived = (params.get('archived') ?? 'active') as 'active' | 'archived' | 'all'
  const creating = params.get('new') === '1'
  const query = useInfiniteQuery({
    queryKey: ['documents', 'list', q, archived],
    queryFn: ({ pageParam }) => client.documents.list({ q, archived, limit: 30, cursor: pageParam }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    placeholderData: keepPreviousData,
  })
  const docs = query.data?.pages.flatMap((p) => p.items) ?? []
  const update = (key: string, value: string) => {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value)
    else next.delete(key)
    setParams(next, { replace: true })
  }
  return (
    <div className="page resource-page">
      <div className="resource-head">
        <h1>Documents</h1>
        <Button variant="primary" icon={Plus} onClick={() => update('new', '1')}>
          New document
        </Button>
      </div>
      <Dialog open={creating} onOpenChange={(o) => !o && update('new', '')} title="New document" size="lg">
        <NewDocumentForm onCancel={() => update('new', '')} />
      </Dialog>
      <form className="resource-toolbar" role="search" aria-label="Find documents" onSubmit={(e) => e.preventDefault()}>
        <div className="resource-toolbar-search">
          <TextField label="Search documents" hideLabel placeholder="Search documents" type="search" value={q} onChange={(e) => update('q', e.target.value)} />
        </div>
        <SegmentedControl
          label="Show documents"
          value={archived}
          onValueChange={(v) => update('archived', v === 'active' ? '' : v)}
          options={[
            { value: 'active', label: 'Active' },
            { value: 'archived', label: 'Archived' },
            { value: 'all', label: 'All' },
          ]}
        />
      </form>
      {query.error && !query.data ? (
        <Banner tone="danger" title="Documents could not be loaded" action={<Button size="sm" onClick={() => void query.refetch()}>Try again</Button>}>
          {errorText(query.error)}
        </Banner>
      ) : query.isLoading ? (
        <Skeleton lines={5} />
      ) : docs.length === 0 && !q && archived === 'active' ? (
        creating ? null : <IllustratedState pose="focused" copy="documentsEmpty" title="Reference documents live here" />
      ) : docs.length === 0 ? (
        <EmptyState title="No documents found.">Try other words, or show archived documents.</EmptyState>
      ) : (
        <ResourceList label="Documents" layout="list">
          {docs.map((d) => (
            <ResourceItem
              key={d.id}
              icon={d.sourceUrl && !d.excerpt ? Link2 : FileText}
              title={<Link to={`/documents/${d.id}`}>{d.title}</Link>}
              text={d.excerpt || undefined}
              meta={
                <>
                  {d.archivedAt && <Badge>archived</Badge>}
                  <span>Revision {d.revision}</span>
                  <span>
                    Updated {formatDate(d.updatedAt)} by <ActorBadge actor={d.updatedBy} />
                  </span>
                  {d.sourceUrl && <span className="resource-source">{d.sourceUrl}</span>}
                </>
              }
            />
          ))}
        </ResourceList>
      )}
      {query.hasNextPage && (
        <Button size="sm" loading={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>
          Load more
        </Button>
      )}
    </div>
  )
}

/** Create a document, optionally linking it to a task or project right away. */
export function NewDocumentForm({ onCancel, link }: { onCancel: () => void; link?: { taskId?: string; projectId?: string } }) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [sourceUrl, setSourceUrl] = useState('')
  const create = useMutation({
    mutationFn: async () => {
      const res = await client.documents.create({ title, body, sourceUrl: sourceUrl.trim() || null })
      if (link) await client.documents.link(res.document.id, link)
      return res.document
    },
    onSuccess: (doc) => {
      void qc.invalidateQueries({ queryKey: ['documents'] })
      if (link) {
        onCancel()
        if (link.taskId) void qc.invalidateQueries({ queryKey: ['task', link.taskId] })
      } else navigate(`/documents/${doc.id}`)
    },
  })
  return (
    <form
      className="resource-form"
      aria-label="New document"
      onSubmit={(e: FormEvent) => {
        e.preventDefault()
        create.mutate()
      }}
    >
      <TextField label="Document title" value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={200} autoFocus data-autofocus />
      <MarkdownEditor id={`new-doc-body-${link?.taskId ?? link?.projectId ?? 'page'}`} label="Body (Markdown)" value={body} onChange={setBody} rows={6} />
      <TextField
        label="Source URL (optional)"
        hint="A document needs a body, a source URL, or both."
        type="url"
        placeholder="https://…"
        value={sourceUrl}
        onChange={(e) => setSourceUrl(e.target.value)}
      />
      {create.error && <FieldMessage tone="error">{errorText(create.error)}</FieldMessage>}
      <div className="resource-actions">
        <Button variant="primary" type="submit" loading={create.isPending}>
          Create document
        </Button>
        <Button onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  )
}
