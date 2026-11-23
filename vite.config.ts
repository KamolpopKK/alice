import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { frozenPrototypeCompat } from './scripts/frozen-prototype'

const apiTarget = process.env.ALICE_DEV_API ?? 'http://127.0.0.1:8080'

export default defineConfig({
  root: path.resolve(import.meta.dirname, 'src/web'),
  plugins: [react(), frozenPrototypeCompat()],
  // Desktop ตรึง Object.prototype ไว้ (ดู scripts/frozen-prototype.ts); dev server pre-bundle dependency แยก จึงต้องใส่ให้ optimizer ด้วย
  optimizeDeps: { rolldownOptions: { plugins: [frozenPrototypeCompat()] } },
  build: {
    outDir: path.resolve(import.meta.dirname, 'dist/web'),
    emptyOutDir: true,
    sourcemap: false,
  },
  server: {
    port: 5173,
    // key ที่ขึ้นต้นด้วย ^ เป็น regex: match เฉพาะ path ของ server จริง
    // ไม่ให้ไปจับ module ของ Vite อย่าง /api.ts (root คือ src/web)
    proxy: {
      '^/(client|api)/': { target: apiTarget, changeOrigin: false },
      '^/mcp(/|$|\\?)': { target: apiTarget, changeOrigin: false },
      '^/downloads/': { target: apiTarget, changeOrigin: false },
      '^/(readyz|livez)$': { target: apiTarget, changeOrigin: false },
    },
  },
})
