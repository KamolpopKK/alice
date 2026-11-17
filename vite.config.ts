import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const apiTarget = process.env.ALICE_DEV_API ?? 'http://127.0.0.1:8080'

export default defineConfig({
  root: path.resolve(import.meta.dirname, 'src/web'),
  plugins: [react()],
  build: {
    outDir: path.resolve(import.meta.dirname, 'dist/web'),
    emptyOutDir: true,
    sourcemap: false,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: apiTarget, changeOrigin: false },
      '/mcp': { target: apiTarget, changeOrigin: false },
      '/readyz': apiTarget,
      '/livez': apiTarget,
    },
  },
})
