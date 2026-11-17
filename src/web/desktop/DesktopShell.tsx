import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { setTransport } from '../api'
import { ErrorMessage, Loading, TextInput } from '../components/ui'
import { isNativeError, native, workspaceLabel, type AuthEvent, type ConnectionTest, type DesktopProfile, type ProfilesView } from './native'
import { AgentsSection, LocalRecovery, LocalWorkspacesSection, Onboarding } from './LocalScreens'
import { LocalWorkspaceContext } from '../workspace-mode'
import { ShellWorkspaceContext, type ShellWorkspace } from '../shell/workspace'
import { TauriTransport } from './transport'

type Phase =
  | { kind: 'loading' }
  | { kind: 'profiles' }
  | { kind: 'checking'; profile: DesktopProfile }
  | { kind: 'unreachable'; profile: DesktopProfile; message: string }
  | { kind: 'incompatible'; profile: DesktopProfile; test: ConnectionTest }
  | { kind: 'sign-in'; profile: DesktopProfile }
  | { kind: 'ready'; profile: DesktopProfile }
  | { kind: 'onboarding' }
  | { kind: 'local-failed'; profile: DesktopProfile; message: string; code: string | null }

function messageOf(err: unknown): string {
  return typeof err === 'object' && err && 'message' in err ? String((err as { message: unknown }).message) : String(err)
}

/** Opens http(s) links outside the app through the restricted native opener. */
function useExternalLinks() {
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null
      if (!a) return
      const url = new URL(a.href, window.location.href)
      if (url.origin === window.location.origin) return
      e.preventDefault()
      if (url.protocol === 'http:' || url.protocol === 'https:') void native.openExternal(url.href)
    }
    document.addEventListener('click', onClick, true)
    return () => document.removeEventListener('click', onClick, true)
  }, [])
}

/**
 * Desktop-only chrome: server profiles, browser sign-in, compatibility and the active-profile banner.
 * Everything else is the same React app as the Web dashboard.
 */
