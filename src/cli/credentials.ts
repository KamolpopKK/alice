import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { CliError } from './errors'

const SERVICE = 'alice-cli'

/** Where refresh credentials live. Secrets travel through stdin/stdout of OS tools, never argv. */
export interface CredentialStore {
  readonly name: string
  /** True when the backend keeps secrets outside plain files (OS keychain or OS-bound encryption). */
  readonly secure: boolean
  get(account: string): string | null
  set(account: string, secret: string): void
  delete(account: string): void
}

function run(cmd: string, args: string[], input?: string) {
  const res = spawnSync(cmd, args, { input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
  if (res.error && (res.error as NodeJS.ErrnoException).code === 'ENOENT') {
    throw new CliError(`The credential tool "${cmd}" is not available`, 'internal', 'Install it, or see docs/cli.md for supported credential stores')
  }
  return res
}

/** macOS Keychain through `security`; the password is read from stdin (-w as last argument). */
class KeychainStore implements CredentialStore {
  readonly name = 'macOS Keychain'
  readonly secure = true
  constructor(private readonly service: string) {}
  get(account: string) {
    const res = run('security', ['find-generic-password', '-a', account, '-s', this.service, '-w'])
    if (res.status !== 0) return null
    return res.stdout.replace(/\n$/, '') || null
  }
  set(account: string, secret: string) {
    const res = run('security', ['add-generic-password', '-a', account, '-s', this.service, '-l', `Alice (${account})`, '-U', '-w'], `${secret}\n${secret}\n`)
    if (res.status !== 0) throw new CliError('Could not save the credential in the macOS Keychain', 'internal')
  }
  delete(account: string) {
    run('security', ['delete-generic-password', '-a', account, '-s', this.service])
  }
}

/** Linux Secret Service (GNOME Keyring, KWallet) through `secret-tool`; the secret is passed on stdin. */
class SecretServiceStore implements CredentialStore {
  readonly name = 'Secret Service'
  readonly secure = true
  constructor(private readonly service: string) {}
  get(account: string) {
    const res = run('secret-tool', ['lookup', 'service', this.service, 'account', account])
    return res.status === 0 && res.stdout ? res.stdout.replace(/\n$/, '') : null
  }
  set(account: string, secret: string) {
    const res = run('secret-tool', ['store', '--label', `Alice (${account})`, 'service', this.service, 'account', account], secret)
    if (res.status !== 0) throw new CliError('Could not save the credential with secret-tool (is a Secret Service keyring unlocked?)', 'internal')
  }
  delete(account: string) {
    run('secret-tool', ['clear', 'service', this.service, 'account', account])
  }
}

/** Windows: the secret is encrypted with DPAPI for the current user before it touches disk. */
class WindowsDpapiStore implements CredentialStore {
  readonly name = 'Windows DPAPI'
  readonly secure = true
  constructor(private readonly dir: string) {}
  private file(account: string) {
    return path.join(this.dir, `${createHash('sha256').update(account).digest('hex').slice(0, 32)}.dpapi`)
  }
  private ps(script: string, input: string) {
    const res = run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Add-Type -AssemblyName System.Security; $in=[Console]::In.ReadToEnd(); ${script}`], input)
    if (res.status !== 0) throw new CliError('Windows credential protection failed', 'internal')
    return res.stdout.trim()
  }
  get(account: string) {
    const file = this.file(account)
    if (!fs.existsSync(file)) return null
    return this.ps(
      "[Text.Encoding]::UTF8.GetString([Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String($in),$null,'CurrentUser'))",
      fs.readFileSync(file, 'utf8'),
    )
  }
  set(account: string, secret: string) {
    const blob = this.ps("[Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Protect([Text.Encoding]::UTF8.GetBytes($in),$null,'CurrentUser'))", secret)
    fs.mkdirSync(this.dir, { recursive: true, mode: 0o700 })
    fs.writeFileSync(this.file(account), blob, { mode: 0o600 })
  }
  delete(account: string) {
    fs.rmSync(this.file(account), { force: true })
  }
}

/** Plain JSON file. Only for automated tests and explicitly opted-in environments without a keyring. */
export class FileStore implements CredentialStore {
  readonly name = 'plaintext file (testing only)'
  readonly secure = false
  constructor(private readonly file: string) {}
  private read(): Record<string, string> {
    try {
      return JSON.parse(fs.readFileSync(this.file, 'utf8')) as Record<string, string>
    } catch {
      return {}
    }
  }
  private write(data: Record<string, string>) {
    fs.mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 })
    fs.writeFileSync(this.file, JSON.stringify(data), { mode: 0o600 })
  }
  get(account: string) {
    return this.read()[account] ?? null
  }
  set(account: string, secret: string) {
    this.write({ ...this.read(), [account]: secret })
  }
  delete(account: string) {
    const data = this.read()
    delete data[account]
    this.write(data)
  }
}

/**
 * Chooses the OS credential store. `service` separates Remote CLI sign-ins (`alice-cli`) from Local
 * workspace capabilities (`alice-local`). `ALICE_CREDENTIAL_STORE=file:/path/credentials.json` selects the
 * plaintext test adapter; there is no silent plaintext fallback.
 */
export function selectCredentialStore(configDir: string, env: NodeJS.ProcessEnv = process.env, service = SERVICE): CredentialStore {
  const choice = env.ALICE_CREDENTIAL_STORE
  if (choice?.startsWith('file:')) return new FileStore(path.resolve(choice.slice(5)))
  if (choice === 'keychain' || (!choice && process.platform === 'darwin')) return new KeychainStore(service)
  if (choice === 'secret-service' || (!choice && process.platform === 'linux')) return new SecretServiceStore(service)
  if (choice === 'windows' || (!choice && process.platform === 'win32')) return new WindowsDpapiStore(path.join(configDir, 'credentials'))
  throw new CliError(`No supported credential store for ${process.platform}`, 'internal', 'Set ALICE_CREDENTIAL_STORE (see docs/cli.md)')
}

export const credentialAccount = (profile: { name: string; server: string }) => `${profile.name}@${profile.server}`
