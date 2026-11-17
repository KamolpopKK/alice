// `alice integration …`: เปิด/ปิด Codex และ Claude สำหรับ Local workspaces
// เปิด = identity ของ agent ในแต่ละ workspace + skill ของ client นั้น; ไม่มี MCP, URL หรือ token ให้เห็น
// ปิด = เพิกถอน credential ทันที (ทั้งใน OS store และใน daemon ที่เปิดอยู่) แต่ประวัติทั้งหมดคงไว้
import { SKILLS, installSkills, skillTargetDir, type AgentClient } from '../../server/agent-setup'
import { capabilityAccount, localCredentialStore } from '../../local/capabilities'
import { probeDaemon } from '../../local/daemon-client'
import { LOCAL_AGENT_CLIENTS, LOCAL_AGENT_LABEL, readRegistry, setIntegrationOptIn, type LocalAgentClient, type LocalWorkspace } from '../../local/registry'
import fs from 'node:fs'
import path from 'node:path'
import { CliContext, parseCommand } from '../context'
import { CliError } from '../errors'
import { LocalSession } from '../local-session'
import { confirm } from '../output'
import { CLI_VERSION } from '../version'

export const INTEGRATION_HELP = `alice integration — Codex and Claude in Local workspaces

  list                                    Opt-in, skills and per-workspace state of each agent
  enable codex|claude-code                Install its Alice skills and give it its own identity in every Local workspace
  disable codex|claude-code               Revoke its access now; its history and assignments stay
  unassign codex|claude-code --workspace W --yes
                                          Move that agent's open tasks back to unassigned (in_progress → ready)
  refresh                                 Reinstall the skills of opted-in agents from this Alice version

Agents then work with: alice --as codex … (or --as claude-code). No MCP setup or token is needed.`

const clientOf = (raw: string | undefined): LocalAgentClient => {
  const value = raw === 'claude' ? 'claude-code' : raw
  if (!value || !(LOCAL_AGENT_CLIENTS as readonly string[]).includes(value)) throw new CliError(`Name the agent: ${LOCAL_AGENT_CLIENTS.join(' or ')}`)
  return value as LocalAgentClient
}

/** Installed version of each skill for a client (user scope), or null. */
export function installedSkills(client: LocalAgentClient): Record<string, string | null> {
  return Object.fromEntries(
    SKILLS.map((skill) => {
      try {
        const text = fs.readFileSync(path.join(skillTargetDir(client as AgentClient, 'user', undefined, undefined, skill), 'SKILL.md'), 'utf8')
        return [skill, /^version:\s*(\S+)/m.exec(text)?.[1] ?? 'unknown']
      } catch {
        return [skill, null]
      }
    }),
  )
}

/** Reinstalls the skills of every opted-in client whose installed version differs from this release. */
export function refreshSkills(root: string): Array<{ client: LocalAgentClient; installed: string[] }> {
  const out: Array<{ client: LocalAgentClient; installed: string[] }> = []
  for (const client of LOCAL_AGENT_CLIENTS) {
    const integration = readRegistry(root).integrations[client]
    if (!integration?.optedIn) continue
    const versions = installedSkills(client)
    const stale = SKILLS.filter((s) => versions[s] !== CLI_VERSION)
    if (!stale.length) continue
    installSkills(client as AgentClient, 'user', stale)
    setIntegrationOptIn(root, client, true, CLI_VERSION)
    out.push({ client, installed: [...stale] })
  }
  return out
}

/** Applies a change to every Local workspace whose daemon runs now; the rest reconcile when they open. */
async function forRunning(ctx: CliContext, fn: (session: LocalSession, ws: LocalWorkspace) => Promise<unknown>): Promise<string[]> {
  const root = ctx.resolver.root
  const touched: string[] = []
  for (const ws of readRegistry(root).workspaces) {
    if (!(await probeDaemon(root, ws.id)).ok) continue
    await fn(new LocalSession(ws, root, null, ctx.env, ctx.out), ws)
    touched.push(ws.alias)
  }
  return touched
}

type View = { client: string; enabled: boolean; assignedTasks: number }

