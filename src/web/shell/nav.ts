import { Activity, Bot, FileText, FolderKanban, House, ListChecks, NotebookPen, Search, Settings, type LucideIcon } from 'lucide-react'

export interface Destination {
  to: string
  label: string
  icon: LucideIcon
  /** Shown only when the server advertises this Client API capability. */
  capability?: string
  /** Paths (besides `to`) that mark this destination as current. */
  match?: RegExp
}

/** The six primary destinations, in order. */
export const PRIMARY: Destination[] = [
  { to: '/', label: 'Home', icon: House, match: /^\/$/ },
  { to: '/pads', label: 'Task Pads', icon: NotebookPen, capability: 'task-pads', match: /^\/pads(\/|$)/ },
  { to: '/tasks', label: 'Tasks', icon: ListChecks, match: /^\/(tasks|list|my-tasks)(\/|$)/ },
  { to: '/projects', label: 'Projects', icon: FolderKanban, match: /^\/projects(\/|$)/ },
  { to: '/documents', label: 'Documents', icon: FileText, match: /^\/documents(\/|$)/ },
  { to: '/search', label: 'Search', icon: Search, match: /^\/search(\/|$)/ },
]

/** Occasional destinations, below the primary list. Admin and devices live inside Settings. */
export const SECONDARY: Destination[] = [
  { to: '/agents', label: 'Agents', icon: Bot, match: /^\/(agents|for-agent)(\/|$)/ },
  { to: '/activity', label: 'Activity', icon: Activity, match: /^\/activity(\/|$)/ },
  { to: '/settings', label: 'Settings', icon: Settings, match: /^\/(settings|devices|admin)(\/|$)/ },
]

export const available = (items: Destination[], capabilities: { taskPads: boolean }) => items.filter((d) => d.capability !== 'task-pads' || capabilities.taskPads)

export const isCurrent = (d: Destination, pathname: string) => (d.match ? d.match.test(pathname) : pathname === d.to)
