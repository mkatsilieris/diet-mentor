import { Router, type Request, type Response, type NextFunction } from 'express';
import { bearerToken, requireApiToken } from '../auth.js';
import { config } from '../config.js';
import { RateLimiter } from '../lib/ratelimit.js';
import { handleMessage, type McpContext } from '../mcp/protocol.js';
import { ToolError, type ApiCall } from '../mcp/tools.js';

/**
 * POST /api/mcp - the door for Claude (Model Context Protocol, "streamable HTTP" transport,
 * stateless). How it is kept safe:
 *
 *   - only personal access tokens open it (auth.ts): 256 random bits, kept hashed, with an expiry
 *     date, revocable in the app, read-only if the person chose so; wrong tokens are rate limited
 *   - browsers are turned away: a page on another site must not be able to talk to it
 *   - each token gets 120 calls a minute
 *   - a tool does nothing by itself: it calls the same route the web app calls, with the same
 *     token, so every check and the "only your own data" rule apply exactly as in the app
 *   - every tool call leaves a line in the log (who, which token, which tool - not the contents)
 */
export const mcpRouter = Router();

const perToken = new RateLimiter(120, 60_000);
const MAX_BATCH = 20;

/** MCP clients are programs, not web pages. A request that names a foreign Origin is a browser being steered here. */
function noForeignOrigin(req: Request, res: Response, next: NextFunction): void {
  const origin = req.headers.origin;
  if (origin && origin !== config.appUrl) {
    res.status(403).json({ error: 'Origin not allowed' });
    return;
  }
  next();
}

function limit(req: Request, res: Response, next: NextFunction): void {
  const key = String(req.apiToken!.id);
  if (!perToken.hit(key)) {
    res.setHeader('Retry-After', String(perToken.retryAfter(key)));
    res.status(429).json({ error: 'Too many requests for this token, slow down' });
    return;
  }
  next();
}

/** Calls this API's own routes on the loopback interface, as the person, with the token they sent. */
function loopback(req: Request): ApiCall {
  const token = bearerToken(req)!;
  return async (method, path, body) => {
    const res = await fetch(`http://127.0.0.1:${config.port}/api${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(20_000),
    });
    if (res.status === 204) return { ok: true };
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) throw new ToolError(data.error ?? `Request failed (${res.status})`);
    return data;
  };
}

mcpRouter.post('/', noForeignOrigin, requireApiToken, limit, async (req, res) => {
  const ctx: McpContext = {
    scope: req.apiToken!.scope,
    api: loopback(req),
    onToolCall: (tool, ok) => req.log.info({ user: req.user.id, tokenId: req.apiToken!.id, tool, ok }, 'mcp tool call'),
  };
  res.setHeader('Cache-Control', 'no-store');

  const body: unknown = req.body;
  if (Array.isArray(body)) {
    if (body.length === 0 || body.length > MAX_BATCH) {
      res.status(400).json({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid Request' } });
      return;
    }
    const answers = [];
    for (const msg of body) {
      const answer = await handleMessage(msg, ctx);
      if (answer) answers.push(answer);
    }
    if (answers.length) res.json(answers);
    else res.status(202).end();
    return;
  }

  const answer = await handleMessage(body, ctx);
  if (answer) res.json(answer);
  else res.status(202).end();
});

// No server-to-client stream and no sessions to end: the spec asks for 405 on GET and DELETE.
mcpRouter.all('/', (_req, res) => {
  res.setHeader('Allow', 'POST');
  res.status(405).json({ error: 'Method not allowed' });
});
