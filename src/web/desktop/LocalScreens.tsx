// หน้าของ Local workspaces ใน Desktop: onboarding ครั้งแรก, จัดการ workspace และหน้ากู้คืน
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { ErrorMessage, TextInput } from '../components/ui'
import { MascotImage } from '../brand'
import { markWhatsNewSeen } from '../whats-new'
import { Button, Checkbox, FieldMessage, RadioGroup, TextField } from '../ui'
import { native, workspaceLabel, type AgentIntegration, type DesktopProfile, type ProfilesView } from './native'

function messageOf(err: unknown): string {
  return typeof err === 'object' && err && 'message' in err ? String((err as { message: unknown }).message) : String(err)
}

export interface OnboardingResult {
  ownerName: string
  tools: { cli: boolean; codex: boolean; claude: boolean }
}

// 'remote' = เลือก server ของทีมแล้วออกไปตั้งค่า/sign in; กลับมาที่ขั้นที่ 3 เมื่อเชื่อมต่อแล้ว
type Stage = 'welcome' | 'workspace' | 'agents' | 'remote' | 'first-task'
const STAGES: Stage[] = ['welcome', 'workspace', 'agents', 'remote', 'first-task']
const STEP: Record<Stage, number> = { welcome: 1, workspace: 2, agents: 3, remote: 3, 'first-task': 4 }
const PROGRESS_KEY = 'alice.onboarding'
interface Progress {
  stage: Stage
  workspaceName: string
  ownerName: string
  tools: OnboardingResult['tools']
}

function readProgress(): Progress | null {
  try {
    const raw = localStorage.getItem(PROGRESS_KEY)
    const value = raw ? (JSON.parse(raw) as Progress) : null
    return value && STAGES.includes(value.stage) ? value : null
  } catch {
    return null
  }
}
function saveProgress(p: Progress | null) {
  try {
    if (p) localStorage.setItem(PROGRESS_KEY, JSON.stringify(p))
    else localStorage.removeItem(PROGRESS_KEY)
  } catch {
    /* progress lasts for this window only */
  }
}

/**
 * True after the workspace was set up but before the first capture: Desktop resumes onboarding at
 * its last stage instead of skipping it (nothing is created twice).
 */
export function onboardingPending(): boolean {
  return readProgress()?.stage === 'first-task'
}

/** True after someone chose a team server during first run: once signed in, onboarding continues. */
export function remoteOnboardingPending(): boolean {
  const stage = readProgress()?.stage
  return stage === 'remote' || (stage === 'first-task' && readProgress()?.workspaceName === '')
}

/**
 * Alice-guided first run in four stages: Welcome, Workspace (Local, or Remote through the server
 * switcher), Agents (optional) and First task in a real Task Pad. Progress survives a restart.
 * No URL, port, database path, password or MCP configuration is asked for on the Local path.
 */
