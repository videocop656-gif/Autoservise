import type { ApiRequest, ApiResponse } from '../../src/server/types/http'
import { loginSchema } from '../../src/server/validation/auth.schemas'
import { loginUser } from '../../src/server/services/authService'
import { setSessionCookie } from '../../src/server/lib/cookies'
import { sendError, ApiError } from '../../src/server/lib/errors'
import { rateLimit } from '../../src/server/middleware/rateLimit'
import { getClientIp } from '../../src/server/lib/request'
import { logger } from '../../src/server/lib/logger'

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  try {
    if (req.method !== 'POST') {
      throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed')
    }

    const ip = getClientIp(req)
    const limit = rateLimit(`login:${ip}`, 10, 15 * 60 * 1000)
    if (!limit.allowed) {
      throw new ApiError(429, 'RATE_LIMITED', 'Too many attempts. Please try again later.')
    }

    const input = loginSchema.parse(req.body)
    const result = await loginUser(input)

    setSessionCookie(res, result.token, result.expiresAt)
    logger.info('user_logged_in', { tenantId: result.tenant.id, userId: result.user.id })

    res.status(200).json({ user: result.user, tenant: result.tenant })
  } catch (err) {
    sendError(res, err)
  }
}
