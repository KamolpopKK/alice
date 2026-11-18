import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/scale/**/*.test.ts'],
    testTimeout: 600_000,
    hookTimeout: 900_000,
    pool: 'forks',
    setupFiles: ['tests/helpers/vitest-setup.ts'],
    // วัด latency: ห้ามรันไฟล์พร้อมกัน ไม่งั้น server สองตัวแย่ง CPU กันเอง
    fileParallelism: false,
  },
})
