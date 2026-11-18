import type { Meta, StoryObj } from '@storybook/react-vite'
import { Bot, CircleDot, FolderOpen, Inbox, Lock } from 'lucide-react'
import { Avatar, Badge, Banner, Button, Card, EmptyState, List, ListItem, SectionHeader, Skeleton, Table } from '..'

const meta: Meta = { title: 'Alice UI/Display' }
export default meta
type Story = StoryObj

export const Badges: Story = {
  render: () => (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      <Badge>Backlog</Badge>
      <Badge tone="info" icon={CircleDot}>
        In progress
      </Badge>
      <Badge tone="success">Done</Badge>
      <Badge tone="warning">Due today</Badge>
      <Badge tone="danger" icon={Lock}>
        Blocked
      </Badge>
      <Badge tone="agent" icon={Bot}>
        Agent
      </Badge>
      <Badge tone="brand">Local</Badge>
    </div>
  ),
}

export const Avatars: Story = {
  render: () => (
    <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
      <Avatar name="Sample Person" size="sm" />
      <Avatar name="Sample Person" />
      <Avatar name="Sample Person" size="lg" />
      <Avatar name="Research Agent" kind="agent" />
      <Avatar name="" />
    </div>
  ),
}

export const CardsAndSections: Story = {
  render: () => (
    <div style={{ display: 'grid', gap: 16, maxWidth: 640 }}>
      <SectionHeader title="Projects" description="Active work grouped by project." actions={<Button size="sm">New project</Button>} />
      <Card>
        <strong>Website relaunch</strong>
        <p className="ui-text-muted">12 open tasks · 3 documents</p>
      </Card>
      <Card>
        <strong>A project whose name is long enough to wrap onto a second line on narrow screens</strong>
      </Card>
    </div>
  ),
}

export const ListsAndTables: Story = {
  render: () => (
    <div style={{ display: 'grid', gap: 24, maxWidth: 640 }}>
      <List label="Recent activity">
        <ListItem leading={<Avatar name="Sample Person" size="sm" />} trailing="2 min ago">
          Sample Person moved “Draft homepage copy” to In progress
        </ListItem>
        <ListItem leading={<Avatar name="Research Agent" kind="agent" size="sm" />} trailing="1 h ago">
          Research Agent completed “Summarise competitor notes”
        </ListItem>
      </List>
      <Table caption="Devices signed in">
        <thead>
          <tr>
            <th scope="col">Device</th>
            <th scope="col">Client</th>
            <th scope="col">Last used</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>example-laptop</td>
            <td>Alice Desktop</td>
            <td>Today</td>
          </tr>
          <tr>
            <td>build-box</td>
            <td>Alice CLI</td>
            <td>Yesterday</td>
          </tr>
        </tbody>
      </Table>
    </div>
  ),
}

export const EmptyLoadingAndBanners: Story = {
  render: () => (
    <div style={{ display: 'grid', gap: 16, maxWidth: 640 }}>
      <EmptyState icon={Inbox} title="Nothing waiting for you" action={<Button variant="primary">New task</Button>}>
        Tasks assigned to you will appear here.
      </EmptyState>
      <EmptyState icon={FolderOpen} title="No documents yet" />
      <div role="status" aria-label="Loading tasks">
        <Skeleton lines={3} />
      </div>
      <Banner tone="warning" title="Not synced" action={<Button size="sm">Retry</Button>}>
        2 changes are saved on this device and will be sent when the connection returns.
      </Banner>
      <Banner tone="danger" title="Cannot reach the server">
        Nothing is shown until the server answers.
      </Banner>
      <Banner tone="info" onDismiss={() => undefined}>
        What’s new: Tasks now has My Work, Board and List views.
      </Banner>
      <Banner tone="success">Workspace restored from the latest backup.</Banner>
    </div>
  ),
}
