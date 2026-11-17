import { defineConfig, devices } from '@playwright/test'

// Alice UI component checks against the static Storybook build (`npm run storybook:build` first).
export default defineConfig({
  testDir: 'tests/ui',
  timeout: 30_000,
  fullyParallel: true,
  workers: 4,
  reporter: [['list']],
  use: { baseURL: 'http://127.0.0.1:6007', trace: 'retain-on-failure', ...devices['Desktop Chrome'] },
  // ภาพ baseline ต่อแพลตฟอร์ม: สร้างใหม่ด้วย ALICE_UI_VISUAL=1 npx playwright test -c playwright.storybook.config.ts --update-snapshots
  snapshotPathTemplate: '{testDir}/__screenshots__/{arg}-{platform}{ext}',
  webServer: { command: 'node scripts/serve-static.mjs storybook-static 6007', url: 'http://127.0.0.1:6007/index.json', reuseExistingServer: !process.env.CI },
})
