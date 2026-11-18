import { useState, type FormEvent } from 'react'
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import type { Comment, Page, Task } from '../../shared/contracts'
import { client } from '../api'
import { Markdown } from './Markdown'
import { ActorBadge, ErrorMessage, formatDate } from './ui'
import { Badge, Button, Skeleton, TextArea } from '../ui'

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
    <section className="task-section" aria-labelledby={`comments-${task.id}`}>
      <h2 id={`comments-${task.id}`} className="task-section-title">
        Comments
      </h2>
      {query.isLoading && <Skeleton lines={2} />}
      {comments.length === 0 && !query.isLoading && <p className="ui-text-muted">No comments yet.</p>}
      <ol className="comments">
        {comments.map((c) => (
          <li key={c.id} id={`comment-${c.id}`} className={c.kind === 'completion_summary' ? 'comment completion' : 'comment'}>
            <div className="comment-head small">
              <ActorBadge actor={c.author} />
              {c.kind === 'completion_summary' && <Badge tone="success">completion summary</Badge>}
              <time className="muted" dateTime={c.createdAt}>
                {formatDate(c.createdAt)}
              </time>
            </div>
            <Markdown source={c.body} />
          </li>
        ))}
      </ol>
      {query.hasNextPage && (
        <Button size="sm" loading={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>
          Load more comments
        </Button>
      )}
      {task.archivedAt ? (
        <p className="ui-text-muted">Restore the task to comment.</p>
      ) : (
        <form
          className="stack"
          onSubmit={(e: FormEvent) => {
            e.preventDefault()
            if (body.trim()) add.mutate()
          }}
        >
          <TextArea
            label="Add a comment"
            hint="Markdown supported · Ctrl/⌘+Enter to send"
            value={body}
            rows={3}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && body.trim()) add.mutate()
            }}
          />
          <ErrorMessage error={add.error} />
          <div className="task-edit-actions">
            <Button variant="primary" type="submit" loading={add.isPending} disabled={!body.trim()}>
              Comment
            </Button>
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
        <Button variant="primary" onClick={() => setOpen(true)}>
          Complete task…
        </Button>
      ) : (
        <form
          className="stack"
          onSubmit={(e: FormEvent) => {
            e.preventDefault()
            complete.mutate()
          }}
        >
          <TextArea label="Completion summary (optional)" rows={3} value={summary} onChange={(e) => setSummary(e.target.value)} autoFocus />
          <ErrorMessage error={complete.error} />
          <div className="task-edit-actions">
            <Button variant="primary" type="submit" loading={complete.isPending}>
              Mark done
            </Button>
            <Button onClick={() => setOpen(false)}>Cancel</Button>
          </div>
        </form>
      )}
    </div>
  )
}
