import { lazy, Suspense } from 'react'
import { Loading } from '../components/ui'
import { useLocalWorkspace } from '../workspace-mode'
import { ForAgentPage } from './ForAgentPage'

// เครื่องมือ agent ของ Local workspace อยู่ในโค้ดเฉพาะ Desktop (โหลดเมื่อใช้เท่านั้น)
const LocalAgents = lazy(() => import('../desktop/LocalScreens').then((m) => ({ default: m.AgentsSection })))

/** Agents: Remote servers show the setup guide; a Local workspace shows its installed integrations. */
export function AgentsPage() {
  const local = useLocalWorkspace()
  if (!local) return <ForAgentPage />
  return (
    <div className="page">
      <h1>Agents</h1>
      <Suspense fallback={<Loading />}>
        <LocalAgents />
      </Suspense>
    </div>
  )
}
