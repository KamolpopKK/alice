import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { ChevronRight, Info, Laptop, Palette, ShieldCheck, UserRound } from 'lucide-react'
import { Avatar, Badge, Banner, Button, ConfirmDialog, Icon, SectionHeader } from '..'

const meta: Meta = { title: 'Alice UI/Settings and Activity' }
export default meta
type Story = StoryObj

// ข้อมูลสังเคราะห์เท่านั้น: ไม่มี token หรือ endpoint จริง

export const CategoryList: Story = {
  render: () => (
    <nav aria-label="Settings categories" style={{ maxWidth: 360 }}>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 4 }}>
        {[
          { icon: UserRound, label: 'General' },
          { icon: Palette, label: 'Appearance' },
          { icon: Laptop, label: 'Devices & Sessions' },
          { icon: Info, label: 'Advanced' },
          { icon: ShieldCheck, label: 'Administration' },
        ].map((c) => (
          <li key={c.label}>
            <a href="#settings" style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 44 }}>
              <Icon icon={c.icon} size="sm" />
              <span style={{ flex: 1 }}>{c.label}</span>
              <Icon icon={ChevronRight} size="sm" />
            </a>
          </li>
        ))}
      </ul>
    </nav>
  ),
}

export const SecretShownOnce: Story = {
  render: () => (
    <div style={{ display: 'grid', gap: 12, maxWidth: 560 }}>
      <SectionHeader title="Agents" level={3} description="Each agent gets its own identity and token." />
      <Banner tone="warning" title="Token for Research Agent" action={<Button size="sm">Done</Button>}>
        Copy it now. It will not be shown again. (Synthetic example: example-token-value)
      </Banner>
    </div>
  ),
}

export const RevokeConfirmation: Story = {
  render: function Revoke() {
    const [open, setOpen] = useState(false)
    return (
      <>
        <Button onClick={() => setOpen(true)}>Revoke</Button>
        <ConfirmDialog open={open} onOpenChange={setOpen} title="Revoke this token?" confirmLabel="Revoke token" destructive onConfirm={() => setOpen(false)}>
          Anything using “default” for Research Agent loses access immediately. Other tokens keep working.
        </ConfirmDialog>
      </>
    )
  },
}

export const ActivityRows: Story = {
  render: () => (
    <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 12, maxWidth: 640 }} aria-label="Activity">
      <li style={{ display: 'flex', gap: 12 }}>
        <Avatar name="Research Agent" kind="agent" size="sm" />
        <span>
          <strong>Research Agent</strong> <Badge tone="agent">Agent</Badge> changed status from Ready to In progress <a href="#task">Open task</a>
        </span>
      </li>
      <li style={{ display: 'flex', gap: 12 }}>
        <Avatar name="Sample Person" size="sm" />
        <span>
          <strong>Sample Person</strong> created task “Collect notes” <a href="#task">Open task</a>
        </span>
      </li>
    </ol>
  ),
}
