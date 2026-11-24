import { KnowledgeSearch } from './KnowledgeSearch'
import { TopicReadingList } from './TopicReadingList'
import { useRef, useState, type FormEvent } from 'react'
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import type { KnowledgeTopic } from '../../shared/contracts'
import { newIdempotencyKey } from '../../client/client'
import { client } from '../api'
import { errorText } from '../tasks/TaskDetail'
import { Banner, Button, EmptyState, Skeleton, TextArea, TextField } from '../ui'

type Change = {
  action: 'create' | 'update' | 'archive' | 'restore'
  topic?: KnowledgeTopic
  name?: string
  description?: string
}

export function ProjectKnowledge({ projectId, archived: projectArchived }: {
  projectId: string
  archived: boolean
}) {
  const qc = useQueryClient()
  const [archived, setArchived] = useState(false)
  const [editing, setEditing] = useState<KnowledgeTopic | null>(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const attempt = useRef<{
    signature: string
    id: string
  } | null>(null)
  const topics = useInfiniteQuery({
    queryKey: ['knowledge-topics', projectId, archived], initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => client.knowledge.topics(projectId, { archived: archived ? 'archived' : 'active', cursor: pageParam }),
    getNextPageParam: (page) => page.nextCursor ?? undefined
  })
  const reset = () => {
    setEditing(null)
    setName('')
    setDescription('')
    attempt.current = null
  }
  const change = useMutation({
    mutationFn: async (input: Change) => {
      const signature = JSON.stringify(input)
      if (attempt.current?.signature !== signature) attempt.current = { signature, id: newIdempotencyKey() }
      const mutationId = attempt.current.id
      if (input.action === 'create') return client.knowledge.createTopic(projectId, { name: input.name!, description: input.description ?? '', mutationId })
      const t = input.topic!
      const guard = { expectedRevision: t.revision, mutationId }
      if (input.action === 'update') return client.knowledge.updateTopic(t.id, { ...guard, name: input.name, description: input.description })
      return client.knowledge.archiveTopic(t.id, input.action === 'archive', guard)
    }, onSuccess: () => {
      reset()
      void qc.invalidateQueries({ queryKey: ['knowledge-topics', projectId] })
    }
  })
  const submit = (e: FormEvent) => {
    e.preventDefault()
    change.mutate({ action: editing ? 'update' : 'create', topic: editing ?? undefined, name, description })
  }
  return <section aria-label="Project knowledge">
    <div className="row spread"><h2>Knowledge</h2><Button onClick={() => {
      setArchived(!archived)
      reset()
      change.reset()
    }}>{archived ? 'Show active topics' : 'Show archived topics'}</Button></div>
    <p>Choose a topic to find the starting documents. Curated knowledge is not automatically reviewed.</p>
    <KnowledgeSearch projectId={projectId} topics={topics.data?.pages.flatMap((p) => p.items) ?? []} />
    {!projectArchived && !archived && <form aria-label={editing ? 'Edit knowledge topic' : 'New knowledge topic'} onSubmit={submit} className="resource-form">
      <TextField disabled={change.isPending} label="Topic name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={200} />
      <TextArea disabled={change.isPending} label="Topic description" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} />
      <div className="row"><Button type="submit" variant="primary" loading={change.isPending}>{editing ? 'Save topic' : 'Create topic'}</Button>{editing && <Button onClick={() => {
        reset()
        change.reset()
      }}>Cancel editing</Button>}</div>
    </form>}
    {change.error && <Banner tone="danger" title="Topic change was not confirmed" action={<Button onClick={() => void topics.refetch()}>Reload topics</Button>}>{errorText(change.error)} Reload after a conflict; retry an unchanged save after a network error.</Banner>}
    {topics.isLoading ? <Skeleton lines={3} /> : topics.error ? <Banner tone="danger" title="Topics could not be loaded" action={<Button onClick={() => void topics.refetch()}>Try again</Button>}>{errorText(topics.error)}</Banner> : <>
      {!topics.data?.pages.some((p) => p.items.length) && <EmptyState title={archived ? 'No archived topics' : 'No knowledge topics yet'}>Create a topic, then choose existing documents as a reading list.</EmptyState>}
      {topics.data?.pages.flatMap((p) => p.items).map((t) => <section key={t.id} className="resource-panel" aria-label={`Topic ${t.name}`}>
        <TopicReadingList topic={t} readOnly={projectArchived || !!t.archivedAt} /><h3>{t.name}</h3><p>{t.description || 'No description.'}</p><p>Revision {t.revision}{t.archivedAt ? ' · Archived' : ''}</p>
        {!projectArchived && <div className="row">{!t.archivedAt && <Button disabled={change.isPending} onClick={() => {
          setEditing(t)
          setName(t.name)
          setDescription(t.description)
          change.reset()
          attempt.current = null
        }}>Edit topic {t.name}</Button>}
          <Button disabled={change.isPending} onClick={() => change.mutate({ action: t.archivedAt ? 'restore' : 'archive', topic: t })}>{t.archivedAt ? 'Restore' : 'Archive'} topic {t.name}</Button></div>}
      </section>)}
      {topics.hasNextPage && <Button loading={topics.isFetchingNextPage} onClick={() => void topics.fetchNextPage()}>Load more topics</Button>}
    </>}
  </section>
}
