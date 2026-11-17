import { Monitor, Moon, Sun } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth'
import { Card, SectionHeader, SegmentedControl, useTheme, type ThemePreference } from '../ui'
import { useLocalWorkspace } from '../workspace-mode'

/**
 * Settings: appearance for everyone, then what this workspace allows. Devices and sessions exist
 * only on Remote servers; administration only for their owner. The server enforces both anyway.
 */
export function SettingsPage() {
  const { preference, setPreference } = useTheme()
  const { actor } = useAuth()
  const local = useLocalWorkspace()
  return (
    <div className="page settings-page">
      <h1>Settings</h1>
      <section aria-labelledby="settings-appearance" className="settings-section">
        <SectionHeader title={<span id="settings-appearance">Appearance</span>} level={2} description="Saved on this device only." />
        <SegmentedControl
          label="Theme"
          value={preference}
          onValueChange={(v) => setPreference(v as ThemePreference)}
          options={[
            { value: 'light', label: 'Light', icon: Sun },
            { value: 'dark', label: 'Dark', icon: Moon },
            { value: 'system', label: 'System', icon: Monitor },
          ]}
        />
      </section>
      {!local && (
        <section aria-labelledby="settings-account" className="settings-section">
          <SectionHeader title={<span id="settings-account">Account and devices</span>} level={2} />
          <Card>
            <Link to="/devices">Devices and sessions</Link>
            <p className="ui-text-muted">Approve a sign-in code and revoke apps signed in as you.</p>
          </Card>
        </section>
      )}
      {!local && actor?.isOwner && (
        <section aria-labelledby="settings-admin" className="settings-section">
          <SectionHeader title={<span id="settings-admin">Administration</span>} level={2} />
          <Card>
            <Link to="/admin">Workspace admin</Link>
            <p className="ui-text-muted">Invite people, manage agents and their tokens, and see who can do what.</p>
          </Card>
        </section>
      )}
    </div>
  )
}