export function DesktopShell({ children }: { children: ReactNode }) {
  const qc = useQueryClient()
  const [view, setView] = useState<ProfilesView | null>(null)
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' })
  const [managing, setManaging] = useState(false)
  useExternalLinks()

  const navigate = useNavigate()
  // navigate เปลี่ยนทุกครั้งที่เปลี่ยนหน้า: เก็บใน ref เพื่อไม่ให้ evaluate ถูกสร้างใหม่ (และรันซ้ำ) ทุกการนำทาง
  const navigateRef = useRef(navigate)
  navigateRef.current = navigate
  const lastActive = useRef<{ name: string; local: boolean } | null>(null)
  const onboarding = useRef(false)
  // evaluate ซ้อนกันได้ (event profile/auth มาระหว่างที่รอ daemon หรือ server): ผลของรอบเก่าห้ามทับรอบใหม่
  // ไม่งั้นข้อมูลมาจาก workspace ใหม่แต่แถบ Workspace และสถานะยังเป็นของ workspace เดิม
  const evaluation = useRef(0)
  const evaluate = useCallback(async () => {
    if (onboarding.current) return
    const run = ++evaluation.current
    const stale = () => run !== evaluation.current
    const v = await native.profiles()
    if (stale()) return
    setView(v)
    const active = v.profiles.find((p) => p.active)
    // ครั้งแรกที่ไม่มีอะไรเลย: Local เป็นค่าเริ่มต้น (ไม่ถาม URL หรือ sign-in)
    if (!active) return setPhase(v.localAvailable && v.profiles.length === 0 ? { kind: 'onboarding' } : { kind: 'profiles' })
    // เปลี่ยน workspace = เปลี่ยนข้อมูลและตัวตน: ล้าง cache และตำแหน่งหน้าเดิมก่อนแสดงข้อมูลใหม่
    qc.clear()
    const previous = lastActive.current
    if (previous !== null && previous.name !== active.name && (previous.local || !!active.local)) {
      // สลับเข้า/ออก Local workspace: ปิดหน้าจัดการและเริ่มที่หน้าแรกของ workspace ใหม่
      setManaging(false)
      navigateRef.current('/', { replace: true })
    }
    lastActive.current = { name: active.name, local: !!active.local }
    setTransport(new TauriTransport(active.name))
    setPhase({ kind: 'checking', profile: active })
    try {
      const test = await native.testProfile(active.name)
      if (stale()) return
      if (!test.compatible) return setPhase({ kind: 'incompatible', profile: active, test })
    } catch (err) {
      if (stale()) return
      if (active.local) return setPhase({ kind: 'local-failed', profile: active, message: messageOf(err), code: isNativeError(err) ? err.code : null })
      return setPhase({ kind: 'unreachable', profile: active, message: messageOf(err) })
    }
    setPhase(active.signedIn ? { kind: 'ready', profile: active } : { kind: 'sign-in', profile: active })
  }, [qc])

  const [linkNotice, setLinkNotice] = useState<string | null>(null)
  const [linkWaiting, setLinkWaiting] = useState(0)
  useEffect(() => {
    const off = native.onDeepLink((e) => {
      if (e.status === 'rejected') setLinkNotice(`Ignored a link that is not a valid Alice link (${e.message}).`)
      else if (e.status === 'unknown_profile') setLinkNotice(`A link asked for the server profile "${e.profile}", which is not set up in Alice Desktop. Nothing was opened. Add that profile with Switch server, then open the link again.`)
      else if (e.status === 'unknown_workspace') setLinkNotice(`A link asked for a Local workspace (${e.workspace}) that does not exist on this computer. Nothing was opened.`)
      else {
        setLinkNotice(null)
        setLinkWaiting((n) => n + 1)
      }
    })
    return () => void off.then((fn) => fn())
  }, [])
  // navigate เฉพาะเมื่อ profile ของลิงก์ active, sign-in แล้ว และ compatible (Rust ตรวจ profile อีกชั้น)
  useEffect(() => {
    if (phase.kind !== 'ready') return
    void native.deeplinkTake().then((taken) => {
      if (taken && (taken.link.profile ?? taken.link.workspace) === phase.profile.name) navigate(taken.path)
    })
  }, [phase, linkWaiting, navigate])

  // shortcut จับภาพ: รอจน sign-in และ compatible แล้วจึงเปิด Task Pads (intent ไม่หายระหว่าง sign-in)
  const [captureWaiting, setCaptureWaiting] = useState(0)
  useEffect(() => {
    const off = native.onCapture(() => setCaptureWaiting((n) => n + 1))
    return () => void off.then((fn) => fn())
  }, [])
  useEffect(() => {
    if (phase.kind !== 'ready') return
    void native.captureTake().then((taken) => {
      // server รุ่นเก่าที่ไม่มี Task Pads: หน้า /pads อธิบายเองโดยไม่สร้างอะไร
      if (taken) navigate('/pads', { state: { capture: { id: `desktop-${taken.id}-${Date.now()}`, intent: taken.intent } } })
    })
  }, [phase, captureWaiting, navigate])

  const [appVersion, setAppVersion] = useState<string | null>(null)
  useEffect(() => {
    void native.appInfo().then((info) => setAppVersion(info.version))
  }, [])

  useEffect(() => {
    void evaluate()
    const unlisten = [
      native.onProfile(() => void evaluate()),
      native.onAuth((e: AuthEvent) => {
        if (e.status === 'signed_in' || e.status === 'signed_out') void evaluate()
      }),
    ]
    return () => unlisten.forEach((p) => void p.then((fn) => fn()))
  }, [evaluate])

  const profile = 'profile' in phase ? phase.profile : null
  const notice = linkNotice && (
    <div className="disconnected-banner" role="alert">
      {linkNotice}{' '}
      <button type="button" className="link" onClick={() => setLinkNotice(null)}>
        Dismiss
      </button>
    </div>
  )
  if (phase.kind === 'onboarding') {
    return (
      <Onboarding
        onBegin={() => (onboarding.current = true)}
        onFail={() => (onboarding.current = false)}
        onFinish={() => {
          onboarding.current = false
          // จบ onboarding ใน Task Pad ใหม่ที่โฟกัสบรรทัดแรก
          void evaluate().then(() => navigate('/pads', { state: { capture: { id: `onboarding-${Date.now()}`, intent: 'new-pad' } } }))
        }}
        applyTools={async (tools) => {
          if (tools.cli || tools.codex || tools.claude) await native.toolsApply(tools)
        }}
      />
    )
  }
  if (managing || phase.kind === 'profiles') {
    return (
      <>
        {notice}
        <ProfilesScreen view={view} onDone={() => setManaging(false)} canClose={!!view?.active && phase.kind !== 'profiles'} onChanged={(v) => setView(v)} />
        {appVersion && (
          <div className="muted small desktop-version">
            Alice Desktop {appVersion} · <UpdateCheck />
          </div>
        )}
      </>
    )
  }
  return (
    <div className="desktop">
      {/* เมื่อพร้อมใช้งาน แถบ workspace อยู่บนสุดของ sidebar ใน shell แทน */}
      {profile && phase.kind !== 'ready' && <ProfileBar profile={profile} onManage={() => setManaging(true)} />}
      {notice}
      {phase.kind === 'loading' || phase.kind === 'checking' ? (
        <main className="page narrow">
          <Loading />
        </main>
      ) : phase.kind === 'unreachable' ? (
        <StateCard title="Cannot reach the server" tone="warning">
          <p>{phase.message}</p>
          <p className="muted">Nothing is shown until {phase.profile.server} answers. Alice Desktop keeps no offline copy.</p>
          <div className="row">
            <button className="primary" type="button" onClick={() => void evaluate()}>
              Try again
            </button>
            <button type="button" onClick={() => setManaging(true)}>
              Choose another server
            </button>
          </div>
        </StateCard>
      ) : phase.kind === 'incompatible' ? (
        <StateCard title={phase.test.upgrade === 'server' ? 'This server is too old' : 'Update Alice Desktop'} tone="warning">
          <p>{phase.test.message}</p>
          <p className="muted">
            Server {phase.test.serverName} {phase.test.serverVersion} supports Client API v{phase.test.clientApi.minimum}–v{phase.test.clientApi.current}.
          </p>
        </StateCard>
      ) : phase.kind === 'local-failed' ? (
        <LocalRecovery profile={phase.profile} message={phase.message} code={phase.code} onRetry={() => void evaluate()} onSwitch={() => setManaging(true)} />
      ) : phase.kind === 'sign-in' ? (
        <SignInScreen profile={phase.profile} />
      ) : (
        <LocalWorkspaceContext.Provider value={phase.kind === 'ready' && !!phase.profile.local}>
          <ShellWorkspaceContext.Provider value={profile ? shellWorkspace(profile, () => setManaging(true)) : null}>{children}</ShellWorkspaceContext.Provider>
        </LocalWorkspaceContext.Provider>
      )}
    </div>
  )
}

