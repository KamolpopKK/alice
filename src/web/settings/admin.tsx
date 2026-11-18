import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Copy, KeyRound, Plus, RotateCw, UserPlus } from 'lucide-react'
import type { AgentTokenInfo, PublicActor } from '../../shared/contracts'
import { client } from '../api'
import { ClientSessions } from '../components/ClientSessions'
import { formatDate } from '../components/ui'
import { errorText } from '../tasks/TaskDetail'
import { Avatar, Badge, Banner, Button, ConfirmDialog, EmptyState, FieldMessage, SectionHeader, Skeleton, Table, TextField } from '../ui'

type AgentRow = PublicActor & { tokens: AgentTokenInfo[] }

/**
 * A secret shown exactly once (invite link or agent token). It is never stored in the page state
 * after Done, never logged, and never shown again by the server.
 */
function SecretReveal({ label, value, onDismiss }: { label: string; value: string; onDismiss: () => void }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="secret-reveal" role="status">
      <p>
        <strong>{label}</strong> — copy it now. It will not be shown again.
      </p>
      <code className="secret-value" data-testid="secret-value">
        {value}
      </code>
      <div className="resource-actions">
        <Button
          size="sm"
          icon={Copy}
          onClick={async () => {
            await navigator.clipboard?.writeText(value)
            setCopied(true)
          }}
        >
          {copied ? 'Copied' : 'Copy'}
        </Button>
        <Button size="sm" variant="primary" onClick={onDismiss}>
          Done
        </Button>
      </div>
    </div>
  )
}

