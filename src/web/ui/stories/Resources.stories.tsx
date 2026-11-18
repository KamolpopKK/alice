import type { Meta, StoryObj } from '@storybook/react-vite'
import { FileText, FolderClosed, Link2, MessageSquare, SquareCheck } from 'lucide-react'
import { Badge, Banner, Button, EmptyState, ResourceItem, ResourceList, Skeleton, Tabs } from '..'

const meta: Meta = { title: 'Alice UI/Resources' }
export default meta
type Story = StoryObj

// ข้อมูลสังเคราะห์เท่านั้น

export const ProjectCards: Story = {
  render: () => (
    <ResourceList label="Active projects">
      <ResourceItem icon={FolderClosed} title={<a href="#p">Untitled</a>} text="Default home for tasks created without a project." meta={<Badge>Default for new tasks</Badge>} />
      <ResourceItem
        icon={FolderClosed}
        title={<a href="#p">Website launch</a>}
        text="Launch the new company website to improve the brand and clarify the product offering for every visitor."
        meta={<Badge tone="success">Active</Badge>}
      />
      <ResourceItem icon={FolderClosed} title={<a href="#p">A project with a very long name that has to wrap onto a second line</a>} text="No description." />
    </ResourceList>
  ),
}

export const DocumentList: Story = {
  render: () => (
    <ResourceList label="Documents" layout="list">
      <ResourceItem icon={FileText} title={<a href="#d">Website requirements</a>} text="A clear, fast site with a pricing page and docs." meta={<span>Revision 3 · Updated by Sample Person</span>} />
      <ResourceItem icon={Link2} title={<a href="#d">Brand guidelines</a>} meta={<span>https://example.com/brand</span>} />
      <ResourceItem icon={FileText} title={<a href="#d">Old plan</a>} meta={<Badge>archived</Badge>} />
    </ResourceList>
  ),
}

export const SearchResults: Story = {
  render: () => (
    <ResourceList label="Search results" layout="list" ordered>
      <ResourceItem icon={SquareCheck} title={<a href="#t">Finalise launch checklist</a>} text={<><mark>launch</mark> readiness for the team</>} meta={<Badge>Task</Badge>} />
      <ResourceItem icon={FileText} title={<a href="#d">Launch plan</a>} text={<>Plan the <mark>launch</mark> week</>} meta={<Badge>Document</Badge>} />
      <ResourceItem icon={MessageSquare} title={<a href="#c">Review design with stakeholders</a>} text={<>Moved the <mark>launch</mark> to Friday</>} meta={<Badge>Comment</Badge>} />
    </ResourceList>
  ),
}

export const ProjectTabs: Story = {
  render: () => (
    <Tabs
      label="Project sections"
      items={[
        { value: 'overview', label: 'Overview', content: <p>Launch the new company website.</p> },
        { value: 'tasks', label: 'Tasks', content: <Skeleton lines={3} /> },
        { value: 'documents', label: 'Documents', content: <EmptyState title="No linked documents" /> },
        { value: 'activity', label: 'Activity', content: <p>Sample Person created the project.</p> },
      ]}
    />
  ),
}

export const LoadStates: Story = {
  render: () => (
    <div style={{ display: 'grid', gap: 16, maxWidth: 640 }}>
      <Skeleton lines={3} />
      <EmptyState title="No documents found.">Try other words, or show archived documents.</EmptyState>
      <Banner tone="danger" title="Documents could not be loaded" action={<Button size="sm">Try again</Button>}>
        The server did not respond.
      </Banner>
    </div>
  ),
}
