import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { keepPreviousData, useInfiniteQuery } from '@tanstack/react-query'
import { Search } from 'lucide-react'
import { client } from '../api'
import { DocumentFilters, type DocumentFilterKey } from '../components/DocumentFilters'
import { SEARCH_KIND, SearchResultItem } from '../search/results'
import { errorText } from '../tasks/TaskDetail'
import { Banner, Button, EmptyState, ResourceList, SelectField, Skeleton, TextField } from '../ui'

/** Full Search: the same result language as the command palette, with type filtering and paging. */
export function SearchPage() {
  const [params, setParams] = useSearchParams()
  const q = params.get('q') ?? ''
  const kind = params.get('kind') ?? ''
  const [text, setText] = useState(q)
  const filters: Partial<Record<DocumentFilterKey, string>> = {
    tag: params.get('tag') ?? '',
    status: params.get('status') ?? '',
    ownerId: params.get('ownerId') ?? '',
    projectId: params.get('projectId') ?? '',
  }
  useEffect(() => setText(q), [q])
  const query = useInfiniteQuery({
    queryKey: ['search', q, kind, filters],
    enabled: q.trim().length > 0,
    queryFn: ({ pageParam }) => client.search({ q, kind, ...filters, limit: 20, cursor: pageParam }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    placeholderData: keepPreviousData,
  })
  const results = query.data?.pages.flatMap((p) => p.items) ?? []
  const update = (key: string, value: string) => {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value)
    else next.delete(key)
    setParams(next, { replace: true })
  }
  const clearDocumentFilters = () => {
    const next = new URLSearchParams(params)
    for (const key of ['tag', 'status', 'ownerId', 'projectId']) next.delete(key)
    setParams(next, { replace: true })
  }
  return (
    <div className="page resource-page">
      <div className="resource-head">
        <h1>Search</h1>
      </div>
      <form
        role="search"
        className="resource-toolbar"
        onSubmit={(e) => {
          e.preventDefault()
          const next = new URLSearchParams(params)
          if (text.trim()) next.set('q', text.trim())
          else next.delete('q')
          setParams(next)
        }}
      >
        <div className="resource-toolbar-search">
          <TextField label="Search tasks, documents and comments" type="search" value={text} onChange={(e) => setText(e.target.value)} autoFocus />
        </div>
        <SelectField
          label="Type"
          value={kind}
          onChange={(e) => update('kind', e.target.value)}
          options={[{ value: '', label: 'Everything' }, ...Object.entries(SEARCH_KIND).map(([value, k]) => ({ value, label: k.plural }))]}
        />
        <Button variant="primary" type="submit" icon={Search} className="resource-toolbar-submit">
          Search
        </Button>
        <DocumentFilters values={filters} onChange={update} onClear={clearDocumentFilters} />
      </form>
      {query.error && !query.data ? (
        <Banner tone="danger" title="Search did not finish" action={<Button size="sm" onClick={() => void query.refetch()}>Try again</Button>}>
          {errorText(query.error)}
        </Banner>
      ) : !q ? (
        <EmptyState icon={Search} title="Search everything you can see">Tasks, documents and comments, including archived ones.</EmptyState>
      ) : query.isLoading ? (
        <Skeleton lines={4} />
      ) : results.length === 0 ? (
        <EmptyState title={`No results for “${q}”.`}>Try fewer or different words.</EmptyState>
      ) : (
        <>
          <p className="tasks-count ui-text-muted" aria-live="polite">
            {results.length}
            {query.hasNextPage ? '+' : ''} result{results.length === 1 ? '' : 's'}
          </p>
          <ResourceList label="Search results" layout="list" ordered className="results">
            {results.map((r) => (
              <SearchResultItem key={`${r.kind}-${r.id}`} result={r} />
            ))}
          </ResourceList>
        </>
      )}
      {query.hasNextPage && (
        <Button size="sm" loading={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>
          More results
        </Button>
      )}
    </div>
  )
}
