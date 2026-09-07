import type { ApiResponse } from '../types/http'
import { env, SESSION_COOKIE_NAME } from './env'

export function setSessionCookie(res: ApiResponse, token: string, expiresAt: Date): void {
  const maxAgeSeconds = Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000))
  const parts = [`${SESSION_COOKIE_NAME}=${token}`, 'HttpOnly', 'Path=/', `Max-Age=${maxAgeSeconds}`, 'SameSite=Lax']
  if (env.isProduction) parts.push('Secure')
  res.setHeader('Set-Cookie', parts.join('; '))
}

export function clearSessionCookie(res: ApiResponse): void {
  const parts = [`${SESSION_COOKIE_NAME}=`, 'HttpOnly', 'Path=/', 'Max-Age=0', 'SameSite=Lax']
  if (env.isProduction) parts.push('Secure')
  res.setHeader('Set-Cookie', parts.join('; '))
}