export function Onboarding({
  onBegin,
  onFinish,
  onFail,
  onRemote,
  applyTools,
  connected = false,
}: {
  /** Called before the first native change, so profile events do not leave onboarding half-way. */
  onBegin: () => void
  onFinish: (result: OnboardingResult) => void
  onFail: () => void
  /** Leaves onboarding for the Remote server setup (add a server and sign in through the browser). */
  onRemote?: () => void
  applyTools?: (tools: OnboardingResult['tools']) => Promise<void>
  /** Signed in to a team server chosen during this first run: continue from the Remote stage. */
  connected?: boolean
}) {
  const saved = useRef(readProgress()).current
  // เลือก Remote ไว้แต่ยังไม่ได้เชื่อมต่อ (เช่น ปิดหน้าตั้งค่า server): กลับไปเลือกที่เก็บงานใหม่
  const [stage, setStage] = useState<Stage>(saved?.stage === 'remote' && !connected ? 'workspace' : (saved?.stage ?? 'welcome'))
  const [where, setWhere] = useState<'local' | 'remote'>(saved?.stage === 'remote' ? 'remote' : 'local')
  const [workspaceName, setWorkspaceName] = useState(saved?.workspaceName ?? 'Personal')
  // ไม่ดึงชื่อบัญชีของ OS มาใส่เอง: ค่าเริ่มต้นเป็นชื่อกลาง ๆ ที่แก้ได้
  const [ownerName, setOwnerName] = useState(saved?.ownerName ?? 'Local Owner')
  const [tools, setTools] = useState(saved?.tools ?? { cli: true, codex: true, claude: true })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => heading.current?.focus(), [stage])
  useEffect(() => {
    // กลับมาที่ขั้นสุดท้ายหลังเปิดแอปใหม่: workspace มีอยู่แล้ว ให้ shell ข้าม evaluate จนกว่าจะจบ
    if (saved?.stage === 'first-task' || (saved?.stage === 'remote' && connected)) onBegin()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const go = (next: Stage) => {
    setError(null)
    setStage(next)
    saveProgress({ stage: next, workspaceName, ownerName, tools })
  }

  /** Creates (or reuses) the Local workspace, applies names and the chosen tools. Idempotent. */
  const setUp = async (chosen: OnboardingResult['tools']) => {
    setBusy(true)
    setError(null)
    onBegin()
    try {
      const view = await native.localFirstRun()
      const id = view.active!
      if (workspaceName.trim() && workspaceName.trim() !== 'Personal') await native.workspaceRename(id, workspaceName.trim())
      await native.testProfile(id)
      if (ownerName.trim() && ownerName.trim() !== 'Local Owner') await native.ownerRename(ownerName.trim())
      if (applyTools) await applyTools(chosen)
      setTools(chosen)
      setBusy(false)
      setStage('first-task')
      saveProgress({ stage: 'first-task', workspaceName, ownerName, tools: chosen })
    } catch (err) {
      setError(messageOf(err))
      setBusy(false)
      onFail()
    }
  }
  const index = STEP[stage]
  const submit = (fn: () => void) => (e: FormEvent) => {
    e.preventDefault()
    fn()
  }

  return (
    <main className="onboarding-page">
      <section className="onboarding-card" aria-labelledby="onboarding-heading">
        <div className="onboarding-content">
          <p className="ui-text-muted onboarding-step">
            Step {index} of 4
          </p>
          {stage === 'welcome' && (
            <form className="onboarding-form" onSubmit={submit(() => go('workspace'))}>
              <h1 id="onboarding-heading" tabIndex={-1} ref={heading}>
                Welcome to Alice
              </h1>
              <p className="onboarding-alice">I keep your tasks in one place, for you and the agents you work with.</p>
              <p className="ui-text-muted">Setup takes a minute: choose where your work lives, connect agents if you like, then capture your first task.</p>
              <div className="onboarding-actions">
                <Button variant="primary" type="submit">
                  Get started
                </Button>
              </div>
            </form>
          )}
          {stage === 'workspace' && (
            <form
              className="onboarding-form"
              onSubmit={submit(() => {
                if (where !== 'remote') return go('agents')
                saveProgress({ stage: 'remote', workspaceName: '', ownerName, tools })
                onRemote?.()
              })}
            >
              <h1 id="onboarding-heading" tabIndex={-1} ref={heading}>
                Where should your work live?
              </h1>
              <RadioGroup
                legend="Workspace"
                name="where"
                value={where}
                onChange={(v) => setWhere(v as 'local' | 'remote')}
                options={[
                  { value: 'local', label: 'On this computer', hint: 'A private Local workspace. No server, nothing to sign in to.' },
                  ...(onRemote ? [{ value: 'remote', label: 'On a team server', hint: 'Connect to an Alice server and sign in through your browser.' }] : []),
                ]}
              />
              {where === 'local' && (
                <>
                  <TextField label="Workspace name" value={workspaceName} onChange={(e) => setWorkspaceName(e.target.value)} maxLength={80} required />
                  <TextField label="Your name" value={ownerName} onChange={(e) => setOwnerName(e.target.value)} maxLength={80} required hint="Shown on what you create; agents get their own names." />
                </>
              )}
              <div className="onboarding-actions">
                <Button variant="primary" type="submit">
                  {where === 'remote' ? 'Connect to a server' : 'Continue'}
                </Button>
                <Button onClick={() => go('welcome')}>Back</Button>
              </div>
            </form>
          )}
          {stage === 'agents' && (
            <form className="onboarding-form" onSubmit={submit(() => void setUp(tools))}>
              <h1 id="onboarding-heading" tabIndex={-1} ref={heading}>
                Work with your terminal and agents
              </h1>
              <p className="ui-text-muted">
                Alice can install its command-line tool and teach Codex and Claude to use this workspace. Each agent works under its own name, so you can always see who changed
                what. You can change this later in Settings.
              </p>
              <fieldset className="onboarding-fieldset">
                <legend className="ui-field-label">Install</legend>
                <Checkbox label={<>The <code>alice</code> command for your terminal</>} checked={tools.cli} onChange={(e) => setTools({ ...tools, cli: e.target.checked })} />
                <Checkbox label="Codex (adds Alice skills to ~/.codex)" checked={tools.codex} onChange={(e) => setTools({ ...tools, codex: e.target.checked })} />
                <Checkbox label="Claude Code (adds Alice skills to ~/.claude)" checked={tools.claude} onChange={(e) => setTools({ ...tools, claude: e.target.checked })} />
              </fieldset>
              {error && <FieldMessage tone="error">{error}</FieldMessage>}
              <div className="onboarding-actions">
                <Button variant="primary" type="submit" loading={busy}>
                  {busy ? 'Setting up…' : 'Continue'}
                </Button>
                <Button variant="ghost" disabled={busy} onClick={() => void setUp({ cli: false, codex: false, claude: false })}>
                  Skip for now
                </Button>
                <Button disabled={busy} onClick={() => go('workspace')}>
                  Back
                </Button>
              </div>
            </form>
          )}
          {stage === 'remote' && (
            <form
              className="onboarding-form"
              onSubmit={submit(() => {
                setStage('first-task')
                saveProgress({ stage: 'first-task', workspaceName: '', ownerName, tools })
              })}
            >
              <h1 id="onboarding-heading" tabIndex={-1} ref={heading}>
                You’re connected
              </h1>
              <p className="onboarding-alice">You’re signed in to your team’s server. Everyone there sees the same board.</p>
              <p className="ui-text-muted">
                Agents connect to a team server with their own token. When you want one, open Agents: it has a setup prompt you can paste into Claude Code or Codex.
              </p>
              <div className="onboarding-actions">
                <Button variant="primary" type="submit">
                  Continue
                </Button>
              </div>
            </form>
          )}
          {stage === 'first-task' && (
            <form
              className="onboarding-form"
              onSubmit={submit(() => {
                saveProgress(null)
                markWhatsNewSeen()
                onFinish({ ownerName: ownerName.trim(), tools })
              })}
            >
              <h1 id="onboarding-heading" tabIndex={-1} ref={heading}>
                Capture your first task
              </h1>
              <p className="onboarding-alice">Your workspace is ready. Let’s write down the first thing on your mind.</p>
              <p className="ui-text-muted">A Task Pad opens with its first line ready: type a task and press Enter. It becomes a real task right away.</p>
              <div className="onboarding-actions">
                <Button variant="primary" type="submit">
                  Open my Task Pad
                </Button>
              </div>
            </form>
          )}
        </div>
        <div className="onboarding-art" aria-hidden="true">
          <MascotImage pose={stage === 'first-task' ? 'friendly' : stage === 'agents' ? 'focused' : 'curious'} width={200} loading="eager" />
        </div>
      </section>
    </main>
  )
}

/** Local startup failure: only this surface is shown, never a half-initialised dashboard. */
export function LocalRecovery({
  profile,
  message,
  code,
  onRetry,
  onSwitch,
  extraActions,
}: {
  profile: DesktopProfile
  message: string
  code: string | null
  onRetry: () => void
  onSwitch: () => void
  extraActions?: ReactNode
}) {
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => heading.current?.focus(), [])
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [report, setReport] = useState<Array<{ id: string; status: string; summary: string; workspace?: string }> | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const restore = async () => {
    setBusy('Restoring the latest backup…')
    setActionError(null)
    try {
      await native.localRestoreLatest(profile.name)
      setConfirming(false)
      onRetry()
    } catch (err) {
      setActionError(messageOf(err))
    } finally {
      setBusy(null)
    }
  }
  const diagnose = async () => {
    setBusy('Checking…')
    setActionError(null)
    try {
      setReport(await native.localDiagnostics(profile.name))
    } catch (err) {
      setActionError(messageOf(err))
    } finally {
      setBusy(null)
    }
  }
  return (
    <main className="page narrow">
      <section className="panel stack panel-warning" role="alert" aria-labelledby="recovery-heading">
        <h1 id="recovery-heading" tabIndex={-1} ref={heading}>
          {workspaceLabel(profile)} could not open
        </h1>
        <p>{code === 'RUNTIME_MISMATCH' ? 'This workspace needs the same Alice version as Desktop. Repair or update Alice.' : code === 'WORKSPACE_DAMAGED' ? 'The database failed its integrity check. Restore the latest backup; the damaged copy is kept.' : code === 'MIGRATION_FAILED' ? 'The update could not upgrade this workspace. Its data was backed up before the upgrade; restore the latest backup or repair Alice.' : 'Your data is safe on this computer. Try again, or use one of the recovery options below.'}</p>
        <div className="row wrap">
          <Button variant="primary" onClick={onRetry}>
            Try again
          </Button>
          {extraActions}
          <Button onClick={() => void diagnose()} disabled={!!busy}>
            Diagnostics
          </Button>
          <Button onClick={() => setConfirming(true)} disabled={!!busy} aria-expanded={confirming}>
            Restore latest backup
          </Button>
          <Button onClick={() => void native.localOpenFolder(profile.name)}>
            Open data folder
          </Button>
          <Button onClick={onSwitch}>
            Switch workspace
          </Button>
        </div>
        {confirming && (
          <div className="stack" role="group" aria-labelledby="restore-confirm">
            <p id="restore-confirm">
              Replace <strong>{workspaceLabel(profile)}</strong> with its newest backup? Its current data is backed up first and kept, so you can go back.
            </p>
            <div className="row">
              <Button variant="primary" onClick={() => void restore()} disabled={!!busy}>
                Replace with latest backup
              </Button>
              <Button onClick={() => setConfirming(false)} disabled={!!busy}>
                Cancel
              </Button>
            </div>
          </div>
        )}
        {busy && <p role="status">{busy}</p>}
        {actionError && (
          <p className="error" role="alert">
            {actionError}
          </p>
        )}
        {report && (
          <section aria-label="Diagnostics">
            <ul className="small">
              {report.filter((c) => !c.workspace || c.workspace === profile.local?.alias).map((c) => (
                <li key={`${c.workspace ?? ''}${c.id}`}>
                  <strong>{c.status.toUpperCase()}</strong> {c.id}: {c.summary}
                </li>
              ))}
            </ul>
          </section>
        )}
        <details>
          <summary>Technical details</summary>
          <p className="small">
            {code ? `${code}: ` : ''}
            {message}
          </p>
          <p className="small muted">Workspace id {profile.name}</p>
        </details>
      </section>
    </main>
  )
}

