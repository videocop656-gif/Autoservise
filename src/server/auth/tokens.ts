import { createHmac, randomBytes } from 'node:crypto'
import { env } from '../lib/env'

/** Cryptographically random session token. Sent to the client only via cookie, never stored raw. */
export function generateSessionToken(): string {
  return randomBytes(32).toString('base64url')
}

/**
 * HMAC-SHA256 of the raw token, keyed by SESSION_SECRET. This is what gets
 * persisted in the database — a leaked database never exposes usable session
 * tokens, and guessing a token requires both the random value and the server
 * secret.
 */
export function hashSessionToken(token: string): string {
  return createHmac('sha256', env.sessionSecret).update(token).digest('hex')
}
