import { useState, type FormEvent } from 'react'
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import type { Comment, Page, Task } from '../../shared/contracts'
import { client } from '../api'
import { Markdown } from './Markdown'
import { ActorBadge, ErrorMessage, Field, Loading, formatDate } from './ui'

export function Comments({ task }: { task: Task }) {
  const qc = useQueryClient()
  const query = useInfiniteQuery({
    queryKey: ['task', task.id, 'comments'],
    queryFn: ({ pageParam }) => client.tasks.comments(task.id, { limit: 100, cursor: pageParam }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  })
  const [body, setBody] = useState('')
  const add = useMutation({
    mutationFn: () => client.tasks.comment(task.id, body),
    onSuccess: () => {
      setBody('')
      void qc.invalidateQueries({ queryKey: ['task', task.id] })
    },
  })
  const comments = query.data?.pages.flatMap((p) => p.items) ?? []
  return (
    <section className="section" aria-labelledby="comments-heading">
      <h2 id="comments-heading">Comments</h2>
      {query.isLoading && <Loading />}
      {comments.length === 0 && !query.isLoading && <p className="muted">No comments yet.</p>}
      <ol className="comments">
        {comments.map((c) => (
          <li key={c.id} id={`comment-${c.id}`} className={c.kind === 'completion_summary' ? 'comment completion' : 'comment'}>
            <div className="comment-head small">
              <ActorBadge actor={c.author} />
              {c.kind === 'completion_summary' && <span className="pill pill-done">completion summary</span>}
              <time className="muted" dateTime={c.createdAt}>
                {formatDate(c.createdAt)}
              </time>
            </div>
            <Markdown source={c.body} />
          </li>
        ))}
      </ol>
      {query.hasNextPage && (
        <button type="button" onClick={() => void query.fetchNextPage()}>
          Load more comments
        </button>
      )}
      {task.archivedAt ? (
        <p className="muted small">Restore the task to comment.</p>
      ) : (
        <form
          className="stack"
          onSubmit={(e: FormEvent) => {
            e.preventDefault()
            if (body.trim()) add.mutate()
          }}
        >
          <Field label="Add a comment">
            {(id) => (
              <textarea
                id={id}
                value={body}
                rows={3}
                onChange={(e) => setBody(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && body.trim()) add.mutate()
                }}
              />
            )}
          </Field>
          <ErrorMessage error={add.error} />
          <div className="row">
            <button className="primary" type="submit" disabled={add.isPending || !body.trim()}>
              Comment
            </button>
            <span className="muted small">Markdown supported · Ctrl/⌘+Enter to send</span>
          </div>
        </form>
      )}
    </section>
  )
}

/** Human completion with an optional summary (agents must use complete_task with a summary). */
export function CompleteTask({ task }: { task: Task }) {
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [summary, setSummary] = useState('')
  const complete = useMutation({
    mutationFn: () => client.tasks.complete(task.id, summary.trim() || undefined),
    onSuccess: () => {
      setOpen(false)
      setSummary('')
      void qc.invalidateQueries({ queryKey: ['task', task.id] })
      void qc.invalidateQueries({ queryKey: ['tasks'] })
    },
  })
  if (task.status === 'done' || task.archivedAt) return null
  return (
    <div className="stack">
      {!open ? (
        <button type="button" className="primary" onClick={() => setOpen(true)}>
          Complete task…
        </button>
      ) : (
        <form
          className="stack"
          onSubmit={(e: FormEvent) => {
            e.preventDefault()
            complete.mutate()
          }}
        >
          <Field label="Completion summary (optional)">{(id) => <textarea id={id} rows={3} value={summary} onChange={(e) => setSummary(e.target.value)} autoFocus />}</Field>
          <ErrorMessage error={complete.error} />
          <div className="row">
            <button className="primary" type="submit" disabled={complete.isPending}>
              Mark done
            </button>
            <button type="button" onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  )
}
