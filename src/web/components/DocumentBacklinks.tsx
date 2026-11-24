import { DocumentLink } from './DocumentLink'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useInfiniteQuery } from '@tanstack/react-query'
import { client } from '../api'
import { errorText } from '../tasks/TaskDetail'
import { Badge, Banner, Button, EmptyState, Skeleton } from '../ui'

export function DocumentBacklinks({ documentId }: { documentId: string }) {
  const [archived, setArchived] = useState(false)
  const backlinks = useInfiniteQuery({
    queryKey: ['document-backlinks', documentId, archived], initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => client.documents.backlinks(documentId, { archived: archived ? 'all' : 'active', cursor: pageParam, limit: 10 }),
    getNextPageParam: (p) => p.nextCursor ?? undefined,
  })
  const topics = useInfiniteQuery({
    queryKey: ['document-topics', documentId], initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => client.documents.topics(documentId, { archived: 'all', cursor: pageParam, limit: 10 }),
    getNextPageParam: (p) => p.nextCursor ?? undefined,
  })
  const items = backlinks.data?.pages.flatMap((p) => p.items) ?? []
  const memberships = topics.data?.pages.flatMap((p) => p.items) ?? []
  return <>
    <section className="task-section" aria-label="Document backlinks">
      <div className="row spread"><h2 className="task-section-title">Backlinks</h2><Button size="sm" onClick={() => setArchived(!archived)}>{archived ? 'Hide' : 'Include'} archived sources</Button></div>
      {backlinks.isLoading ? <Skeleton lines={2} /> : backlinks.error ? <Banner tone="danger" title="Backlinks could not be loaded" action={<Button onClick={() => void backlinks.refetch()}>Retry backlinks</Button>}>{errorText(backlinks.error)}</Banner> : <>
        {!items.length && <EmptyState title="No incoming references" />}
        <ul className="document-relation-list">{items.map(({ document: d, provenance, projectContext }) => <li key={d.id}>
          <span><DocumentLink href={`/documents/${d.id}`}>{d.title}</DocumentLink> <Badge>{d.status}</Badge>{d.archivedAt && <Badge>Archived source</Badge>}
            <span> · Revision {d.revision}</span><p>{provenance.map((p) => p === 'inline' ? 'Link in content' : 'Manual reference').join(' · ')}</p>
            {projectContext.items.length > 0 && <p>Linked projects: {projectContext.items.map((p) => p.name).join(', ')}{projectContext.total > projectContext.items.length ? ` (+${projectContext.total - projectContext.items.length} more)` : ''}</p>}
          </span>
        </li>)}</ul>
        {backlinks.hasNextPage && <Button size="sm" loading={backlinks.isFetchingNextPage} onClick={() => void backlinks.fetchNextPage()}>More backlinks</Button>}
      </>}
    </section>
    <section className="task-section" aria-label="Topic memberships">
      <h2 className="task-section-title">In topics</h2><p>Curation is separate from document references and review.</p>
      {topics.isLoading ? <Skeleton lines={1} /> : topics.error ? <Banner tone="danger" title="Topic memberships could not be loaded" action={<Button onClick={() => void topics.refetch()}>Retry topic memberships</Button>}>{errorText(topics.error)}</Banner> : <>
        {!memberships.length && <EmptyState title="Not in a topic" />}
        <ul>{memberships.map(({ topic, project }) => <li key={topic.id}><Link to={`/projects/${project.id}?tab=knowledge`}>{project.name} / {topic.name}</Link>{(topic.archivedAt || project.archivedAt) && <Badge>Archived</Badge>}</li>)}</ul>
        {topics.hasNextPage && <Button size="sm" loading={topics.isFetchingNextPage} onClick={() => void topics.fetchNextPage()}>More topic memberships</Button>}
      </>}
    </section>
  </>
}
