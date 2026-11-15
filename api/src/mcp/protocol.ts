import { ZodError } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { ToolError, tools, type ApiCall, type Tool } from './tools.js';
import type { TokenScope } from '../lib/tokens.js';

/**
 * The Model Context Protocol, as much of it as a server that only offers tools needs:
 * JSON-RPC 2.0 messages, one request = one JSON answer, no sessions and no server-to-client stream.
 * https://modelcontextprotocol.io/specification
 */

const PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];

export interface McpContext {
  scope: TokenScope;
  api: ApiCall;
  /** called for every tool call, for the audit line in the log */
  onToolCall?: (tool: string, ok: boolean) => void;
}

interface RpcRequest {
  jsonrpc: '2.0';
  id?: string | number | null;
  method: string;
  params?: any;
}

type RpcResponse =
  | { jsonrpc: '2.0'; id: string | number | null; result: unknown }
  | { jsonrpc: '2.0'; id: string | number | null; error: { code: number; message: string } };

const INSTRUCTIONS =
  'Diet Mentor: the person\'s own calorie diary, weigh-ins, diet sessions, meal plan and notifications. ' +
  'The app and its messages are in Greek; answer in the language the person writes in. ' +
  'Days are calendar days (YYYY-MM-DD) and times HH:MM in the app time zone; call get_account for today\'s date and the time now. ' +
  'Start with get_summary for questions about progress. Before deleting anything, or starting or ending a diet, say what you are about to do and wait for a yes. ' +
  'Numbers are estimates for adults and do not replace a doctor or dietitian.';

const allowed = (scope: TokenScope): Tool[] => (scope === 'write' ? tools : tools.filter((t) => !t.write));

function describe(tool: Tool) {
  const { $schema: _drop, ...schema } = zodToJsonSchema(tool.input, { $refStrategy: 'none' }) as Record<string, unknown>;
  return {
    name: tool.name,
    title: tool.title,
    description: tool.description,
    inputSchema: schema,
    annotations: {
      title: tool.title,
      readOnlyHint: !tool.write,
      destructiveHint: Boolean(tool.destructive),
      idempotentHint: !tool.write,
      openWorldHint: false,
    },
  };
}

const text = (value: unknown, isError = false) => ({
  content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value ?? { ok: true }) }],
  isError,
});

async function callTool(params: any, ctx: McpContext) {
  const tool = allowed(ctx.scope).find((t) => t.name === params?.name);
  if (!tool) {
    const hidden = tools.some((t) => t.name === params?.name);
    return text(hidden ? 'This token is read-only: it cannot change anything. Make a read & write token in the app (Profile > Claude).' : `Unknown tool: ${String(params?.name)}`, true);
  }
  try {
    // strict: a misspelled argument is an error the model can fix, not something to drop silently
    const args = tool.input.strict().parse(params.arguments ?? {});
    const result = await tool.run(args, ctx.api);
    ctx.onToolCall?.(tool.name, true);
    return text(result);
  } catch (err) {
    ctx.onToolCall?.(tool.name, false);
    if (err instanceof ZodError) {
      return text(`Invalid arguments: ${err.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')}`, true);
    }
    if (err instanceof ToolError) return text(err.message, true);
    throw err;
  }
}

/** Answers one JSON-RPC message. null for notifications (they get no answer). */
export async function handleMessage(msg: unknown, ctx: McpContext): Promise<RpcResponse | null> {
  const m = msg as Partial<RpcRequest> | null;
  const hasId = m !== null && typeof m === 'object' && (typeof m.id === 'string' || typeof m.id === 'number');
  const id = hasId ? (m!.id as string | number) : null;
  const fail = (code: number, message: string): RpcResponse => ({ jsonrpc: '2.0', id, error: { code, message } });

  if (!m || typeof m !== 'object' || m.jsonrpc !== '2.0' || typeof m.method !== 'string') return fail(-32600, 'Invalid Request');
  if (!hasId) return null; // notifications/initialized, notifications/cancelled, ...
  const ok = (result: unknown): RpcResponse => ({ jsonrpc: '2.0', id, result });

  switch (m.method) {
    case 'initialize': {
      const asked = m.params?.protocolVersion;
      return ok({
        protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'diet-mentor', title: 'Diet Mentor', version: '1.0.0' },
        instructions: INSTRUCTIONS,
      });
    }
    case 'ping':
      return ok({});
    case 'tools/list':
      return ok({ tools: allowed(ctx.scope).map(describe) });
    case 'tools/call':
      try {
        return ok(await callTool(m.params, ctx));
      } catch {
        return fail(-32603, 'Internal error');
      }
    default:
      return fail(-32601, `Method not found: ${m.method}`);
  }
}
