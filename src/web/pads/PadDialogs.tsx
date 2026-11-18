import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { STATUS_LABELS } from '../../shared/contracts'
import { ErrorMessage } from '../components/ui'
import { Banner, Button, ConfirmDialog, Dialog, TextField } from '../ui'
import { client } from '../api'

export interface PasteRequest {
  key: string
  lines: string[]
}

/** Every non-blank line becomes a task title; overlong lines are named before anything is created. */
export function checkTitles(lines: string[]): { titles: string[]; errors: Array<{ line: number; length: number }> } {
  const titles: string[] = []
  const errors: Array<{ line: number; length: number }> = []
  lines.forEach((raw, i) => {
    const title = raw.replace(/\s+/g, ' ').trim()
    if (!title) return
    if (title.length > 300) errors.push({ line: i + 1, length: title.length })
    else titles.push(title)
  })
  return { titles, errors }
}

/** Multiline paste always asks: a large accidental paste can never flood the Board. */
export function PasteDialog({ request, onTasks, onText, onCancel }: { request: PasteRequest | null; onTasks: (titles: string[]) => void; onText: (lines: string[]) => void; onCancel: () => void }) {
  const check = request ? checkTitles(request.lines) : { titles: [], errors: [] }
  const count = check.titles.length + check.errors.length
  return (
    <Dialog
      open={request !== null}
      onOpenChange={(o) => !o && onCancel()}
      title="Paste multiple lines"
      description={`You pasted ${count} non-blank line${count === 1 ? '' : 's'}. Create a task from each line, or keep them as text in this pad.`}
      actions={
        <>
          <Button onClick={onCancel} data-autofocus>
            Cancel
          </Button>
          <Button onClick={() => request && onText(request.lines.filter((l) => l.trim()))}>Paste as text</Button>
          <Button variant="primary" disabled={check.errors.length > 0 || check.titles.length === 0} onClick={() => onTasks(check.titles)}>
            Create {check.titles.length} task{check.titles.length === 1 ? '' : 's'}
          </Button>
        </>
      }
    >
      {check.errors.length > 0 && (
        <Banner tone="danger" title="Task titles are limited to 300 characters.">
          Shorten these lines or paste as text:
          <ul>
            {check.errors.map((e) => (
              <li key={e.line}>
                Line {e.line} ({e.length} characters)
              </li>
            ))}
          </ul>
        </Banner>
      )}
      {check.titles.length > 0 && (
        <details className="paste-preview">
          <summary>Preview of {check.titles.length} task{check.titles.length === 1 ? '' : 's'}</summary>
          <ol>
            {check.titles.slice(0, 50).map((t, i) => (
              <li key={i}>{t}</li>
            ))}
          </ol>
          {check.titles.length > 50 && <p className="ui-text-muted">…and {check.titles.length - 50} more</p>}
        </details>
      )}
    </Dialog>
  )
}

/** Explicit demotion of a Task block into another task's description. */
export function TurnIntoDescriptionDialog({
  source,
  onConfirm,
  onCancel,
}: {
  source: { key: string; taskId: string; title: string } | null
  onConfirm: (targetTaskId: string) => void
  onCancel: () => void
}) {
  const [q, setQ] = useState('')
  const [target, setTarget] = useState<{ id: string; title: string } | null>(null)
  const results = useQuery({ queryKey: ['pad-task-search', 'describe', q], queryFn: () => client.pads.taskSearch(q, 8), enabled: source !== null })
  const close = () => {
    setTarget(null)
    setQ('')
    onCancel()
  }
  if (target && source) {
    return (
      <ConfirmDialog
        open
        onOpenChange={(o) => !o && close()}
        title="Turn into description?"
        confirmLabel="Turn into description"
        onConfirm={() => {
          onConfirm(target.id)
          setTarget(null)
          setQ('')
        }}
      >
        “{source.title}” will be added as a line to the description of “{target.title}”, and its Task line will be removed from this pad. The task “{source.title}” itself is
        not archived or changed.
      </ConfirmDialog>
    )
  }
  return (
    <Dialog open={source !== null} onOpenChange={(o) => !o && close()} title="Turn into description" description="Choose the task whose description should receive this line.">
      <TextField label="Find a task" type="search" value={q} onChange={(e) => setQ(e.target.value)} data-autofocus />
      <ErrorMessage error={results.error} />
      <ul className="plain-list describe-targets">
        {(results.data ?? [])
          .filter((c) => c.task.id !== source?.taskId)
          .map((c) => (
            <li key={c.task.id}>
              <button type="button" className="pad-link" onClick={() => setTarget({ id: c.task.id, title: c.task.title })}>
                <span className="pad-link-name">{c.task.title}</span>
                <span className="pad-link-meta">
                  {c.task.project.name} · {STATUS_LABELS[c.task.status]}
                </span>
              </button>
            </li>
          ))}
      </ul>
    </Dialog>
  )
}
