import { defineConfig, devices } from '@playwright/test'

// ทุก spec boot server จริงของตัวเอง (ต้อง `npm run build` ก่อนเพื่อให้มี dist/web)
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 2,
  reporter: [['list']],
  use: { trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] }, grep: /@mobile/ },
  ],
})