function Invites() {
  const qc = useQueryClient()
  const invites = useQuery({ queryKey: ['invites'], queryFn: () => client.invites.list().then((items) => ({ items })) })
  const [note, setNote] = useState('')
  const [url, setUrl] = useState<string | null>(null)
  const create = useMutation({
    mutationFn: () => client.invites.create({ note }),
    onSuccess: (res) => {
      setUrl(res.url)
      setNote('')
      void qc.invalidateQueries({ queryKey: ['invites'] })
    },
  })
  const revoke = useMutation({
    mutationFn: (id: string) => client.invites.revoke(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['invites'] }),
  })
  return (
    <section className="resource-panel" aria-labelledby="invites-heading">
      <SectionHeader title={<span id="invites-heading">Invite people</span>} level={3} description="Each link works once and expires." />
      <form
        className="settings-inline-form"
        onSubmit={(e: FormEvent) => {
          e.preventDefault()
          create.mutate()
        }}
      >
        <TextField label="Note (optional)" placeholder="Who is this for?" value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} />
        <Button variant="primary" type="submit" icon={UserPlus} loading={create.isPending}>
          Create invite link
        </Button>
      </form>
      {(create.error || revoke.error) && <FieldMessage tone="error">{errorText(create.error ?? revoke.error)}</FieldMessage>}
      {url && <SecretReveal label="One-time invite link" value={url} onDismiss={() => setUrl(null)} />}
      {invites.isLoading ? (
        <Skeleton lines={2} />
      ) : !invites.data?.items.length ? (
        <EmptyState title="No invites yet" />
      ) : (
        <Table caption="Invites">
          <thead>
            <tr>
              <th scope="col">Note</th>
              <th scope="col">Status</th>
              <th scope="col">Expires</th>
              <th scope="col">
                <span className="ui-visually-hidden">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {invites.data.items.map((i) => (
              <tr key={i.id}>
                <td>{i.note || <span className="ui-text-muted">—</span>}</td>
                <td>
                  <Badge tone={i.status === 'pending' ? 'info' : i.status === 'used' ? 'success' : 'neutral'}>{i.status}</Badge>
                </td>
                <td>{formatDate(i.expiresAt)}</td>
                <td>
                  {i.status === 'pending' && (
                    <Button size="sm" variant="ghost" onClick={() => revoke.mutate(i.id)} aria-label={`Revoke invite${i.note ? ` for ${i.note}` : ''}`}>
                      Revoke
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </section>
  )
}

type Pending = { kind: 'deactivate'; agent: AgentRow } | { kind: 'revoke'; agent: AgentRow; token: AgentTokenInfo } | null

function Agents() {
  const qc = useQueryClient()
  const agents = useQuery({ queryKey: ['agents'], queryFn: () => client.agents.list().then((items) => ({ items: items as AgentRow[] })) })
  const [name, setName] = useState('')
  const [secret, setSecret] = useState<{ label: string; value: string } | null>(null)
  const [pending, setPending] = useState<Pending>(null)
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['agents'] })
    void qc.invalidateQueries({ queryKey: ['actors'] })
  }
  const create = useMutation({
    mutationFn: () => client.agents.create({ displayName: name }),
    onSuccess: (res) => {
      setSecret({ label: `Token for ${res.agent.displayName}`, value: res.plaintextToken })
      setName('')
      refresh()
    },
  })
  const rotate = useMutation({
    mutationFn: (tokenId: string) => client.agents.rotateToken(tokenId),
    onSuccess: (res) => {
      setSecret({ label: `New token for ${res.agent.displayName}`, value: res.plaintextToken })
      refresh()
    },
  })
  const issue = useMutation({
    mutationFn: (agentId: string) => client.agents.issueToken(agentId, `token-${new Date().toISOString().slice(0, 10)}`),
    onSuccess: (res) => {
      setSecret({ label: `Additional token for ${res.agent.displayName}`, value: res.plaintextToken })
      refresh()
    },
  })
  const revoke = useMutation({ mutationFn: (tokenId: string) => client.agents.revokeToken(tokenId), onSuccess: refresh })
  const deactivate = useMutation({ mutationFn: (agentId: string) => client.agents.deactivate(agentId), onSuccess: refresh })
  const error = create.error ?? rotate.error ?? issue.error

  return (
    <section className="resource-panel" aria-labelledby="agents-heading">
      <SectionHeader
        title={<span id="agents-heading">Agents</span>}
        level={3}
        description="Each agent gets its own identity and bearer token for the MCP endpoint. Only a hash of each token is stored."
      />
      <p className="resource-meta">
        MCP endpoint: <code>{`${window.location.origin}/mcp/v1`}</code> (Streamable HTTP, <code>Authorization: Bearer &lt;token&gt;</code>)
      </p>
      <form
        className="settings-inline-form"
        onSubmit={(e: FormEvent) => {
          e.preventDefault()
          create.mutate()
        }}
      >
        <TextField label="Agent name" placeholder="e.g. Codex — backend" value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} />
        <Button variant="primary" type="submit" icon={Plus} loading={create.isPending}>
          Create agent
        </Button>
      </form>
      {error && <FieldMessage tone="error">{errorText(error)}</FieldMessage>}
      {secret && <SecretReveal label={secret.label} value={secret.value} onDismiss={() => setSecret(null)} />}
      {agents.isLoading ? (
        <Skeleton lines={3} />
      ) : !agents.data?.items.length ? (
        <EmptyState title="No agents yet">Create one above, then follow Agents to connect it.</EmptyState>
      ) : (
        <ul className="settings-agents">
          {agents.data.items.map((agent) => (
            <li key={agent.id} className="settings-agent">
              <div className="settings-agent-head">
                <span className="resource-meta-row">
                  <Avatar name={agent.displayName} kind="agent" size="sm" />
                  <strong>{agent.displayName}</strong>
                  {agent.deactivatedAt && <Badge>deactivated</Badge>}
                </span>
                {!agent.deactivatedAt && (
                  <span className="resource-actions">
                    <Button size="sm" icon={KeyRound} loading={issue.isPending && issue.variables === agent.id} onClick={() => issue.mutate(agent.id)}>
                      New token
                    </Button>
                    <Button size="sm" variant="danger" onClick={() => setPending({ kind: 'deactivate', agent })}>
                      Deactivate
                    </Button>
                  </span>
                )}
              </div>
              <Table caption={`Tokens for ${agent.displayName}`}>
                <thead>
                  <tr>
                    <th scope="col">Token</th>
                    <th scope="col">Last used</th>
                    <th scope="col">Status</th>
                    <th scope="col">
                      <span className="ui-visually-hidden">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {agent.tokens.map((t) => (
                    <tr key={t.id}>
                      <td>
                        {t.name} <code className="ui-text-muted">{t.hint}</code>
                      </td>
                      <td>{formatDate(t.lastUsedAt)}</td>
                      <td>{t.revokedAt ? <Badge>revoked</Badge> : <Badge tone="success">active</Badge>}</td>
                      <td>
                        {!t.revokedAt && !agent.deactivatedAt && (
                          <span className="resource-actions">
                            <Button size="sm" icon={RotateCw} onClick={() => rotate.mutate(t.id)} aria-label={`Rotate ${t.name} of ${agent.displayName}`}>
                              Rotate
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => setPending({ kind: 'revoke', agent, token: t })} aria-label={`Revoke ${t.name} of ${agent.displayName}`}>
                              Revoke
                            </Button>
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog
        open={pending !== null}
        onOpenChange={(o) => !o && setPending(null)}
        title={pending?.kind === 'deactivate' ? `Deactivate ${pending.agent.displayName}?` : `Revoke this token?`}
        confirmLabel={pending?.kind === 'deactivate' ? 'Deactivate agent' : 'Revoke token'}
        destructive
        busy={deactivate.isPending || revoke.isPending}
        error={(deactivate.error || revoke.error) && <FieldMessage tone="error">{errorText(deactivate.error ?? revoke.error)}</FieldMessage>}
        onConfirm={() => {
          if (!pending) return
          const done = { onSuccess: () => setPending(null) }
          if (pending.kind === 'deactivate') deactivate.mutate(pending.agent.id, done)
          else revoke.mutate(pending.token.id, done)
        }}
      >
        {pending?.kind === 'deactivate'
          ? 'All of its tokens stop working at once. Its past work stays attributed to it. This cannot be undone.'
          : pending
            ? `Anything using “${pending.token.name}” for ${pending.agent.displayName} loses access immediately. Other tokens keep working.`
            : null}
      </ConfirmDialog>
    </section>
  )
}

/** Owner-only administration inside Settings (Remote workspaces). The server checks the role on every call. */
export function AdminSection() {
  return (
    <div className="settings-stack">
      <Banner tone="info">Only you, as the workspace owner, can see this section.</Banner>
      <Invites />
      <Agents />
      <ClientSessions title="Desktop and CLI sessions" />
    </div>
  )
}
