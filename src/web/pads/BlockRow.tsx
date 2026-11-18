import { memo, useEffect, useLayoutEffect, useRef, type ClipboardEvent, type DragEvent, type KeyboardEvent } from 'react'
import type { Pad } from '../../shared/pads'
import { ChevronDown, ChevronRight, GripVertical, PanelRightOpen } from 'lucide-react'
import { Button, Icon, IconButton } from '../ui'
import { BlockMenu, type BlockMenuItem } from './BlockMenu'
import { caretAtEnd, caretAtStart, mentionQuery, pastedLines, insertPlainText, readSegments, renderSegments, splitAtCaret, placeCaret } from './editable'
import { optionId, PICKER_ID, type PickerState } from './MentionPicker'
import type { FlatRow, MentionMap } from './store'
import { plain } from './store'

export interface RowApi {
  setContent(key: string, el: HTMLElement): void
  setTitle(key: string, title: string): void
  setDescription(key: string, text: string): void
  enter(key: string, payload: { before?: unknown; after?: unknown; titleBefore?: string; titleAfter?: string }): void
  commit(key: string): void
  indent(key: string): void
  outdent(key: string): void
  moveUp(key: string): void
  moveDown(key: string): void
  backspaceAtStart(key: string, empty: boolean): void
  /** Returns true when it handled the key (so the browser default is cancelled). */
  backspaceAtStartTask(key: string, empty: boolean): boolean
  focusNeighbour(key: string, dir: -1 | 1): void
  focused(key: string): void
  openDescription(key: string): void
  exitDescription(key: string, trimTrailing: boolean): void
  picker(key: string, mode: PickerState['mode'] | null, query: string, anchor?: { node: Text; start: number; end: number } | null): void
  pickerKey(e: KeyboardEvent): boolean
  paste(key: string, lines: string[]): void
  menuItems(row: FlatRow): BlockMenuItem[]
  toggleComplete(key: string): void
  toggleCollapse(key: string): void
  openTask(taskId: string): void
  retry(key: string): void
  discard(key: string): void
  dragStart(key: string): void
  drop(target: string, position: 'before' | 'after'): void
  consumeFocus(key: string, field: 'title' | 'content' | 'description'): { field: 'title' | 'content' | 'description'; caret: 'start' | 'end' | number } | null
}

const mod = (e: KeyboardEvent) => e.metaKey || e.ctrlKey
const TYPE_LABEL = { task: 'Task', text: 'Text', heading: 'Heading' } as const

function rowLabel(row: FlatRow, mentions: MentionMap): string {
  const b = row.block
  const textOf = b.type === 'task' ? b.title : b.content.map((s) => (s.type === 'text' ? s.text : `@${mentions[s.taskId]?.title ?? 'task'}`)).join('')
  const short = textOf.trim().slice(0, 60) || 'empty line'
  return `${TYPE_LABEL[b.type]} actions: ${short}`
}

interface RowProps {
  row: FlatRow
  api: RowApi
  mentions: MentionMap
  pad: Pad
  picker: PickerState | null
  pickerActive: number
  pickerCount: number
  menuOpen: boolean
  onMenuOpenChange: (key: string, open: boolean) => void
  descriptionOpen: boolean
  focusSeq: number
  disabled: boolean
  /** The server is unreachable: pending lines are labelled Not synced. */
  offline: boolean
}

function sameRow(a: RowProps, b: RowProps): boolean {
  return (
    a.row.block === b.row.block &&
    a.row.depth === b.row.depth &&
    a.row.parentKey === b.row.parentKey &&
    a.row.hasChildren === b.row.hasChildren &&
    a.api === b.api &&
    a.mentions === b.mentions &&
    a.pad === b.pad &&
    a.picker === b.picker &&
    a.pickerActive === b.pickerActive &&
    a.pickerCount === b.pickerCount &&
    a.menuOpen === b.menuOpen &&
    a.descriptionOpen === b.descriptionOpen &&
    a.focusSeq === b.focusSeq &&
    a.disabled === b.disabled &&
    a.offline === b.offline
  )
}

