import { describe, expect, it } from 'vitest'
import { ConfigError, loadConfig } from '../../src/server/config'

describe('loadConfig', () => {
  it('uses safe development defaults', () => {
    const config = loadConfig({})
    expect(config.port).toBe(8080)
    expect(config.host).toBe('127.0.0.1')
    expect(config.cookieSecure).toBe(false)
  })

  it('requires an https public URL in production except for local hosts', () => {
    expect(() => loadConfig({ NODE_ENV: 'production' })).toThrow(ConfigError)
    expect(() => loadConfig({ NODE_ENV: 'production', ALICE_PUBLIC_URL: 'http://alice.example.com' })).toThrow(/https/)
    expect(loadConfig({ NODE_ENV: 'production', ALICE_PUBLIC_URL: 'http://localhost:8080' }).cookieSecure).toBe(false)
    expect(loadConfig({ NODE_ENV: 'production', ALICE_PUBLIC_URL: 'https://alice.example.com' }).cookieSecure).toBe(true)
    expect(
      loadConfig({ NODE_ENV: 'production', ALICE_PUBLIC_URL: 'http://alice.internal', ALICE_ALLOW_INSECURE_HTTP: 'true' }).publicUrl.host,
    ).toBe('alice.internal')
  })

  it('reports every problem without echoing values', () => {
    try {
      loadConfig({ ALICE_PORT: 'abc', ALICE_PUBLIC_URL: 'not a url secretvalue', ALICE_BOOTSTRAP_TOKEN: 'tiny-secret' })
      throw new Error('expected failure')
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigError)
      const message = (err as Error).message
      expect((err as ConfigError).problems).toHaveLength(3)
      expect(message).not.toContain('secretvalue')
      expect(message).not.toContain('tiny-secret')
    }
  })

  it('rejects a public URL with a path', () => {
    expect(() => loadConfig({ ALICE_PUBLIC_URL: 'https://example.com/alice' })).toThrow(/origin/)
  })
})
