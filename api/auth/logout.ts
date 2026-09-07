import type { ApiRequest, ApiResponse } from '../../src/server/types/http'
import { logoutUser } from '../../src/server/services/authService'
import { clearSessionCookie } from '../../src/server/lib/cookies'
import { sendError, ApiError } from '../../src/server/lib/errors'
import { SESSION_COOKIE_NAME } from '../../src/server/lib/env'

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  try {
    if (req.method !== 'POST') {
      throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed')
    }

    // Safe even if the cookie/session is already gone.
    const token = req.cookies?.[SESSION_COOKIE_NAME]
    await logoutUser(token)
    clearSessionCookie(res)

    res.status(200).json({ success: true })
  } catch (err) {
    sendError(res, err)
  }
}
