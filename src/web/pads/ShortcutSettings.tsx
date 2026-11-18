import { useEffect, useState, type KeyboardEvent } from 'react'
import { Button, Checkbox, Dialog, TextField } from '../ui'
import { ErrorMessage } from '../components/ui'
import { native, type ShortcutStatus, type ShortcutsView } from '../desktop/native'
import { isDesktop } from '../platform'
import { setWebShortcutsEnabled, webShortcutsEnabled } from './capture'

/** Builds an accelerator from a key press (e.g. Option+Shift+Space → Alt+Shift+Space). */
function accelerator(e: KeyboardEvent): string | null {
  const code = e.code
  let key: string | null = null
  if (code === 'Space') key = 'Space'
  else if (/^Key[A-Z]$/.test(code)) key = code.slice(3)
  else if (/^Digit\d$/.test(code)) key = code.slice(5)
  else if (/^F\d{1,2}$/.test(code)) key = code
  else if (code === 'Period' || code === 'Comma' || code === 'Slash' || code === 'Semicolon' || code === 'Quote' || code === 'Backquote' || code === 'Enter') key = code
  if (!key) return null
  const mods = [e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift', e.metaKey && 'Super'].filter(Boolean)
  return [...mods, key].join('+')
}

function pretty(accel: string, platform: string): string {
  if (platform !== 'macos') return accel.replace('Super', 'Win')
  return accel.replace('Alt', 'Option').replace('Super', 'Cmd')
}

function StatusLine({ status }: { status: ShortcutStatus | undefined }) {
  if (!status) return null
  if (status.state === 'registered') return <p className="hint">Active</p>
  if (status.state === 'disabled') return <p className="hint">Off</p>
  return (
    <p className="error" role="alert">
      {status.message ?? 'This shortcut is not active.'}
    </p>
  )
}

function ShortcutField({ label, value, platform, onChange }: { label: string; value: string; platform: string; onChange: (v: string) => void }) {
  const id = `shortcut-${label.replace(/\W+/g, '-').toLowerCase()}`
  return (
    <TextField
      id={id}
      label={label}
      hint={<>Press the combination, or type it (for example {pretty('Alt+Shift+Space', platform)}).</>}
      value={value}
      onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          // กดคีย์ผสมเพื่อบันทึก (Tab/Escape ใช้งานตามปกติ)
          if (e.key === 'Tab' || e.key === 'Escape' || (!e.ctrlKey && !e.altKey && !e.metaKey)) return
          const accel = accelerator(e)
          if (!accel) return
          e.preventDefault()
          onChange(accel)
        }}
    />
  )
}

function DesktopShortcuts() {
  const [view, setView] = useState<ShortcutsView | null>(null)
  const [draft, setDraft] = useState<{ enabled: boolean; openLast: string; newPad: string } | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [saved, setSaved] = useState(false)
  useEffect(() => {
    native
      .shortcutsGet()
      .then((v) => {
        setView(v)
        setDraft({ enabled: v.enabled, openLast: v.openLast, newPad: v.newPad })
      })
      .catch(setError)
  }, [])
  if (!view || !draft) return <ErrorMessage error={error} />
  const apply = (p: Promise<ShortcutsView>) =>
    p
      .then((v) => {
        setView(v)
        setDraft({ enabled: v.enabled, openLast: v.openLast, newPad: v.newPad })
        setError(null)
        setSaved(true)
      })
      .catch((e) => {
        setSaved(false)
        setError(e)
      })
  return (
    <section className="stack" aria-labelledby="desktop-shortcuts-heading">
      <h3 id="desktop-shortcuts-heading">Alice Desktop (works from any app)</h3>
      <Checkbox label="Use global capture shortcuts on this computer" checked={draft.enabled} onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })} />
      <ShortcutField label="Open last pad" value={draft.openLast} platform={view.platform} onChange={(openLast) => setDraft({ ...draft, openLast })} />
      <StatusLine status={view.status.openLast} />
      <ShortcutField label="New pad" value={draft.newPad} platform={view.platform} onChange={(newPad) => setDraft({ ...draft, newPad })} />
      <StatusLine status={view.status.newPad} />
      <ErrorMessage error={error} />
      {saved && !error && (
        <p className="hint" role="status">
          Saved for this computer.
        </p>
      )}
      <div className="row">
        <Button variant="primary" onClick={() => apply(native.shortcutsSet(draft))}>
          Save shortcuts
        </Button>
        <Button onClick={() => apply(native.shortcutsReset())}>
          Restore defaults ({pretty(view.defaults.openLast, view.platform)}, {pretty(view.defaults.newPad, view.platform)})
        </Button>
      </div>
    </section>
  )
}

/** Capture shortcut settings: active-tab shortcuts everywhere, plus OS-global ones in Alice Desktop. */
export function ShortcutSettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [web, setWeb] = useState(webShortcutsEnabled)
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()} title="Capture shortcuts" size="lg">
      <div className="stack">
        <section className="stack" aria-labelledby="web-shortcuts-heading">
          <h3 id="web-shortcuts-heading">While Alice is the active {isDesktop ? 'window' : 'tab'}</h3>
          <dl className="shortcut-list">
            <dt>
              <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>P</kbd>
            </dt>
            <dd>Open the last pad and start a new task line</dd>
            <dt>
              <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>N</kbd>
            </dt>
            <dd>Create a new pad named with the date and time</dd>
          </dl>
          <Checkbox
            label="Enable these shortcuts in this browser"
            checked={web}
            onChange={(e) => {
              setWeb(e.target.checked)
              setWebShortcutsEnabled(e.target.checked)
            }}
          />
          <p className="hint">In the editor: Enter, Tab, Shift+Tab, Alt+Shift+arrows to move or nest, Ctrl/⌘+/ for line actions, Ctrl/⌘+Z to undo.</p>
        </section>
        {isDesktop && <DesktopShortcuts />}
      </div>
    </Dialog>
  )
}