/** One Pad line: floating controls, the type-specific editor and its sync state. */
export const BlockRow = memo(function BlockRow(props: RowProps) {
  const { row, api, mentions, pad, menuOpen, onMenuOpenChange, descriptionOpen, disabled } = props
  const b = row.block
  const rowRef = useRef<HTMLLIElement>(null)
  const pickerHere = props.picker?.key === b.key

  const onDragOver = (e: DragEvent) => {
    if (!e.dataTransfer.types.includes('application/x-alice-block')) return
    e.preventDefault()
    const rect = rowRef.current!.getBoundingClientRect()
    rowRef.current!.dataset.drop = e.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
  }
  const onDrop = (e: DragEvent) => {
    const position = rowRef.current?.dataset.drop as 'before' | 'after' | undefined
    delete rowRef.current?.dataset.drop
    if (!position) return
    e.preventDefault()
    api.drop(b.key, position)
  }

  const isDone = b.task?.status === 'done'
  const archived = Boolean(b.task?.archivedAt)
  const defaultProject = pad.defaults.project?.id
  const showProject = b.task && (defaultProject ? b.task.project.id !== defaultProject : !b.task.project.isSystem)

  return (
    <li
      ref={rowRef}
      className={`pad-row pad-row-${b.type} ${b.sync === 'failed' ? 'is-failed' : ''} ${isDone ? 'is-done' : ''} ${archived ? 'is-archived' : ''}`}
      style={{ ['--depth' as string]: row.depth - 1 }}
      data-block-id={b.id ?? undefined}
      data-key={b.key}
      data-type={b.type}
      data-sync={b.sync}
      aria-level={row.depth}
      onDragOver={onDragOver}
      onDragLeave={() => delete rowRef.current?.dataset.drop}
      onDrop={onDrop}
    >
      <div className="pad-row-line">
        <div className="pad-row-gutter">
          <BlockMenu
            label={rowLabel(row, mentions)}
            items={api.menuItems(row)}
            open={menuOpen}
            onOpenChange={(open) => onMenuOpenChange(b.key, open)}
            className="block-menu"
            buttonProps={{
              className: 'block-handle',
              draggable: !disabled,
              tabIndex: -1,
              title: 'Drag to move, click for actions (Ctrl/⌘ + /)',
              onDragStart: (e) => {
                e.dataTransfer.setData('application/x-alice-block', b.key)
                e.dataTransfer.effectAllowed = 'move'
                api.dragStart(b.key)
              },
            }}
          >
            <Icon icon={GripVertical} size="sm" />
          </BlockMenu>
        </div>
        {b.type === 'heading' && (
          <button
            type="button"
            className="ui-icon-button ui-button--ghost ui-icon-button--sm collapse-toggle"
            aria-expanded={!b.collapsed}
            aria-label={`${b.collapsed ? 'Expand' : 'Collapse'} section ${plain(b.content).slice(0, 60)}`}
            onClick={() => api.toggleCollapse(b.key)}
            disabled={!row.hasChildren && !b.collapsed}
            tabIndex={-1}
          >
            <Icon icon={b.collapsed ? ChevronRight : ChevronDown} size="sm" />
          </button>
        )}
        {b.type === 'task' ? (
          <TaskLine {...props} />
        ) : (
          <EditableLine {...props} />
        )}
        {showProject && b.task && <span className="chip chip-static" title="Project">{b.task.project.name}</span>}
        {archived && <span className="pill pill-archived">Archived</span>}
        <SyncBadge row={row} api={api} offline={props.offline} />
      </div>
      {b.type === 'task' && (descriptionOpen || b.description) && !(b.sync === 'draft' && !b.title) && (
        <DescriptionRegion {...props} />
      )}
      {pickerHere && <div className="mention-anchor" />}
    </li>
  )
}, sameRow)

function SyncBadge({ row, api, offline }: { row: FlatRow; api: RowApi; offline: boolean }) {
  const b = row.block
  if (b.sync === 'failed') {
    return (
      <span className="sync-failed" role="group" aria-label="Not saved">
        <span className="sync-text">{b.error ?? 'Not saved'}</span>
        <Button size="sm" variant="ghost" onClick={() => api.retry(b.key)}>
          Retry
        </Button>
        <Button size="sm" variant="ghost" className="sync-discard" onClick={() => api.discard(b.key)}>
          Discard
        </Button>
      </span>
    )
  }
  if (b.sync === 'pending' && offline) {
    return (
      <span className="sync-offline" title="Saved on this device; it will be sent when the connection returns">
        Not synced
      </span>
    )
  }
  if (b.sync === 'pending') {
    return (
      <span className="sync-pending" title="Saving…">
        <span className="sr-only">Saving</span>
      </span>
    )
  }
  return null
}

