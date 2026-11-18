import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { Archive, Keyboard, MoreHorizontal, Plus } from 'lucide-react'
import { Banner, Button, ConfirmDialog, Dialog, IconButton, Menu, TextField } from '..'

const meta: Meta = { title: 'Alice UI/Pads' }
export default meta
type Story = StoryObj

// ข้อมูลสังเคราะห์เท่านั้น: องค์ประกอบของ Task Pads ที่ใช้ primitive ของ Alice UI

export const PadList: Story = {
  render: () => (
    <aside style={{ display: 'grid', gap: 10, maxWidth: 300 }} aria-label="Task pads">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 style={{ margin: 0, fontSize: 18 }}>Task Pads</h1>
        <Menu
          trigger={<IconButton icon={MoreHorizontal} label="More pad options" size="sm" />}
          items={[
            { label: 'Archived pads', icon: Archive, onSelect: () => undefined },
            { label: 'Capture shortcuts…', icon: Keyboard, onSelect: () => undefined },
          ]}
        />
      </div>
      <Button variant="primary" icon={Plus}>
        New Pad
      </Button>
      <TextField label="Search pads" hideLabel type="search" placeholder="Search pads" />
      <nav aria-label="Recent pads">
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 4 }}>
          <li>
            <a href="#pad" aria-current="page">
              Weekly sync
            </a>
          </li>
          <li>
            <a href="#pad">Customer call notes</a>
          </li>
        </ul>
      </nav>
    </aside>
  ),
}

export const SyncStates: Story = {
  render: () => (
    <div style={{ display: 'grid', gap: 12, maxWidth: 640 }}>
      <Banner tone="warning" action={<Button size="sm">Retry now</Button>}>
        Not synced: 2 changes saved on this device and will be sent when the connection returns.
      </Banner>
      <Banner tone="danger">1 line could not be saved. Use Retry or Discard on it below.</Banner>
      <Banner tone="warning">This line was updated on another device; the newer text is shown.</Banner>
    </div>
  ),
}

export const PasteDialog: Story = {
  render: function PasteDialogStory() {
    const [open, setOpen] = useState(false)
    return (
      <>
        <Button onClick={() => setOpen(true)}>Paste three lines</Button>
        <Dialog
          open={open}
          onOpenChange={setOpen}
          title="Paste multiple lines"
          description="You pasted 3 non-blank lines. Create a task from each line, or keep them as text in this pad."
          actions={
            <>
              <Button onClick={() => setOpen(false)} data-autofocus>
                Cancel
              </Button>
              <Button onClick={() => setOpen(false)}>Paste as text</Button>
              <Button variant="primary" onClick={() => setOpen(false)}>
                Create 3 tasks
              </Button>
            </>
          }
        />
      </>
    )
  },
}

export const DeleteConfirmation: Story = {
  render: function DeleteStory() {
    const [open, setOpen] = useState(false)
    return (
      <>
        <Button variant="danger" onClick={() => setOpen(true)}>
          Delete pad permanently…
        </Button>
        <ConfirmDialog open={open} onOpenChange={setOpen} title="Delete pad permanently?" confirmLabel="Delete pad permanently" destructive onConfirm={() => setOpen(false)}>
          “Weekly sync” and all of its notes will be removed for good. Tasks created from it stay on the Board unchanged.
        </ConfirmDialog>
      </>
    )
  },
}
