// Runs the README's first-time setup against a deployed instance:
// bootstrap → invite → create agent → agent claims and completes a task over MCP.
// Usage: npx tsx tests/compose/operator-journey.ts <url> <bootstrap-token>
import { HttpClient, OWNER } from '../helpers/client'
import { connectMcp } from '../helpers/mcp'

const [url, bootstrapToken] = process.argv.slice(2)
const owner = new HttpClient(url)
const boot = await owner.post('/api/auth/bootstrap', { bootstrapToken, ...OWNER })
if (boot.status !== 201) throw new Error(`bootstrap failed: ${JSON.stringify(boot.body)}`)
const invite = await owner.post('/api/invites', { note: 'teammate' })
const token = new URL(invite.body.url).pathname.split('/').pop()!
const mate = new HttpClient(url)
const accepted = await mate.post('/api/invites/accept', { token, username: 'mate', displayName: 'Team Mate', password: 'mate-password-1' })
if (accepted.status !== 201) throw new Error('invite failed')
const agent = await owner.post('/api/agents', { displayName: 'Compose Agent' })
const task = await mate.post('/api/tasks', { title: 'Compose journey', status: 'ready' })
const mcp = await connectMcp(url, agent.body.plaintextToken)
await mcp.ok('claim_task', { id: task.body.task.id })
await mcp.ok('complete_task', { id: task.body.task.id, summary: 'Done inside the container' })
await mcp.close()
const final = await mate.get(`/api/tasks/${task.body.task.id}`)
if (final.body.task.status !== 'done' || final.body.task.assignee.displayName !== 'Compose Agent') throw new Error('journey state mismatch')
console.log('operator journey: ok')
