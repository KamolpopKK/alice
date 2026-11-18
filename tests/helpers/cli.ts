import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { build } from 'esbuild'
// @ts-expect-error — plain .mjs build helper shared with the release build
import { cliBuildOptions } from '../../scripts/cli-build.mjs'
import { tempDataDir } from './app'
import { testDir } from './tmp'

const ROOT = path.resolve(import.meta.dirname, '../..')
let built: Promise<{ dir: string; standalone: string }> | null = null

/**
 * Builds the real CLI artifact once per test process: `dir` holds alice.js next to alice-server.js
 * (like an npm install); `standalone` is alice.js alone in an empty directory outside the repository.
 */
export function buildCli() {
  built ??= (async () => {
    const dir = tempDataDir('cli-dist')
    await build(cliBuildOptions(dir, ROOT))
    await build({
      entryPoints: { 'alice-server': path.join(ROOT, 'src/server/cli.ts') },
      outdir: dir,
      bundle: true,
      platform: 'node',
      format: 'esm',
      target: 'node22',
      packages: 'external',
      logLevel: 'warning',
    })
    const standalone = testDir('alice-cli-standalone-')
    fs.copyFileSync(path.join(dir, 'alice.js'), path.join(standalone, 'alice.js'))
    return { dir, standalone }
  })()
  return built
}

export interface CliRun {
  code: number
  stdout: string
  stderr: string
}

export interface CliEnv {
  configDir: string
  credentialFile: string
  env: Record<string, string>
}

/** An isolated CLI home: its own profile directory and test credential store. */
export function cliHome(label = 'cli-home'): CliEnv {
  const configDir = tempDataDir(label)
  const credentialFile = path.join(configDir, 'test-credentials.json')
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !k.startsWith('ALICE_')) env[k] = v
  // ALICE_HOME แยกต่อ test: ห้ามอ่าน Local workspaces จริงของเครื่อง
  Object.assign(env, { ALICE_CONFIG_DIR: configDir, ALICE_HOME: path.join(configDir, 'app-data'), ALICE_CREDENTIAL_STORE: `file:${credentialFile}`, ALICE_NO_BROWSER: '1', NO_COLOR: '1' })
  return { configDir, credentialFile, env }
}

export interface RunningCli {
  stdoutText(): string
  stderrText(): string
  waitForStderr(pattern: RegExp, timeoutMs?: number): Promise<RegExpMatchArray>
  done: Promise<CliRun>
}

export async function startAlice(home: CliEnv, args: string[], opts: { input?: string; entry?: string; extraEnv?: Record<string, string>; cwd?: string } = {}): Promise<RunningCli> {
  const { dir } = await buildCli()
  const child = spawn(process.execPath, [opts.entry ?? path.join(dir, 'alice.js'), ...args], { env: { ...home.env, ...opts.extraEnv }, cwd: opts.cwd, stdio: ['pipe', 'pipe', 'pipe'] })
  let stdout = ''
  let stderr = ''
  const listeners: Array<() => void> = []
  child.stdout.on('data', (c: Buffer) => (stdout += c.toString()))
  child.stderr.on('data', (c: Buffer) => {
    stderr += c.toString()
    for (const l of [...listeners]) l()
  })
  if (opts.input !== undefined) child.stdin.end(opts.input)
  else child.stdin.end()
  const done = new Promise<CliRun>((resolve) => child.on('close', (code) => resolve({ code: code ?? -1, stdout, stderr })))
  return {
    stdoutText: () => stdout,
    stderrText: () => stderr,
    waitForStderr(pattern, timeoutMs = 10_000) {
      return new Promise((resolve, reject) => {
        const check = () => {
          const m = stderr.match(pattern)
          if (m) {
            listeners.splice(listeners.indexOf(check), 1)
            clearTimeout(timer)
            resolve(m)
          }
        }
        const timer = setTimeout(() => reject(new Error(`stderr never matched ${pattern}:\n${stderr}`)), timeoutMs)
        listeners.push(check)
        check()
      })
    },
    done,
  }
}

export async function alice(home: CliEnv, args: string[], opts: { input?: string; entry?: string; extraEnv?: Record<string, string>; cwd?: string } = {}): Promise<CliRun> {
  return (await startAlice(home, args, opts)).done
}
