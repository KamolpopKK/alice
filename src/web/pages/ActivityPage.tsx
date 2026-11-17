import { useInfiniteQuery } from '@tanstack/react-query'
import type { ActivityEvent, Page } from '../../shared/contracts'
import { client } from '../api'
import { ActivityList } from '../components/Activity'
import { ErrorMessage, Loading } from '../components/ui'

export function ActivityPage() {
  const query = useInfiniteQuery({
    queryKey: ['activity', 'feed'],
    queryFn: ({ pageParam }) => client.activity({ limit: 50, cursor: pageParam }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  })
  return (
    <div className="page">
      <h1>Recent activity</h1>
      <p className="muted">Everything people and agents changed, newest first.</p>
      <ErrorMessage error={query.error} />
      {query.isLoading ? <Loading /> : <ActivityList events={query.data?.pages.flatMap((p) => p.items) ?? []} showResource />}
      {query.hasNextPage && (
        <button type="button" onClick={() => void query.fetchNextPage()} disabled={query.isFetchingNextPage}>
          Load more
        </button>
      )}
    </div>
  )
}
