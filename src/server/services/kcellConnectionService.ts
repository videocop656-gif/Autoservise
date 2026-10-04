import type { AuthContext } from '../types/auth'
import { env } from '../lib/env'
import { ApiError } from '../lib/errors'
import { maskPhone } from '../lib/phone'
import { requireRole } from '../middleware/requireRole'
import { businessPhoneNumberRepository } from '../repositories/businessPhoneNumberRepository'
import { telephonyConnectionRepository } from '../repositories/telephonyConnectionRepository'
import { KCELL_PROVIDER } from '../telephony/adapters/kcell/kcellTelephonyAdapter'

// ---------------------------------------------------------------------------
// MCR-8A — the controlled pilot way to switch a business's Kcell Virtual PBX
// integration on/off, and its secret-free status for Settings.
//
// The CRM token is never typed in the browser: it is server configuration
// (KCELL_CRM_TOKENS, one entry per business). An owner/admin can only
// activate the connection of THEIR business, and only when the server holds a
// token for it. Which calls belong to the business is still decided by its
// active BusinessPhoneNumbers (the called number) — the Kcell number, or an
// existing workshop number brought into the PBX by SIP / forwarding.
// ---------------------------------------------------------------------------

export const KCELL_WEBHOOK_PATH = '/api/webhooks/telephony/kcell'
const MANAGING_ROLES = ['owner', 'admin'] as const

export function kcellTokenConfigured(businessId: string): boolean {
  return env.kcellCrmTokens.some((entry) => entry.businessId === businessId)
}

/** The public HTTPS URL to paste into the Kcell PBX CRM integration (null if APP_URL is unusable in production). */
export function kcellWebhookUrl(): string | null {
  try {
    const url = new URL(env.appUrl)
    if (env.isProduction && (url.protocol !== 'https:' || ['localhost', '127.0.0.1'].includes(url.hostname))) return null
    return `${url.origin}${url.pathname.replace(/\/+$/, '')}${KCELL_WEBHOOK_PATH}`
  } catch {
    return null
  }
}

export interface TelephonyStatus {
  provider: 'kcell' | 'mock' | 'none'
  mode: 'production' | 'mock' | 'off'
  /** The server holds a CRM token for THIS business (the token itself never leaves the server). */
  tokenConfigured: boolean
  connection: 'ACTIVE' | 'DISABLED' | null
  connectedAt: string | null
  /** Active business numbers calls are routed by — masked. */
  numbers: string[]
  /** Kcell callbacks for this business will be accepted and turned into calls. */
  missedCallEventsEnabled: boolean
  webhookUrl: string | null
}

export async function telephonyStatus(ctx: AuthContext): Promise<TelephonyStatus> {
  const [connection, numbers] = await Promise.all([
    telephonyConnectionRepository.findByBusiness(ctx.tenant.id, ctx.business.id, KCELL_PROVIDER),
    businessPhoneNumberRepository.listByBusiness(ctx.tenant.id, ctx.business.id),
  ])
  const tokenConfigured = kcellTokenConfigured(ctx.business.id)
  const active = numbers.filter((n) => n.isActive).map((n) => maskPhone(n.phoneE164))
  const webhookUrl = kcellWebhookUrl()
  if (tokenConfigured || connection) {
    return {
      provider: 'kcell',
      mode: 'production',
      tokenConfigured,
      connection: connection?.status ?? null,
      connectedAt: connection?.status === 'ACTIVE' ? connection.connectedAt.toISOString() : null,
      numbers: active,
      missedCallEventsEnabled: tokenConfigured && connection?.status === 'ACTIVE' && active.length > 0 && !!webhookUrl,
      webhookUrl,
    }
  }
  const mock = !env.isProduction && !!env.telephonyMockWebhookSecret
  return { provider: mock ? 'mock' : 'none', mode: mock ? 'mock' : 'off', tokenConfigured: false, connection: null, connectedAt: null, numbers: active, missedCallEventsEnabled: mock && active.length > 0, webhookUrl: null }
}

export async function connectKcell(ctx: AuthContext, now = new Date()) {
  requireRole(ctx, ...MANAGING_ROLES)
  if (!kcellTokenConfigured(ctx.business.id)) {
    throw new ApiError(409, 'KCELL_NOT_PROVISIONED', 'Для вашего автосервиса не настроен ключ интеграции Kcell на сервере')
  }
  await telephonyConnectionRepository.activate(ctx.tenant.id, ctx.business.id, KCELL_PROVIDER, now)
  return telephonyStatus(ctx)
}

export async function disconnectKcell(ctx: AuthContext, now = new Date()) {
  requireRole(ctx, ...MANAGING_ROLES)
  await telephonyConnectionRepository.disable(ctx.tenant.id, ctx.business.id, KCELL_PROVIDER, now)
  return telephonyStatus(ctx)
}
