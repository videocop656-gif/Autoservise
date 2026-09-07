import type { ApiRequest } from '../types/http'

export function getClientIp(req: ApiRequest): string {
  const forwarded = req.headers['x-forwarded-for']
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0]?.trim() ?? 'unknown'
  }
  return req.socket?.remoteAddress ?? 'unknown'
}
