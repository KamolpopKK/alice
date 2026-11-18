import type { Meta, StoryObj } from '@storybook/react-vite'
import { Archive, MoreHorizontal, Plus, Trash2 } from 'lucide-react'
import { Button, IconButton, LinkButton, Spinner, TextLink } from '..'

const meta: Meta = { title: 'Alice UI/Controls' }
export default meta
type Story = StoryObj

export const Buttons: Story = {
  render: () => (
    <div style={{ display: 'grid', gap: 16 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <Button variant="primary" icon={Plus}>
          New task
        </Button>
        <Button>Cancel</Button>
        <Button variant="ghost">Skip for now</Button>
        <Button variant="danger" icon={Trash2}>
          Delete pad
        </Button>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <Button variant="primary" size="sm">
          Save
        </Button>
        <Button size="sm">Small secondary</Button>
        <Button variant="primary" loading>
          Saving
        </Button>
        <Button disabled>Disabled</Button>
      </div>
    </div>
  ),
}

export const IconButtons: Story = {
  render: () => (
    <div style={{ display: 'flex', gap: 8 }}>
      <IconButton icon={MoreHorizontal} label="More actions for Example task" />
      <IconButton icon={Archive} label="Archive" variant="secondary" />
      <IconButton icon={Trash2} label="Delete" variant="danger" />
      <IconButton icon={Plus} label="Add" size="sm" />
      <IconButton icon={Plus} label="Add (unavailable)" disabled />
    </div>
  ),
}

export const Links: Story = {
  render: () => (
    <div style={{ display: 'grid', gap: 12, justifyItems: 'start' }}>
      <p style={{ margin: 0 }}>
        Read the <TextLink href="#guide">setup guide</TextLink> before connecting an agent.
      </p>
      <LinkButton href="#tasks" variant="primary">
        Open Tasks
      </LinkButton>
      <span>
        <Spinner label="Loading tasks" /> Loading tasks
      </span>
    </div>
  ),
}

export const LongLabels: Story = {
  render: () => (
    <div style={{ maxWidth: 280, display: 'grid', gap: 8 }}>
      <Button variant="primary">Create the project and invite the whole team</Button>
      <Button>Very long secondary action label that keeps one line</Button>
    </div>
  ),
}
