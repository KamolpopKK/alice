import { lazy, Suspense } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { ArrowRight, Bot, ShieldCheck } from 'lucide-react'
import { useAuth } from '../auth'
import { useActors } from '../hooks'
import { Avatar, Badge, Banner, Button, EmptyState, LinkButton, ResourceItem, ResourceList, Skeleton } from '../ui'
import { useLocalWorkspace } from '../workspace-mode'
import { AgentSetupGuide } from './ForAgentPage'

// เครื่องมือ agent ของ Local workspace อยู่ในโค้ดเฉพาะ Desktop (โหลดเมื่อใช้เท่านั้น)
const LocalAgents = lazy(() => import('../desktop/LocalScreens').then((m) => ({ default: m.AgentsSection })))
const LocalGuide = lazy(() => import('../desktop/LocalAgentGuide').then((m) => ({ default: m.LocalAgentGuide })))

/** Agents: who the agents in this workspace are and what they did, then how to connect another. */
export function AgentsPage() {
  const local = useLocalWorkspace()
  const { actor } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  // ครั้งแรกหลังจบ onboarding: หน้านี้มาก่อน Home เพื่อให้ตั้งค่า agent ได้ทันที
  const after = location.state as { afterOnboarding?: boolean; capturedPad?: string } | null
  return (
    <div className="page resource-page agents-page">
      {after?.afterOnboarding && (
        <Banner
          tone="info"
          title="One more step: connect your agent"
          action={
            <Button size="sm" variant="primary" icon={ArrowRight} onClick={() => navigate('/', { state: after.capturedPad ? { capturedPad: after.capturedPad } : null })}>
              Continue to Home
            </Button>
          }
        >
          Copy the setup prompt below into Claude Code or Codex and it sets itself up. You can come back here any time from Agents in the sidebar.
        </Banner>
      )}
      <div className="resource-head">
        <div>
          <h1>Agents</h1>
          <p className="resource-meta">AI agents work on the same board as people, each under its own name.</p>
        </div>
        {!local && actor?.isOwner && (
          <LinkButton as={Link as never} to="/settings/admin" icon={ShieldCheck}>
            Manage agents and tokens
          </LinkButton>
        )}
      </div>
      <AgentRoster />
      {local ? (
        <Suspense fallback={<Skeleton lines={4} />}>
          <LocalGuide />
          <LocalAgents />
        </Suspense>
      ) : (
        <AgentSetupGuide />
      )}
    </div>
  )
}

function AgentRoster() {
  const actors = useActors()
  const agents = (actors.data ?? []).filter((a) => a.kind === 'agent')
  return (
    <section aria-labelledby="agents-roster" className="resource-section">
      <h2 id="agents-roster" className="resource-panel-title">
        In this workspace
      </h2>
      {actors.isLoading ? (
        <Skeleton lines={2} />
      ) : agents.length === 0 ? (
        <EmptyState icon={Bot} title="No agents yet">
          Connect one below; its work will appear here and in Activity.
        </EmptyState>
      ) : (
        <ResourceList label="Agents in this workspace">
          {agents.map((a) => (
            <ResourceItem
              key={a.id}
              icon={Bot}
              title={a.displayName}
              meta={
                <>
                  <Avatar name={a.displayName} kind="agent" size="sm" />
                  {a.deactivatedAt ? <Badge>deactivated</Badge> : <Badge tone="agent">Agent</Badge>}
                  <Link to={`/activity?actorId=${a.id}`}>Activity of {a.displayName}</Link>
                </>
              }
            />
          ))}
        </ResourceList>
      )}
    </section>
  )
}
