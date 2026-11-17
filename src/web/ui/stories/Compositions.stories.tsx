import type { Meta, StoryObj } from '@storybook/react-vite'
import { Bot, Lock, MoreHorizontal, Plus } from 'lucide-react'
import { Avatar, Badge, Banner, Button, Card, IconButton, List, ListItem, Menu, SectionHeader, Switch, TextField } from '..'

const meta: Meta = { title: 'Alice UI/Compositions' }
export default meta
type Story = StoryObj

/** A task list section as later pages will compose it (synthetic data only). */
export const TaskSection: Story = {
  render: () => (
    <section style={{ maxWidth: 720 }} aria-labelledby="due-today">
      <SectionHeader title={<span id="due-today">Due today</span>} level={3} actions={<Button size="sm" icon={Plus}>New task</Button>} />
      <List label="Tasks due today">
        <ListItem leading={<Avatar name="Sample Person" size="sm" />} trailing={<Badge tone="warning">Today</Badge>}>
          Finalise the plan
        </ListItem>
        <ListItem
          leading={<Avatar name="Research Agent" kind="agent" size="sm" />}
          trailing={
            <>
              <Badge tone="agent" icon={Bot}>
                Agent
              </Badge>
              <Menu trigger={<IconButton icon={MoreHorizontal} label="More actions for Collect notes" size="sm" />} items={[{ label: 'Open', onSelect: () => undefined }]} />
            </>
          }
        >
          Collect notes from the last three customer calls and summarise them in one document
        </ListItem>
        <ListItem leading={<Avatar name="Sample Person" size="sm" />} trailing={<Badge tone="danger" icon={Lock}>Blocked</Badge>}>
          Get design assets
        </ListItem>
      </List>
    </section>
  ),
}

export const SettingsCard: Story = {
  render: () => (
    <Card style={{ maxWidth: 560, display: 'grid', gap: 16 }}>
      <SectionHeader title="Workspace" level={3} />
      <TextField label="Workspace name" defaultValue="Personal" />
      <Switch label="Show completed tasks on the board" defaultChecked />
      <Banner tone="info">Local workspaces keep everything on this computer.</Banner>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <Button>Cancel</Button>
        <Button variant="primary">Save</Button>
      </div>
    </Card>
  ),
}
