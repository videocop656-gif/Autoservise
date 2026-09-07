import type { IncomingMessage, ServerResponse } from 'node:http'

/**
 * Shape of the request/response objects our handlers receive. This matches
 * what Vercel's Node.js serverless runtime provides natively (parsed JSON
 * body, parsed cookies, parsed query, and `res.status/json/send` helpers),
 * so the same handler code runs unmodified in production and in local dev
 * (see vite.config.ts, which augments plain Node req/res the same way).
 */
export interface ApiRequest extends IncomingMessage {
  body: unknown
  cookies: Record<string, string>
  query: Record<string, string | string[]>
}

export interface ApiResponse extends ServerResponse {
  status(code: number): ApiResponse
  json(data: unknown): void
  send(data: unknown): void
}

export type ApiHandler = (req: ApiRequest, res: ApiResponse) => void | Promise<void>
