import fs from 'node:fs'
import { build } from 'esbuild'
import { cliBuildOptions } from './cli-build.mjs'
import { buildDownloads } from './downloads-build.mjs'

const common = { bundle: true, platform: 'node', format: 'esm', target: 'node22', banner: { js: '#!/usr/bin/env node' }, logLevel: 'info' }

// Server: alice-server (+ cli.js เป็นชื่อเดิมเพื่อ compat) และ stdio adapter — dependencies เป็น external
await build({
  ...common,
  entryPoints: {
    'alice-server': 'src/server/cli.ts',
    cli: 'src/server/cli.ts',
    ...(fs.existsSync('src/stdio/adapter.ts') ? { 'alice-mcp-stdio': 'src/stdio/adapter.ts' } : {}),
  },
  outdir: 'dist',
  packages: 'external',
})

// Human CLI: ไฟล์เดียวที่รวม dependency ทั้งหมด ไม่ต้องมี node_modules, SQLite หรือโค้ด server runtime
await build({ ...cliBuildOptions('dist'), logLevel: 'info' })

for (const file of fs.readdirSync('dist')) if (file.endsWith('.js')) fs.chmodSync(`dist/${file}`, 0o755)

// ชุดดาวน์โหลดสำหรับ agent: CLI + stdio adapter แบบ standalone ที่ server เสิร์ฟใต้ /downloads/
await buildDownloads('dist/downloads')
