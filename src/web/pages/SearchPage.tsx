import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useInfiniteQuery } from '@tanstack/react-query'
import type { Page, SearchResult } from '../../shared/contracts'
import { client } from '../api'
import { Highlight } from '../components/Highlight'
import { Empty, ErrorMessage, Field, Loading } from '../components/ui'

function resultLink(r: SearchResult): string {
  if (r.kind === 'document') return `/documents/${r.id}`
  if (r.kind === 'comment') return `/tasks/${r.taskId}#comment-${r.id}`
  return `/tasks/${r.id}`
}

const KIND_LABEL: Record<SearchResult['kind'], string> = { task: 'Task', document: 'Document', comment: 'Comment' }

export function SearchPage() {
  const [params, setParams] = useSearchParams()
  const q = params.get('q') ?? ''
  const kind = params.get('kind') ?? ''
  const [text, setText] = useState(q)
  useEffect(() => setText(q), [q])
  const query = useInfiniteQuery({
    queryKey: ['search', q, kind],
    enabled: q.trim().length > 0,
    queryFn: ({ pageParam }) => client.search({ q, kind, limit: 20, cursor: pageParam }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  })
  const results = query.data?.pages.flatMap((p) => p.items) ?? []
  return (
    <div className="page">
      <h1>Search</h1>
      <form
        role="search"
        className="inline-form"
        onSubmit={(e) => {
          e.preventDefault()
          setParams(text.trim() ? { q: text.trim(), ...(kind ? { kind } : {}) } : {})
        }}
      >
        <Field label="Search tasks, documents and comments">
          {(id) => <input id={id} type="search" value={text} onChange={(e) => setText(e.target.value)} autoFocus />}
        </Field>
        <Field label="Type">
          {(id) => (
            <select id={id} value={kind} onChange={(e) => setParams({ ...(q ? { q } : {}), ...(e.target.value ? { kind: e.target.value } : {}) })}>
              <option value="">Everything</option>
              <option value="task">Tasks</option>
              <option value="document">Documents</option>
              <option value="comment">Comments</option>
            </select>
          )}
        </Field>
        <button className="primary" type="submit">
          Search
        </button>
      </form>
      <ErrorMessage error={query.error} />
      {query.isLoading && q && <Loading />}
      {q && !query.isLoading && results.length === 0 && <Empty>No results for “{q}”.</Empty>}
      <ol className="results">
        {results.map((r) => (
          <li key={`${r.kind}-${r.id}`}>
            <div className="row">
              <span className="pill">{KIND_LABEL[r.kind]}</span>
              <Link to={resultLink(r)}>{r.title}</Link>
              {r.archived && <span className="pill pill-archived">archived</span>}
            </div>
            {r.snippet && (
              <p className="muted small snippet">
                <Highlight text={r.snippet} />
              </p>
            )}
          </li>
        ))}
      </ol>
      {query.hasNextPage && (
        <button type="button" onClick={() => void query.fetchNextPage()}>
          More results
        </button>
      )}
    </div>
  )
}
