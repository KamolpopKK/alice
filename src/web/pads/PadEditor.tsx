import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent } from 'react'
import { useQueryClient, type InfiniteData } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import type { Pad, PadBlock, PadBlockPage, PadMentionInfo, PadSegment, PadTaskCandidate } from '../../shared/pads'
import type { PadBlockType } from '../../shared/pads'
import { ConfirmDialog } from '../components/Dialog'
import type { MenuItem } from '../components/Menu'
import { ErrorMessage, Loading } from '../components/ui'
import { onLiveEvent } from '../live'
import { useMe } from '../auth'
import { useConnectivity } from '../connectivity'
import { acquirePad, importSavedOutbox, padModel, releasePad } from './registry'
import { BlockRow, type RowApi } from './BlockRow'
import { insertMention, mentionQuery, readSegments } from './editable'
import { usePadBlocks } from './hooks'
import { MentionPicker, usePickerResults, type PickerState } from './MentionPicker'
import type { PadModel } from './model'
import { PasteDialog, TurnIntoDescriptionDialog, type PasteRequest } from './PadDialogs'
import { ROOT, plain, type FlatRow } from './store'
import { usePeek } from './TaskPeek'

/** The open editor model of a Pad (used by Pad-level actions such as Remove completed). */
export function activePadModel(padId: string): PadModel | undefined {
  return padModel(padId)
}

/** The Pad's model from the registry, held while this editor is mounted. */
function usePadEntry(pad: Pad, actorId: string) {
  const archived = pad.archivedAt !== null
  const [entry] = useState(() => acquirePad(pad.id, actorId, archived))
  useEffect(() => () => releasePad(pad.id, entry), [pad.id, entry])
  return entry
}

/**
 * Keyboard-first block editor: Task, Text and Heading lines with hierarchy, descriptions, mentions,
 * paste, reorder and session Undo. Every change is local first and synced through the model's outbox.
 */
