import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useInfiniteQuery } from '@tanstack/react-query'
import type { KnowledgeTopic } from '../../shared/contracts'
import { client } from '../api'
import { DocumentFilters, type DocumentFilterKey } from '../components/DocumentFilters'
import { errorText } from '../tasks/TaskDetail'
import { Badge, Banner, Button, Checkbox, EmptyState, SelectField, Skeleton, TextField } from '../ui'

export function KnowledgeSearch({ projectId, topics }: {
  projectId: string
  topics: KnowledgeTopic[]
}) {
  const [draft, setDraft] = useState('')
  const [q, setQ] = useState('')
  const [topicId, setTopicId] = useState('')
  const [curatedOnly, setCuratedOnly] = useState(false)
  const [filters, setFilters] = useState<Partial<Record<DocumentFilterKey, string>>>({})
  const results = useInfiniteQuery({
    queryKey: ['documents', 'knowledge-search', projectId, q, topicId, curatedOnly, filters], initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => client.documents.list({ q, knowledgeProjectId: projectId, topicId: topicId || undefined, curatedOnly, ...filters, cursor: pageParam, limit: 20 }),
    getNextPageParam: (p) => p.nextCursor ?? undefined,
  })
  const submit = (e: FormEvent) => {
    e.preventDefault()
    setQ(draft.trim())
  }
  const items = results.data?.pages.flatMap((p) => p.items) ?? []
  return <section aria-label="Search project knowledge" className="resource-panel">
    <h3>Find knowledge</h3>
    <p>Search linked documents and curated sources across this workspace. <Link to="/documents">Browse all Documents</Link></p>
    <form onSubmit={submit} className="resource-form">
      <TextField label="Search project knowledge" type="search" value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={200} />
      <Button type="submit">Find knowledge</Button>
      <SelectField label="Knowledge topic" value={topicId} onChange={(e) => setTopicId(e.target.value)} options={[{ value: '', label: 'All topics and linked documents' }, ...topics.filter((t) => !t.archivedAt).map((t) => ({ value: t.id, label: t.name }))]} />
      <Checkbox label="Curated documents only" checked={curatedOnly} onChange={(e) => setCuratedOnly(e.target.checked)} />
      <DocumentFilters values={filters} onChange={(key, value) => setFilters((old) => ({ ...old, [key]: value }))} onClear={() => setFilters({})} />
    </form>
    {results.isLoading ? <Skeleton lines={3} /> : results.error ? <Banner tone="danger" title="Knowledge search could not be loaded" action={<Button onClick={() => void results.refetch()}>Retry knowledge search</Button>}>{errorText(results.error)}</Banner> : <>
      {!items.length && <EmptyState title="No matching documents in this scope">Try other words or filters, or search all Documents. Relevant knowledge may use different wording.</EmptyState>}
      <ul>{items.map((d) => <li key={d.id}>
        <Link to={`/documents/${d.id}`}>{d.title}</Link> <Badge>{d.status}</Badge><span> · Revision {d.revision}</span>
        <p>{d.excerpt}</p>{d.match && <p>Matched {d.match.field}{d.match.value ? `: ${d.match.value}` : ''}</p>}
        <p>Linked projects: {d.projectContext?.items.map((p) => p.name).join(', ') || 'None'}</p>
        <p>Topics: {d.topicContext?.items.map((t) => t.name + (t.archivedAt ? ' (archived)' : '')).join(', ') || 'Not curated'}{d.topicContext && d.topicContext.total > d.topicContext.items.length && <> · <Link to={`/documents/${d.id}`}>View all {d.topicContext.total} topics</Link></>}</p>
      </li>)}</ul>
      {results.hasNextPage && <Button loading={results.isFetchingNextPage} onClick={() => void results.fetchNextPage()}>More knowledge results</Button>}
    </>}
  </section>
}
