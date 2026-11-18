import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { Checkbox, FieldMessage, RadioGroup, SelectField, Switch, TextArea, TextField } from '..'

const meta: Meta = { title: 'Alice UI/Fields' }
export default meta
type Story = StoryObj

export const TextInputs: Story = {
  render: () => (
    <div style={{ display: 'grid', gap: 16, maxWidth: 420 }}>
      <TextField label="Task title" placeholder="What needs doing?" required />
      <TextField label="Project name" hint="Shown on every task in the project." defaultValue="Website relaunch" />
      <TextField label="Due date" type="date" error="Pick a date on or after today." defaultValue="2020-01-01" />
      <TextField label="Server" defaultValue="https://alice.example.test" disabled />
      <TextArea label="Description" hint="Markdown is supported." defaultValue={'First line\n\nA longer paragraph that wraps across several lines to show how the field grows.'} />
    </div>
  ),
}

export const Choices: Story = {
  render: function Choices() {
    const [view, setView] = useState('board')
    const [live, setLive] = useState(true)
    return (
      <div style={{ display: 'grid', gap: 16, maxWidth: 420 }}>
        <SelectField
          label="Status"
          defaultValue="ready"
          options={[
            { value: 'backlog', label: 'Backlog' },
            { value: 'ready', label: 'Ready' },
            { value: 'in_progress', label: 'In progress' },
            { value: 'done', label: 'Done' },
          ]}
        />
        <Checkbox label="Notify me when an agent completes a task" defaultChecked />
        <Checkbox label="Include archived tasks" hint="Archived tasks are read-only." />
        <Switch label="Live updates" checked={live} onChange={(e) => setLive(e.target.checked)} hint="Turn off to pause the board while reading." />
        <RadioGroup
          legend="Default view"
          name="view"
          value={view}
          onChange={setView}
          options={[
            { value: 'my-work', label: 'My Work', hint: 'Tasks assigned to you' },
            { value: 'board', label: 'Board' },
            { value: 'list', label: 'List' },
          ]}
        />
      </div>
    )
  },
}

export const Feedback: Story = {
  render: () => (
    <div style={{ display: 'grid', gap: 8, maxWidth: 420 }}>
      <FieldMessage tone="error">This title is already used by another pad.</FieldMessage>
      <FieldMessage tone="success">Saved.</FieldMessage>
      <FieldMessage tone="info">Changes are saved automatically.</FieldMessage>
    </div>
  ),
}