type FocusRequest = { field: string; caret: 'start' | 'end' | number }

/**
 * Applies a focus request to this row. If focus did not land (seen intermittently right after a new
 * Pad opens on slow machines), try again on the next frames, but only while nothing else has taken
 * focus in the meantime, so a click or Tab by the person always wins.
 */
function useFocusRequest(api: RowApi, key: string, field: 'title' | 'content' | 'description', seq: number, focus: (f: FocusRequest) => HTMLElement | null) {
  useLayoutEffect(() => {
    const req = api.consumeFocus(key, field)
    if (!req) return
    const el = focus(req)
    if (!el || document.activeElement === el) return
    let frame = 0
    let tries = 0
    const retry = () => {
      const active = document.activeElement
      if (!el.isConnected || (active !== null && active !== document.body)) return
      focus(req)
      if (document.activeElement !== el && ++tries < 10) frame = requestAnimationFrame(retry)
    }
    frame = requestAnimationFrame(retry)
    return () => cancelAnimationFrame(frame)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seq])
}

function TaskLine({ row, api, picker, pickerActive, pickerCount, focusSeq, disabled }: RowProps) {
  const b = row.block
  const ref = useRef<HTMLInputElement>(null)
  useFocusRequest(api, b.key, 'title', focusSeq, (req) => {
    if (req.field !== 'title' || !ref.current) return null
    const el = ref.current
    el.focus()
    const pos = req.caret === 'start' ? 0 : req.caret === 'end' ? el.value.length : req.caret
    el.setSelectionRange(pos, pos)
    return el
  })
  const pickerHere = picker?.key === b.key
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    const el = e.currentTarget
    if (pickerHere && api.pickerKey(e)) return
    if (e.key === 'Enter' && !mod(e)) {
      e.preventDefault()
      const start = el.selectionStart ?? el.value.length
      api.enter(b.key, { titleBefore: el.value.slice(0, start), titleAfter: el.value.slice(el.selectionEnd ?? start) })
    } else if (e.key === 'Tab' && !e.shiftKey) {
      e.preventDefault()
      if (b.title.trim()) api.openDescription(b.key)
      else api.indent(b.key)
    } else if (e.key === 'Tab' && e.shiftKey) {
      e.preventDefault()
      api.outdent(b.key)
    } else if (e.key === 'Backspace' && el.selectionStart === 0 && el.selectionEnd === 0) {
      if (api.backspaceAtStartTask(b.key, el.value === '')) e.preventDefault()
    } else if (e.key === 'ArrowUp' && !e.altKey) {
      e.preventDefault()
      api.focusNeighbour(b.key, -1)
    } else if (e.key === 'ArrowDown' && !e.altKey) {
      e.preventDefault()
      api.focusNeighbour(b.key, 1)
    } else {
      commonKeys(e, b.key, api)
    }
  }
  return (
    <span className="pad-task">
      {b.task ? (
        <input
          type="checkbox"
          className="pad-check"
          checked={b.task.status === 'done'}
          aria-label={`${b.task.status === 'done' ? 'Reopen' : 'Complete'}: ${b.title}`}
          onChange={() => api.toggleComplete(b.key)}
          disabled={disabled || Boolean(b.task.archivedAt)}
        />
      ) : (
        <span className="pad-check-placeholder" aria-hidden="true" />
      )}
      <input
        ref={ref}
        className="pad-title"
        value={b.title}
        maxLength={300}
        aria-label={b.task ? 'Task title' : 'New task'}
        placeholder={b.sync === 'draft' ? 'Type a task, @ to add an existing one' : undefined}
        data-capture-target={b.sync === 'draft' && !b.title ? '' : undefined}
        disabled={disabled || Boolean(b.task?.archivedAt)}
        role={pickerHere ? 'combobox' : undefined}
        aria-expanded={pickerHere ? true : undefined}
        aria-controls={pickerHere ? PICKER_ID : undefined}
        aria-autocomplete={pickerHere ? 'list' : undefined}
        aria-activedescendant={pickerHere && pickerCount > 0 ? optionId(pickerActive) : undefined}
        onFocus={() => api.focused(b.key)}
        onBlur={() => api.commit(b.key)}
        onChange={(e) => {
          const value = e.target.value
          api.setTitle(b.key, value)
          if (!b.id && b.sync === 'draft' && value.startsWith('@')) api.picker(b.key, 'place', value.slice(1))
          else if (pickerHere) api.picker(b.key, null, '')
        }}
        onKeyDown={onKeyDown}
        onPaste={(e: ClipboardEvent<HTMLInputElement>) => {
          const lines = pastedLines(e.clipboardData.getData('text/plain'))
          if (lines) {
            e.preventDefault()
            api.paste(b.key, lines)
          }
        }}
        onDoubleClick={() => b.task && api.openTask(b.task.id)}
      />
      {b.task && (
        <IconButton icon={PanelRightOpen} size="sm" className="open-task" label={`Open task details: ${b.title}`} title="Open task details" onClick={() => api.openTask(b.task!.id)} tabIndex={-1} />
      )}
    </span>
  )
}