export function PadEditor({ pad, focusCapture, focusToken = null, expand }: { pad: Pad; focusCapture: boolean; focusToken?: string | null; expand: string[] }) {
  const me = useMe()
  const entry = usePadEntry(pad, me.id)
  const model = entry.model
  const snap = useSyncExternalStore(model.subscribe, model.getSnapshot)
  const blocks = usePadBlocks(pad.id)
  const qc = useQueryClient()
  const peek = usePeek()
  const [params, setParams] = useSearchParams()
  const target = params.get('block')
  const [picker, setPicker] = useState<PickerState | null>(null)
  const [pickerActive, setPickerActive] = useState(0)
  const pickerAnchor = useRef<{ node: Text; start: number; end: number } | null>(null)
  const results = usePickerResults(picker)
  const items = results.data ?? []
  const [menuKey, setMenuKey] = useState<string | null>(null)
  const [descriptions, setDescriptions] = useState<Set<string>>(() => new Set())
  const [paste, setPaste] = useState<PasteRequest | null>(null)
  const [describe, setDescribe] = useState<{ key: string; taskId: string; title: string } | null>(null)
  const [confirmSubtree, setConfirmSubtree] = useState<string | null>(null)
  const dragKey = useRef<string | null>(null)
  const remoteIds = useRef(new Set<string>())
  const loaded = useRef(false)
  const archived = pad.archivedAt !== null
  const connectivity = useConnectivity()

  // server snapshots → model (only while the editor is quiet)
  const serverItems = useMemo(() => blocks.data?.pages.flatMap((p) => p.items) ?? null, [blocks.data])
  const serverMentions = useMemo(() => Object.assign({}, ...(blocks.data?.pages.map((p) => p.mentions) ?? [])) as Record<string, PadMentionInfo>, [blocks.data])
  useEffect(() => {
    if (!serverItems) return
    model.applyServer(serverItems as PadBlock[], serverMentions, remoteIds.current)
    remoteIds.current = new Set()
    if (!loaded.current) {
      loaded.current = true
      // งานที่ค้างจาก session ก่อน (reload, ปิดแอป, เน็ตหลุด) กลับมาและ replay ตามลำดับเดิม
      const restored = importSavedOutbox(entry)
      if (restored) model.notify(`Restored ${restored} unsynced change${restored === 1 ? '' : 's'} from this device`)
      if (focusCapture) {
        const key = model.captureKey()
        model.requestFocus(key, 'title', 'start')
        model.notify('Ready to capture')
      }
    }
  }, [serverItems, serverMentions, model, focusCapture, entry])
  // live stream กลับมา = server กลับมา: ส่งที่ค้างทันทีไม่ต้องรอ backoff
  useEffect(() => {
    if (connectivity === 'live') model.wake()
  }, [connectivity, model])
  useEffect(() => {
    // refetch แล้ว apply ตรง ๆ: ถ้าข้อมูลเหมือนเดิม react-query คืน object เดิมและ effect จะไม่ทำงาน
    model.onNeedRefresh = () =>
      void qc.refetchQueries({ queryKey: ['pad-blocks', pad.id] }).then(() => {
        const data = qc.getQueryData<InfiniteData<PadBlockPage>>(['pad-blocks', pad.id])
        if (!data) return
        model.applyServer(
          data.pages.flatMap((p) => p.items),
          Object.assign({}, ...data.pages.map((p) => p.mentions)),
        )
      })
    return () => {
      model.onNeedRefresh = null
    }
  }, [model, qc, pad.id])
  // live events: remember which blocks another device changed (for the remote-update notice)
  useEffect(
    () =>
      onLiveEvent((e) => {
        if ((e.kind === 'pad_block' || e.kind === 'pad') && e.origin && model.ownMutations.has(e.origin)) return
        if (e.kind === 'pad_block') remoteIds.current.add(e.id)
        if (e.kind === 'task') {
          // ชื่อ/สถานะ task ที่เปลี่ยนจากที่อื่นสะท้อนผ่านการ refetch ของ pad-blocks
        }
      }),
    [model],
  )
  const expandKey = expand.join(',')
  useEffect(() => {
    if (expandKey) model.reveal(expandKey.split(','))
  }, [expandKey, model])

  // search target: expand its section, scroll, focus (once per target)
  const handledTarget = useRef<string | null>(null)
  useEffect(() => {
    if (!target || handledTarget.current === target) return
    const row = snap.rows.find((r) => r.block.id === target)
    if (!row) return
    const ancestors: string[] = []
    let k = model.tree.parentOf(row.block.key)
    while (k !== ROOT) {
      ancestors.push(k)
      k = model.tree.parentOf(k)
    }
    if (ancestors.some((a) => !model.expanded.has(a))) {
      model.reveal(ancestors)
      return
    }
    const el = document.querySelector<HTMLElement>(`[data-key="${CSS.escape(row.block.key)}"]`)
    if (!el) return
    handledTarget.current = target
    el.scrollIntoView({ block: 'center' })
    model.requestFocus(row.block.key, row.block.type === 'task' ? 'title' : 'content', 'end')
    model.notify(`Found in ${pad.name}`)
    setParams(
      (p) => {
        const next = new URLSearchParams(p)
        next.delete('block')
        return next
      },
      { replace: true },
    )
  }, [target, snap.rows, model, pad.name, setParams])

  const focusField = (key: string, caret: 'start' | 'end' = 'end') => {
    const b = model.tree.blocks.get(key)
    if (!b) return
    model.requestFocus(key, b.type === 'task' ? 'title' : 'content', caret)
  }

  const closePicker = useCallback(() => {
    setPicker(null)
    setPickerActive(0)
    pickerAnchor.current = null
  }, [])

  const pick = (c: PadTaskCandidate) => {
    if (!picker) return
    const key = picker.key.replace(/:description$/, '')
    if (picker.mode === 'place') {
      model.placeTask(key, c)
    } else if (picker.mode === 'mention') {
      model.addMentionInfo(c.task)
      const el = document.querySelector<HTMLElement>(`[data-key="${CSS.escape(key)}"] .pad-editable`)
      const at = el ? mentionQuery(el) : null
      if (el && at) {
        insertMention(el, at, c.task.id, { ...snap.mentions, [c.task.id]: { id: c.task.id, title: c.task.title, status: c.task.status, archivedAt: c.task.archivedAt } })
        model.setContent(key, readSegments(el))
      }
    } else {
      const b = model.tree.get(key)
      const textarea = document.getElementById(`desc-${key}`) as HTMLTextAreaElement | null
      const caret = textarea?.selectionStart ?? b.description.length
      const before = b.description.slice(0, caret).replace(/@([^@\n]{0,40})$/, '')
      const link = `[@${c.task.title.replace(/[[\]]/g, '')}](/tasks/${c.task.id}) `
      model.setDescription(key, before + link + b.description.slice(caret))
      requestAnimationFrame(() => {
        textarea?.focus()
        textarea?.setSelectionRange((before + link).length, (before + link).length)
      })
    }
    closePicker()
  }

  const api: RowApi & { backspaceAtStartTask(key: string, empty: boolean): boolean } = {
    setContent: (key, el) => model.setContent(key, readSegments(el)),
    setTitle: (key, title) => model.setTitle(key, title),
    setDescription: (key, text) => model.setDescription(key, text),
    enter: (key, p) => {
      const b = model.tree.get(key)
      closePicker()
      if (b.type === 'task') {
        let before = p.titleBefore ?? b.title
        let after = p.titleAfter ?? ''
        // Enter ที่ต้นบรรทัดที่มีข้อความ: ยืนยันบรรทัดนี้ทั้งบรรทัด ไม่ใช่แยกเป็นบรรทัดว่าง
        if (!before.trim() && after.trim()) {
          before = b.title
          after = ''
        }
        if (!before.trim() && !b.id) {
          // Enter บนบรรทัด Task ว่าง: ออกจากระดับซ้อนก่อน
          if (model.tree.parentOf(key) !== ROOT) model.outdent(key)
          return
        }
        if (after) model.setTitle(key, before)
        model.commitTask(key)
        const next = model.insertAfter(key, 'task', { title: after.trim() })
        model.requestFocus(next, 'title', 'start')
        model.flushAll()
        return
      }
      model.setContent(key, p.before as PadSegment[])
      model.flush(key)
      const next = model.insertAfter(key, 'text', { content: p.after as PadSegment[] })
      model.requestFocus(next, 'content', 'start')
    },
    commit: (key) => {
      if (!model.tree.has(key)) return
      const b = model.tree.get(key)
      if (b.type === 'task') model.commitTask(key)
      else model.flush(key)
    },
    indent: (key) => model.indent(key),
    outdent: (key) => model.outdent(key),
    moveUp: (key) => model.moveUp(key),
    moveDown: (key) => model.moveDown(key),
    backspaceAtStart: (key, empty) => {
      const prev = previousVisible(snap.visible, key)
      if (empty) {
        model.remove(key, 'promote')
        if (prev) focusField(prev, 'end')
      } else model.outdent(key)
    },
    backspaceAtStartTask: (key, empty) => {
      const b = model.tree.get(key)
      const prev = previousVisible(snap.visible, key)
      if (empty && !b.id && b.sync === 'draft') {
        if (!prev) return false
        model.remove(key, 'promote')
        focusField(prev, 'end')
        return true
      }
      if (model.tree.parentOf(key) !== ROOT) {
        model.outdent(key)
        return true
      }
      return false
    },
    focusNeighbour: (key, dir) => {
      const i = snap.visible.findIndex((r) => r.block.key === key)
      const next = snap.visible[i + dir]
      if (next) {
        focusField(next.block.key, dir < 0 ? 'end' : 'start')
        model.notify('')
      }
    },
    focused: (key) => {
      model.focusedKey = key
    },
    openDescription: (key) => {
      model.commitTask(key)
      setDescriptions((s) => new Set(s).add(key))
      model.requestFocus(key, 'description', 'end')
      model.notify('Description')
    },
    exitDescription: (key, trim) => {
      const b = model.tree.get(key)
      if (trim) model.setDescription(key, b.description.replace(/\n+$/, ''))
      model.flush(key)
      setDescriptions((s) => {
        const n = new Set(s)
        n.delete(key)
        return n
      })
      const next = model.insertAfter(key, 'task')
      model.requestFocus(next, 'title', 'start')
      model.notify('New task line')
    },
    picker: (key, mode, query) => {
      if (!mode) return closePicker()
      setPicker({ key, mode, query })
      setPickerActive(0)
    },
    pickerKey: (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') setPickerActive((i) => Math.min(i + 1, Math.max(items.length - 1, 0)))
      else if (e.key === 'ArrowUp') setPickerActive((i) => Math.max(i - 1, 0))
      else if ((e.key === 'Enter' || e.key === 'Tab') && items[pickerActive]) pick(items[pickerActive])
      else if (e.key === 'Escape') closePicker()
      else return false
      e.preventDefault()
      return true
    },
    paste: (key, lines) => setPaste({ key, lines }),
    menuItems: (row) => menuFor(row),
    toggleComplete: (key) => model.toggleComplete(key),
    toggleCollapse: (key) => model.toggleCollapse(key),
    openTask: (taskId) => peek.open(taskId),
    retry: (key) => model.retry(key),
    discard: (key) => model.discard(key),
    dragStart: (key) => {
      dragKey.current = key
    },
    drop: (targetKey, position) => {
      const key = dragKey.current
      dragKey.current = null
      if (key) model.moveRelative(key, targetKey, position)
    },
    consumeFocus: (key, field) => {
      const f = model.getSnapshot().focus
      if (!f || f.key !== key || f.field !== field || f.seq <= appliedFocus.current) return null
      appliedFocus.current = f.seq
      return { field: f.field, caret: f.caret }
    },
  }
  const appliedFocus = useRef(0)
  // rows ได้ api ตัวเดิมตลอด (เรียก closure ล่าสุดผ่าน ref) เพื่อให้ memo ของแต่ละแถวทำงาน
  const apiRef = useRef(api)
  apiRef.current = api
  const stableApi = useMemo(
    () => new Proxy({} as typeof api, { get: (_t, prop: string) => (...args: unknown[]) => (apiRef.current as any)[prop](...args) }),
    [],
  )

  const menuFor = (row: FlatRow): MenuItem[] => {
    const b = row.block
    const key = b.key
    if (archived) return [{ label: 'Restore the pad to edit', onSelect: () => undefined, disabled: true }]
    const items: MenuItem[] = []
    const types: PadBlockType[] = ['task', 'text', 'heading']
    for (const t of types) if (t !== b.type) items.push({ label: `Turn into ${t === 'task' ? 'Task' : t === 'text' ? 'Text' : 'Heading'}`, onSelect: () => model.convert(key, t) })
    items.push(
      { label: 'Indent (Alt+Shift+→)', onSelect: () => model.indent(key), disabled: !model.tree.prevSibling(key) },
      { label: 'Outdent (Alt+Shift+←)', onSelect: () => model.outdent(key), disabled: row.parentKey === ROOT },
      { label: 'Move up (Alt+Shift+↑)', onSelect: () => model.moveUp(key), disabled: !model.tree.prevSibling(key) },
      { label: 'Move down (Alt+Shift+↓)', onSelect: () => model.moveDown(key), disabled: !model.tree.nextSibling(key) },
    )
    if (b.type === 'heading') items.push({ label: b.collapsed ? 'Expand section' : 'Collapse section', onSelect: () => model.toggleCollapse(key) })
    if (b.type === 'task' && b.task) {
      const task = b.task
      items.push(
        { label: 'Open task details', onSelect: () => peek.open(task.id) },
        { label: b.description || descriptions.has(key) ? 'Edit description' : 'Add description', onSelect: () => api.openDescription(key) },
        { label: task.status === 'done' ? 'Reopen task' : 'Mark task done', onSelect: () => model.toggleComplete(key), disabled: Boolean(task.archivedAt) },
        task.archivedAt ? { label: 'Restore task', onSelect: () => model.setTaskArchived(key, false) } : { label: 'Archive task', onSelect: () => model.setTaskArchived(key, true) },
        { label: 'Turn into description…', onSelect: () => setDescribe({ key, taskId: task.id, title: b.title }) },
        { label: 'Remove from pad', onSelect: () => removeAndFocus(key, 'promote') },
      )
    } else if (b.type !== 'task') {
      for (const s of b.content) {
        if (s.type === 'mention') items.push({ label: `Open @${snap.mentions[s.taskId]?.title ?? 'task'}`, onSelect: () => peek.open(s.taskId) })
      }
      items.push({ label: row.hasChildren ? 'Delete line (keep nested lines)' : 'Delete line', onSelect: () => removeAndFocus(key, 'promote'), danger: !row.hasChildren })
      if (row.hasChildren) items.push({ label: 'Delete with nested lines…', danger: true, onSelect: () => setConfirmSubtree(key) })
    } else {
      items.push({ label: 'Delete line', onSelect: () => removeAndFocus(key, 'promote') })
    }
    return items
  }

  const removeAndFocus = (key: string, mode: 'promote' | 'subtree') => {
    const prev = previousVisible(snap.visible, key)
    model.remove(key, mode)
    if (prev) focusField(prev)
    else focusField(model.captureKey())
  }

  const onMenuOpenChange = useCallback((key: string, open: boolean) => setMenuKey(open ? key : null), [])

  // Undo และเมนูบรรทัดใช้ได้แม้ focus หลุดไปที่ body (เช่น หลังลบบรรทัดผ่านเมนู)
  const rootKeyRef = useRef<(e: KeyboardEvent) => void>(() => undefined)
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      const active = document.activeElement
      if (active && active !== document.body && !active.closest('.pad-document')) return
      if (active && active.closest('.pad-document')) return // handled by the capture listener
      rootKeyRef.current(e as unknown as KeyboardEvent)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  const onRootKeyDown = (e: KeyboardEvent) => {
    const modKey = e.metaKey || e.ctrlKey
    if (modKey && !e.shiftKey && e.key.toLowerCase() === 'z') {
      e.preventDefault()
      if (!model.undo()) model.notify('Nothing to undo')
    } else if (modKey && e.key === '/') {
      e.preventDefault()
      const key = model.focusedKey
      if (key && model.tree.has(key)) setMenuKey(key)
    }
  }

  rootKeyRef.current = onRootKeyDown
  if (blocks.isLoading && snap.rows.length <= 1) return <Loading />
  const subtreeRow = confirmSubtree ? snap.rows.find((r) => r.block.key === confirmSubtree) : null

  return (
    <div className="pad-document" onKeyDownCapture={onRootKeyDown}>
      <ErrorMessage error={blocks.error} />
      <SyncStatus pending={snap.pending} failed={snap.failed} offline={snap.offline} overflow={entry.outbox.overflow} onRetry={() => model.wake()} />
      <ol className="pad-blocks" aria-label={`Contents of ${pad.name}`} role="list">
        {snap.visible.map((row) => (
          <BlockRow
            key={row.block.key}
            row={row}
            api={stableApi}
            mentions={snap.mentions}
            pad={pad}
            picker={picker && picker.key.replace(/:description$/, '') === row.block.key ? picker : null}
            pickerActive={pickerActive}
            pickerCount={items.length}
            menuOpen={menuKey === row.block.key}
            onMenuOpenChange={onMenuOpenChange}
            descriptionOpen={descriptions.has(row.block.key)}
            focusSeq={snap.focus?.key === row.block.key ? snap.focus.seq : 0}
            disabled={archived}
            offline={snap.offline}
          />
        ))}
      </ol>
      {picker && (
        <PickerPortal pickerKey={picker.key}>
          <MentionPicker state={picker} items={items} active={pickerActive} loading={results.isFetching} onPick={pick} onHover={setPickerActive} />
        </PickerPortal>
      )}
      <p className="sr-only" role="status" aria-live="polite">
        {snap.notice?.text}
      </p>
      {snap.notice?.text.startsWith('This line was updated') && (
        <p className="notice pad-notice" role="alert">
          {snap.notice.text}
        </p>
      )}
      <PasteDialog
        request={paste}
        onCancel={() => setPaste(null)}
        onTasks={(titles) => {
          if (paste) model.pasteTasks(paste.key, titles)
          setPaste(null)
        }}
        onText={(lines) => {
          if (paste) model.pasteText(paste.key, lines)
          setPaste(null)
        }}
      />
      <TurnIntoDescriptionDialog
        source={describe}
        onCancel={() => setDescribe(null)}
        onConfirm={(targetTaskId) => {
          if (describe) model.turnIntoDescription(describe.key, targetTaskId)
          setDescribe(null)
          void qc.invalidateQueries({ queryKey: ['task', targetTaskId] })
        }}
      />
      <ConfirmDialog
        open={subtreeRow != null}
        title="Delete this line and everything nested in it?"
        message={`“${subtreeRow ? plain(subtreeRow.block.content).slice(0, 80) || 'This line' : ''}” and all lines nested under it will be removed from this pad. Tasks inside stay on the Board.`}
        confirmLabel="Delete with nested lines"
        danger
        onCancel={() => setConfirmSubtree(null)}
        onConfirm={() => {
          if (confirmSubtree) removeAndFocus(confirmSubtree, 'subtree')
          setConfirmSubtree(null)
        }}
      />
    </div>
  )
}

