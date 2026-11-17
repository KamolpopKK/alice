// งานดูแล Local workspace ที่ต้องใช้ runtime (SQLite อยู่ใน alice-server เท่านั้น) หรือหยุด daemon ก่อน
import { spawnSync } from 'node:child_process'
import { capabilityAccount, localCredentialStore } from '../local/capabilities'
import { probeDaemon } from '../local/daemon-client'
import { liveLockHolder, type LocalWorkspace } from '../local/registry'
import { CliError } from './errors'
import { runtimeServerCommand } from './local-session'

/** Runs an internal `alice-server` command of the installed runtime and returns its JSON line. */
export function runServer<T>(root: string, env: NodeJS.ProcessEnv, args: string[]): T {
  const [cmd, ...pre] = runtimeServerCommand(env)
  const res = spawnSync(cmd, [...pre, ...args], { env: { ...env, ALICE_HOME: root }, encoding: 'utf8', timeout: 10 * 60_000 })
  if (res.error) throw new CliError('The Alice runtime could not be started', 'internal', 'Run: alice doctor')
  if (res.status !== 0) {
    const message = (res.stderr ?? '').trim().split('\n').pop()?.replace(/^alice-server: /, '') || `exit ${res.status}`
    throw new CliError(message, /not found|No Local workspace/i.test(message) ? 'not_found' : 'usage')
  }
  const line = (res.stdout ?? '').trim().split('\n').pop() ?? ''
  try {
    return JSON.parse(line) as T
  } catch {
    throw new CliError('The Alice runtime returned an unexpected answer', 'internal')
  }
}

/**
 * Stops a workspace's daemon gracefully (it drains accepted work first) and waits until its lock is
 * released. Nothing happens when no daemon runs.
 */
export async function stopDaemon(root: string, ws: LocalWorkspace, env: NodeJS.ProcessEnv, timeoutMs = 30_000): Promise<boolean> {
  const probe = await probeDaemon(root, ws.id)
  if (probe.ok) {
    const capability = localCredentialStore(root, env).get(capabilityAccount(ws.id, 'owner'))
    if (!capability) throw new CliError(`Cannot stop "${ws.alias}": its owner capability is missing`, 'auth', 'Run: alice doctor')
    await fetch(`http://127.0.0.1:${probe.locator.port}/local/v1/shutdown`, {
      method: 'POST',
      headers: { authorization: `Bearer ${capability}`, 'content-type': 'application/json' },
      body: '{}',
      signal: AbortSignal.timeout(10_000),
    }).catch(() => undefined)
  }
  const deadline = Date.now() + timeoutMs
  while (liveLockHolder(root, ws.id)) {
    if (Date.now() > deadline) throw new CliError(`The workspace "${ws.alias}" is still in use; close Alice Desktop or wait for running commands`, 'not_found')
    await new Promise((r) => setTimeout(r, 100))
  }
  return probe.ok
}
