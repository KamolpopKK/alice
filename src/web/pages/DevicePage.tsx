import { useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { ClientSessionInfo } from '../../shared/contracts'
import { client } from '../api'
import { formatDate } from '../components/ui'
import { errorText } from '../tasks/TaskDetail'
import { Banner, Button, FieldMessage, Skeleton, TextField } from '../ui'
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
    <div className="page resource-page device-page">
      <h1>Sign in a device</h1>
      {decision?.kind === 'approved' ? (
        <section className="resource-panel device-decision" role="status">
          <h2 className="resource-panel-title">Approved</h2>
          <p>
            {decision.session.clientName} on <strong>{decision.session.deviceName}</strong> is now signed in as you. You can return to it.
          </p>
          <p className="ui-text-muted">You can revoke this session at any time below.</p>
        </section>
      ) : decision?.kind === 'denied' ? (
        <section className="resource-panel device-decision" role="status">
          <h2 className="resource-panel-title">Request denied</h2>
          <p>The device was not signed in.</p>
        </section>
      ) : !code ? (
        <form
          className="resource-panel resource-form"
          onSubmit={(e: FormEvent) => {
            e.preventDefault()
            setParams({ code: typed.trim() })
          }}
        >
          <p>Enter the code shown by Alice Desktop or the Alice CLI.</p>
          <TextField label="Code" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="BCDF-GHJK" autoComplete="off" required autoFocus />
          <div>
            <Button variant="primary" type="submit">
              Continue
            </Button>
          </div>
        </form>
      ) : lookup.isLoading ? (
        <Skeleton lines={4} />
      ) : lookup.error ? (
        <Banner tone="danger" title="This code cannot be used" action={<Button size="sm" onClick={() => setParams({})}>Enter a different code</Button>}>
          {errorText(lookup.error)}
        </Banner>
      ) : lookup.data ? (
        <section className="resource-panel" aria-labelledby="device-request-heading">
          <h2 id="device-request-heading">Allow {KIND_LABEL[lookup.data.clientKind]} to act as you?</h2>
          <dl className="settings-facts">
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
          <Banner tone="warning">Only approve if you started this sign-in yourself and the code matches the one on your device.</Banner>
          <div className="resource-actions">
            <Button variant="primary" loading={approve.isPending} disabled={deny.isPending} onClick={() => approve.mutate()}>
              Approve
            </Button>
            <Button loading={deny.isPending} disabled={approve.isPending} onClick={() => deny.mutate()}>
              Deny
            </Button>
          </div>
          {(approve.error || deny.error) && <FieldMessage tone="error">{errorText(approve.error ?? deny.error)}</FieldMessage>}
        </section>
      ) : null}
      <ClientSessions title="Your signed-in devices" />
    </div>
  )
}