function commonKeys(e: KeyboardEvent, key: string, api: RowApi): void {
  if (e.altKey && e.shiftKey && e.key === 'ArrowUp') {
    e.preventDefault()
    api.moveUp(key)
  } else if (e.altKey && e.shiftKey && e.key === 'ArrowDown') {
    e.preventDefault()
    api.moveDown(key)
  } else if (e.altKey && e.shiftKey && e.key === 'ArrowRight') {
    e.preventDefault()
    api.indent(key)
  } else if (e.altKey && e.shiftKey && e.key === 'ArrowLeft') {
    e.preventDefault()
    api.outdent(key)
  }
}

function EditableLine({ row, api, mentions, picker, pickerActive, pickerCount, focusSeq, disabled }: RowProps) {
  const b = row.block
  const ref = useRef<HTMLDivElement>(null)
  const pickerHere = picker?.key === b.key
  // uncontrolled: เขียน DOM ใหม่เฉพาะตอน mount หรือเมื่อเนื้อหาเปลี่ยนจากภายนอก (version)
  useLayoutEffect(() => {
    if (ref.current) renderSegments(ref.current, b.content, mentions)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [b.version, b.key])
  // ชื่อของ mention อัปเดตตามข้อมูล task ปัจจุบัน
  useEffect(() => {
    ref.current?.querySelectorAll<HTMLElement>('[data-mention]').forEach((chip) => {
      const info = mentions[chip.dataset.mention!]
      if (info) {
        chip.textContent = `@${info.title}`
        chip.classList.toggle('is-archived', Boolean(info.archivedAt))
      }
    })
  }, [mentions])
  useFocusRequest(api, b.key, 'content', focusSeq, (req) => {
    if (req.field !== 'content' || !ref.current) return null
    placeCaret(ref.current, req.caret)
    return ref.current
  })

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const el = e.currentTarget
    if (pickerHere && api.pickerKey(e)) return
    if (e.key === 'Enter' && !e.shiftKey && !mod(e)) {
      e.preventDefault()
      const { before, after } = splitAtCaret(el)
      api.enter(b.key, { before, after })
    } else if (e.key === 'Enter' && e.shiftKey) {
      e.preventDefault()
      if (b.type === 'text') {
        insertPlainText('\n')
        api.setContent(b.key, el)
      }
    } else if (e.key === 'Tab') {
      e.preventDefault()
      if (e.shiftKey) api.outdent(b.key)
      else api.indent(b.key)
    } else if (e.key === 'Backspace' && caretAtStart(el)) {
      const empty = readSegments(el).length === 0
      if (empty || row.depth > 1) {
        e.preventDefault()
        api.backspaceAtStart(b.key, empty)
      }
    } else if (e.key === 'ArrowUp' && !e.altKey && caretAtStart(el)) {
      e.preventDefault()
      api.focusNeighbour(b.key, -1)
    } else if (e.key === 'ArrowDown' && !e.altKey && caretAtEnd(el)) {
      e.preventDefault()
      api.focusNeighbour(b.key, 1)
    } else {
      commonKeys(e, b.key, api)
    }
  }

  return (
    <div
      ref={ref}
      className={b.type === 'heading' ? 'pad-editable pad-heading' : 'pad-editable pad-text'}
      contentEditable={!disabled}
      suppressContentEditableWarning
      role="textbox"
      aria-multiline={b.type === 'text'}
      aria-label={b.type === 'heading' ? `Heading level ${row.depth}` : 'Text'}
      aria-expanded={pickerHere ? true : undefined}
      aria-controls={pickerHere ? PICKER_ID : undefined}
      aria-autocomplete={pickerHere ? 'list' : undefined}
      aria-activedescendant={pickerHere && pickerCount > 0 ? optionId(pickerActive) : undefined}
      data-placeholder={b.type === 'heading' ? 'Heading' : 'Text'}
      tabIndex={0}
      spellCheck
      onFocus={() => api.focused(b.key)}
      onBlur={() => api.commit(b.key)}
      onInput={(e) => {
        const el = e.currentTarget
        api.setContent(b.key, el)
        const q = mentionQuery(el)
        if (q) api.picker(b.key, 'mention', q.query, q)
        else if (pickerHere) api.picker(b.key, null, '')
      }}
      onKeyDown={onKeyDown}
      onPaste={(e) => {
        e.preventDefault()
        const text = e.clipboardData.getData('text/plain')
        const lines = pastedLines(text)
        if (lines) api.paste(b.key, lines)
        else {
          // ตัด formatting ทิ้งเสมอ: Text/Heading รับเฉพาะข้อความล้วน
          insertPlainText(b.type === 'heading' ? text.replace(/\s*\n\s*/g, ' ') : text)
          api.setContent(b.key, e.currentTarget)
        }
      }}
      onClick={(e) => {
        const chip = (e.target as HTMLElement).closest<HTMLElement>('[data-mention]')
        if (chip) api.openTask(chip.dataset.mention!)
      }}
    />
  )
}

