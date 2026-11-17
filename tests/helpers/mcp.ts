import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'

export interface ToolCall<T = any> {
  isError: boolean
  result: T
  error: { code: string; message: string; details?: unknown } | null
}

export interface McpHandle {
  client: Client
  call<T = any>(name: string, args?: Record<string, unknown>): Promise<ToolCall<T>>
  /** Like call but throws on tool errors. */
  ok<T = any>(name: string, args?: Record<string, unknown>): Promise<T>
  close(): Promise<void>
}

export async function connectWithTransport(transport: Transport): Promise<McpHandle> {
  const client = new Client({ name: 'alice-tests', version: '0.0.0' })
  await client.connect(transport)
  const call = async (name: string, args: Record<string, unknown> = {}): Promise<ToolCall> => {
    const res = (await client.callTool({ name, arguments: args })) as { isError?: boolean; structuredContent?: any; content: Array<{ text: string }> }
    const payload = res.structuredContent ?? JSON.parse(res.content[0].text)
    return res.isError ? { isError: true, result: null, error: payload.error } : { isError: false, result: payload, error: null }
  }
  return {
    client,
    call,
    async ok(name, args) {
      const res = await call(name, args)
      if (res.isError) throw new Error(`${name} failed: ${JSON.stringify(res.error)}`)
      return res.result
    },
    close: () => client.close(),
  }
}

export function connectMcp(baseUrl: string, token: string): Promise<McpHandle> {
  const transport = new StreamableHTTPClientTransport(new URL('/mcp/v1', baseUrl), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  })
  return connectWithTransport(transport)
}
