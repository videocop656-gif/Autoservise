// ---------------------------------------------------------------------------
// MCR-7A — Mobizon Kazakhstan HTTP API client (official docs: mobizon.kz/help/api-docs).
//
//   POST https://api.mobizon.kz/service/{Module}/{Method}?output=json&api=v1&apiKey=…
//   body: application/x-www-form-urlencoded (UTF-8)
//   response: { code: 0 = success, data, message }
//
// The API key travels in the query string (that is Mobizon's documented
// authentication), so request URLs are NEVER logged. Repository-native
// fetch, injectable for tests; explicit timeout + abort; bounded response.
// No SDK.
// ---------------------------------------------------------------------------

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal }) => Promise<{
  status: number
  text(): Promise<string>
}>

export interface MobizonConfig {
  apiKey: string
  /** Validated official origin, e.g. https://api.mobizon.kz */
  baseUrl: string
  /** Optional alphaname ("from"); unset = the account's default sender. */
  sender?: string
}

const MAX_RESPONSE_CHARS = 64 * 1024
export const MOBIZON_SEND_TIMEOUT_MS = 8_000
export const MOBIZON_STATUS_TIMEOUT_MS = 3_000

/** Network-level outcome of one HTTP call, before any business interpretation. */
export type MobizonHttpResult =
  | { kind: 'RESPONSE'; httpStatus: number; body: { code: number; data: unknown; message: string } | null }
  /** The request certainly did not reach Mobizon (DNS / connection refused). */
  | { kind: 'NOT_SENT'; reason: string }
  /** The request may have reached Mobizon (timeout, reset, aborted mid-flight). */
  | { kind: 'UNKNOWN'; reason: string }

const NOT_SENT_CODES = new Set(['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ERR_INVALID_URL'])

function parseBody(text: string): { code: number; data: unknown; message: string } | null {
  if (text.length > MAX_RESPONSE_CHARS) return null
  try {
    const json = JSON.parse(text) as Record<string, unknown>
    if (typeof json !== 'object' || json === null) return null
    const code = typeof json.code === 'number' ? json.code : typeof json.code === 'string' && /^\d+$/.test(json.code) ? Number(json.code) : null
    if (code === null) return null
    return { code, data: json.data ?? null, message: typeof json.message === 'string' ? json.message.slice(0, 300) : '' }
  } catch {
    return null
  }
}

export async function callMobizon(
  config: MobizonConfig,
  fetchImpl: FetchLike,
  method: 'Message/SendSmsMessage' | 'Message/GetSMSStatus',
  params: Record<string, string>,
  timeoutMs: number
): Promise<MobizonHttpResult> {
  const url = `${config.baseUrl}/service/${method}?output=json&api=v1&apiKey=${encodeURIComponent(config.apiKey)}`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8', Accept: 'application/json' },
      body: new URLSearchParams(params).toString(),
      signal: controller.signal,
    })
    const text = await response.text()
    return { kind: 'RESPONSE', httpStatus: response.status, body: parseBody(text) }
  } catch (err) {
    const code = (err as { cause?: { code?: string } })?.cause?.code ?? (err as { code?: string })?.code
    if (code && NOT_SENT_CODES.has(code)) return { kind: 'NOT_SENT', reason: code }
    return { kind: 'UNKNOWN', reason: controller.signal.aborted ? 'TIMEOUT' : (code ?? 'NETWORK_ERROR') }
  } finally {
    clearTimeout(timer)
  }
}

/** Default transport: the runtime's global fetch (Node 20+ / Vercel). */
export const defaultFetch: FetchLike = (url, init) => fetch(url, init)
