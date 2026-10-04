import type { ChannelConnection } from '@prisma/client'
import { env } from '../lib/env'
import { ApiError } from '../lib/errors'
import { maskPhone } from '../lib/phone'
import type { ChannelAdapter, ChannelSendResult } from './types'
import { createMockAdapter } from './adapters/mockAdapter'
import { createTwilioWhatsAppAdapter, TWILIO_PROVIDER } from './adapters/twilio/twilioWhatsAppAdapter'
import type { FetchLike } from './adapters/mobizon/mobizonClient'
import type { TwilioCredentials } from './adapters/twilio/twilioClient'
import { MISSED_CALL_RECOVERY_V1 } from '../recovery/templates'

// ---------------------------------------------------------------------------
// MCR-7B1 — which transport a WhatsApp ChannelConnection uses. Per
// connection (each one belongs to exactly one business and one sender):
//
//   connection.provider = "twilio" + Twilio credentials  → Twilio adapter
//   connection.provider = "twilio", no credentials        → UNAVAILABLE
//   no provider, outside production                      → mock (dev/test)
//   no provider, production                              → UNAVAILABLE
//                                                           (never a fake send)
//
// Pilot credential model: one AUTOSERVISE-controlled Twilio account (server
// env). Per-business credentials / subaccounts (MCR-7B2 Embedded Signup)
// replace twilioCredentialsFor() — nothing above the registry changes.
// ---------------------------------------------------------------------------

type ConnectionLike = Pick<ChannelConnection, 'type'> & Partial<Pick<ChannelConnection, 'provider' | 'senderE164'>>

let fetchOverride: FetchLike | null = null

/** Tests only: route Twilio HTTP through an in-process fake (never the internet). */
export function setTwilioFetchForTests(fetchImpl: FetchLike | null): void {
  fetchOverride = fetchImpl
}

export function twilioCredentials(): TwilioCredentials | null {
  const accountSid = env.twilioAccountSid
  const authToken = env.twilioAuthToken
  return accountSid && authToken ? { accountSid, authToken } : null
}

/** The canonical public origin Twilio calls (APP_URL) — the exact base of every signed webhook URL. */
export function twilioWebhookUrl(path: '/api/webhooks/channels/twilio/inbound' | '/api/webhooks/channels/twilio/status'): string | null {
  try {
    const url = new URL(env.appUrl)
    if (env.isProduction && (url.protocol !== 'https:' || ['localhost', '127.0.0.1'].includes(url.hostname))) return null
    return `${url.origin}${url.pathname.replace(/\/+$/, '')}${path}`
  } catch {
    return null
  }
}

/** Internal template key → approved Twilio ContentSid (only configured ones). */
function twilioTemplates(): Record<string, string> {
  const sid = env.twilioRecoveryTemplateSid
  return sid ? { [MISSED_CALL_RECOVERY_V1]: sid } : {}
}

const unavailableWhatsApp: ChannelAdapter = {
  channelType: 'WHATSAPP',
  provider: 'none',
  freeFormRequiresOpenSession: true,
  parseIncoming() {
    throw new ApiError(409, 'CHANNEL_UNAVAILABLE', 'This WhatsApp connection has no configured transport')
  },
  businessInitiatedCapability: () => ({ eligible: false, reason: 'PROVIDER_UNAVAILABLE' }),
  recoveryTemplateAvailable: () => false,
  async sendMessage(): Promise<ChannelSendResult> {
    return { success: false, errorCode: 'PROVIDER_UNAVAILABLE', errorMessage: 'WhatsApp transport is not configured', retryable: true }
  },
}

const mockWhatsApp = createMockAdapter('WHATSAPP')

export function whatsappAdapterFor(connection?: ConnectionLike | null): ChannelAdapter {
  if (connection?.provider === TWILIO_PROVIDER) {
    const credentials = twilioCredentials()
    if (!credentials || !connection.senderE164) return unavailableWhatsApp
    return createTwilioWhatsAppAdapter(
      { ...credentials, senderE164: connection.senderE164, statusCallbackUrl: twilioWebhookUrl('/api/webhooks/channels/twilio/status'), templates: twilioTemplates() },
      { fetchImpl: fetchOverride ?? undefined }
    )
  }
  return env.isProduction ? unavailableWhatsApp : mockWhatsApp
}

/** The sender assigned to this business in server configuration (pilot), or null. */
export function assignedTwilioSender(businessId: string): string | null {
  const matches = env.twilioWhatsAppSenders.filter((s) => s.businessId === businessId)
  return matches.length === 1 ? matches[0]!.senderE164 : null
}

export interface WhatsAppTransportStatus {
  provider: 'twilio' | 'mock' | 'none'
  mode: 'production' | 'mock' | 'off'
  credentialsConfigured: boolean
  /** Masked: the sender assigned to THIS business in server configuration. */
  assignedSender: string | null
  recoveryTemplateConfigured: boolean
  webhooksConfigured: boolean
}

/** Safe, secret-free status for Settings → Channels (never the token, never a full number). */
export function whatsappTransportStatus(businessId: string): WhatsAppTransportStatus {
  const credentialsConfigured = !!twilioCredentials()
  const sender = assignedTwilioSender(businessId)
  if (credentialsConfigured || sender) {
    return {
      provider: 'twilio',
      mode: 'production',
      credentialsConfigured,
      assignedSender: sender ? maskPhone(sender) : null,
      recoveryTemplateConfigured: !!env.twilioRecoveryTemplateSid,
      webhooksConfigured: !!twilioWebhookUrl('/api/webhooks/channels/twilio/inbound'),
    }
  }
  return env.isProduction
    ? { provider: 'none', mode: 'off', credentialsConfigured: false, assignedSender: null, recoveryTemplateConfigured: false, webhooksConfigured: false }
    : { provider: 'mock', mode: 'mock', credentialsConfigured: false, assignedSender: null, recoveryTemplateConfigured: false, webhooksConfigured: false }
}

export { TWILIO_PROVIDER }
