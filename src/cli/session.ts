import fs from 'node:fs'
import path from 'node:path'
import { AliceClient, AliceClientError } from '../client'
import type { CliConfig, Profile } from './config'
import { saveConfig } from './config'
import { credentialAccount, type CredentialStore } from './credentials'
import { CliError } from './errors'
import { NodeTransport } from './transport'
import { CLI_CLIENT_NAME } from './version'

const LOCK_STALE_MS = 30_000

/** Cross-process lock so parallel commands rotate the refresh credential one after another (no false replay). */
async function withLock<T>(file: string, fn: () => Promise<T>): Promise<T> {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
  const deadline = Date.now() + 20_000
  for (;;) {
    try {
      fs.closeSync(fs.openSync(file, 'wx', 0o600))
      break
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err
      try {
        if (Date.now() - fs.statSync(file).mtimeMs > LOCK_STALE_MS) fs.rmSync(file, { force: true })
      } catch {
        /* removed concurrently */
      }
      if (Date.now() > deadline) throw new CliError('Timed out waiting for another alice command to refresh the session', 'network')
      await new Promise((r) => setTimeout(r, 25 + Math.random() * 50))
    }
  }
  try {
    return await fn()
  } finally {
    fs.rmSync(file, { force: true })
  }
}

export const loginHint = (profile: Profile) => `Run: alice auth login --profile ${profile.name}`

/**
 * One profile's signed-in state. The refresh credential stays in the OS store; the access credential
 * exists only in this process.
 */
export class ProfileSession {
  private access: string | null = null

  constructor(
    readonly profile: Profile,
    private readonly storeProvider: () => CredentialStore,
    private readonly config: CliConfig,
    private readonly configDir: string,
  ) {}

  /** Opened lazily so offline and anonymous commands never touch the OS credential store. */
  private get store(): CredentialStore {
    return this.storeProvider()
  }

  get account() {
    return credentialAccount(this.profile)
  }

  hasCredential(): boolean {
    return this.store.get(this.account) !== null
  }

  anonymousClient(): AliceClient {
    return new AliceClient(new NodeTransport(this.profile.server), { clientName: CLI_CLIENT_NAME })
  }

  authenticatedClient(): AliceClient {
    const transport = new NodeTransport(this.profile.server, {
      current: async () => this.access ?? (await this.renew()),
      renew: () => this.renew(),
    })
    return new AliceClient(transport, { clientName: CLI_CLIENT_NAME })
  }

  /** Rotates the refresh credential under a lock and keeps the new access credential in memory. */
  async renew(): Promise<string> {
    const lock = path.join(this.configDir, 'locks', `${this.profile.name}.lock`)
    return withLock(lock, async () => {
      const refreshToken = this.store.get(this.account)
      if (!refreshToken) throw new CliError(`Not signed in to profile "${this.profile.name}"`, 'auth', loginHint(this.profile))
      try {
        const creds = await this.anonymousClient().auth.refresh(refreshToken)
        this.store.set(this.account, creds.refreshToken)
        this.access = creds.accessToken
        return creds.accessToken
      } catch (err) {
        if (err instanceof AliceClientError && err.code === 'UNAUTHENTICATED') {
          this.forget()
          throw new CliError(`The session for profile "${this.profile.name}" expired or was revoked`, 'auth', loginHint(this.profile))
        }
        throw err
      }
    })
  }

  /** Saves a freshly issued session. */
  remember(refreshToken: string, accessToken: string, session: { id: string; actor: { id: string; displayName: string } }): void {
    this.store.set(this.account, refreshToken)
    this.access = accessToken
    this.config.profiles[this.profile.name] = { ...this.profile, session: { id: session.id, actor: session.actor, signedInAt: new Date().toISOString() } }
    saveConfig(this.config, this.configDir)
  }

  /** Drops the local credential and session metadata (the server session may still need revoking). */
  forget(): void {
    this.store.delete(this.account)
    this.access = null
    const current = this.config.profiles[this.profile.name]
    if (current?.session) {
      this.config.profiles[this.profile.name] = { ...current, session: null }
      saveConfig(this.config, this.configDir)
    }
  }

  /** Revokes the server session (best effort) using only the refresh credential, then forgets it locally. */
  async signOut(): Promise<{ revoked: boolean; hadSession: boolean }> {
    const refreshToken = this.store.get(this.account)
    if (!refreshToken) {
      this.forget()
      return { revoked: false, hadSession: false }
    }
    let revoked = false
    try {
      await this.anonymousClient().auth.revoke(refreshToken)
      revoked = true
    } finally {
      this.forget()
    }
    return { revoked, hadSession: true }
  }
}
