import { useId, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, HandHelping, X } from 'lucide-react'
import type { ApprovalRequest, ApprovalStatus, Task } from '../../shared/contracts'
import { client } from '../api'
import { useMe } from '../auth'
import { formatDate } from '../components/ui'
import { useActors, useCapability } from '../hooks'
import { Avatar, Badge, Button, EmptyState, FieldMessage, Skeleton, TextField } from '../ui'
import { errorText } from './TaskDetail'

const STATUS_TONE: Record<ApprovalStatus, 'warning' | 'success' | 'danger' | 'neutral'> = { pending: 'warning', approved: 'success', rejected: 'danger', canceled: 'neutral' }
const STATUS_TEXT: Record<ApprovalStatus, string> = { pending: 'Waiting', approved: 'Approved', rejected: 'Rejected', canceled: 'Withdrawn' }

function useRefreshApprovals(taskId: string) {
  const qc = useQueryClient()
  return () => {
    void qc.invalidateQueries({ queryKey: ['approvals'] })
    void qc.invalidateQueries({ queryKey: ['task', taskId] })
    void qc.invalidateQueries({ queryKey: ['activity'] })
  }
}

/** Whether this person may decide: a person, not the asker, and asked (or anyone was asked, or owner). */
function canDecide(a: ApprovalRequest, me: { id: string; kind: string; isOwner: boolean }): boolean {
  if (a.status !== 'pending' || me.kind !== 'human' || a.requestedBy?.id === me.id) return false
  return !a.requestedOf || a.requestedOf.id === me.id || me.isOwner
}

/** One approval request, with Approve / Reject (and an optional note) for whoever may decide. */
export function ApprovalItem({ approval, showTask = false }: { approval: ApprovalRequest; showTask?: boolean }) {
  const me = useMe()
  const refresh = useRefreshApprovals(approval.task.id)
  const [note, setNote] = useState('')
  const decide = useMutation({
    mutationFn: (approve: boolean) => (approve ? client.approvals.approve(approval.id, note || undefined) : client.approvals.reject(approval.id, note || undefined)),
    onSuccess: refresh,
  })
  const withdraw = useMutation({ mutationFn: () => client.approvals.cancel(approval.id), onSuccess: refresh })
  const asker = approval.requestedBy
  const mayDecide = canDecide(approval, me)
  return (
    <li className="approval">
      <div className="approval-head">
        <Avatar name={asker?.displayName ?? 'System'} kind={asker?.kind ?? 'human'} size="sm" />
        <span className="approval-who">
          <strong>{asker?.displayName ?? 'System'}</strong>
          {asker?.kind === 'agent' && (
            <>
              {' '}
              <Badge tone="agent">Agent</Badge>
            </>
          )}{' '}
          asks{approval.requestedOf ? ` ${approval.requestedOf.id === me.id ? 'you' : approval.requestedOf.displayName}` : ''}
        </span>
        <Badge tone={STATUS_TONE[approval.status]}>{STATUS_TEXT[approval.status]}</Badge>
      </div>
      <p className="approval-question">{approval.question}</p>
      <p className="approval-meta">
        {showTask && (
          <>
            On <Link to={`/tasks/${approval.task.id}`}>{approval.task.title}</Link> ·{' '}
          </>
        )}
        <time dateTime={approval.createdAt}>{formatDate(approval.createdAt)}</time>
        {approval.decidedBy && (
          <>
            {' '}
            · {STATUS_TEXT[approval.status].toLowerCase()} by {approval.decidedBy.displayName}
            {approval.note && <> — “{approval.note}”</>}
          </>
        )}
      </p>
      {mayDecide && (
        <form className="approval-decide" aria-label={`Decide: ${approval.question}`} onSubmit={(e) => e.preventDefault()}>
          <TextField label="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} placeholder="Shown to whoever asked" />
          <div className="resource-actions">
            <Button size="sm" variant="primary" icon={Check} loading={decide.isPending && decide.variables === true} disabled={decide.isPending} onClick={() => decide.mutate(true)}>
              Approve
            </Button>
            <Button size="sm" icon={X} loading={decide.isPending && decide.variables === false} disabled={decide.isPending} onClick={() => decide.mutate(false)}>
              Reject
            </Button>
          </div>
        </form>
      )}
      {approval.status === 'pending' && asker?.id === me.id && (
        <Button size="sm" variant="ghost" loading={withdraw.isPending} onClick={() => withdraw.mutate()}>
          Withdraw
        </Button>
      )}
      {(decide.error || withdraw.error) && <FieldMessage tone="error">{errorText(decide.error ?? withdraw.error)}</FieldMessage>}
    </li>
  )
}

