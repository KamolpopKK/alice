import type { Meta, StoryObj } from '@storybook/react-vite'
import { Archive, Copy, MoreHorizontal, Pencil, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Button, ConfirmDialog, Dialog, IconButton, Menu, Popover, Sheet, TextField, Tooltip, useToast } from '..'

const meta: Meta = { title: 'Alice UI/Overlays' }
export default meta
type Story = StoryObj

export const TooltipOnFocus: Story = {
  render: () => (
    <Tooltip content="Archive keeps the task and its history">
      <IconButton icon={Archive} label="Archive" variant="secondary" />
    </Tooltip>
  ),
}

export const ActionMenu: Story = {
  render: () => (
    <Menu
      trigger={<IconButton icon={MoreHorizontal} label="More actions" variant="secondary" />}
      items={[
        { label: 'Rename', icon: Pencil, onSelect: () => undefined, shortcut: 'R' },
        { label: 'Copy link', icon: Copy, onSelect: () => undefined },
        { kind: 'separator' },
        { label: 'Archive', icon: Archive, onSelect: () => undefined },
        { label: 'Delete', icon: Trash2, onSelect: () => undefined, destructive: true },
        { label: 'Move to another workspace', onSelect: () => undefined, disabled: true },
      ]}
    />
  ),
}

export const PopoverPanel: Story = {
  render: () => (
    <Popover label="Filter tasks" trigger={<Button>Filter</Button>}>
      <TextField label="Label contains" placeholder="design" />
    </Popover>
  ),
}

export const Dialogs: Story = {
  render: function Dialogs() {
    const [open, setOpen] = useState(false)
    const [confirm, setConfirm] = useState(false)
    const toast = useToast()
    return (
      <div style={{ display: 'flex', gap: 8 }}>
        <Button onClick={() => setOpen(true)}>Rename pad</Button>
        <Button variant="danger" onClick={() => setConfirm(true)}>
          Delete pad
        </Button>
        <Dialog
          open={open}
          onOpenChange={setOpen}
          title="Rename pad"
          description="The name appears in the pad list and search."
          actions={
            <>
              <Button onClick={() => setOpen(false)}>Cancel</Button>
              <Button
                variant="primary"
                onClick={() => {
                  setOpen(false)
                  toast.show('Pad renamed', { tone: 'success' })
                }}
              >
                Save
              </Button>
            </>
          }
        >
          <TextField label="Name" defaultValue="Customer call" />
        </Dialog>
        <ConfirmDialog open={confirm} onOpenChange={setConfirm} title="Delete this pad?" confirmLabel="Delete pad" destructive onConfirm={() => setConfirm(false)}>
          Its Text and Heading lines are deleted. Tasks created from it stay on the Board.
        </ConfirmDialog>
      </div>
    )
  },
}

export const DialogOpen: Story = {
  render: () => (
    <Dialog open onOpenChange={() => undefined} title="Rename pad" description="The name appears in the pad list and search." actions={<Button variant="primary">Save</Button>}>
      <TextField label="Name" defaultValue="Customer call" />
    </Dialog>
  ),
}

export const SheetOpen: Story = {
  render: () => (
    <Sheet open onOpenChange={() => undefined} title="Task detail" side="right">
      <p>Long content scrolls inside the sheet, never the page behind it.</p>
      {Array.from({ length: 12 }, (_, i) => (
        <p key={i}>Paragraph {i + 1} of example detail text.</p>
      ))}
    </Sheet>
  ),
}

export const Toasts: Story = {
  render: function Toasts() {
    const toast = useToast()
    return (
      <div style={{ display: 'flex', gap: 8 }}>
        <Button onClick={() => toast.show('Task created', { tone: 'success', action: { label: 'Undo', onAction: () => undefined } })}>Show success</Button>
        <Button onClick={() => toast.show('Link copied')}>Show info</Button>
      </div>
    )
  },
}
