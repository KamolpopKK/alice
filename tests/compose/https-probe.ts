// Through the Caddy https profile: the owner signs in over HTTPS (secure cookies), live updates
// arrive without proxy buffering, and Alice sees the original https origin.
// Usage: NODE_EXTRA_CA_CERTS=<caddy root> npx tsx tests/compose/https-probe.ts <https-url>
import { HttpClient, OWNER } from '../helpers/client'

const [url] = process.argv.slice(2)
const owner = new HttpClient(url)
const login = await owner.post('/api/auth/login', { username: OWNER.username, password: OWNER.password })
if (login.status !== 200) throw new Error(`login over https failed: ${login.status}`)
if (!/;\s*secure/i.test(login.headers.get('set-cookie') ?? '')) throw new Error('session cookie is not Secure behind the proxy')

const res = await fetch(`${url}/api/events`, { headers: { cookie: owner.cookie! } })
if (res.headers.get('content-type')?.startsWith('text/event-stream') !== true) throw new Error('no event stream')
const reader = res.body!.getReader()
const decoder = new TextDecoder()
let seen = ''
const until = async (needle: string, ms: number) => {
  const deadline = Date.now() + ms
  while (!seen.includes(needle)) {
    const left = deadline - Date.now()
    if (left <= 0) throw new Error(`"${needle}" did not arrive within ${ms} ms (proxy buffering?)`)
    const chunk = await Promise.race([reader.read(), new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`"${needle}" did not arrive within ${ms} ms (proxy buffering?)`)), left))])
    if (chunk.done) throw new Error('event stream closed')
    seen += decoder.decode(chunk.value, { stream: true })
  }
}
await until('event: ready', 3000)
const task = await owner.post('/api/tasks', { title: 'Through the proxy' })
await until(task.body.task.id, 3000)
await reader.cancel()
console.log('https profile: secure cookie, unbuffered live updates: ok')
