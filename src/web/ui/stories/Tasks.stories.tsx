import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { Bookmark, Filter, LayoutGrid, List, Plus, UserRound } from 'lucide-react'
import { Banner, Button, EmptyState, FieldMessage, InlineSelect, SegmentedControl, SelectField, Skeleton, Spinner, TaskItem, TextField } from '..'

const meta: Meta = { title: 'Alice UI/Tasks' }
export default meta
type Story = StoryObj

// ข้อมูลสังเคราะห์เท่านั้น
const STATUS = [
  { value: 'backlog', label: 'Backlog' },
  { value: 'ready', label: 'Ready' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'blocked', label: 'Blocked' },
  { value: 'done', label: 'Done' },
]
const TONE: Record<string, 'neutral' | 'info' | 'danger' | 'success'> = { backlog: 'neutral', ready: 'neutral', in_progress: 'info', blocked: 'danger', done: 'success' }

function Status({ title, initial }: { title: string; initial: string }) {
  const [value, setValue] = useState(initial)
  return <InlineSelect label={`Status of ${title}`} value={value} tone={TONE[value]} options={STATUS} onChange={(e) => setValue(e.target.value)} />
}

const title = (text: string) => <a href="#task">{text}</a>

export const Cards: Story = {
  render: () => (
    <ul style={{ display: 'grid', gap: 8, maxWidth: 280, listStyle: 'none', padding: 0 }} aria-label="Ready tasks">
      <li>
        <TaskItem
          title={title('Finalise launch checklist')}
          status={<Status title="Finalise launch checklist" initial="ready" />}
          priority="high"
          assignee={{ name: 'Sample Person' }}
          project="Launch"
          due={{ label: 'Today', tone: 'warning' }}
        />
      </li>
      <li>
        <TaskItem
          title={title('Collect notes from the last three customer calls and summarise them in one shared document')}
          status={<Status title="Collect notes" initial="ready" />}
          assignee={{ name: 'Research Agent', kind: 'agent' }}
          project="Research"
        />
      </li>
      <li>
        <TaskItem
          title={title('Get design assets')}
          status={<Status title="Get design assets" initial="blocked" />}
          priority="urgent"
          assignee={{ name: null }}
          due={{ label: 'Overdue · 3 Feb', tone: 'danger' }}
          blocked="Blocked by 2"
          selected
        />
      </li>
    </ul>
  ),
}

export const Rows: Story = {
  render: () => (
    <ul style={{ maxWidth: 760, listStyle: 'none', padding: 0, margin: 0 }} aria-label="In progress">
      <li>
        <TaskItem layout="row" title={title('Update project timeline')} status={<Status title="Update project timeline" initial="in_progress" />} priority="urgent" assignee={{ name: 'Sample Person' }} project="Launch" due={{ label: 'Tomorrow' }} />
      </li>
      <li>
        <TaskItem
          layout="row"
          title={title('Refine requirements')}
          status={<InlineSelect label="Status of Refine requirements" value="in_progress" tone="info" options={STATUS} disabled aria-busy onChange={() => undefined} />}
          assignee={{ name: 'Sample Person' }}
          feedback={
            <span role="status">
              <Spinner size="sm" /> Saving…
            </span>
          }
        />
      </li>
      <li>
        <TaskItem
          layout="row"
          title={title('Prepare customer update')}
          status={<Status title="Prepare customer update" initial="ready" />}
          assignee={{ name: null }}
          feedback={<FieldMessage tone="error">Status not changed: the connection was lost.</FieldMessage>}
        />
      </li>
    </ul>
  ),
}

export const Toolbar: Story = {
  render: function Toolbar() {
    const [view, setView] = useState('board')
    return (
      <div style={{ display: 'grid', gap: 12 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', justifyContent: 'space-between' }}>
          <h1 style={{ margin: 0 }}>Tasks</h1>
          <Button variant="primary" icon={Plus}>
            New task
          </Button>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          <SegmentedControl
            label="Task view"
            value={view}
            onValueChange={setView}
            options={[
              { value: 'my-work', label: 'My Work', icon: UserRound },
              { value: 'board', label: 'Board', icon: LayoutGrid },
              { value: 'list', label: 'List', icon: List },
            ]}
          />
          <div style={{ flex: '1 1 8rem', maxWidth: '20rem', minWidth: 0 }}>
            <TextField label="Search tasks" hideLabel type="search" placeholder="Search tasks" />
          </div>
          <Button size="sm" icon={Filter} aria-label="Filters, 2 active">
            Filters · 2
          </Button>
          <div style={{ flex: '0 1 10rem' }}>
            <SelectField label="Sort by" hideLabel defaultValue="priority" options={[{ value: 'priority', label: 'Priority' }, { value: 'due', label: 'Due date' }]} />
          </div>
          <Button size="sm" icon={Bookmark}>
            Saved views
          </Button>
        </div>
      </div>
    )
  },
}

export const ViewStates: Story = {
  render: () => (
    <div style={{ display: 'grid', gap: 24, maxWidth: 640 }}>
      <section aria-label="Loading">
        <Skeleton lines={3} />
      </section>
      <EmptyState title="No tasks match these filters">Change the filters, or create a task.</EmptyState>
      <Banner tone="danger" title="Tasks could not be loaded" action={<Button size="sm">Try again</Button>}>
        The server did not respond.
      </Banner>
    </div>
  ),
}

export const EditConflict: Story = {
  render: () => (
    <form style={{ display: 'grid', gap: 12, maxWidth: 560 }} aria-label="Edit task" onSubmit={(e) => e.preventDefault()}>
      <Banner
        tone="warning"
        title="This task changed while you were editing"
        action={
          <>
            <Button size="sm">Load their changes</Button>
            <Button size="sm" variant="ghost">
              Keep mine
            </Button>
          </>
        }
      >
        Research Agent updated it. Saving now replaces their title, description and labels with yours.
      </Banner>
      <TextField label="Title" defaultValue="Finalise launch checklist" />
      <div style={{ display: 'flex', gap: 8 }}>
        <Button variant="primary" type="submit">
          Save
        </Button>
        <Button>Cancel</Button>
      </div>
    </form>
  ),
}

export const FieldFeedback: Story = {
  render: () => (
    <div style={{ display: 'grid', gap: 12, maxWidth: 320 }}>
      <div style={{ display: 'grid', gap: 4 }}>
        <SelectField label="Priority" defaultValue="high" options={[{ value: 'high', label: 'High' }, { value: 'low', label: 'Low' }]} />
        <span role="status" className="ui-field-message ui-field-message--success">
          Saved
        </span>
      </div>
      <div style={{ display: 'grid', gap: 4 }}>
        <TextField label="Due date" type="date" defaultValue="2030-01-02" />
        <FieldMessage tone="error">Due date is not valid.</FieldMessage>
      </div>
    </div>
  ),
}
