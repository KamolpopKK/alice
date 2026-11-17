// Alice stdio MCP adapter: exposes the remote Alice MCP contract over stdio for clients that
// need a local process. It forwards every request to the server and stores no workspace data.
import fs from 'node:fs'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { CallToolRequestSchema, ListToolsRequestSchema, type CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { APP_VERSION, MCP_CONTRACT_VERSION, MCP_ENDPOINT_PATH } from '../shared/version'

export class AdapterError extends Error {}

export interface AdapterConfig {
  baseUrl: URL
  token: string
}

export function readAdapterConfig(env: NodeJS.ProcessEnv): AdapterConfig {
  const problems: string[] = []
  let baseUrl: URL | null = null
  if (!env.ALICE_URL) problems.push('ALICE_URL is not set (the Alice server origin, e.g. https://alice.example.com)')
  else {
    try {
      baseUrl = new URL(env.ALICE_URL)
      if (!['http:', 'https:'].includes(baseUrl.protocol)) problems.push('ALICE_URL must use http:// or https://')
    } catch {
      problems.push('ALICE_URL is not a valid URL')
    }
  }
  let token = env.ALICE_TOKEN?.trim() ?? ''
  if (!token && env.ALICE_TOKEN_FILE) {
    try {
      token = fs.readFileSync(env.ALICE_TOKEN_FILE, 'utf8').trim()
    } catch {
      problems.push('ALICE_TOKEN_FILE could not be read')
    }
  }
  if (!token) problems.push('Set ALICE_TOKEN or ALICE_TOKEN_FILE to the agent token from Alice Admin → Agents')
  else if (!token.startsWith('alice_at_')) problems.push('The agent token has an unexpected format (expected alice_at_…)')
  if (problems.length) throw new AdapterError(problems.join('\n'))
  return { baseUrl: baseUrl!, token }
}


export async function connectRemote(config: AdapterConfig): Promise<Client> {
  const discovery = await fetch(new URL('/mcp', config.baseUrl)).catch(() => null)
  if (!discovery || !discovery.ok) throw new AdapterError(`Cannot reach Alice at ${config.baseUrl.origin}; check ALICE_URL and that the server is running`)
  const info = (await discovery.json()) as { contractVersion?: string; version?: string }
  if (info.contractVersion !== MCP_CONTRACT_VERSION) {
    throw new AdapterError(`Alice server speaks MCP contract v${info.contractVersion}; this adapter needs v${MCP_CONTRACT_VERSION}. Install a matching adapter.`)
  }
  const client = new Client({ name: 'alice-mcp-stdio', version: APP_VERSION })
  const transport = new StreamableHTTPClientTransport(new URL(MCP_ENDPOINT_PATH, config.baseUrl), {
    requestInit: { headers: { Authorization: `Bearer ${config.token}` } },
  })
  try {
    await client.connect(transport)
  } catch (err) {
    const text = String((err as Error).message)
    if (/401|UNAUTHENTICATED|bearer/i.test(text)) {
      throw new AdapterError('Alice rejected the agent token (invalid, rotated or revoked). Ask the workspace owner for a new token.')
    }
    throw new AdapterError(`Could not connect to Alice MCP: ${text.replaceAll(config.token, '[redacted]')}`)
  }
  // ความเข้ากันได้ตัดสินจาก MCP contract (ตรวจแล้วข้างบน) — adapter กับ server ออก release แยกกันได้
  return client
}

function transportFailure(err: unknown, token: string): CallToolResult {
  const message = String((err as Error)?.message ?? err).replaceAll(token, '[redacted]')
  const code = /401|UNAUTHENTICATED/i.test(message) ? 'UNAUTHENTICATED' : /429/.test(message) ? 'RATE_LIMITED' : 'INTERNAL_ERROR'
  const body = { error: { code, message: code === 'UNAUTHENTICATED' ? 'The agent token was rejected; ask the owner for a new one' : 'Alice server request failed' } }
  return { isError: true, content: [{ type: 'text', text: JSON.stringify(body) }], structuredContent: body }
}

export async function runAdapter(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const config = readAdapterConfig(env)
  const remote = await connectRemote(config)
  const server = new Server(
    { name: 'alice', title: 'Alice taskboard', version: remote.getServerVersion()?.version ?? APP_VERSION },
    { capabilities: { tools: {} }, instructions: remote.getInstructions() },
  )
  server.setRequestHandler(ListToolsRequestSchema, async (request) => remote.listTools(request.params))
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
      return (await remote.callTool(request.params)) as CallToolResult
    } catch (err) {
      return transportFailure(err, config.token)
    }
  })
  const stdio = new StdioServerTransport()
  stdio.onclose = () => void remote.close()
  await server.connect(stdio)
}

const isMain = process.argv[1] && /alice-mcp-stdio|stdio[\\/]adapter/.test(process.argv[1])
if (isMain && (process.argv[2] === '--version' || process.argv[2] === 'version')) {
  // diagnostics: เวอร์ชันของ adapter และ MCP contract ที่ใช้ (ไม่ต้องมี token)
  process.stdout.write(`alice-mcp-stdio ${APP_VERSION} (MCP contract v${MCP_CONTRACT_VERSION})\n`)
} else if (isMain) {
  runAdapter().catch((err) => {
    process.stderr.write(`alice-mcp-stdio: ${err instanceof AdapterError ? err.message : 'unexpected error'}\n`)
    process.exit(2)
  })
}
