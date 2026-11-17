#!/usr/bin/env node
// เสิร์ฟโฟลเดอร์ static บน 127.0.0.1 สำหรับเทสต์ (เช่น storybook-static) — ไม่มี dependency เพิ่ม
// usage: node scripts/serve-static.mjs <dir> <port>
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'

const [dir = 'storybook-static', port = '6007'] = process.argv.slice(2)
const root = path.resolve(dir)
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.map': 'application/json' }

http
  .createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    let file = path.join(root, decodeURIComponent(url.pathname))
    if (!file.startsWith(root)) return res.writeHead(403).end()
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html')
    if (!fs.existsSync(file)) return res.writeHead(404).end()
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' })
    fs.createReadStream(file).pipe(res)
  })
  .listen(Number(port), '127.0.0.1', () => console.log(`serving ${root} on http://127.0.0.1:${port}`))