function previousVisible(visible: FlatRow[], key: string): string | null {
  const i = visible.findIndex((r) => r.block.key === key)
  return i > 0 ? visible[i - 1].block.key : null
}

/** Places the picker under the line that opened it. */
function PickerPortal({ pickerKey, children }: { pickerKey: string; children: React.ReactNode }) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  useEffect(() => {
    const key = pickerKey.replace(/:description$/, '')
    const row = document.querySelector<HTMLElement>(`[data-key="${CSS.escape(key)}"]`)
    const doc = row?.closest('.pad-document') as HTMLElement | null
    if (!row || !doc) return
    const field = pickerKey.endsWith(':description') ? row.querySelector<HTMLElement>('.pad-description') : row.querySelector<HTMLElement>('.pad-row-line')
    const r = (field ?? row).getBoundingClientRect()
    const d = doc.getBoundingClientRect()
    setPos({ top: r.bottom - d.top + 4, left: Math.max(0, r.left - d.left + 24) })
  }, [pickerKey])
  return (
    <div className="mention-picker-wrap" style={pos ? { top: pos.top, left: pos.left } : { display: 'none' }}>
      {children}
    </div>
  )
}

/** Pad-level sync state: quiet when saved, explicit when changes wait on this device or failed. */
function SyncStatus({ pending, failed, offline, overflow, onRetry }: { pending: number; failed: number; offline: boolean; overflow: boolean; onRetry: () => void }) {
  if (failed > 0) {
    return (
      <p className="pad-sync is-failed" role="status">
        {failed} line{failed === 1 ? '' : 's'} could not be saved. Use Retry or Discard on {failed === 1 ? 'it' : 'each line'} below.
      </p>
    )
  }
  if (offline && pending > 0) {
    return (
      <p className="pad-sync is-offline" role="status">
        <span>
          Not synced: {pending} change{pending === 1 ? '' : 's'} {overflow ? 'are kept in this window only' : 'saved on this device'} and will be sent when the connection returns.
        </span>
        <button type="button" className="link" onClick={onRetry}>
          Retry now
        </button>
      </p>
    )
  }
  return (
    <p className="sr-only" role="status">
      {pending > 0 ? 'Saving' : 'All changes saved'}
    </p>
  )
}
