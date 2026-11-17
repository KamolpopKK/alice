import fs from 'node:fs'
import path from 'node:path'
import { build } from 'esbuild'
import { cliBuildOptions } from './cli-build.mjs'

/**
 * Standalone agent tooling the server distributes under `/downloads/`.
 * ทั้งสองไฟล์ต้องรันได้ด้วย Node อย่างเดียว ไม่ต้องมี node_modules
 */
export async function buildDownloads(outdir, root = process.cwd()) {
  fs.mkdirSync(outdir, { recursive: true })
  await build(cliBuildOptions(outdir, root))
  await build({
    entryPoints: { 'alice-mcp-stdio': path.join(root, 'src/stdio/adapter.ts') },
    outdir,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    packages: 'bundle',
    minifySyntax: true,
    banner: { js: '#!/usr/bin/env node' },
    logLevel: 'warning',
  })
  for (const file of ['alice.js', 'alice-mcp-stdio.js']) fs.chmodSync(path.join(outdir, file), 0o755)
}
