import { DragDropProvider, DragOverlay, PointerSensor, useDraggable, useDroppable } from '@dnd-kit/react'
import { Accessibility, PointerActivationConstraints } from '@dnd-kit/dom'
import { createContext, useContext, useMemo, useRef, useState, type MouseEvent } from 'react'
import { Link } from 'react-router-dom'
import { STATUS_LABELS, TASK_STATUSES, type Task, type TaskStatus } from '../../shared/contracts'
import { IllustratedState } from '../brand'
import { useMediaQuery } from '../pads/hooks'
import { AssigneeChip, Banner, BlockedBadge, Button, DueLabel, EmptyState, FieldMessage, InlineSelect, PriorityBadge, ProjectLabel, Skeleton, Spinner, Table, TaskItem } from '../ui'
import { useStatusChange, useTaskPages } from './hooks'
import { STATUS_OPTIONS, STATUS_TONE, blockedLabel, dueInfo, isOpen, meaningfulPriority } from './model'
import { useHasTaskPanel, useTaskPanel } from './panel'
import { errorText } from './TaskDetail'
import { BulkBar, SelectAll, SelectTask, SelectionProvider, useSelectionState, useTaskSelection } from './bulk'

/**
 * Title link used by every view. A plain click opens Task Detail beside the view; modified clicks,
 * middle clicks and "open in new tab" still follow the full-page URL.
 */
export function TaskLink({ task }: { task: Pick<Task, 'id' | 'title'> }) {
  const panel = useTaskPanel()
  const host = useHasTaskPanel()
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (!host || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    e.preventDefault()
    panel.open(task.id)
  }
  return (
    <Link to={`/tasks/${task.id}`} data-task-link={task.id} aria-current={panel.taskId === task.id ? 'true' : undefined} onClick={onClick}>
      {task.title}
    </Link>
  )
}

/** Status control in a row or card, with pending and failure shown next to the task. */
function useRowStatus(task: Task) {
  const change = useStatusChange()
  const control = (
    <InlineSelect
      label={`Status of ${task.title}`}
      value={task.status}
      options={STATUS_OPTIONS}
      tone={STATUS_TONE[task.status]}
      disabled={change.isPending || task.archivedAt !== null}
      aria-busy={change.isPending || undefined}
      onChange={(e) => change.mutate({ id: task.id, status: e.target.value as TaskStatus })}
    />
  )
  const feedback = change.isPending ? (
    <span className="tasks-row-pending" role="status">
      <Spinner size="sm" /> Saving…
    </span>
  ) : change.error ? (
    <FieldMessage tone="error">Status not changed: {errorText(change.error)}</FieldMessage>
  ) : null
  return { control, feedback }
}

function TaskEntry({ task, layout, showProject = true }: { task: Task; layout: 'card' | 'row'; showProject?: boolean }) {
  const { taskId } = useTaskPanel()
  const status = useRowStatus(task)
  return (
    <TaskItem
      layout={layout}
      selected={taskId === task.id}
      title={<TaskLink task={task} />}
      status={status.control}
      assignee={{ name: task.assignee?.displayName ?? null, kind: task.assignee?.kind }}
      priority={meaningfulPriority(task)}
      due={dueInfo(task)}
      project={showProject ? task.project.name : null}
      blocked={blockedLabel(task)}
      feedback={status.feedback}
      select={<SelectTask task={task} />}
    />
  )
}

