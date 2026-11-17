import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { randomBytes } from 'node:crypto'

const ROOT = path.resolve(import.meta.dirname, '../..')
const CLI = path.join(ROOT, 'src/server/cli.ts')
const TEST_ROOT = path.join(ROOT, '.alice-test')

export function tempDataDir(label = 'app'): string {
  fs.mkdirSync(TEST_ROOT, { recursive: true })
  return fs.mkdtempSync(path.join(TEST_ROOT, `${label}-`))
}

export interface StartOptions {
  dataDir?: string
  env?: Record<string, string | undefined>
}

export interface RunningApp {
  url: string
  pid: number
  dataDir: string
  env: Record<string, string>
  output(): string
  stop(): Promise<void>
}

function baseEnv(dataDir: string, extra: Record<string, string | undefined> = {}): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !k.startsWith('ALICE_')) env[k] = v
  Object.assign(env, {
    NODE_ENV: 'test',
    ALICE_DATA_DIR: dataDir,
    ALICE_HOST: '127.0.0.1',
    ALICE_PORT: '0',
    ALICE_LOG_LEVEL: 'info',
    ALICE_BOOTSTRAP_TOKEN: 'test-bootstrap-token-' + randomBytes(8).toString('hex'),
  })
  for (const [k, v] of Object.entries(extra)) {
    if (v === undefined) delete env[k]
    else env[k] = v
  }
  return env
}

/** Boots the real Alice server as a child process against an isolated SQLite data directory. */
export async function startApp(options: StartOptions = {}): Promise<RunningApp> {
  const dataDir = options.dataDir ?? tempDataDir()
  const env = baseEnv(dataDir, options.env)
  const child: ChildProcess = spawn(process.execPath, ['--import', 'tsx', CLI, 'serve'], {
    cwd: ROOT,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  const url = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Alice did not start in time:\n${output}`)), 30_000)
    const onData = (chunk: Buffer) => {
      output += chunk.toString()
      for (const line of output.split('\n')) {
        if (!line.includes('alice.listening')) continue
        try {
          const parsed = JSON.parse(line) as { url: string }
          clearTimeout(timer)
          resolve(parsed.url)
          return
        } catch {
          /* partial line */
        }
      }
    }
    child.stdout!.on('data', onData)
    child.stderr!.on('data', (chunk: Buffer) => (output += chunk.toString()))
    child.on('exit', (code) => {
      clearTimeout(timer)
      reject(new Error(`Alice exited early with code ${code}:\n${output}`))
    })
  })
  child.removeAllListeners('exit')

  return {
    url,
    pid: child.pid!,
    dataDir,
    env,
    output: () => output,
    stop: () =>
      new Promise<void>((resolve) => {
        if (child.exitCode !== null) return resolve()
        child.once('exit', () => resolve())
        child.kill('SIGTERM')
        setTimeout(() => child.kill('SIGKILL'), 5000).unref()
      }),
  }
}

export interface CliResult {
  status: number | null
  stdout: string
  stderr: string
}

export function runCli(args: string[], env: Record<string, string | undefined>, input?: string): CliResult {
  const dataDir = env.ALICE_DATA_DIR ?? tempDataDir('cli')
  const result = spawnSync(process.execPath, ['--import', 'tsx', CLI, ...args], {
    cwd: ROOT,
    env: baseEnv(dataDir, env),
    encoding: 'utf8',
    input,
    timeout: 120_000,
  })
  return { status: result.status, stdout: result.stdout, stderr: result.stderr }
}
