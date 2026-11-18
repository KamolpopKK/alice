import { useEffect, useState } from 'react'
import { MascotImage } from '../brand'
import { Button, Dialog } from '../ui'

const EVENT = 'alice:tour'

/** Opens the guided tour from anywhere (Help in the account menu, the command palette). */
export function openTour() {
  window.dispatchEvent(new Event(EVENT))
}

const STEPS: Array<{ title: string; body: string }> = [
  { title: 'Everything starts in the sidebar', body: 'Home, Task Pads, Tasks, Projects, Documents and Search are at the top. Agents, Activity and Settings sit below them.' },
  { title: 'New, from any page', body: 'Use New to create a task, a pad, a project or a document in two clicks, wherever you are.' },
  { title: 'Find anything with Ctrl K', body: 'Press Ctrl K (⌘K on a Mac) to jump to a page, open a task or document, or run a command.' },
  { title: 'Tasks in three views', body: 'My Work, Board and List show the same tasks. Open one to see it beside the list, drag cards between Board columns, or select several in List to change them together.' },
  { title: 'Agents work alongside you', body: 'Agents have their own names, so Activity always shows who changed what. Agents has the setup guide.' },
  { title: 'Make it yours', body: 'Choose Light, Dark or System in Settings › Appearance. You can take this tour again from the account menu.' },
]

/** A short, skippable tour of the interface. Alice appears here because Help is one of her moments. */
export function Tour() {
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState(0)
  useEffect(() => {
    const show = () => {
      setStep(0)
      setOpen(true)
    }
    window.addEventListener(EVENT, show)
    return () => window.removeEventListener(EVENT, show)
  }, [])
  const current = STEPS[step]
  const last = step === STEPS.length - 1
  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      title={current.title}
      description={`Step ${step + 1} of ${STEPS.length}`}
      actions={
        <>
          {step > 0 && <Button onClick={() => setStep(step - 1)}>Back</Button>}
          {last ? (
            <Button variant="primary" onClick={() => setOpen(false)} data-autofocus>
              Done
            </Button>
          ) : (
            <Button variant="primary" onClick={() => setStep(step + 1)} data-autofocus>
              Next
            </Button>
          )}
        </>
      }
    >
      <div className="tour-body" aria-live="polite">
        <MascotImage pose={last ? 'friendly' : 'curious'} width={72} className="tour-mascot" />
        <p>{current.body}</p>
      </div>
    </Dialog>
  )
}
