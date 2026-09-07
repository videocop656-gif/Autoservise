import type { ApiRequest } from '../types/http'
import type { AuthContext } from '../types/auth'
import { ApiError } from '../lib/errors'
import { SESSION_COOKIE_NAME } from '../lib/env'
import { hashSessionToken } from '../auth/tokens'
import { sessionRepository } from '../repositories/sessionRepository'
import { userRepository } from '../repositories/userRepository'
import { tenantRepository } from '../repositories/tenantRepository'
import { toSafeUser } from '../lib/safeUser'

/**
 * Resolves the authenticated user/tenant for the current request from the
 * session cookie. This is the ONLY source of truth for tenantId/userId/role
 * — endpoints must never trust these values if they arrive from the client
 * (query params, body, headers).
 */
export async function requireAuth(req: ApiRequest): Promise<AuthContext> {
  const token = req.cookies?.[SESSION_COOKIE_NAME]
  if (!token) {
    throw new ApiError(401, 'UNAUTHORIZED', 'Authentication required')
  }

  const tokenHash = hashSessionToken(token)
  const session = await sessionRepository.findByTokenHash(tokenHash)
  if (!session || session.expiresAt.getTime() < Date.now()) {
    throw new ApiError(401, 'UNAUTHORIZED', 'Session expired or invalid')
  }

  const user = await userRepository.findById(session.userId)
  if (!user) {
    throw new ApiError(401, 'UNAUTHORIZED', 'User not found')
  }

  const tenant = await tenantRepository.findById(user.tenantId)
  if (!tenant) {
    throw new ApiError(401, 'UNAUTHORIZED', 'Tenant not found')
  }

  // Best-effort activity tracking; must never block or fail the request.
  void sessionRepository.touch(session.id).catch(() => {})

  return { user: toSafeUser(user), tenant, sessionId: session.id }
}
