import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import type { DocumentDetail, DocumentSummary, Page } from '../../shared/contracts'
import { client } from '../api'
import { MarkdownEditor } from '../components/Markdown'
import { ActorBadge, Empty, ErrorMessage, Field, Loading, TextInput, formatDate } from '../components/ui'
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
  })
  const docs = query.data?.pages.flatMap((p) => p.items) ?? []
  const update = (key: string, value: string) => {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value)
    else next.delete(key)
    setParams(next, { replace: true })
  }
  return (
    <div className="page">
      <div className="page-head">
        <h1>Documents</h1>
        <button type="button" className="primary" onClick={() => update('new', '1')}>
          New document
        </button>
      </div>
      {creating && <NewDocumentForm onCancel={() => update('new', '')} />}
      <form className="inline-form" role="search" onSubmit={(e) => e.preventDefault()}>
        <Field label="Search documents">{(id) => <input id={id} type="search" value={q} onChange={(e) => update('q', e.target.value)} />}</Field>
        <Field label="Show">
          {(id) => (
            <select id={id} value={archived} onChange={(e) => update('archived', e.target.value === 'active' ? '' : e.target.value)}>
              <option value="active">Active</option>
              <option value="archived">Archived</option>
              <option value="all">All</option>
            </select>
          )}
        </Field>
      </form>
      <ErrorMessage error={query.error} />
      {query.isLoading ? (
        <Loading />
      ) : docs.length === 0 && !q && archived === 'active' ? (
        creating ? null : <IllustratedState pose="focused" copy="documentsEmpty" title="Reference documents live here" />
      ) : docs.length === 0 ? (
        <Empty>No documents found.</Empty>
      ) : (
        <ul className="doc-list">
          {docs.map((d) => (
            <li key={d.id} className="card">
              <div className="row">
                <Link to={`/documents/${d.id}`} className="card-title">
                  {d.title}
                </Link>
                {d.archivedAt && <span className="pill pill-archived">archived</span>}
                <span className="muted small">rev {d.revision}</span>
              </div>
              {d.excerpt && <p className="muted clamp small">{d.excerpt}</p>}
              {d.sourceUrl && <span className="small source">{d.sourceUrl}</span>}
              <span className="muted small">
                Updated {formatDate(d.updatedAt)} by <ActorBadge actor={d.updatedBy} />
              </span>
            </li>
          ))}
        </ul>
      )}
      {query.hasNextPage && (
        <button type="button" onClick={() => void query.fetchNextPage()}>
          Load more
        </button>
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
      className="panel stack"
      aria-label="New document"
      onSubmit={(e: FormEvent) => {
        e.preventDefault()
        create.mutate()
      }}
    >
      <TextInput label="Document title" value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={200} autoFocus />
      <MarkdownEditor id={`new-doc-body-${link?.taskId ?? link?.projectId ?? 'page'}`} label="Body (Markdown)" value={body} onChange={setBody} rows={6} />
      <TextInput label="Source URL (optional)" type="url" placeholder="https://…" value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} />
      <p className="hint">A document needs a body, a source URL, or both.</p>
      <ErrorMessage error={create.error} />
      <div className="row">
        <button className="primary" type="submit" disabled={create.isPending}>
          Create document
        </button>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  )
}
