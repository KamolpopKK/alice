import type { Meta, StoryObj } from '@storybook/react-vite'
import { Activity, FileText, LayoutGrid, List, ListChecks, Monitor, Moon, Sun, UserRound } from 'lucide-react'
import { useState } from 'react'
import { EmptyState, SegmentedControl, Tabs, useTheme } from '..'

const meta: Meta = { title: 'Alice UI/Navigation' }
export default meta
type Story = StoryObj

export const ProjectTabs: Story = {
  render: () => (
    <Tabs
      label="Project sections"
      items={[
        { value: 'overview', label: 'Overview', content: <p>Summary of the project.</p> },
        { value: 'tasks', label: 'Tasks', icon: ListChecks, count: 12, content: <p>12 open tasks.</p> },
        { value: 'documents', label: 'Documents', icon: FileText, count: 3, content: <EmptyState title="No documents linked" /> },
        { value: 'activity', label: 'Activity', icon: Activity, content: <p>Recent changes.</p> },
      ]}
    />
  ),
}

export const TaskViews: Story = {
  render: function TaskViews() {
    const [view, setView] = useState('board')
    return (
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
    )
  },
}

export const ThemeChoice: Story = {
  render: function ThemeChoice() {
    const { resolved } = useThemeSafe()
    const [value, setValue] = useState('system')
    return (
      <div style={{ display: 'grid', gap: 8, justifyItems: 'start' }}>
        <SegmentedControl
          label="Theme"
          value={value}
          onValueChange={setValue}
          options={[
            { value: 'light', label: 'Light', icon: Sun },
            { value: 'dark', label: 'Dark', icon: Moon },
            { value: 'system', label: 'System', icon: Monitor },
          ]}
        />
        <p className="ui-text-muted">Storybook theme: {resolved}</p>
      </div>
    )
  },
}

// Stories run without the app's ThemeProvider; the toolbar sets the theme.
function useThemeSafe() {
  try {
    return useTheme()
  } catch {
    return { resolved: document.documentElement.getAttribute('data-theme') ?? 'system' }
  }
}
