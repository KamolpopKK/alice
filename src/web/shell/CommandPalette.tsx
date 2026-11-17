import * as RDialog from '@radix-ui/react-dialog'
import { useQuery } from '@tanstack/react-query'
import { CircleHelp, FilePlus2, FolderPlus, Monitor, Moon, NotebookPen, Repeat, Search, SquarePlus, Sun, type LucideIcon } from 'lucide-react'
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { client } from '../api'
import { useCapability } from '../hooks'
import { useNewPad } from '../pads/PadSidebar'
import { useTheme } from '../ui'
import { available, PRIMARY, SECONDARY } from './nav'
import { useShellWorkspace } from './workspace'

interface Command {
  id: string
  group: 'Go to' | 'Create' | 'Tasks' | 'Workspace' | 'Theme' | 'Help'
  label: string
  icon: LucideIcon
  keywords?: string
  run: () => void
}

/** Ctrl+K / Cmd+K opens the palette from anywhere, including text fields. */
export function usePaletteShortcut(open: () => void) {
  useEffect(() => {
    const on = (e: globalThis.KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        open()
      }
    }
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  }, [open])
}

const GROUP_ORDER: Command['group'][] = ['Tasks', 'Go to', 'Create', 'Workspace', 'Theme', 'Help']

/**
 * Keyboard command palette: navigation, task search, creation, workspace switching, theme, Help and
 * Settings. A combobox over a grouped listbox; focus returns to where it was opened.
 */
export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const navigate = useNavigate()
  const taskPads = useCapability('task-pads')
  const newPad = useNewPad()
  const ws = useShellWorkspace()
  const { setPreference } = useTheme()
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const opener = useRef<HTMLElement | null>(null)
  const listId = useId()
  const q = query.trim().toLowerCase()

  useEffect(() => {
    if (open) {
      opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
      setQuery('')
      setActive(0)
    }
  }, [open])

  const tasks = useQuery({
    queryKey: ['palette-tasks', q],
    queryFn: () => client.search({ q, kind: ['task'], limit: 6 }),
    enabled: open && q.length >= 2,
    staleTime: 5_000,
  })

  const commands = useMemo<Command[]>(() => {
    const go = (to: string) => () => navigate(to)
    const list: Command[] = [
      ...[...available(PRIMARY, { taskPads }), ...SECONDARY].map((d) => ({ id: `go:${d.to}`, group: 'Go to' as const, label: d.label, icon: d.icon, run: go(d.to) })),
      { id: 'new:task', group: 'Create', label: 'New task', icon: SquarePlus, run: go('/tasks/new') },
      ...(taskPads ? [{ id: 'new:pad', group: 'Create' as const, label: 'New pad', icon: NotebookPen, run: () => newPad.start() }] : []),
      { id: 'new:project', group: 'Create', label: 'New project', icon: FolderPlus, run: () => navigate('/projects', { state: { create: true } }) },
      { id: 'new:document', group: 'Create', label: 'New document', icon: FilePlus2, run: () => navigate('/documents?new=1') },
      { id: 'theme:light', group: 'Theme', label: 'Light theme', icon: Sun, keywords: 'appearance', run: () => setPreference('light') },
      { id: 'theme:dark', group: 'Theme', label: 'Dark theme', icon: Moon, keywords: 'appearance', run: () => setPreference('dark') },
      { id: 'theme:system', group: 'Theme', label: 'System theme', icon: Monitor, keywords: 'appearance auto', run: () => setPreference('system') },
      { id: 'help', group: 'Help', label: 'Help: connect an agent', icon: CircleHelp, keywords: 'docs guide', run: go('/agents') },
    ]
    if (ws.onSwitch) list.push({ id: 'workspace:switch', group: 'Workspace', label: ws.kind === 'local' ? 'Switch workspace' : 'Switch server', icon: Repeat, run: ws.onSwitch })
    return list
  }, [navigate, taskPads, newPad, setPreference, ws])

  const results = useMemo(() => {
    const matched = q ? commands.filter((c) => `${c.label} ${c.group} ${c.keywords ?? ''}`.toLowerCase().includes(q)) : commands
    const found: Command[] = (tasks.data?.items ?? [])
      .filter((r) => r.kind === 'task')
      .map((r) => ({ id: `task:${r.id}`, group: 'Tasks' as const, label: r.title, icon: Search, run: () => navigate(`/tasks/${r.id}`) }))
    return [...found, ...matched].sort((a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group))
  }, [q, commands, tasks.data, navigate])

  useEffect(() => setActive((i) => Math.min(i, Math.max(0, results.length - 1))), [results.length])

  const execute = (cmd: Command | undefined) => {
    if (!cmd) return
    opener.current = null // ไปหน้าอื่นแล้ว: ไม่ย้อนโฟกัสกลับไปปุ่มเดิม
    onOpenChange(false)
    cmd.run()
  }
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') setActive((i) => (results.length ? (i + 1) % results.length : 0))
    else if (e.key === 'ArrowUp') setActive((i) => (results.length ? (i - 1 + results.length) % results.length : 0))
    else if (e.key === 'Home') setActive(0)
    else if (e.key === 'End') setActive(Math.max(0, results.length - 1))
    else if (e.key === 'Enter') execute(results[active])
    else return
    e.preventDefault()
  }

  let lastGroup = ''
  return (
    <RDialog.Root open={open} onOpenChange={onOpenChange}>
      <RDialog.Portal>
        <RDialog.Overlay className="ui-overlay" />
        <RDialog.Content
          className="palette"
          aria-label="Command palette"
          onCloseAutoFocus={(e) => {
            if (opener.current?.isConnected) {
              e.preventDefault()
              opener.current.focus()
            }
          }}
        >
          <RDialog.Title className="ui-visually-hidden">Search and commands</RDialog.Title>
          <RDialog.Description className="ui-visually-hidden">Type to filter. Use the arrow keys to choose and Enter to run.</RDialog.Description>
          <div className="palette-input-row">
            <Search width={18} height={18} aria-hidden="true" />
            <input
              className="palette-input"
              role="combobox"
              aria-expanded="true"
              aria-controls={listId}
              aria-activedescendant={results[active] ? `${listId}-${active}` : undefined}
              aria-autocomplete="list"
              aria-label="Search tasks, pages and commands"
              placeholder="Search tasks, pages and commands"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value)
                setActive(0)
              }}
              onKeyDown={onKeyDown}
              autoFocus
            />
          </div>
          <ul className="palette-list" id={listId} role="listbox" aria-label="Results">
            {results.map((cmd, i) => {
              const header = cmd.group !== lastGroup ? cmd.group : null
              lastGroup = cmd.group
              return (
                <li key={cmd.id} role="presentation">
                  {header && (
                    <span className="palette-group" role="presentation" aria-hidden="true">
                      {header}
                    </span>
                  )}
                  <div
                    id={`${listId}-${i}`}
                    role="option"
                    aria-selected={i === active}
                    aria-label={`${cmd.label}, ${cmd.group}`}
                    className={`palette-option${i === active ? ' is-active' : ''}`}
                    onMouseMove={() => setActive(i)}
                    onClick={() => execute(cmd)}
                  >
                    <cmd.icon width={16} height={16} aria-hidden="true" />
                    <span>{cmd.label}</span>
                  </div>
                </li>
              )
            })}
          </ul>
          {results.length === 0 && (
            <p className="palette-empty" role="status">
              {tasks.isFetching ? 'Searching…' : 'No matches'}
            </p>
          )}
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  )
}
