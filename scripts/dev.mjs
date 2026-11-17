import { spawn } from 'node:child_process'

// รัน API server (tsx watch) และ Vite dev server พร้อมกัน
const procs = [
  spawn(process.execPath, ['--import', 'tsx', '--watch', 'src/server/cli.ts', 'serve'], { stdio: 'inherit', env: { ...process.env, ALICE_PUBLIC_URL: process.env.ALICE_PUBLIC_URL ?? 'http://localhost:5173' } }),
  spawn('npx', ['vite', ...process.argv.slice(2)], { stdio: 'inherit', env: process.env }),
]
const stop = () => procs.forEach((p) => p.kill('SIGTERM'))
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
procs.forEach((p) => p.on('exit', (code) => { stop(); process.exitCode = code ?? 0 }))