export async function integrationCommand(ctx: CliContext, args: string[]): Promise<number> {
  const [sub = 'help', ...rest] = args
  const { out } = ctx
  out.useEnvelope(null)
  if (ctx.agent) throw new CliError('Agents cannot change integrations; ask the person who owns this computer', 'auth')
  const root = ctx.resolver.root
  switch (sub) {
    case 'list':
    case 'ls': {
      parseCommand(rest, {})
      const registry = readRegistry(root)
      const rows = LOCAL_AGENT_CLIENTS.map((client) => ({
        client,
        label: LOCAL_AGENT_LABEL[client],
        optedIn: !!registry.integrations[client]?.optedIn,
        skills: installedSkills(client),
        credentials: registry.workspaces.filter((w) => !!localCredentialStore(root, ctx.env).get(capabilityAccount(w.id, client))).map((w) => w.alias),
      }))
      out.list(rows, [
        { header: 'AGENT', value: (r) => r.label },
        { header: 'ENABLED', value: (r) => (r.optedIn ? 'yes' : 'no') },
        { header: 'SKILLS', value: (r) => Object.entries(r.skills).map(([k, v]) => `${k} ${v ?? '—'}`).join(', ') },
        { header: 'WORKSPACES', value: (r) => r.credentials.join(', ') },
      ])
      return 0
    }
    case 'enable': {
      const { positionals } = parseCommand(rest, {}, 1)
      const client = clientOf(positionals[0])
      const targets = installSkills(client as AgentClient, 'user', SKILLS)
      setIntegrationOptIn(root, client, true, CLI_VERSION)
      const enabled = await forRunning(ctx, (s) => s.local('POST', `/integrations/${client}`, { enabled: true }))
      out.value({ client, enabled: true, skills: targets, workspaces: enabled }, () => {
        out.line(`${LOCAL_AGENT_LABEL[client]} can now work in your Local workspaces as its own identity.`)
        out.info(`Skills installed to ${targets.map((t) => path.dirname(t)).filter((v, i, a) => a.indexOf(v) === i).join(', ')}. Start a new ${LOCAL_AGENT_LABEL[client]} session to load them.`)
      })
      return 0
    }
    case 'disable': {
      const { positionals } = parseCommand(rest, {}, 1)
      const client = clientOf(positionals[0])
      setIntegrationOptIn(root, client, false)
      const store = localCredentialStore(root, ctx.env)
      const views: Array<View & { workspace: string }> = []
      await forRunning(ctx, async (s, ws) => views.push({ ...(await s.local<View>('POST', `/integrations/${client}`, { enabled: false })), workspace: ws.alias }))
      // credential ใน store ถูกลบทันทีในทุก workspace: คำสั่งถัดไปของ agent ล้มแม้ daemon ยังไม่เปิด
      for (const ws of readRegistry(root).workspaces) store.delete(capabilityAccount(ws.id, client))
      const assigned = views.filter((v) => v.assignedTasks > 0)
      out.value({ client, enabled: false, assigned: assigned.map((v) => ({ workspace: v.workspace, tasks: v.assignedTasks })) }, () => {
        out.line(`${LOCAL_AGENT_LABEL[client]} can no longer act in your Local workspaces. Its past work keeps its name.`)
        for (const v of assigned) out.warn(`${v.workspace}: ${v.assignedTasks} open task(s) are still assigned to ${LOCAL_AGENT_LABEL[client]}. Unassign them with: alice integration unassign ${client} --workspace ${v.workspace} --yes`)
      })
      return 0
    }
    case 'unassign': {
      const { values, positionals } = parseCommand(rest, { yes: { type: 'boolean' } }, 1)
      const client = clientOf(positionals[0])
      if (!ctx.flags.workspace) throw new CliError('Name the workspace: --workspace ALIAS')
      const target = ctx.target()
      if (target.kind !== 'local') throw new CliError('Unassign works in Local workspaces')
      await confirm(out, `Unassign every open task of ${LOCAL_AGENT_LABEL[client]} in ${target.workspace.alias}?`, !!values.yes)
      const res = await ctx.localSession().local<{ unassigned: string[] }>('POST', `/integrations/${client}/unassign`, {})
      out.value(res, () => out.line(`Unassigned ${res.unassigned.length} task(s).`))
      return 0
    }
    case 'refresh': {
      parseCommand(rest, {})
      const refreshed = refreshSkills(root)
      out.value({ refreshed }, () => out.line(refreshed.length ? refreshed.map((r) => `Updated ${r.installed.join(', ')} for ${r.client}`).join('\n') : 'Skills are up to date.'))
      return 0
    }
    case 'help':
      out.line(INTEGRATION_HELP)
      return 0
    default:
      if (sub.startsWith('-')) throw new CliError(`Usage: alice integration <command> (unexpected ${sub})`, 'usage', 'See: alice integration help')
      throw new CliError(`Unknown integration command: ${sub}`, 'usage', 'See: alice integration help')
  }
}
