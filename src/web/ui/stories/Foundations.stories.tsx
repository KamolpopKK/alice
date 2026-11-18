import type { Meta, StoryObj } from '@storybook/react-vite'

const meta: Meta = { title: 'Alice UI/Foundations' }
export default meta
type Story = StoryObj

const ROLES = [
  ['--ui-canvas', 'Canvas'],
  ['--ui-surface', 'Surface'],
  ['--ui-surface-raised', 'Raised surface'],
  ['--ui-surface-sunken', 'Sunken surface'],
  ['--ui-surface-hover', 'Hover'],
  ['--ui-surface-selected', 'Selected'],
  ['--ui-border', 'Border'],
  ['--ui-border-strong', 'Strong border'],
  ['--ui-action-primary', 'Primary action'],
  ['--ui-action-danger', 'Danger action'],
  ['--ui-brand', 'Brand'],
  ['--ui-focus', 'Focus'],
] as const

export const ColourRoles: Story = {
  render: () => (
    <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))' }}>
      {ROLES.map(([token, name]) => (
        <li key={token} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ width: 32, height: 32, borderRadius: 6, background: `var(${token})`, border: '1px solid var(--ui-border-strong)' }} />
          <span>
            {name}
            <br />
            <code style={{ fontSize: 'var(--ui-text-xs)', color: 'var(--ui-text-muted)' }}>{token}</code>
          </span>
        </li>
      ))}
    </ul>
  ),
}

export const Typography: Story = {
  render: () => (
    <div style={{ display: 'grid', gap: 8 }}>
      <p style={{ fontSize: 'var(--ui-text-2xl)', fontWeight: 700, margin: 0 }}>Good morning</p>
      <p style={{ fontSize: 'var(--ui-text-xl)', fontWeight: 600, margin: 0 }}>Continue your pad</p>
      <p style={{ fontSize: 'var(--ui-text-lg)', fontWeight: 600, margin: 0 }}>Due today</p>
      <p style={{ fontSize: 'var(--ui-text-md)', margin: 0 }}>Body text for descriptions and comments.</p>
      <p style={{ fontSize: 'var(--ui-text-sm)', color: 'var(--ui-text-muted)', margin: 0 }}>Secondary metadata and hints</p>
      <p style={{ fontSize: 'var(--ui-text-xs)', color: 'var(--ui-text-muted)', margin: 0 }}>Captions and counts</p>
    </div>
  ),
}

export const StatusRoles: Story = {
  render: () => (
    <div style={{ display: 'grid', gap: 8, maxWidth: 420 }}>
      {(['info', 'success', 'warning', 'danger', 'agent'] as const).map((tone) => (
        <p key={tone} style={{ margin: 0, padding: '8px 12px', borderRadius: 8, background: `var(--ui-${tone}-bg)`, color: `var(--ui-${tone}-text)`, fontWeight: 600 }}>
          {tone[0].toUpperCase() + tone.slice(1)} message text
        </p>
      ))}
    </div>
  ),
}
