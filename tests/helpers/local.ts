// Helper ของ Local workspaces: app-data root ชั่วคราว, credential store แบบไฟล์ และ daemon จริง
import fs from 'node:fs'
import path from 'node:path'
import { tempDataDir } from './app'
import { readLocator } from '../../src/local/locator'
import { listWorkspaces } from '../../src/local/registry'
import { workspacePaths } from '../../src/local/paths'
import { capabilityAccount, type CapabilityHolder } from '../../src/local/capabilities'

const ROOT = path.resolve(import.meta.dirname, '../..')
/** Runs the server entry from source, as the packaged runtime would run alice-server.js. */
export const SERVER_COMMAND = [process.execPath, '--import', 'tsx', path.join(ROOT, 'src/server/cli.ts')]

const homes: string[] = []

export function localHome(): string {
  const home = tempDataDir('local-home')
  homes.push(home)
  return home
}

export function localEnv(home: string, extra: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !k.startsWith('ALICE_')) env[k] = v
  Object.assign(env, {
    NODE_ENV: 'test',
    ALICE_HOME: home,
    ALICE_CREDENTIAL_STORE: `file:${path.join(home, 'test-credentials.json')}`,
  })
  for (const [k, v] of Object.entries(extra)) {
    if (v === undefined) delete env[k]
    else env[k] = v
  }
  return env
}

export function storedCapability(home: string, workspaceId: string, holder: CapabilityHolder = 'owner'): string | null {
  try {
    const all = JSON.parse(fs.readFileSync(path.join(home, 'test-credentials.json'), 'utf8')) as Record<string, string>
    return all[capabilityAccount(workspaceId, holder)] ?? null
  } catch {
    return null
  }
}

export async function call(baseUrl: string, p: string, init: { token?: string | null; method?: string; body?: unknown; headers?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { ...(init.headers ?? {}) }
  if (init.token) headers.authorization = `Bearer ${init.token}`
  if (init.body !== undefined) headers['content-type'] = 'application/json'
  const res = await fetch(`${baseUrl}${p}`, { method: init.method ?? (init.body !== undefined ? 'POST' : 'GET'), headers, body: init.body !== undefined ? JSON.stringify(init.body) : undefined })
  const text = await res.text()
  let data: unknown = text
  try {
    data = JSON.parse(text)
  } catch {
    /* not JSON */
  }
  return { status: res.status, data: data as any }
}

export async function waitFor(check: () => boolean | Promise<boolean>, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error('timed out')
    await new Promise((r) => setTimeout(r, 50))
  }
}

/** Stops every daemon started under the test homes (SIGTERM, graceful). */
export async function stopLocalDaemons(): Promise<void> {
  for (const home of homes.splice(0)) {
    let workspaces: { id: string }[] = []
    try {
      workspaces = listWorkspaces(home)
    } catch {
      continue
    }
    for (const ws of workspaces) {
      const locator = readLocator(workspacePaths(home, ws.id).locator)
      if (locator) {
        try {
          process.kill(locator.pid, 'SIGTERM')
        } catch {
          /* gone */
        }
      }
    }
  }
}