function StateCard({ title, tone, children }: { title: string; tone?: 'warning'; children: ReactNode }) {
  return (
    <main className="page narrow">
      <section className={`panel stack${tone ? ` panel-${tone}` : ''}`} role={tone ? 'alert' : undefined}>
        <h1>{title}</h1>
        {children}
      </section>
    </main>
  )
}

function shellWorkspace(profile: DesktopProfile, onSwitch: () => void): ShellWorkspace {
  if (profile.local) return { name: workspaceLabel(profile), kind: 'local', detail: `${profile.local.alias} · on this computer`, onSwitch }
  const detail = profile.session ? `${profile.server} · ${profile.session.actorName}` : profile.server
  return { name: profile.name, kind: 'remote', detail, insecure: profile.insecure, onSwitch }
}

function ProfileBar({ profile, onManage }: { profile: DesktopProfile; onManage: () => void }) {
  if (profile.local) {
    return (
      <div className="profile-bar" role="region" aria-label="Workspace">
        <span>
          <strong>{workspaceLabel(profile)}</strong> <span className="pill">Local</span> <span className="muted small">{profile.local.alias} · on this computer</span>
        </span>
        <button type="button" className="link" onClick={onManage}>
          Switch workspace
        </button>
      </div>
    )
  }
  return (
    <div className="profile-bar" role="region" aria-label="Server profile">
      <span>
        <strong>{profile.name}</strong> <span className="pill">Remote</span> <span className="muted">{profile.server}</span>
        {profile.session && <span className="muted"> · {profile.session.actorName}</span>}
      </span>
      {profile.insecure && (
        <span className="insecure-warning" role="note">
          Unencrypted HTTP — development only
        </span>
      )}
      <button type="button" className="link" onClick={onManage}>
        Switch server
      </button>
    </div>
  )
}

