import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// Self-hosting runs the published image, pinned to the version being released
const ROOT = path.resolve(import.meta.dirname, '../..')
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8')
const version = JSON.parse(read('package.json')).version as string

describe('server image', () => {
  it('compose runs the GHCR image pinned to this version and can still build from source', () => {
    const compose = read('compose.yaml')
    expect(compose).toContain(`image: ghcr.io/kamolpopkk/alice:\${ALICE_VERSION:-${version}}`)
    expect(compose).toMatch(/^\s+build: \.$/m)
    expect(read('.env.example')).toMatch(new RegExp(`^ALICE_VERSION=${version.replace(/\./g, '\\.')}$`, 'm'))
  })

  it('release builds both architectures natively and only a published release moves :latest', () => {
    const release = read('.github/workflows/release.yml')
    expect(release).toContain('{ arch: amd64, runner: ubuntu-24.04 }')
    expect(release).toContain('{ arch: arm64, runner: ubuntu-24.04-arm }')
    expect(release).toContain('push-by-digest=true')
    expect(release).not.toMatch(/-t "\$IMAGE:latest"|tags?:.*latest/)
    const promote = read('.github/workflows/promote-image.yml')
    expect(promote).toMatch(/release:\s+types: \[published\]/)
    expect(promote).toContain('!github.event.release.prerelease')
  })

  it('image carries OCI labels for source, version, revision and license', () => {
    const dockerfile = read('Dockerfile')
    for (const label of ['source="https://github.com/KamolpopKK/alice"', 'licenses="AGPL-3.0"', 'version="${ALICE_VERSION}"', 'revision="${ALICE_REVISION}"']) {
      expect(dockerfile).toContain(`org.opencontainers.image.${label}`)
    }
  })
})
