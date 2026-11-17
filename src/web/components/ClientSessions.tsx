import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { client } from '../api'
import { useMe } from '../auth'
import { ActorBadge, Empty, ErrorMessage, Loading, formatDate } from './ui'

const KIND_LABEL = { desktop: 'Desktop', cli: 'CLI' } as const

/** Desktop and CLI sessions: a human sees their own, the owner sees everyone's. Each can be revoked. */
export function ClientSessions({ title }: { title: string }) {
  const me = useMe()
  const qc = useQueryClient()
  const sessions = useQuery({ queryKey: ['client-sessions'], queryFn: () => client.clientSessions.list() })
  const revoke = useMutation({
    mutationFn: (id: string) => client.clientSessions.revoke(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['client-sessions'] }),
  })
  return (
    <section className="panel" aria-labelledby="client-sessions-heading">
      <h2 id="client-sessions-heading">{title}</h2>
      <ErrorMessage error={sessions.error ?? revoke.error} />
      {sessions.isLoading ? (
        <Loading />
      ) : !sessions.data?.length ? (
        <Empty>No Desktop or CLI sessions are signed in.</Empty>
      ) : (
        <table className="table">
          <thead>
            <tr>
              {me.isOwner && <th>Person</th>}
              <th>Client</th>
              <th>Device</th>
              <th>Signed in</th>
              <th>Last used</th>
              <th>
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {sessions.data.map((s) => (
              <tr key={s.id}>
                {me.isOwner && (
                  <td>
                    <ActorBadge actor={s.actor} />
                  </td>
                )}
                <td>
                  {KIND_LABEL[s.clientKind]} · {s.clientName} {s.clientVersion}
                </td>
                <td>{s.deviceName}</td>
                <td>{formatDate(s.createdAt)}</td>
                <td>{formatDate(s.lastUsedAt)}</td>
                <td className="actions">
                  <button type="button" disabled={revoke.isPending} onClick={() => revoke.mutate(s.id)} aria-label={`Revoke ${s.clientName} on ${s.deviceName}`}>
                    Revoke
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}