function SignInScreen({ profile }: { profile: DesktopProfile }) {
  const [pending, setPending] = useState<{ userCode: string; verificationUri: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    const off = native.onAuth((e) => {
      if (e.profile !== profile.name) return
      if (e.status === 'denied' || e.status === 'expired' || e.status === 'failed') {
        setPending(null)
        setError(e.message)
      }
      if (e.status === 'cancelled') setPending(null)
    })
    return () => void off.then((fn) => fn())
  }, [profile.name])
  const start = async () => {
    setError(null)
    try {
      const res = await native.loginStart(profile.name)
      setPending({ userCode: res.userCode, verificationUri: res.verificationUri })
    } catch (err) {
      setError(messageOf(err))
    }
  }
  return (
    <StateCard title={`Sign in to ${profile.name}`}>
      <p>
        Alice Desktop signs in through your browser, so it never sees your password. Your session is kept in the operating system's credential store.
      </p>
      {pending ? (
        <>
          <p>
            Approve the request in the browser window that opened. Check that it shows this code:
          </p>
          <p className="user-code" aria-label="Sign-in code">
            {pending.userCode}
          </p>
          <p className="muted small">
            If no browser opened, visit <a href={pending.verificationUri}>{pending.verificationUri}</a>
          </p>
          <div className="row">
            <button type="button" onClick={() => void native.loginCancel()}>
              Cancel
            </button>
          </div>
        </>
      ) : (
        <div className="row">
          <button className="primary" type="button" onClick={() => void start()}>
            Sign in with browser
          </button>
        </div>
      )}
      {error && <p className="error" role="alert">{error}</p>}
    </StateCard>
  )
}

