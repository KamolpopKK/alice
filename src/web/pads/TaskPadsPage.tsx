import { Navigate, useLocation, useParams } from 'react-router-dom'
import { useEffect } from 'react'
import { isRecoverable, FullPageError } from '../brand'
import { ErrorMessage } from '../components/ui'
import { Banner, Button, EmptyState, Skeleton } from '../ui'
import { NotebookPen } from 'lucide-react'
import { NARROW_QUERY, lastPadId, rememberLastPad, useMediaQuery, usePad, usePads } from './hooks'
import { PadEditor, activePadModel } from './PadEditor'
import { PadHeader } from './PadHeader'
import { PadSidebar, useNewPad } from './PadSidebar'
import { TaskPeek } from './TaskPeek'
import { useCaptureIntent } from './capture'
import { useCapability } from '../hooks'

/**
 * Notes-style Task Pads: the Pad list on the left and the selected Pad on the right. Narrow
 * windows show the list and the editor as separate screens with a Back action.
 */
export function TaskPadsPage() {
  const supported = useCapability('task-pads')
  if (!supported) {
    return (
      <div className="page">
        <h1>Task Pads</h1>
        <Banner tone="info">This Alice server does not offer Task Pads yet. Ask the operator to upgrade the server; everything else keeps working.</Banner>
      </div>
    )
  }
  return <TaskPads />
}

function TaskPads() {
  const { padId } = useParams()
  useCaptureIntent()
  const narrow = useMediaQuery(NARROW_QUERY)
  const showList = !narrow || !padId
  const showEditor = Boolean(padId) || !narrow
  return (
    <div className={`pads-page ${narrow ? 'is-narrow' : ''}`}>
      {showList && <PadSidebar selectedId={padId} />}
      {showEditor && (
        <section className="pad-main" aria-label="Pad editor">
          {padId ? <PadScreen key={padId} padId={padId} narrow={narrow} /> : <OpenDefaultPad />}
        </section>
      )}
      <TaskPeek />
    </div>
  )
}

/** Wide screens open the last Pad used on this device, or the most recently updated one. */
function OpenDefaultPad() {
  const pads = usePads('active')
  const newPad = useNewPad()
  const location = useLocation()
  if ((location.state as { capture?: unknown } | null)?.capture) return <Skeleton lines={4} />
  if (pads.isLoading) return <Skeleton lines={4} />
  if (pads.error) return <ErrorMessage error={pads.error} />
  const items = pads.data ?? []
  if (items.length > 0) {
    const remembered = lastPadId()
    const target = items.find((p) => p.id === remembered) ?? [...items].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]
    return <Navigate to={`/pads/${target.id}`} replace />
  }
  return (
    <div className="pad-empty">
      <EmptyState
        icon={NotebookPen}
        headingLevel={2}
        title="Capture while you listen"
        action={
          <Button variant="primary" onClick={newPad.start} loading={newPad.pending}>
            New Pad
          </Button>
        }
      >
        A pad is a private notepad. Lines you mark as tasks go straight to the Board; text and headings stay yours.
      </EmptyState>
      <ErrorMessage error={newPad.error} />
    </div>
  )
}

function PadScreen({ padId, narrow }: { padId: string; narrow: boolean }) {
  const pad = usePad(padId)
  const location = useLocation()
  useEffect(() => {
    if (pad.data) rememberLastPad(pad.data.id)
  }, [pad.data])
  if (pad.isLoading) return <Skeleton lines={6} />
  if (pad.error) {
    // Pad ของคนอื่นกับ id ที่ไม่มีอยู่ แสดงเหมือนกันทุกประการ
    if (!isRecoverable(pad.error)) {
      return (
        <div className="pad-empty">
          <EmptyState headingLevel={2} title="Pad not found">It may have been deleted, or it is not one of your pads.</EmptyState>
        </div>
      )
    }
    return <FullPageError error={pad.error} onRetry={() => void pad.refetch()} />
  }
  if (!pad.data) return null
  const state = (location.state ?? {}) as { focusCapture?: boolean; focusToken?: string; expand?: string[]; capture?: unknown }
  return (
    <>
      <PadHeader
        pad={pad.data}
        narrow={narrow}
        extraActions={
          pad.data.archivedAt
            ? []
            : [
                {
                  label: 'Remove completed tasks',
                  onSelect: () => {
                    const removed = activePadModel(padId)?.removeCompleted() ?? []
                    activePadModel(padId)?.notify(removed.length ? `Removed ${removed.length} completed task line${removed.length === 1 ? '' : 's'}; the tasks stay on the Board` : 'No completed tasks in this pad')
                  },
                },
              ]
        }
      />
      <PadEditor pad={pad.data} focusCapture={state.focusCapture === true} focusToken={state.focusToken ?? null} expand={state.expand ?? []} />
    </>
  )
}
