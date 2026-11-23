import { useState } from 'react'
import { guarded } from '../documents/leave'
import { Button } from '../ui'
import { native } from './native'

function messageOf(err: unknown): string {
  return typeof err === 'object' && err && 'message' in err ? String((err as { message: unknown }).message) : String(err)
}

/**
 * Signed updates: the native updater verifies the signature and installs only newer, compatible
 * releases. Installing restarts the app, so it asks first when a document has unsaved changes.
 */
export function UpdateCheck({ size = 'sm' }: { size?: 'sm' | 'md' }) {
  const [status, setStatus] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)
  const [installable, setInstallable] = useState<string | null>(null)
  const check = async () => {
    setChecking(true)
    setStatus('Checking…')
    setInstallable(null)
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
    } finally {
      setChecking(false)
    }
  }
  return (
    <span className="update-check">
      {/* role=status อ่านผลให้ screen reader โดยไม่ย้าย focus */}
      <span role="status">{status}</span>
      {installable ? (
        <Button variant="primary" size={size} onClick={() => void guarded('install the update', () => native.updateInstall().catch((e) => setStatus(messageOf(e))))}>
          Install and restart
        </Button>
      ) : (
        <Button variant={status ? 'ghost' : 'secondary'} size={size} loading={checking} onClick={() => void check()}>
          {status && !checking ? 'Check again' : 'Check for updates'}
        </Button>
      )}
    </span>
  )
}