function ProfilesScreen({ view, onDone, canClose, onChanged }: { view: ProfilesView | null; onDone: () => void; canClose: boolean; onChanged: (v: ProfilesView) => void }) {
  const [name, setName] = useState('')
  const [server, setServer] = useState('')
  const [insecureDev, setInsecureDev] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [tests, setTests] = useState<Record<string, string>>({})
  const run = async (fn: () => Promise<ProfilesView>) => {
    setError(null)
    try {
      onChanged(await fn())
    } catch (err) {
      setError(new Error(messageOf(err)))
    }
  }
  const test = async (p: DesktopProfile) => {
    try {
      const r = await native.testProfile(p.name)
      setTests((t) => ({ ...t, [p.name]: `${r.serverName} ${r.serverVersion} · TLS ${r.tls === 'verified' ? 'verified' : 'none (HTTP)'} · ${r.message}` }))
    } catch (err) {
      setTests((t) => ({ ...t, [p.name]: messageOf(err) }))
    }
  }
  return (
    <main className="page narrow desktop-profiles">
      {view?.localAvailable ? <h1>Workspaces</h1> : <h1>Alice servers</h1>}
      {view?.localAvailable && <LocalWorkspacesSection view={view} onChanged={onChanged} />}
      {view?.localAvailable && view.profiles.some((p) => p.local) && <AgentsSection />}
      {view?.localAvailable && <h2>Alice servers</h2>}
      <p className="muted">Each profile connects to one Alice server. Profiles store no passwords or tokens.</p>
      {view && view.profiles.some((p) => !p.local) && (
        <section className="panel" aria-labelledby="profiles-heading">
          <h2 id="profiles-heading">Profiles</h2>
          <ul className="profile-list">
            {view.profiles.filter((p) => !p.local).map((p) => (
              <li key={p.name}>
                <div>
                  <strong>{p.name}</strong> {p.active && <span className="pill">active</span>}
                  <div className="muted small">
                    {p.server}
                    {p.insecure ? ' · unencrypted HTTP' : ''} · {p.signedIn ? `signed in as ${p.session?.actorName ?? 'you'}` : 'signed out'}
                  </div>
                  {tests[p.name] && <div className="small">{tests[p.name]}</div>}
                </div>
                <div className="row">
                  {!p.active && (
                    <button type="button" onClick={() => void run(() => native.useProfile(p.name))}>
                      Use
                    </button>
                  )}
                  <button type="button" onClick={() => void test(p)}>
                    Test
                  </button>
                  <button type="button" onClick={() => void run(() => native.removeProfile(p.name))} aria-label={`Remove ${p.name}`}>
                    Remove
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
      <form
        className="panel stack"
        onSubmit={(e: FormEvent) => {
          e.preventDefault()
          void run(async () => {
            const v = await native.addProfile({ name: name.trim(), server: server.trim(), insecureDev })
            setName('')
            setServer('')
            setInsecureDev(false)
            return v
          })
        }}
      >
        <h2>Add a server</h2>
        <TextInput label="Profile name" value={name} onChange={(e) => setName(e.target.value)} placeholder="work" required />
        <TextInput label="Server URL" value={server} onChange={(e) => setServer(e.target.value)} placeholder="https://alice.example.com" required inputMode="url" />
        <label className="checkbox">
          <input type="checkbox" checked={insecureDev} onChange={(e) => setInsecureDev(e.target.checked)} /> Allow unencrypted HTTP (development servers only)
        </label>
        <ErrorMessage error={error} />
        <div className="row">
          <button className="primary" type="submit">
            Add server
          </button>
          {canClose && (
            <button type="button" onClick={onDone}>
              Done
            </button>
          )}
        </div>
      </form>
    </main>
  )
}

/** Signed updates: the native updater verifies the signature; installs only newer, compatible releases. */
function UpdateCheck() {
  const [status, setStatus] = useState<string | null>(null)
  const [installable, setInstallable] = useState<string | null>(null)
  const check = async () => {
    setStatus('Checking…')
    try {
      const r = await native.updateCheck()
      if (!r.configured) return setStatus('Updates are not configured in this build')
      if (r.available && r.version) {
        setInstallable(r.version)
        return setStatus(`Version ${r.version} is available`)
      }
      setStatus(r.decision === 'incompatible' ? (r.message ?? 'The new version does not support your server yet') : 'Alice Desktop is up to date')
    } catch (err) {
      setStatus(messageOf(err))
    }
  }
  return (
    <span role="status">
      {status ?? (
        <button type="button" className="link" onClick={() => void check()}>
          Check for updates
        </button>
      )}
      {installable && (
        <>
          {' '}
          <button type="button" className="link" onClick={() => void native.updateInstall().catch((e) => setStatus(messageOf(e)))}>
            Install and restart
          </button>
        </>
      )}
    </span>
  )
}