/** Local workspaces in the workspace manager: use, create, rename and alias. */
export function LocalWorkspacesSection({ view, onChanged }: { view: ProfilesView; onChanged: (v: ProfilesView) => void }) {
  const locals = view.profiles.filter((p) => p.local)
  const [name, setName] = useState('')
  const [editing, setEditing] = useState<{ id: string; field: 'name' | 'alias'; value: string } | null>(null)
  const [error, setError] = useState<unknown>(null)
  const run = async (fn: () => Promise<ProfilesView>) => {
    setError(null)
    try {
      onChanged(await fn())
      return true
    } catch (err) {
      setError(new Error(messageOf(err)))
      return false
    }
  }
  return (
    <section className="panel stack" aria-labelledby="local-heading">
      <h2 id="local-heading">Local workspaces</h2>
      <p className="muted small">Private to this computer account. The alias is how the alice command and agents address each workspace.</p>
      {locals.length > 0 && (
        <ul className="profile-list">
          {locals.map((p) => (
            <li key={p.name}>
              <div>
                <strong>{p.local!.displayName}</strong> <span className="pill">Local</span> {p.active && <span className="pill">active</span>}
                <div className="muted small">
                  alias {p.local!.alias} · {p.name}
                </div>
                {editing?.id === p.name && (
                  <form
                    className="row"
                    onSubmit={(e: FormEvent) => {
                      e.preventDefault()
                      void run(() => (editing.field === 'name' ? native.workspaceRename(p.name, editing.value.trim()) : native.workspaceAlias(p.name, editing.value.trim()))).then(
                        (ok) => ok && setEditing(null),
                      )
                    }}
                  >
                    <TextInput label={editing.field === 'name' ? `New name for ${p.local!.displayName}` : `New alias for ${p.local!.displayName}`} value={editing.value} onChange={(e) => setEditing({ ...editing, value: e.target.value })} required />
                    <Button type="submit">Save</Button>
                    <Button onClick={() => setEditing(null)}>
                      Cancel
                    </Button>
                  </form>
                )}
              </div>
              <div className="row">
                {!p.active && (
                  <Button onClick={() => void run(() => native.useProfile(p.name))} aria-label={`Use ${p.local!.displayName} (${p.local!.alias})`}>
                    Use
                  </Button>
                )}
                <Button onClick={() => setEditing({ id: p.name, field: 'name', value: p.local!.displayName })} aria-label={`Rename ${p.local!.alias}`}>
                  Rename
                </Button>
                <Button onClick={() => setEditing({ id: p.name, field: 'alias', value: p.local!.alias })} aria-label={`Change alias of ${p.local!.alias}`}>
                  Alias
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <form
        className="row"
        onSubmit={(e: FormEvent) => {
          e.preventDefault()
          void run(() => native.workspaceCreate(name.trim() || 'Workspace')).then((ok) => ok && setName(''))
        }}
      >
        <TextInput label="New Local workspace" value={name} onChange={(e) => setName(e.target.value)} placeholder="Workspace" maxLength={80} />
        <Button type="submit">Create</Button>
      </form>
      <ErrorMessage error={error} />
    </section>
  )
}

/** Settings → Agents: consent, status, repair and revocation of the Codex and Claude integrations. */
export function AgentsSection() {
  const [agents, setAgents] = useState<AgentIntegration[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [assigned, setAssigned] = useState<Array<{ client: 'codex' | 'claude-code'; workspace: string; tasks: number }>>([])
  const load = () =>
    native.integrationsStatus().then(setAgents, (err) => setError(messageOf(err)))
  useEffect(() => void load(), [])
  const act = async (label: string, fn: () => Promise<void>) => {
    setBusy(label)
    setError(null)
    try {
      await fn()
      await load()
    } catch (err) {
      setError(messageOf(err))
    } finally {
      setBusy(null)
    }
  }
  return (
    <section className="panel stack" aria-labelledby="agents-heading">
      <h2 id="agents-heading">Agents on this computer</h2>
      <p className="muted small">
        Enabled agents work in your Local workspaces through the alice command, each under its own name. Disabling one stops it at once;
        its past work keeps its name.
      </p>
      {agents === null && !error && <p role="status">Loading…</p>}
      {agents && (
        <ul className="profile-list">
          {agents.map((a) => {
            const outdated = a.optedIn && Object.values(a.skills).some((v) => v === null)
            return (
              <li key={a.client}>
                <div>
                  <strong>{a.label}</strong> <span className="pill">{a.optedIn ? 'enabled' : 'off'}</span>
                  <div className="muted small">
                    Skills: {Object.entries(a.skills).map(([k, v]) => `${k} ${v ?? 'not installed'}`).join(' · ')}
                  </div>
                </div>
                <div className="row">
                  {a.optedIn ? (
                    <>
                      {outdated && (
                        <Button disabled={!!busy} onClick={() => void act('repair', async () => void (await native.integrationSet(a.client, true)))}>
                          Repair {a.label}
                        </Button>
                      )}
                      <Button
                       
                        disabled={!!busy}
                        onClick={() =>
                          void act('disable', async () => {
                            const res = await native.integrationSet(a.client, false)
                            setAssigned((res.assigned ?? []).map((x) => ({ client: a.client, ...x })))
                          })
                        }
                      >
                        Disable {a.label}
                      </Button>
                    </>
                  ) : (
                    <Button disabled={!!busy} onClick={() => void act('enable', async () => void (await native.integrationSet(a.client, true)))}>
                      Enable {a.label}
                    </Button>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}
      {assigned.map((x) => (
        <div key={`${x.client}${x.workspace}`} className="stack" role="alert">
          <p>
            {x.tasks} open task(s) in {x.workspace} are still assigned to {x.client === 'codex' ? 'Codex' : 'Claude'}. They stay assigned until you move
            them.
          </p>
          <div className="row">
            <Button
             
              onClick={() =>
                void act('unassign', async () => {
                  const ws = (await native.profiles()).profiles.find((p) => p.local?.alias === x.workspace)
                  if (ws) await native.integrationUnassign(x.client, ws.name)
                  setAssigned((list) => list.filter((y) => y !== x))
                })
              }
            >
              Unassign them in {x.workspace}
            </Button>
          </div>
        </div>
      ))}
      {busy && <p role="status">Working…</p>}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  )
}
