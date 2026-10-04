import type { ApiRequest, ApiResponse } from '../../src/server/types/http'
import { resolveBridge } from '../../src/server/recovery/bridge'
import { logger } from '../../src/server/lib/logger'

// ============================================================================
// MCR-6 — GET /r/<token> (vercel.json rewrite → /api/bridge/<token>): the
// public SMS → WhatsApp bridge. No session: the token is the only input and
// it grants nothing but this redirect. The destination is ALWAYS built from
// the business's own trusted configuration (https://wa.me/<entry number>),
// never from the request — no open redirect. Every failure (malformed,
// unknown, expired, revoked, WhatsApp entry not configured) gets the same
// neutral page: no business, customer or reason is revealed.
// ============================================================================
const INVALID_PAGE =
  '<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Ссылка недействительна</title></head>' +
  '<body style="font-family:system-ui,sans-serif;max-width:28rem;margin:3rem auto;padding:0 1rem;color:#222"><h1 style="font-size:1.25rem">Ссылка недействительна</h1>' +
  '<p>Срок действия ссылки истёк или она больше не работает. Пожалуйста, позвоните в автосервис ещё раз.</p></body></html>'

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('Referrer-Policy', 'no-referrer')
  res.setHeader('X-Robots-Tag', 'noindex')
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.status(405).json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' } })
    return
  }
  try {
    const result = await resolveBridge(req.query.token)
    if (result.kind === 'REDIRECT') {
      res.statusCode = 302
      res.setHeader('Location', result.url)
      res.end()
      return
    }
  } catch (err) {
    logger.error('recovery_bridge_failed', { message: err instanceof Error ? err.message : 'unknown' })
  }
  res.statusCode = 404
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.end(INVALID_PAGE)
}
