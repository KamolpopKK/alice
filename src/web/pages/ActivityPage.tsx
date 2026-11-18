import { useId } from 'react'
import { keepPreviousData, useInfiniteQuery } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { client } from '../api'
import { ActivityList } from '../components/Activity'
import { useActors } from '../hooks'
import { errorText } from '../tasks/TaskDetail'
import { Banner, Button, EmptyState, SelectField, Skeleton } from '../ui'

const RESOURCES = [
  { value: '', label: 'Everything' },
  { value: 'task', label: 'Tasks' },
  { value: 'project', label: 'Projects' },
  { value: 'document', label: 'Documents' },
]

/** Activity: the audit trail of what people and agents changed, filterable by who and by what. */
export function ActivityPage() {
  const [params, setParams] = useSearchParams()
  const actorId = params.get('actorId') ?? ''
  const resourceType = params.get('resourceType') ?? ''
  const actors = useActors()
  const whoId = useId()
  const query = useInfiniteQuery({
    queryKey: ['activity', 'feed', actorId, resourceType],
    queryFn: ({ pageParam }) => client.activity({ limit: 50, cursor: pageParam, ...(actorId ? { actorId } : {}), ...(resourceType ? { resourceType } : {}) }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    placeholderData: keepPreviousData,
  })
  const set = (key: string, value: string) =>
    setParams(
      (p) => {
        const n = new URLSearchParams(p)
        if (value) n.set(key, value)
        else n.delete(key)
        return n
      },
      { replace: true },
    )
  const people = (actors.data ?? []).filter((a) => a.kind === 'human')
  const agents = (actors.data ?? []).filter((a) => a.kind === 'agent')
  const events = query.data?.pages.flatMap((p) => p.items) ?? []
  return (
    <div className="page resource-page">
      <div className="resource-head">
        <div>
          <h1>Activity</h1>
          <p className="resource-meta">Everything people and agents changed, newest first.</p>
        </div>
      </div>
      <form className="resource-toolbar" aria-label="Filter activity" onSubmit={(e) => e.preventDefault()}>
        <div className="activity-filter">
          <div className="ui-field">
            <label className="ui-field-label" htmlFor={whoId}>
              Who
            </label>
            <select id={whoId} className="ui-input ui-select" value={actorId} onChange={(e) => set('actorId', e.target.value)}>
              <option value="">Everyone</option>
              <optgroup label="People">
                {people.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.displayName}
                  </option>
                ))}
              </optgroup>
              <optgroup label="Agents">
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.displayName}
                  </option>
                ))}
              </optgroup>
            </select>
          </div>
        </div>
        <div className="activity-filter">
          <SelectField label="What" value={resourceType} options={RESOURCES} onChange={(e) => set('resourceType', e.target.value)} />
        </div>
      </form>
      {query.error && !query.data ? (
        <Banner tone="danger" title="Activity could not be loaded" action={<Button size="sm" onClick={() => void query.refetch()}>Try again</Button>}>
          {errorText(query.error)}
        </Banner>
      ) : query.isLoading ? (
        <Skeleton lines={6} />
      ) : events.length === 0 ? (
        <EmptyState title="No activity matches">Change who or what to see more.</EmptyState>
      ) : (
        <div className="resource-panel">
          <ActivityList events={events} showResource />
        </div>
      )}
      {query.hasNextPage && (
        <Button size="sm" loading={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>
          Load more
        </Button>
      )}
    </div>
  )
}
