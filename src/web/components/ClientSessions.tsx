import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { client } from '../api'
import { useMe } from '../auth'
import { errorText } from '../tasks/TaskDetail'
import { Button, EmptyState, FieldMessage, SectionHeader, Skeleton, Table } from '../ui'
import { ActorBadge, formatDate } from './ui'

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
    <section className="resource-panel" aria-labelledby="client-sessions-heading">
      <SectionHeader title={<span id="client-sessions-heading">{title}</span>} level={3} />
      {(sessions.error || revoke.error) && <FieldMessage tone="error">{errorText(sessions.error ?? revoke.error)}</FieldMessage>}
      {sessions.isLoading ? (
        <Skeleton lines={2} />
      ) : !sessions.data?.length ? (
        <EmptyState title="No Desktop or CLI sessions are signed in." />
      ) : (
        <Table caption={title}>
          <thead>
            <tr>
              {me.isOwner && <th scope="col">Person</th>}
              <th scope="col">Client</th>
              <th scope="col">Device</th>
              <th scope="col">Signed in</th>
              <th scope="col">Last used</th>
              <th scope="col">
                <span className="ui-visually-hidden">Actions</span>
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
                <td>
                  <Button size="sm" variant="ghost" loading={revoke.isPending && revoke.variables === s.id} onClick={() => revoke.mutate(s.id)} aria-label={`Revoke ${s.clientName} on ${s.deviceName}`}>
                    Revoke
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </section>
  )
}
