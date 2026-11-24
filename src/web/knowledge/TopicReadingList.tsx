import { DocumentLink } from '../components/DocumentLink'
import { useRef, useState, type FormEvent } from 'react'
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import type { KnowledgeTopic } from '../../shared/contracts'
import { newIdempotencyKey } from '../../client/client'
import { client } from '../api'
import { errorText } from '../tasks/TaskDetail'
import { Banner, Button, EmptyState, SelectField, Skeleton, TextField } from '../ui'

type Change = {
  documentId: string
  remove?: boolean
  beforeDocumentId?: string
  revision: number
}
export function TopicReadingList({ topic, readOnly }: {
  topic: KnowledgeTopic
  readOnly: boolean
}) {
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState('')
  const attempt = useRef<{
    signature: string
    id: string
  } | null>(null)
  const members = useInfiniteQuery({
    queryKey: ['knowledge-members', topic.id], enabled: open, initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => client.knowledge.documents(topic.id, { cursor: pageParam, limit: 20 }),
    getNextPageParam: (p) => p.nextCursor ?? undefined,
  })
  const candidates = useInfiniteQuery({
    queryKey: ['documents', 'knowledge-picker', topic.id, search], enabled: open && !readOnly,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => client.documents.list({ q: search || undefined, archived: 'active', limit: 20, cursor: pageParam }),
    getNextPageParam: (p) => p.nextCursor ?? undefined,
  })
  const change = useMutation({
    mutationFn: (input: Change) => {
      const signature = JSON.stringify(input)
      if (attempt.current?.signature !== signature) attempt.current = { signature, id: newIdempotencyKey() }
      const guard = { expectedRevision: input.revision, mutationId: attempt.current.id }
      return input.remove ? client.knowledge.removeDocument(topic.id, input.documentId, guard) : client.knowledge.putDocument(topic.id, input.documentId, { ...guard, beforeDocumentId: input.beforeDocumentId })
    },
    onSuccess: () => {
      attempt.current = null
      setSelected('')
      void qc.invalidateQueries({ queryKey: ['knowledge-members', topic.id] })
      void qc.invalidateQueries({ queryKey: ['knowledge-topics', topic.projectId] })
    },
  })
  const rows = members.data?.pages.flatMap((p) => p.items) ?? []
  const revision = members.data?.pages[0]?.topic.revision
  const searchDocuments = (e: FormEvent) => {
    e.preventDefault()
    setSearch(query.trim())
    setSelected('')
  }
  return <div>
    <Button aria-expanded={open} onClick={() => setOpen(!open)}>{open ? 'Hide' : 'Show'} reading list for {topic.name}</Button>
    {open && <section aria-label={`Reading list ${topic.name}`}>
      {members.isLoading ? <Skeleton lines={2} /> : members.error ? <Banner tone="danger" title="Reading list could not be loaded" action={<Button onClick={() => void members.refetch()}>Reload reading list</Button>}>{errorText(members.error)}</Banner> : <>
        {!rows.length && <EmptyState title="No reading documents yet">Choose existing documents in the order people should read them.</EmptyState>}
        <ol>{rows.map((item, i) => <li key={item.document.id}>
          <DocumentLink href={`/documents/${item.document.id}`}>{item.document.title}</DocumentLink>
          <p>{item.document.status} · Revision {item.document.revision}{item.document.archivedAt ? ' · Archived document' : ''}</p>
          <p>Linked projects: {item.projectContext.items.map((p) => p.name + (p.archivedAt ? ' (archived)' : '')).join(', ') || 'None'}{item.projectContext.total > item.projectContext.items.length ? ` (+${item.projectContext.total - item.projectContext.items.length} more)` : ''}</p>
          {!readOnly && <div className="row">
            <Button disabled={change.isPending || !revision || i === 0} onClick={() => change.mutate({ documentId: item.document.id, beforeDocumentId: rows[i - 1].document.id, revision: revision! })}>Move {item.document.title} up</Button>
            <Button disabled={change.isPending || !revision || (i === rows.length - 1 || (i === rows.length - 2 && !!members.hasNextPage))} onClick={() => change.mutate({ documentId: item.document.id, beforeDocumentId: rows[i + 2]?.document.id, revision: revision! })}>Move {item.document.title} down</Button>
            <Button disabled={change.isPending || !revision} onClick={() => change.mutate({ documentId: item.document.id, remove: true, revision: revision! })}>Remove {item.document.title} from topic</Button>
          </div>}
        </li>)}</ol>
        {members.hasNextPage && <Button loading={members.isFetchingNextPage} onClick={() => void members.fetchNextPage()}>Load more reading documents</Button>}
      </>}
      {!readOnly && <>
        <form onSubmit={searchDocuments} className="resource-form" aria-label={`Find documents for ${topic.name}`}>
          <TextField label="Find existing document" value={query} onChange={(e) => setQuery(e.target.value)} />
          <Button type="submit">Search documents</Button>
        </form>
        {candidates.isLoading ? <Skeleton lines={1} /> : candidates.error ? <Banner tone="danger" title="Document search failed" action={<Button onClick={() => void candidates.refetch()}>Retry document search</Button>}>{errorText(candidates.error)}</Banner> : <>
          <SelectField label="Existing document" value={selected} onChange={(e) => setSelected(e.target.value)} options={[{ value: '', label: 'Choose a document' }, ...(candidates.data?.pages.flatMap((p) => p.items) ?? []).filter((d) => !rows.some((r) => r.document.id === d.id)).map((d) => ({ value: d.id, label: `${d.title} · ${d.status}` }))]} />
          {candidates.hasNextPage && <Button loading={candidates.isFetchingNextPage} onClick={() => void candidates.fetchNextPage()}>More document choices</Button>}
          <Button disabled={!selected || !revision || !!members.error || change.isPending} onClick={() => change.mutate({ documentId: selected, revision: revision! })}>Add document to topic</Button>
        </>}
      </>}
      {change.error && <Banner tone="danger" title="Reading list change was not confirmed" action={<Button onClick={() => void members.refetch()}>Reload reading list</Button>}>{errorText(change.error)} Reload after a conflict, then retry.</Banner>}
    </section>}
  </div>
}
