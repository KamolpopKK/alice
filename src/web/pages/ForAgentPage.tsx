import { useRef, useState, type KeyboardEvent } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { AGENT_GUIDE_CLIENTS, agentSetupGuide, type AgentGuideClient } from '../../shared/agent-guide'
import { useMe } from '../auth'
import { CodeBlock } from '../components/CodeBlock'
import { useServerInfo } from '../hooks'
import { Banner } from '../ui'

interface DownloadManifest {
  version: string
  files: Array<{ name: string; bytes: number; sha256: string }>
}

/** Server origin for commands: the configured public URL, else the address this page came from. */
function useServerOrigin(): string {
  const info = useServerInfo()
  try {
    if (info.data?.publicUrl) return new URL(info.data.publicUrl).origin
  } catch {
    /* fall back below */
  }
  return window.location.origin
}

/** Whether this server offers the tooling downloads. Only probed when the page shares the server's origin. */
function useDownloads(origin: string) {
  const sameOrigin = origin === window.location.origin
  return useQuery({
    queryKey: ['downloads-manifest'],
    enabled: sameOrigin,
    retry: false,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<DownloadManifest | null> => {
      const res = await fetch('/downloads/manifest.json', { credentials: 'omit' })
      return res.ok ? ((await res.json()) as DownloadManifest) : null
    },
  })
}

/** Setup guide for connecting an agent to this Remote workspace (no secrets are ever shown here). */
export function AgentSetupGuide() {
  const me = useMe()
  const origin = useServerOrigin()
  const downloads = useDownloads(origin)
  const [client, setClient] = useState<AgentGuideClient>('claude-code')
  const tabs = useRef<Array<HTMLButtonElement | null>>([])
  const guide = agentSetupGuide(client, origin)

  const onTabKey = (e: KeyboardEvent, index: number) => {
    const last = AGENT_GUIDE_CLIENTS.length - 1
    const next = e.key === 'ArrowRight' ? (index === last ? 0 : index + 1) : e.key === 'ArrowLeft' ? (index === 0 ? last : index - 1) : e.key === 'Home' ? 0 : e.key === 'End' ? last : null
    if (next === null) return
    e.preventDefault()
    setClient(AGENT_GUIDE_CLIENTS[next].id)
    tabs.current[next]?.focus()
  }

  return (
    <div className="for-agent">
      <section className="resource-panel" aria-labelledby="connect-heading">
        <h2 id="connect-heading" className="resource-panel-title">
          Connect an agent
        </h2>
        <p>
          Install the <code>alice</code> CLI, the Alice skill and the MCP connection. Every change the agent makes is recorded under its own identity.
        </p>
        <h3 id="token-heading">Agent token</h3>
        <p>Each agent needs its own token. You place it yourself; neither this page nor the setup prompt ever asks for it.</p>
        {me.isOwner ? (
          <p>
            Create an agent and its token in <Link to="/settings/admin">Settings › Administration</Link>. The token is shown once.
          </p>
        ) : (
          <p>Ask the workspace owner to create an agent and give you its token.</p>
        )}
      </section>

      {downloads.data === null && (
        <Banner tone="danger">
          Tool downloads are not available on this server. Ask the operator to build it with <code>npm run build:server</code>.
        </Banner>
      )}

      <div className="agent-tabs" role="tablist" aria-label="Agent client">
        {AGENT_GUIDE_CLIENTS.map((c, i) => (
          <button
            key={c.id}
            ref={(el) => {
              tabs.current[i] = el
            }}
            type="button"
            role="tab"
            id={`agent-tab-${c.id}`}
            aria-selected={client === c.id}
            aria-controls="agent-tabpanel"
            tabIndex={client === c.id ? 0 : -1}
            onClick={() => setClient(c.id)}
            onKeyDown={(e) => onTabKey(e, i)}
          >
            {c.label}
          </button>
        ))}
      </div>

      <div id="agent-tabpanel" role="tabpanel" aria-labelledby={`agent-tab-${client}`}>
        <section className="resource-panel" aria-labelledby="prompt-heading">
          <h2 id="prompt-heading" className="resource-panel-title">Let your agent set it up</h2>
          <p>
            Copy this prompt and paste it into {guide.label}. It installs and configures everything, then stops for you to place the
            token, and finally checks the connection.
          </p>
          <CodeBlock code={guide.prompt} label={`Setup prompt for ${guide.label}`} primary />
        </section>

        <section className="resource-panel" aria-labelledby="manual-heading">
          <h2 id="manual-heading" className="resource-panel-title">Or set it up yourself</h2>
          <p className="resource-meta">
            Server <code>{guide.origin}</code> · MCP endpoint <code>{guide.mcpUrl}</code>
            {downloads.data && <> · tools version {downloads.data.version}</>}
          </p>
          <ol className="agent-steps">
            {guide.steps.map((step) => (
              <li key={step.title}>
                <h3>{step.title}</h3>
                <p>{step.description}</p>
                <CodeBlock code={step.code} label={step.title} />
              </li>
            ))}
          </ol>
        </section>

        <section className="resource-panel" aria-labelledby="update-heading">
          <h2 id="update-heading" className="resource-panel-title">Keep it up to date</h2>
          <p>
            After this server is upgraded, update the CLI, the MCP adapter and the skills so they match it. Your token and MCP
            configuration stay as they are.
            {downloads.data && (
              <>
                {' '}
                This server ships version <strong>{downloads.data.version}</strong>; compare it with <code>alice version</code>.
              </>
            )}
          </p>
          <CodeBlock code={guide.update.prompt} label={`Update prompt for ${guide.label}`} />
          <h3 className="agent-subhead">Or update by hand</h3>
          <ol className="agent-steps">
            {guide.update.steps.map((step) => (
              <li key={step.title}>
                <h3>{step.title}</h3>
                <p>{step.description}</p>
                <CodeBlock code={step.code} label={`Update: ${step.title}`} />
              </li>
            ))}
          </ol>
        </section>
      </div>
    </div>
  )
}
