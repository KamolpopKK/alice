import os from 'node:os'
import path from 'node:path'
import { defineConfig } from 'vitest/config'

// Resolve the installed, read-only browser cache before setup replaces HOME per test file.
const browserCache = process.platform === 'darwin' ? path.join(os.homedir(), 'Library', 'Caches')
  : process.platform === 'win32' ? process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local')
    : process.env.XDG_CACHE_HOME ?? path.join(os.homedir(), '.cache')

export default defineConfig({
  test: {
    env: { PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH ?? path.join(browserCache, 'ms-playwright') },
    include: ['tests/unit/**/*.test.ts', 'tests/unit/**/*.test.tsx', 'tests/system/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    pool: 'forks',
    setupFiles: ['tests/helpers/vitest-setup.ts'],
  },
})