function DescriptionRegion({ row, api, picker, pickerActive, pickerCount, focusSeq, disabled }: RowProps) {
  const b = row.block
  const ref = useRef<HTMLTextAreaElement>(null)
  const pickerHere = picker?.key === `${b.key}:description`
  useFocusRequest(api, b.key, 'description', focusSeq, (req) => {
    if (req.field !== 'description' || !ref.current) return null
    ref.current.focus()
    const pos = req.caret === 'start' ? 0 : ref.current.value.length
    ref.current.setSelectionRange(pos, pos)
    return ref.current
  })
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight + 2}px`
  }, [b.description])
  const id = `desc-${b.key}`
  return (
    <div className="pad-description" style={{ ['--depth' as string]: row.depth - 1 }}>
      <label htmlFor={id} className="sr-only">
        Description of {b.title}
      </label>
      <textarea
        id={id}
        ref={ref}
        rows={1}
        value={b.description}
        placeholder="Description (Markdown). Enter twice to finish."
        disabled={disabled || Boolean(b.task?.archivedAt)}
        role={pickerHere ? 'combobox' : undefined}
        aria-expanded={pickerHere ? true : undefined}
        aria-controls={pickerHere ? PICKER_ID : undefined}
        aria-activedescendant={pickerHere && pickerCount > 0 ? optionId(pickerActive) : undefined}
        onFocus={() => api.focused(b.key)}
        onBlur={() => api.commit(b.key)}
        onChange={(e) => {
          const el = e.target
          api.setDescription(b.key, el.value)
          const before = el.value.slice(0, el.selectionStart)
          const m = /(^|\s)@([^@\n]{0,40})$/.exec(before)
          if (m) api.picker(`${b.key}:description`, 'markdown', m[2])
          else if (pickerHere) api.picker(`${b.key}:description`, null, '')
        }}
        onKeyDown={(e) => {
          const el = e.currentTarget
          if (pickerHere && api.pickerKey(e)) return
          const atEnd = el.selectionStart === el.value.length && el.selectionEnd === el.value.length
          const onEmptyLine = atEnd && (el.value === '' || el.value.endsWith('\n'))
          if (e.key === 'Enter' && mod(e)) {
            e.preventDefault()
            api.exitDescription(b.key, false)
          } else if (e.key === 'Enter' && !e.shiftKey && onEmptyLine && el.value !== '') {
            // Enter ครั้งที่สองบนบรรทัดว่างท้ายสุด = ออกจาก Description
            e.preventDefault()
            api.exitDescription(b.key, true)
          } else if (e.key === 'Tab' && e.shiftKey && onEmptyLine) {
            e.preventDefault()
            api.exitDescription(b.key, true)
          } else if (e.key === 'Escape') {
            e.preventDefault()
            api.exitDescription(b.key, false)
          }
        }}
      />
    </div>
  )
}