function LoadMore({ query }: { query: { hasNextPage: boolean; isFetchingNextPage: boolean; fetchNextPage: () => unknown } }) {
  if (!query.hasNextPage) return null
  return (
    <Button size="sm" loading={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>
      Load more
    </Button>
  )
}

function LoadError({ error, retry }: { error: unknown; retry: () => void }) {
  return (
    <Banner tone="danger" title="Tasks could not be loaded" action={<Button size="sm" onClick={retry}>Try again</Button>}>
      {errorText(error)}
    </Banner>
  )
}

const OPEN_STATUSES = TASK_STATUSES.filter((s) => s !== 'done' && s !== 'canceled')

/** My Work: my open tasks grouped by status; finished work is folded away. */
export function MyWorkView({ filters }: { filters: Record<string, string> }) {
  const query = useTaskPages('my-work', filters, 200)
  const tasks = query.data?.pages.flatMap((p) => p.items) ?? []
  const finished = tasks.filter((t) => !isOpen(t))
  if (query.isLoading) return <Skeleton lines={6} />
  if (query.error && !query.data) return <LoadError error={query.error} retry={() => void query.refetch()} />
  const filtered = Object.keys(filters).some((k) => !['assigneeId', 'sort'].includes(k))
  return (
    <div className="tasks-my-work">
      {tasks.every((t) => !isOpen(t)) &&
        (filtered ? <EmptyState title="No tasks match these filters">Clear or change the filters to see more of your work.</EmptyState> : <IllustratedState pose="neutral" copy="myTasksEmpty" title="Nothing assigned to you" />)}
      {OPEN_STATUSES.map((status) => {
        const group = tasks.filter((t) => t.status === status)
        if (group.length === 0) return null
        const headingId = `my-work-${status}`
        return (
          <section key={status} className="tasks-group" aria-labelledby={headingId}>
            <h2 id={headingId} className="tasks-group-title">
              {STATUS_LABELS[status]} <span className="ui-text-muted">{group.length}</span>
            </h2>
            <ul className="tasks-rows" aria-label={STATUS_LABELS[status]}>
              {group.map((t) => (
                <li key={t.id}>
                  <TaskEntry task={t} layout="row" />
                </li>
              ))}
            </ul>
          </section>
        )
      })}
      {finished.length > 0 && (
        <details className="tasks-group tasks-finished">
          <summary>
            Done and canceled <span className="ui-text-muted">{finished.length}</span>
          </summary>
          <ul className="tasks-rows" aria-label="Done and canceled">
            {finished.map((t) => (
              <li key={t.id}>
                <TaskEntry task={t} layout="row" />
              </li>
            ))}
          </ul>
        </details>
      )}
      <LoadMore query={query} />
    </div>
  )
}

const COLUMN_PAGE = 25

// ส่วนที่มีหน้าที่ของตัวเองในการ์ด: คลิกแล้วทำแค่หน้าที่นั้น ไม่เปิด task ซ้ำ
const CARD_CONTROLS = 'a, button, input, select, textarea, label, summary, [role="button"], [role="checkbox"], [contenteditable="true"]'

/**
 * A plain click anywhere on a Board card opens its task, through the title link so the Task Panel
 * (or the full page) behaves exactly as a title click. Controls and links keep their own action, a
 * text selection is left alone, and modified clicks do nothing: the title link still handles those.
 */
function openCardOnClick(e: MouseEvent<HTMLElement>) {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
  const card = e.currentTarget
  const target = e.target as Element
  if (target.closest(CARD_CONTROLS) && card.contains(target.closest(CARD_CONTROLS))) return
  const selection = window.getSelection()
  if (selection && !selection.isCollapsed && card.contains(selection.anchorNode)) return
  card.querySelector<HTMLAnchorElement>('a[data-task-link]')?.click()
}

type DragPayload = { id: string; title: string; status: TaskStatus }
type BoardDnd = { move: (task: DragPayload, to: TaskStatus) => void; moving: ReadonlySet<string> }
const BoardDndContext = createContext<BoardDnd | null>(null)

// เมาส์/trackpad เริ่มลากเมื่อขยับเกิน 8px; นิ้วต้องกดค้าง 250ms (ปัดก่อนนั้น = เลื่อนหน้าจอตามปกติ)
const boardSensors = [
  PointerSensor.configure({
    activationConstraints: (event) =>
      event.pointerType === 'touch'
        ? [new PointerActivationConstraints.Delay({ value: 250, tolerance: 5 })]
        : [new PointerActivationConstraints.Distance({ value: 8 })],
    // controls และลิงก์อื่นในการ์ดไม่เริ่มลาก; ชื่อ task (ลิงก์ของการ์ดเอง) ลากได้
    preventActivation: (event, source) => {
      const target = event.target as Element | null
      const control = target?.closest?.(CARD_CONTROLS)
      if (!control || !source.element?.contains(control)) return false
      return !control.matches('a[data-task-link]')
    },
  }),
]

// ไม่ใช้ plugin Accessibility ของ dnd-kit: มันใส่ role="button" ทั้งการ์ด (ครอบ controls ข้างใน) และสอนการลากด้วย
// คีย์บอร์ด ซึ่ง Board ไม่มี; ผู้ใช้คีย์บอร์ดเปลี่ยนสถานะด้วยตัวเลือกบนการ์ด และผลประกาศผ่าน role="status" ของ Board
const boardPlugins = <T,>(defaults: T[]): T[] => defaults.filter((p) => p !== (Accessibility as unknown) && (p as { plugin?: unknown }).plugin !== Accessibility)

/** Swallows the click that the browser sends after a drag ends, so a drag never also opens the card. */
function suppressNextClick() {
  const stop = (e: Event) => {
    e.stopPropagation()
    e.preventDefault()
  }
  window.addEventListener('click', stop, { capture: true, once: true })
  window.setTimeout(() => window.removeEventListener('click', stop, { capture: true }), 100)
}

const isStatus = (value: unknown): value is TaskStatus => typeof value === 'string' && (TASK_STATUSES as readonly string[]).includes(value)

function BoardCard({ task }: { task: Task }) {
  const dnd = useContext(BoardDndContext)
  const { ref, isDragSource } = useDraggable({
    id: task.id,
    data: { id: task.id, title: task.title, status: task.status } satisfies DragPayload,
    disabled: task.archivedAt !== null || Boolean(dnd?.moving.has(task.id)),
  })
  return (
    <li ref={ref} className={`tasks-card-drag${task.archivedAt ? '' : ' is-draggable'}${isDragSource ? ' is-drag-source' : ''}`} onClick={openCardOnClick}>
      <TaskEntry task={task} layout="card" />
    </li>
  )
}

function BoardColumn({ status, filters }: { status: TaskStatus; filters: Record<string, string> }) {
  const query = useTaskPages(`board-${status}`, { ...filters, status }, COLUMN_PAGE)
  const tasks = query.data?.pages.flatMap((p) => p.items) ?? []
  const headingId = `board-col-${status}`
  // ลากการ์ดมาวางในคอลัมน์ = เปลี่ยนสถานะ; ทางคีย์บอร์ดยังเป็นตัวเลือกสถานะบนการ์ด
  const { ref, isDropTarget } = useDroppable({ id: status })
  return (
    <section ref={ref} className={`tasks-column tasks-column--${STATUS_TONE[status]}${isDropTarget ? ' is-drop-target' : ''}`} aria-labelledby={headingId}>
      <header className="tasks-column-head">
        <h2 id={headingId}>{STATUS_LABELS[status]}</h2>
        <span className="ui-text-muted">{query.isLoading ? '' : query.hasNextPage ? `${tasks.length}+` : tasks.length}</span>
      </header>
      {query.isLoading ? (
        <Skeleton lines={3} />
      ) : query.error && !query.data ? (
        <LoadError error={query.error} retry={() => void query.refetch()} />
      ) : (
        <ul className="tasks-cards" aria-label={`${STATUS_LABELS[status]} tasks`}>
          {tasks.map((t) => (
            <BoardCard key={t.id} task={t} />
          ))}
          {tasks.length === 0 && <li className="tasks-column-empty ui-text-muted">No tasks</li>}
        </ul>
      )}
      <LoadMore query={query} />
    </section>
  )
}

/**
 * Board: one column per status. Drag a card to another column to change its status (mouse, trackpad or a
 * long press on touch); the status control on each card does the same by keyboard. The result is
 * announced either way, and a failed move says so instead of claiming success.
 */
export function BoardView({ filters }: { filters: Record<string, string> }) {
  const change = useStatusChange()
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  const [moving, setMoving] = useState<ReadonlySet<string>>(new Set())
  const movingRef = useRef(moving)
  movingRef.current = moving
  const dnd = useMemo<BoardDnd>(
    () => ({
      moving,
      move: (task, to) => {
        // การ์ดเดียวกันส่งการย้ายซ้อนกันไม่ได้ระหว่างรอผล
        if (movingRef.current.has(task.id)) return
        setMoving((m) => new Set(m).add(task.id))
        setMessage({ tone: 'ok', text: `Moving ${task.title} to ${STATUS_LABELS[to]}…` })
        change.mutate(
          { id: task.id, status: to },
          {
            onSuccess: () => setMessage({ tone: 'ok', text: `Moved ${task.title} to ${STATUS_LABELS[to]}.` }),
            onError: (error) => setMessage({ tone: 'error', text: `${task.title} was not moved: ${errorText(error)}` }),
            onSettled: () =>
              setMoving((m) => {
                const next = new Set(m)
                next.delete(task.id)
                return next
              }),
          },
        )
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [moving],
  )
  return (
    <BoardDndContext.Provider value={dnd}>
      <DragDropProvider
        sensors={boardSensors}
        plugins={boardPlugins}
        onDragStart={() => suppressNextClick()}
        onDragEnd={(event) => {
          suppressNextClick()
          if (event.canceled) return
          const { source, target } = event.operation
          const task = source?.data as DragPayload | undefined
          const to = target?.id
          if (!task || !isStatus(to) || to === task.status) return
          dnd.move(task, to)
        }}
      >
        <p className="tasks-board-status" role="status">
          {message?.tone === 'ok' ? message.text : ''}
        </p>
        {message?.tone === 'error' && <FieldMessage tone="error">{message.text}</FieldMessage>}
        {/* เลื่อนแนวนอนด้วยคีย์บอร์ดได้แม้คอลัมน์ว่าง (axe: scrollable-region-focusable) */}
        <div className="tasks-board" tabIndex={0} role="region" aria-label="Board columns">
          {TASK_STATUSES.map((s) => (
            <BoardColumn key={s} status={s} filters={filters} />
          ))}
        </div>
        <DragOverlay className="tasks-drag-overlay">
          {(source) => <div className="ui-task ui-task--card">{(source.data as DragPayload).title}</div>}
        </DragOverlay>
      </DragDropProvider>
    </BoardDndContext.Provider>
  )
}

function TableRow({ task, showProject }: { task: Task; showProject: boolean }) {
  const selectable = useTaskSelection() !== null
  const status = useRowStatus(task)
  const { taskId } = useTaskPanel()
  const due = dueInfo(task)
  const priority = meaningfulPriority(task)
  const blocked = blockedLabel(task)
  return (
    <tr className={taskId === task.id ? 'is-selected' : undefined}>
      {selectable && (
        <td className="tasks-table-select">
          <SelectTask task={task} />
        </td>
      )}
      <td className="tasks-table-title">
        <TaskLink task={task} />
        {blocked && <BlockedBadge>{blocked}</BlockedBadge>}
        {task.archivedAt && <span className="ui-text-muted"> · Archived</span>}
        {status.feedback}
      </td>
      <td>{status.control}</td>
      <td>
        <AssigneeChip name={task.assignee?.displayName ?? null} kind={task.assignee?.kind} />
      </td>
      {showProject && (
        <td>
          <ProjectLabel name={task.project.name} />
        </td>
      )}
      <td>{due ? <DueLabel label={due.label} tone={due.tone} /> : null}</td>
      <td>{priority ? <PriorityBadge priority={priority} /> : null}</td>
    </tr>
  )
}

/** Task table for wide screens; the same rows as My Work on narrow ones. */
export function TaskTable({ tasks, showProject = true, caption = 'Tasks' }: { tasks: Task[]; showProject?: boolean; caption?: string }) {
  const narrow = useMediaQuery('(max-width: 719px)')
  const selectable = useTaskSelection() !== null
  if (narrow)
    return (
      <ul className="tasks-rows" aria-label={caption}>
        {tasks.map((t) => (
          <li key={t.id}>
            <TaskEntry task={t} layout="row" showProject={showProject} />
          </li>
        ))}
      </ul>
    )
  return (
    <Table caption={caption} className="tasks-table">
      <thead>
        <tr>
          {selectable && (
            <th scope="col" className="tasks-table-select">
              <SelectAll ids={tasks.map((t) => t.id)} />
            </th>
          )}
          <th scope="col">Title</th>
          <th scope="col">Status</th>
          <th scope="col">Assignee</th>
          {showProject && <th scope="col">Project</th>}
          <th scope="col">Due</th>
          <th scope="col">Priority</th>
        </tr>
      </thead>
      <tbody>
        {tasks.map((t) => (
          <TableRow key={t.id} task={t} showProject={showProject} />
        ))}
      </tbody>
    </Table>
  )
}

export function ListView({ filters }: { filters: Record<string, string> }) {
  const query = useTaskPages('list', filters)
  const tasks = query.data?.pages.flatMap((p) => p.items) ?? []
  const selection = useSelectionState(tasks.map((t) => t.id))
  if (query.isLoading) return <Skeleton lines={6} />
  if (query.error && !query.data) return <LoadError error={query.error} retry={() => void query.refetch()} />
  return (
    <SelectionProvider value={selection}>
    <div className="tasks-list">
      <BulkBar tasks={tasks} />
      <p className="tasks-count ui-text-muted" aria-live="polite">
        {`${tasks.length}${query.hasNextPage ? '+' : ''} ${tasks.length === 1 ? 'task' : 'tasks'}`}
      </p>
      {tasks.length === 0 ? (
        <EmptyState title="No tasks match these filters">
          Change the filters, or <Link to="/tasks/new">create a task</Link>.
        </EmptyState>
      ) : (
        <TaskTable tasks={tasks} />
      )}
      <LoadMore query={query} />
    </div>
    </SelectionProvider>
  )
}
