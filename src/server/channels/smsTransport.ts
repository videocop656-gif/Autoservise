import { env } from '../lib/env'
import type { ChannelAdapter, ChannelSendResult } from './types'
import { ApiError } from '../lib/errors'
import { createMockAdapter } from './adapters/mockAdapter'
import { createMobizonSmsAdapter, MOBIZON_PROVIDER } from './adapters/mobizon/mobizonSmsAdapter'
import type { FetchLike, MobizonConfig } from './adapters/mobizon/mobizonClient'

// ---------------------------------------------------------------------------
// MCR-7A — which transport the SMS channel uses. Explicit, fail-closed:
//
//   SMS_PROVIDER=mobizon + complete config  → real Mobizon adapter
//   SMS_PROVIDER=mobizon + missing config   → UNAVAILABLE (never the mock)
//   SMS_PROVIDER=mock (dev/test only)       → mock (still gated by
//                                             RECOVERY_MOCK_CHANNEL_ENABLED)
//   production without SMS_PROVIDER         → UNAVAILABLE
//
// Pilot credential model: ONE AUTOSERVISE-owned Mobizon account (server
// env), used for every business whose SMS ChannelConnection is ACTIVE. The
// business is always the one of the CallInteraction / Conversation being
// sent — never chosen by a client or a provider payload. Per-business
// credentials later = resolving the config from the connection here; the
// Recovery Engine does not change.
// ---------------------------------------------------------------------------

let fetchOverride: FetchLike | null = null

/** Tests only: route Mobizon HTTP through an in-process fake (never the internet). */
export function setMobizonFetchForTests(fetchImpl: FetchLike | null): void {
  fetchOverride = fetchImpl
}

export function mobizonConfig(): MobizonConfig | null {
  const apiKey = env.mobizonApiKey
  const baseUrl = env.mobizonApiBaseUrl
  if (!apiKey || !baseUrl) return null
  return { apiKey, baseUrl, sender: env.mobizonSender }
}

/** Mobizon adapter for the configured account, or null when Mobizon isn't the configured, complete transport. */
export function mobizonAdapter() {
  if (env.smsProvider !== 'mobizon') return null
  const config = mobizonConfig()
  return config ? createMobizonSmsAdapter(config, { fetchImpl: fetchOverride ?? undefined }) : null
}

const unavailableSms: ChannelAdapter = {
  channelType: 'SMS',
  provider: 'none',
  parseIncoming() {
    throw new ApiError(400, 'CHANNEL_INBOUND_UNSUPPORTED', 'Inbound messages are not supported for this channel yet')
  },
  businessInitiatedCapability: () => ({ eligible: false, reason: 'PROVIDER_UNAVAILABLE' }),
  async sendMessage(): Promise<ChannelSendResult> {
    // Nothing is sent: safe to retry once the transport is configured.
    return { success: false, errorCode: 'PROVIDER_UNAVAILABLE', errorMessage: 'SMS transport is not configured', retryable: true }
  },
}

const mockSms = createMockAdapter('SMS')

export function smsAdapter(): ChannelAdapter {
  const provider = env.smsProvider
  if (provider === 'mobizon') return mobizonAdapter() ?? unavailableSms
  if (provider === 'mock') return mockSms
  return unavailableSms
}

export interface SmsTransportStatus {
  provider: 'mobizon' | 'mock' | 'none'
  mode: 'production' | 'mock' | 'off'
  configured: boolean
  /** The configured alphaname, or null (= the Mobizon account's default sender). Never a secret. */
  sender: string | null
  /** The pilot runs on one AUTOSERVISE-owned account: a sender is never the workshop's own brand. */
  senderScope: 'SHARED_ACCOUNT'
  webhookConfigured: boolean
}

/** Safe, secret-free status for Settings → Channels. */
export function smsTransportStatus(): SmsTransportStatus {
  const provider = env.smsProvider
  if (provider === 'mobizon') {
    return {
      provider,
      mode: 'production',
      configured: !!mobizonConfig(),
      sender: env.mobizonSender ?? null,
      senderScope: 'SHARED_ACCOUNT',
      webhookConfigured: !!env.mobizonWebhookSecret,
    }
  }
  if (provider === 'mock') return { provider, mode: 'mock', configured: env.recoveryMockChannelEnabled, sender: null, senderScope: 'SHARED_ACCOUNT', webhookConfigured: false }
  return { provider: 'none', mode: 'off', configured: false, sender: null, senderScope: 'SHARED_ACCOUNT', webhookConfigured: false }
}

export { MOBIZON_PROVIDER }