/** Home: pending requests this person may decide. */
export function WaitingForYou() {
  const enabled = useCapability('approvals')
  const pending = useQuery({ queryKey: ['approvals', 'for-me'], queryFn: () => client.approvals.list({ for: 'me' }), enabled })
  if (!enabled) return null
  const items = pending.data ?? []
  return (
    <section aria-labelledby="home-waiting" className="home-section">
      <h2 id="home-waiting" className="resource-panel-title">
        Waiting for you {items.length > 0 && <span className="ui-text-muted">{items.length}</span>}
      </h2>
      {pending.isLoading ? (
        <Skeleton lines={2} />
      ) : pending.error ? (
        <FieldMessage tone="error">{errorText(pending.error)}</FieldMessage>
      ) : items.length === 0 ? (
        <EmptyState icon={HandHelping} title="Nothing waiting for you">
          When an agent or a teammate asks for your approval, it appears here.
        </EmptyState>
      ) : (
        <ul className="approvals" aria-label="Waiting for you">
          {items.map((a) => (
            <ApprovalItem key={a.id} approval={a} showTask />
          ))}
        </ul>
      )}
    </section>
  )
}

/** Task Detail: this task's requests, and asking a person to approve. */
export function TaskApprovals({ task }: { task: Task }) {
  const enabled = useCapability('approvals')
  const me = useMe()
  const actors = useActors()
  const list = useQuery({ queryKey: ['approvals', 'task', task.id], queryFn: () => client.approvals.list({ taskId: task.id }), enabled })
  const refresh = useRefreshApprovals(task.id)
  const [asking, setAsking] = useState(false)
  const [question, setQuestion] = useState('')
  const [of, setOf] = useState('')
  const selectId = useId()
  const headingId = `approvals-${task.id}`
  const ask = useMutation({
    mutationFn: () => client.approvals.request(task.id, { question, ...(of ? { requestedOfId: of } : {}) }),
    onSuccess: () => {
      setQuestion('')
      setOf('')
      setAsking(false)
      refresh()
    },
  })
  if (!enabled) return null
  const items = list.data ?? []
  const people = (actors.data ?? []).filter((a) => a.kind === 'human' && !a.deactivatedAt && a.id !== me.id)
  return (
    <section className="task-section" aria-labelledby={headingId}>
      <h2 id={headingId} className="task-section-title">
        Approvals
      </h2>
      {list.isLoading ? (
        <Skeleton lines={1} />
      ) : items.length === 0 ? (
        <p className="ui-text-muted">No approval requests.</p>
      ) : (
        <ul className="approvals" aria-label="Approval requests">
          {items.map((a) => (
            <ApprovalItem key={a.id} approval={a} />
          ))}
        </ul>
      )}
      {!task.archivedAt &&
        (asking ? (
          <form
            className="resource-form"
            aria-label="Ask for approval"
            onSubmit={(e: FormEvent) => {
              e.preventDefault()
              if (question.trim()) ask.mutate()
            }}
          >
            <TextField label="What needs approval?" value={question} onChange={(e) => setQuestion(e.target.value)} maxLength={2000} autoFocus />
            <div className="ui-field">
              <label className="ui-field-label" htmlFor={selectId}>
                Who should decide?
              </label>
              <select id={selectId} className="ui-input ui-select" value={of} onChange={(e) => setOf(e.target.value)}>
                <option value="">Anyone</option>
                {people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.displayName}
                  </option>
                ))}
              </select>
            </div>
            {ask.error && <FieldMessage tone="error">{errorText(ask.error)}</FieldMessage>}
            <div className="resource-actions">
              <Button size="sm" variant="primary" type="submit" loading={ask.isPending} disabled={!question.trim()}>
                Ask
              </Button>
              <Button size="sm" onClick={() => setAsking(false)}>
                Cancel
              </Button>
            </div>
          </form>
        ) : (
          <div>
            <Button size="sm" icon={HandHelping} onClick={() => setAsking(true)}>
              Ask for approval
            </Button>
          </div>
        ))}
    </section>
  )
}
