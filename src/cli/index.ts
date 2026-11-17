import { main } from './main'

// `alice task list | head` ปิด pipe ก่อน: จบอย่างเงียบ ๆ แทน stack trace จาก EPIPE
for (const stream of [process.stdout, process.stderr]) {
  stream.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EPIPE') process.exit(process.exitCode ?? 0)
    throw err
  })
}

process.exitCode = await main(process.argv.slice(2))
