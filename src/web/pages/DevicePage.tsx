import { useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { ClientSessionInfo } from '../../shared/contracts'
import { client } from '../api'
import { ErrorMessage, Loading, TextInput, formatDate } from '../components/ui'
import { ClientSessions } from '../components/ClientSessions'

const KIND_LABEL = { desktop: 'Alice Desktop', cli: 'Alice CLI' } as const

/** Browser side of the device flow: a signed-in human confirms the code shown by Desktop or CLI. */
export function DevicePage() {
  const [params, setParams] = useSearchParams()
  const code = params.get('code') ?? ''
  const [typed, setTyped] = useState(code)
  const [decision, setDecision] = useState<{ kind: 'approved'; session: ClientSessionInfo } | { kind: 'denied' } | null>(null)
  const qc = useQueryClient()
  const lookup = useQuery({ queryKey: ['device-request', code], queryFn: () => client.device.lookup(code), enabled: code !== '' && decision === null, retry: false })
  const approve = useMutation({
    mutationFn: () => client.device.approve(code),
    onSuccess: (session) => {
      setDecision({ kind: 'approved', session })
      void qc.invalidateQueries({ queryKey: ['client-sessions'] })
    },
  })
  const deny = useMutation({ mutationFn: () => client.device.deny(code), onSuccess: () => setDecision({ kind: 'denied' }) })

  return (
    <div className="page narrow">
      <h1>Sign in a device</h1>
      {decision?.kind === 'approved' ? (
        <section className="panel" role="status">
          <h2>Approved</h2>
          <p>
            {decision.session.clientName} on <strong>{decision.session.deviceName}</strong> is now signed in as you. You can return to it.
          </p>
          <p className="muted">You can revoke this session at any time below.</p>
        </section>
      ) : decision?.kind === 'denied' ? (
        <section className="panel" role="status">
          <h2>Request denied</h2>
          <p>The device was not signed in.</p>
        </section>
      ) : !code ? (
        <form
          className="panel stack"
          onSubmit={(e: FormEvent) => {
            e.preventDefault()
            setParams({ code: typed.trim() })
          }}
        >
          <p>Enter the code shown by Alice Desktop or the Alice CLI.</p>
          <TextInput label="Code" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="BCDF-GHJK" autoComplete="off" required autoFocus />
          <button className="primary" type="submit">
            Continue
          </button>
        </form>
      ) : lookup.isLoading ? (
        <Loading />
      ) : lookup.error ? (
        <section className="panel">
          <ErrorMessage error={lookup.error} />
          <button type="button" onClick={() => setParams({})}>
            Enter a different code
          </button>
        </section>
      ) : lookup.data ? (
        <section className="panel stack" aria-labelledby="device-request-heading">
          <h2 id="device-request-heading">Allow {KIND_LABEL[lookup.data.clientKind]} to act as you?</h2>
          <dl className="details">
            <dt>Code</dt>
            <dd>
              <code>{code.toUpperCase()}</code>
            </dd>
            <dt>Application</dt>
            <dd>
              {lookup.data.clientName} {lookup.data.clientVersion}
            </dd>
            <dt>Device</dt>
            <dd>{lookup.data.deviceName}</dd>
            <dt>Requested</dt>
            <dd>{formatDate(lookup.data.createdAt)}</dd>
            <dt>Expires</dt>
            <dd>{formatDate(lookup.data.expiresAt)}</dd>
          </dl>
          <p className="muted">Only approve if you started this sign-in yourself and the code matches the one on your device.</p>
          <div className="row">
            <button className="primary" type="button" disabled={approve.isPending || deny.isPending} onClick={() => approve.mutate()}>
              Approve
            </button>
            <button type="button" disabled={approve.isPending || deny.isPending} onClick={() => deny.mutate()}>
              Deny
            </button>
          </div>
          <ErrorMessage error={approve.error ?? deny.error} />
        </section>
      ) : null}
      <ClientSessions title="Your signed-in devices" />
    </div>
  )
}
