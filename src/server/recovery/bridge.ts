import { createHash, randomBytes } from 'node:crypto'
import type { ChannelConnection } from '@prisma/client'
import { env } from '../lib/env'
import { logger } from '../lib/logger'
import { normalizePhone } from '../lib/phone'
import { bridgeLinkRepository } from '../repositories/recoveryRoutingRepository'
import { channelConnectionRepository } from '../repositories/channelConnectionRepository'
import { RECOVERY_BRIDGE_LINK_TTL_HOURS, RECOVERY_BRIDGE_PREFILL_TEXT } from './policy'

// ---------------------------------------------------------------------------
// MCR-6 — the SMS → WhatsApp bridge.
//
//   SMS "…Продолжим в WhatsApp: https://<APP_URL>/r/<token>"
//   → GET /r/<token> (public, no session) → 302 https://wa.me/<business
//     WhatsApp entry number>?text=<fixed greeting>
//   → the customer presses send in WhatsApp → THAT is the inbound message
//     (future real WhatsApp webhook → MCR-5).
//
// Token: 128 random bits (base64url, 22 chars), opaque. Stored only as its
// SHA-256 — chosen over a signed JWT because it carries nothing (no tenant,
// call, phone, expiry to decode), is revocable by a DB update, and a leaked
// table yields no working links. The URL never contains PII or internal ids.
// Opening a link records attribution only: never consent, never a session,
// never a message.
// ---------------------------------------------------------------------------

const TOKEN_BYTES = 16
const TOKEN_FORMAT = /^[A-Za-z0-9_-]{22}$/

export function generateBridgeToken(): { token: string; tokenHash: string } {
  const token = randomBytes(TOKEN_BYTES).toString('base64url')
  return { token, tokenHash: hashBridgeToken(token) }
}

export function hashBridgeToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function bridgeLinkExpiry(now: Date): Date {
  return new Date(now.getTime() + RECOVERY_BRIDGE_LINK_TTL_HOURS * 3_600_000)
}

/**
 * The public origin bridge links are built on: RECOVERY_LINK_BASE_URL (an
 * optional short first-party domain pointing at this deployment) or APP_URL
 * (the same setting the Telegram webhook uses). Production requires https and a real host — a
 * localhost / http value means "not configured" (SMS bridge not offered).
 */
export function publicBridgeBaseUrl(): string | null {
  try {
    // MCR-7A — a dedicated short first-party origin (same deployment) wins over APP_URL.
    const url = new URL(env.recoveryLinkBaseUrl ?? env.appUrl)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
    if (env.isProduction && (url.protocol !== 'https:' || ['localhost', '127.0.0.1'].includes(url.hostname))) return null
    return `${url.origin}${url.pathname.replace(/\/+$/, '')}`
  } catch {
    return null
  }
}

export function buildBridgeUrl(baseUrl: string, token: string): string {
  return `${baseUrl}/r/${token}`
}

/**
 * The business's WhatsApp customer-entry number: config.customerEntryPhone of
 * its ACTIVE WhatsApp connection (oldest first), canonical E.164 only. Never a
 * global number; absent → no bridge.
 */
export function whatsappEntryPhone(connections: Pick<ChannelConnection, 'type' | 'status' | 'config' | 'createdAt'>[]): string | null {
  const candidates = connections
    .filter((c) => c.type === 'WHATSAPP' && c.status === 'ACTIVE')
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
  for (const c of candidates) {
    const raw = (c.config as Record<string, unknown> | null)?.customerEntryPhone
    const e164 = typeof raw === 'string' ? normalizePhone(raw, null) : null
    if (e164) return e164
  }
  return null
}

/** wa.me only — the destination is built from trusted business configuration, never from the request. */
export function whatsappEntryUrl(entryPhoneE164: string): string {
  return `https://wa.me/${entryPhoneE164.replace(/^\+/, '')}?text=${encodeURIComponent(RECOVERY_BRIDGE_PREFILL_TEXT)}`
}

export type BridgeResolution = { kind: 'REDIRECT'; url: string } | { kind: 'INVALID' }

/** Public: resolve a bridge token to the redirect target. Malformed / unknown / expired / revoked / unconfigured → INVALID (same answer for all). */
export async function resolveBridge(token: unknown, now: Date = new Date()): Promise<BridgeResolution> {
  if (typeof token !== 'string' || !TOKEN_FORMAT.test(token)) return { kind: 'INVALID' } // cheap reject, no DB
  const link = await bridgeLinkRepository.findByTokenHash(hashBridgeToken(token))
  if (!link || link.revokedAt || link.expiresAt.getTime() <= now.getTime()) {
    logger.info('recovery_bridge_rejected', { reason: !link ? 'UNKNOWN' : link.revokedAt ? 'REVOKED' : 'EXPIRED' })
    return { kind: 'INVALID' }
  }
  const connections = await channelConnectionRepository.list(link.tenantId, link.businessId)
  const entry = whatsappEntryPhone(connections)
  if (!entry) {
    logger.info('recovery_bridge_rejected', { reason: 'WHATSAPP_ENTRY_NOT_CONFIGURED', bridgeLinkId: link.id })
    return { kind: 'INVALID' }
  }
  await bridgeLinkRepository.recordOpen(link.id, now)
  logger.info('recovery_bridge_opened', { bridgeLinkId: link.id, callInteractionId: link.callInteractionId })
  return { kind: 'REDIRECT', url: whatsappEntryUrl(entry) }
}
