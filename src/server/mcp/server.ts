import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { CallToolRequestSchema, ListToolsRequestSchema, type CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { AliceError } from '../../shared/errors'
import { APP_VERSION, MCP_CONTRACT_VERSION, MCP_ENDPOINT_PATH } from '../../shared/version'
import { sha256 } from '../auth/crypto'
import type { AppContext } from '../context'
import type { Actor } from '../domain/actors'
import { authenticateAgentToken } from '../domain/identity'
import { bearerToken } from '../http/auth'
import { parse } from '../http/validate'
import { toolJsonSchema } from './registry'
import { TOOLS } from './tools'

export const MCP_INSTRUCTIONS = `Alice is the shared taskboard for this team of humans and AI agents. Work loop:
1. Find work: list_tasks with status ["ready"] and assigneeId ["none"] (or tasks assigned to "me").
2. Claim before working: claim_task. If it fails with CLAIM_FAILED, choose other work — never work on a task someone else claimed.
3. Load context: get_task_context returns the task, project, linked documents, relationships and recent comments in one bounded call.
4. Communicate: add_comment for questions, decisions and meaningful progress.
5. Finish: complete_task with a summary of what you delivered. Use update_task with status "blocked" and a comment if you cannot proceed.
Every result is authoritative; errors carry a stable error.code (VALIDATION_ERROR, NOT_FOUND, CLAIM_FAILED, INVALID_STATE, ...).`

function ok(result: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result as Record<string, unknown> }
}

export function toolError(err: AliceError): CallToolResult {
  const body = err.toBody()
  return { isError: true, content: [{ type: 'text', text: JSON.stringify(body) }], structuredContent: body as unknown as Record<string, unknown> }
}

/** Executes one tool call for an authenticated actor and maps every failure to a stable error code. */
export async function callTool(ctx: AppContext, actor: Actor, name: string, args: unknown): Promise<CallToolResult> {
  const tool = TOOLS.find((t) => t.name === name)
  if (!tool) return toolError(new AliceError('NOT_FOUND', `Unknown tool: ${name}`))
  try {
    const input = parse(tool.input, args ?? {})
    return ok(await tool.handler(ctx, actor, input))
  } catch (err) {
    if (err instanceof AliceError) return toolError(err)
    ctx.log?.error({ err, tool: name }, 'mcp tool failed')
    return toolError(new AliceError('INTERNAL_ERROR', 'Internal server error'))
  }
}

export function createMcpServer(ctx: AppContext, actor: Actor): Server {
  const server = new Server(
    { name: 'alice', title: 'Alice taskboard', version: APP_VERSION },
    { capabilities: { tools: {} }, instructions: MCP_INSTRUCTIONS },
  )
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS.map((t) => ({
      name: t.name,
      title: t.title,
      description: t.description,
      inputSchema: toolJsonSchema(t) as { type: 'object' },
      annotations: { readOnlyHint: t.readOnly ?? false, destructiveHint: false, openWorldHint: false },
    })),
  }))
  server.setRequestHandler(CallToolRequestSchema, async (request) => callTool(ctx, actor, request.params.name, request.params.arguments))
  return server
}

declare module 'fastify' {
  interface FastifyRequest {
    mcpActor: Actor | null
  }
}

function jsonRpcError(code: string, message: string) {
  return { jsonrpc: '2.0', error: { code: -32001, message, data: { code } }, id: null }
}

export async function registerMcp(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.decorateRequest('mcpActor', null)
  const tokenKey = (req: FastifyRequest) => {
    const token = bearerToken(req)
    return token ? `tok:${sha256(token).slice(0, 32)}` : `ip:${req.ip}`
  }
  const routeOptions = {
    config: { rateLimit: { max: ctx.config.mcpRateLimitPerMinute, timeWindow: '1 minute', keyGenerator: tokenKey } },
    onRequest: async (req: FastifyRequest, reply: import('fastify').FastifyReply) => {
      const token = bearerToken(req)
      const actor = token ? authenticateAgentToken(ctx, token) : null
      if (!actor) {
        reply
          .status(401)
          .header('WWW-Authenticate', 'Bearer realm="alice", error="invalid_token"')
          .send(jsonRpcError('UNAUTHENTICATED', 'A valid agent bearer token is required'))
        return reply
      }
      req.mcpActor = actor
    },
  }

  // Stateless Streamable HTTP: a fresh server/transport per request, so any instance state lives in SQLite.
  app.post(MCP_ENDPOINT_PATH, routeOptions, async (req, reply) => {
    const server = createMcpServer(ctx, req.mcpActor!)
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
    reply.hijack()
    reply.raw.on('close', () => {
      void transport.close()
      void server.close()
    })
    await server.connect(transport)
    await transport.handleRequest(req.raw, reply.raw, req.body)
  })
  const notAllowed = async (_req: FastifyRequest, reply: import('fastify').FastifyReply) =>
    reply.status(405).header('Allow', 'POST').send({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed (stateless endpoint)' }, id: null })
  app.get(MCP_ENDPOINT_PATH, routeOptions, notAllowed)
  app.delete(MCP_ENDPOINT_PATH, routeOptions, notAllowed)

  // Discovery document for humans and setup tooling (no secrets).
  app.get('/mcp', async () => ({
    name: 'alice',
    version: APP_VERSION,
    contractVersion: MCP_CONTRACT_VERSION,
    endpoint: new URL(MCP_ENDPOINT_PATH, ctx.config.publicUrl).href,
    transport: 'streamable-http',
    auth: 'Authorization: Bearer <agent token>',
  }))
}
