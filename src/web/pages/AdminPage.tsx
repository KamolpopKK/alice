import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { AgentTokenInfo, InviteInfo, PublicActor } from '../../shared/contracts'
import { ClientSessions } from '../components/ClientSessions'
import { client } from '../api'
import { ErrorMessage, Loading, TextInput, formatDate } from '../components/ui'

type AgentRow = PublicActor & { tokens: AgentTokenInfo[] }

function SecretReveal({ label, value, onDismiss }: { label: string; value: string; onDismiss: () => void }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="secret" role="status">
      <p>
        <strong>{label}</strong> — copy it now. It will not be shown again.
      </p>
      <code className="secret-value" data-testid="secret-value">
        {value}
      </code>
      <div className="row">
        <button
          type="button"
          onClick={async () => {
            await navigator.clipboard?.writeText(value)
            setCopied(true)
          }}
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
        <button type="button" onClick={onDismiss}>
          Done
        </button>
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
    <section className="panel" aria-labelledby="invites-heading">
      <h2 id="invites-heading">Invite people</h2>
      <form
        className="inline-form"
        onSubmit={(e: FormEvent) => {
          e.preventDefault()
          create.mutate()
        }}
      >
        <TextInput label="Note (optional)" placeholder="Who is this for?" value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} />
        <button className="primary" type="submit" disabled={create.isPending}>
          Create invite link
        </button>
      </form>
      <ErrorMessage error={create.error} />
      {url && <SecretReveal label="One-time invite link" value={url} onDismiss={() => setUrl(null)} />}
      {invites.isLoading ? (
        <Loading />
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Note</th>
              <th>Status</th>
              <th>Expires</th>
              <th>
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {invites.data?.items.map((i) => (
              <tr key={i.id}>
                <td>{i.note || <span className="muted">—</span>}</td>
                <td>
                  <span className={`pill pill-${i.status}`}>{i.status}</span>
                </td>
                <td>{formatDate(i.expiresAt)}</td>
                <td className="actions">
                  {i.status === 'pending' && (
                    <button type="button" onClick={() => revoke.mutate(i.id)}>
                      Revoke
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}

function Agents() {
  const qc = useQueryClient()
  const agents = useQuery({ queryKey: ['agents'], queryFn: () => client.agents.list().then((items) => ({ items })) })
  const [name, setName] = useState('')
  const [secret, setSecret] = useState<{ label: string; value: string } | null>(null)
  const refresh = () => qc.invalidateQueries({ queryKey: ['agents'] })
  const create = useMutation({
    mutationFn: () => client.agents.create({ displayName: name }),
    onSuccess: (res) => {
      setSecret({ label: `Token for ${res.agent.displayName}`, value: res.plaintextToken })
      setName('')
      void refresh()
      void qc.invalidateQueries({ queryKey: ['actors'] })
    },
  })
  const rotate = useMutation({
    mutationFn: (tokenId: string) => client.agents.rotateToken(tokenId),
    onSuccess: (res) => {
      setSecret({ label: `New token for ${res.agent.displayName}`, value: res.plaintextToken })
      void refresh()
    },
  })
  const issue = useMutation({
    mutationFn: (agentId: string) => client.agents.issueToken(agentId, `token-${new Date().toISOString().slice(0, 10)}`),
    onSuccess: (res) => {
      setSecret({ label: `Additional token for ${res.agent.displayName}`, value: res.plaintextToken })
      void refresh()
    },
  })
  const revoke = useMutation({ mutationFn: (tokenId: string) => client.agents.revokeToken(tokenId), onSuccess: refresh })
  const deactivate = useMutation({ mutationFn: (agentId: string) => client.agents.deactivate(agentId), onSuccess: refresh })

  return (
    <section className="panel" aria-labelledby="agents-heading">
      <h2 id="agents-heading">Agents</h2>
      <p className="muted">Each agent gets its own identity and bearer token for the MCP endpoint. Only a hash of the token is stored.</p>
      <p className="small">
        MCP endpoint: <code>{`${window.location.origin}/mcp/v1`}</code> (Streamable HTTP, <code>Authorization: Bearer &lt;token&gt;</code>)
      </p>
      <form
        className="inline-form"
        onSubmit={(e: FormEvent) => {
          e.preventDefault()
          create.mutate()
        }}
      >
        <TextInput label="Agent name" placeholder="e.g. Codex — backend" value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} />
        <button className="primary" type="submit" disabled={create.isPending}>
          Create agent
        </button>
      </form>
      <ErrorMessage error={create.error ?? rotate.error ?? revoke.error ?? issue.error ?? deactivate.error} />
      {secret && <SecretReveal label={secret.label} value={secret.value} onDismiss={() => setSecret(null)} />}
      {agents.isLoading ? (
        <Loading />
      ) : (
        <ul className="agent-list">
          {agents.data?.items.map((agent) => (
            <li key={agent.id} className="agent-card">
              <div className="row spread">
                <strong>{agent.displayName}</strong>
                {agent.deactivatedAt ? (
                  <span className="pill pill-revoked">deactivated</span>
                ) : (
                  <div className="row">
                    <button type="button" onClick={() => issue.mutate(agent.id)}>
                      New token
                    </button>
                    <button type="button" className="danger" onClick={() => confirm(`Deactivate ${agent.displayName}? All its tokens will be revoked.`) && deactivate.mutate(agent.id)}>
                      Deactivate
                    </button>
                  </div>
                )}
              </div>
              <table className="table compact">
                <thead>
                  <tr>
                    <th>Token</th>
                    <th>Last used</th>
                    <th>Status</th>
                    <th>
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {agent.tokens.map((t) => (
                    <tr key={t.id}>
                      <td>
                        {t.name} <code className="muted">{t.hint}</code>
                      </td>
                      <td>{formatDate(t.lastUsedAt)}</td>
                      <td>{t.revokedAt ? <span className="pill pill-revoked">revoked</span> : <span className="pill pill-pending">active</span>}</td>
                      <td className="actions">
                        {!t.revokedAt && !agent.deactivatedAt && (
                          <>
                            <button type="button" onClick={() => rotate.mutate(t.id)}>
                              Rotate
                            </button>
                            <button type="button" className="danger" onClick={() => revoke.mutate(t.id)}>
                              Revoke
                            </button>
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

export function AdminPage() {
  return (
    <div className="page">
      <h1>Workspace admin</h1>
      <Invites />
      <Agents />
      <ClientSessions title="Desktop and CLI sessions" />
    </div>
  )
}
