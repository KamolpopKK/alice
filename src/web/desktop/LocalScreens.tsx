// หน้าของ Local workspaces ใน Desktop: onboarding ครั้งแรก, จัดการ workspace และหน้ากู้คืน
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { ErrorMessage, TextInput } from '../components/ui'
import { native, workspaceLabel, type AgentIntegration, type DesktopProfile, type ProfilesView } from './native'

function messageOf(err: unknown): string {
  return typeof err === 'object' && err && 'message' in err ? String((err as { message: unknown }).message) : String(err)
}

export interface OnboardingResult {
  ownerName: string
  tools: { cli: boolean; codex: boolean; claude: boolean }
}

/**
 * Three decisions only: names, opt-in tools, then straight into a Task Pad. No URL, port, database
 * path, password or MCP configuration is ever asked for.
 */
export function Onboarding({
  onBegin,
  onFinish,
  onFail,
  applyTools,
}: {
  /** Called before the first native change, so profile events do not leave onboarding half-way. */
  onBegin: () => void
  onFinish: (result: OnboardingResult) => void
  onFail: () => void
  applyTools?: (tools: OnboardingResult['tools']) => Promise<void>
}) {
  const [step, setStep] = useState<1 | 2>(1)
  const [workspaceName, setWorkspaceName] = useState('Personal')
  // ไม่ดึงชื่อบัญชีของ OS มาใส่เอง: ค่าเริ่มต้นเป็นชื่อกลาง ๆ ที่แก้ได้
  const [ownerName, setOwnerName] = useState('Local Owner')
  const [tools, setTools] = useState({ cli: true, codex: true, claude: true })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => heading.current?.focus(), [step])

  const finish = async () => {
    setBusy(true)
    setError(null)
    onBegin()
    try {
      const view = await native.localFirstRun()
      const id = view.active!
      if (workspaceName.trim() && workspaceName.trim() !== 'Personal') await native.workspaceRename(id, workspaceName.trim())
      await native.testProfile(id)
      if (ownerName.trim() && ownerName.trim() !== 'Local Owner') await native.ownerRename(ownerName.trim())
      if (applyTools) await applyTools(tools)
      onFinish({ ownerName: ownerName.trim(), tools })
    } catch (err) {
      setError(messageOf(err))
      setBusy(false)
      onFail()
    }
  }

  return (
    <main className="page narrow onboarding">
      <section className="panel stack" aria-labelledby="onboarding-heading">
        <p className="muted small">Step {step} of 3</p>
        {step === 1 ? (
          <form
            className="stack"
            onSubmit={(e: FormEvent) => {
              e.preventDefault()
              setStep(2)
            }}
          >
            <h1 id="onboarding-heading" tabIndex={-1} ref={heading}>
              Welcome to Alice
            </h1>
            <p>Your tasks stay on this computer in a private Local workspace. There is no server to set up and nothing to sign in to.</p>
            <TextInput label="Workspace name" value={workspaceName} onChange={(e) => setWorkspaceName(e.target.value)} maxLength={80} required />
            <TextInput label="Your name" value={ownerName} onChange={(e) => setOwnerName(e.target.value)} maxLength={80} required hint="Shown on what you create; agents get their own names." />
            <div className="row">
              <button className="primary" type="submit">
                Continue
              </button>
            </div>
          </form>
        ) : (
          <form
            className="stack"
            onSubmit={(e: FormEvent) => {
              e.preventDefault()
              void finish()
            }}
          >
            <h1 id="onboarding-heading" tabIndex={-1} ref={heading}>
              Work with your terminal and agents
            </h1>
            <p>
              Alice can install its command-line tool and teach Codex and Claude to use this workspace. Each agent works under its own name, so you
              can always see who changed what. You can change this later in Settings.
            </p>
            <fieldset className="stack">
              <legend>Install</legend>
              <label className="checkbox">
                <input type="checkbox" checked={tools.cli} onChange={(e) => setTools({ ...tools, cli: e.target.checked })} /> The <code>alice</code> command for your terminal
              </label>
              <label className="checkbox">
                <input type="checkbox" checked={tools.codex} onChange={(e) => setTools({ ...tools, codex: e.target.checked })} /> Codex (adds Alice skills to ~/.codex)
              </label>
              <label className="checkbox">
                <input type="checkbox" checked={tools.claude} onChange={(e) => setTools({ ...tools, claude: e.target.checked })} /> Claude Code (adds Alice skills to ~/.claude)
              </label>
            </fieldset>
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <div className="row">
              <button className="primary" type="submit" disabled={busy}>
                {busy ? 'Setting up…' : 'Open my Task Pad'}
              </button>
              <button type="button" onClick={() => setStep(1)} disabled={busy}>
                Back
              </button>
            </div>
          </form>
        )}
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
          <button className="primary" type="button" onClick={onRetry}>
            Try again
          </button>
          {extraActions}
          <button type="button" onClick={() => void diagnose()} disabled={!!busy}>
            Diagnostics
          </button>
          <button type="button" onClick={() => setConfirming(true)} disabled={!!busy} aria-expanded={confirming}>
            Restore latest backup
          </button>
          <button type="button" onClick={() => void native.localOpenFolder(profile.name)}>
            Open data folder
          </button>
          <button type="button" onClick={onSwitch}>
            Switch workspace
          </button>
        </div>
        {confirming && (
          <div className="stack" role="group" aria-labelledby="restore-confirm">
            <p id="restore-confirm">
              Replace <strong>{workspaceLabel(profile)}</strong> with its newest backup? Its current data is backed up first and kept, so you can go back.
            </p>
            <div className="row">
              <button className="primary" type="button" onClick={() => void restore()} disabled={!!busy}>
                Replace with latest backup
              </button>
              <button type="button" onClick={() => setConfirming(false)} disabled={!!busy}>
                Cancel
              </button>
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
                    <button type="submit">Save</button>
                    <button type="button" onClick={() => setEditing(null)}>
                      Cancel
                    </button>
                  </form>
                )}
              </div>
              <div className="row">
                {!p.active && (
                  <button type="button" onClick={() => void run(() => native.useProfile(p.name))} aria-label={`Use ${p.local!.displayName} (${p.local!.alias})`}>
                    Use
                  </button>
                )}
                <button type="button" onClick={() => setEditing({ id: p.name, field: 'name', value: p.local!.displayName })} aria-label={`Rename ${p.local!.alias}`}>
                  Rename
                </button>
                <button type="button" onClick={() => setEditing({ id: p.name, field: 'alias', value: p.local!.alias })} aria-label={`Change alias of ${p.local!.alias}`}>
                  Alias
                </button>
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
        <button type="submit">Create</button>
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
      <h2 id="agents-heading">Agents</h2>
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
                        <button type="button" disabled={!!busy} onClick={() => void act('repair', async () => void (await native.integrationSet(a.client, true)))}>
                          Repair {a.label}
                        </button>
                      )}
                      <button
                        type="button"
                        disabled={!!busy}
                        onClick={() =>
                          void act('disable', async () => {
                            const res = await native.integrationSet(a.client, false)
                            setAssigned((res.assigned ?? []).map((x) => ({ client: a.client, ...x })))
                          })
                        }
                      >
                        Disable {a.label}
                      </button>
                    </>
                  ) : (
                    <button type="button" disabled={!!busy} onClick={() => void act('enable', async () => void (await native.integrationSet(a.client, true)))}>
                      Enable {a.label}
                    </button>
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
            <button
              type="button"
              onClick={() =>
                void act('unassign', async () => {
                  const ws = (await native.profiles()).profiles.find((p) => p.local?.alias === x.workspace)
                  if (ws) await native.integrationUnassign(x.client, ws.name)
                  setAssigned((list) => list.filter((y) => y !== x))
                })
              }
            >
              Unassign them in {x.workspace}
            </button>
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
