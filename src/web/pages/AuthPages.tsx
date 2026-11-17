import { useState, type FormEvent } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { client } from '../api'
import { useAuth } from '../auth'
import { ErrorMessage, PasswordInput, TextInput } from '../components/ui'
import { AuthShell } from '../brand'
import { safeReturnPath } from '../navigation'

// ทั้ง 4 สถานะ (sign in, setup, invite ใช้ได้/ใช้ไม่ได้) ใช้ฉากเดียวกัน — ดู AuthShell
const AuthCard = AuthShell

function useSubmit<T>(fn: () => Promise<T>, onDone: (value: T) => void | Promise<void>) {
  const [error, setError] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await onDone(await fn())
    } catch (err) {
      setError(err)
    } finally {
      setBusy(false)
    }
  }
  return { submit, error, busy }
}

export function LoginPage() {
  const { refresh } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const { submit, error, busy } = useSubmit(
    () => client.auth.login({ username, password }),
    async () => {
      await refresh()
      navigate(safeReturnPath(location.state), { replace: true })
    },
  )
  return (
    <AuthCard title="Sign in" voice="login">
      <form onSubmit={submit} className="stack">
        <TextInput label="Username" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required autoFocus />
        <PasswordInput label="Password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        <ErrorMessage error={error} />
        <button className="primary" type="submit" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </AuthCard>
  )
}

function AccountFields(props: {
  username: string
  setUsername: (v: string) => void
  displayName: string
  setDisplayName: (v: string) => void
  password: string
  setPassword: (v: string) => void
}) {
  return (
    <>
      <TextInput label="Display name" value={props.displayName} onChange={(e) => props.setDisplayName(e.target.value)} required maxLength={80} autoComplete="name" />
      <TextInput
        label="Username"
        hint="Used to sign in. Letters, digits, dot, dash or underscore."
        value={props.username}
        onChange={(e) => props.setUsername(e.target.value)}
        required
        autoComplete="username"
        pattern="[A-Za-z0-9][A-Za-z0-9._\-]{1,31}"
      />
      <PasswordInput
        label="Password"
        hint="At least 10 characters."
        value={props.password}
        onChange={(e) => props.setPassword(e.target.value)}
        required
        minLength={10}
        autoComplete="new-password"
      />
    </>
  )
}

export function SetupPage() {
  const { refresh } = useAuth()
  const navigate = useNavigate()
  const [bootstrapToken, setToken] = useState('')
  const [username, setUsername] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [password, setPassword] = useState('')
  const { submit, error, busy } = useSubmit(
    () => client.auth.bootstrap({ bootstrapToken, username, displayName, password }),
    async () => {
      await refresh()
      navigate('/')
    },
  )
  return (
    <AuthCard title="Set up Alice" voice="setup" intro="Create the owner account. The owner invites people and manages agent tokens.">
      <form onSubmit={submit} className="stack">
        <PasswordInput
          label="Bootstrap token"
          hint="From ALICE_BOOTSTRAP_TOKEN, or the bootstrap-token file in the data directory."
          value={bootstrapToken}
          onChange={(e) => setToken(e.target.value)}
          required
          autoComplete="off"
        />
        <AccountFields {...{ username, setUsername, displayName, setDisplayName, password, setPassword }} />
        <ErrorMessage error={error} />
        <button className="primary" type="submit" disabled={busy}>
          Create owner account
        </button>
      </form>
    </AuthCard>
  )
}

export function InvitePage() {
  const { token = '' } = useParams()
  const { refresh } = useAuth()
  const navigate = useNavigate()
  const check = useQuery({ queryKey: ['invite-check', token], queryFn: () => client.invites.check(token), retry: false })
  const [username, setUsername] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [password, setPassword] = useState('')
  const { submit, error, busy } = useSubmit(
    () => client.invites.accept({ token, username, displayName, password }),
    async () => {
      await refresh()
      navigate('/')
    },
  )
  if (check.data && !check.data.valid) {
    return <AuthCard title="Invite unavailable" intro="This invite link is invalid, expired, or has already been used. Ask the workspace owner for a new one." />
  }
  return (
    <AuthCard title="Join Alice" voice="invite" intro="Choose how your name appears to teammates and agents.">
      <form onSubmit={submit} className="stack">
        <AccountFields {...{ username, setUsername, displayName, setDisplayName, password, setPassword }} />
        <ErrorMessage error={error} />
        <button className="primary" type="submit" disabled={busy}>
          Create account
        </button>
      </form>
    </AuthCard>
  )
}
