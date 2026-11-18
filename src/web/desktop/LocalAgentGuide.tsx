import { useState } from 'react'
import { AGENT_GUIDE_CLIENTS, localAgentSetupGuide, type AgentGuideClient } from '../../shared/agent-guide'
import { CodeBlock } from '../components/CodeBlock'
import { Button, FieldMessage, Tabs } from '../ui'
import { native } from './native'

function messageOf(err: unknown): string {
  return typeof err === 'object' && err && 'message' in err ? String((err as { message: unknown }).message) : String(err)
}

/** Installs (or repairs) the `alice` command that Local agents use; Alice Desktop owns the runtime. */
function InstallCli() {
  const [state, setState] = useState<{ busy: boolean; done: boolean; error: string | null }>({ busy: false, done: false, error: null })
  return (
    <div className="local-guide-install">
      <Button
        size="sm"
        loading={state.busy}
        onClick={() => {
          setState({ busy: true, done: false, error: null })
          native
            .toolsApply({ cli: true, codex: false, claude: false })
            .then(() => setState({ busy: false, done: true, error: null }))
            .catch((err) => setState({ busy: false, done: false, error: messageOf(err) }))
        }}
      >
        Install the alice command
      </Button>
      {state.done && <span role="status">Installed in ~/.local/bin. New terminal windows find it.</span>}
      {state.error && <FieldMessage tone="error">{state.error}</FieldMessage>}
    </div>
  )
}

function GuidePanel({ client }: { client: AgentGuideClient }) {
  const guide = localAgentSetupGuide(client)
  return (
    <div className="local-guide-panel">
      <section className="resource-panel" aria-labelledby={`local-prompt-${client}`}>
        <h3 id={`local-prompt-${client}`} className="resource-panel-title">
          Let {guide.label} set itself up
        </h3>
        <p>
          Copy this prompt and paste it into {guide.label} on this computer. It checks the <code>alice</code> command, gives itself its own identity and the Alice
          skills, and confirms which workspace it will use. No token or password is involved.
        </p>
        <CodeBlock code={guide.prompt} label={`Setup prompt for ${guide.label}`} primary />
      </section>
      <section className="resource-panel" aria-labelledby={`local-manual-${client}`}>
        <h3 id={`local-manual-${client}`} className="resource-panel-title">
          Or set it up yourself
        </h3>
        <ol className="agent-steps">
          {guide.steps.map((step) => (
            <li key={step.title}>
              <h4>{step.title}</h4>
              <p>{step.description}</p>
              <CodeBlock code={step.code} label={step.title} />
            </li>
          ))}
        </ol>
      </section>
      <section className="resource-panel" aria-labelledby={`local-try-${client}`}>
        <h3 id={`local-try-${client}`} className="resource-panel-title">
          Then try asking {guide.label}
        </h3>
        <ul className="local-guide-try">
          {guide.tryPrompts.map((p, i) => (
            <li key={p}>
              <CodeBlock code={p} label={`Example ${i + 1} for ${guide.label}`} />
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}

/**
 * Setting up an agent in a Local workspace: a prompt the agent runs itself (no server, URL, token or
 * MCP), the same steps by hand, and first things to ask. The `alice` command comes with Alice Desktop.
 */
export function LocalAgentGuide() {
  return (
    <section className="local-guide" aria-labelledby="local-guide-heading">
      <h2 id="local-guide-heading" className="resource-panel-title">
        Set up your agent
      </h2>
      <p className="resource-meta">
        Agents on this computer work through the <code>alice</code> command, each under its own name. If the command is missing, install it first:
      </p>
      <InstallCli />
      <Tabs label="Agent" items={AGENT_GUIDE_CLIENTS.map((c) => ({ value: c.id, label: c.label, content: <GuidePanel client={c.id} /> }))} />
    </section>
  )
}
