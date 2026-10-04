function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`)
  }
  return value
}

export const env = {
  get databaseUrl(): string {
    return requireEnv('DATABASE_URL')
  },
  get sessionSecret(): string {
    return requireEnv('SESSION_SECRET')
  },
  get nodeEnv(): string {
    return process.env.NODE_ENV ?? 'development'
  },
  get appUrl(): string {
    return process.env.APP_URL ?? 'http://localhost:5173'
  },
  get isProduction(): boolean {
    return this.nodeEnv === 'production'
  },
  // Deliberately NOT requireEnv(): an unconfigured key must never crash the
  // process. aiProviderFactory.ts falls back to the deterministic mock
  // provider when this is unset — see docs/AI_BEHAVIOR_CONTRACT.md and the
  // Prompt 09 final report for why that's the correct default here, rather
  // than a hard failure.
  get openAiApiKey(): string | undefined {
    const value = process.env.OPENAI_API_KEY
    return value && value.trim() !== '' ? value : undefined
  },
  get openAiModel(): string {
    return process.env.OPENAI_MODEL?.trim() || 'gpt-4o-mini'
  },
  // Real Telegram Channel Integration (Prompt 18). Both deliberately
  // NOT requireEnv(): the same "optional, mock-fallback" convention as
  // openAiApiKey above — an unconfigured server must never crash, and
  // every Telegram-specific code path (channelAdapterRegistry.ts,
  // telegramSetupService.ts, the webhook route) treats an absent token
  // exactly like aiProviderFactory.ts treats an absent OPENAI_API_KEY:
  // fall back to already-existing mock/foundation behavior rather than
  // fail. The token/secret themselves are never read anywhere else in
  // this codebase (never Prisma, never a DTO, never a log field) — see
  // telegramApiClient.ts and the webhook route's own doc comments.
  get telegramBotToken(): string | undefined {
    const value = process.env.TELEGRAM_BOT_TOKEN
    return value && value.trim() !== '' ? value : undefined
  },
  get telegramWebhookSecret(): string | undefined {
    const value = process.env.TELEGRAM_WEBHOOK_SECRET
    return value && value.trim() !== '' ? value : undefined
  },
  /**
   * MCR-4 / MCR-6 — lets the MOCK WhatsApp and MOCK SMS channels act as
   * recovery channels ("true"). Development/testing only: always false in
   * production, so a mock can never pose as a real provider there. (Consent,
   * session and template rules apply on top — see recovery/channelRouter.ts.)
   */
  get recoveryMockChannelEnabled(): boolean {
    return !this.isProduction && process.env.RECOVERY_MOCK_CHANNEL_ENABLED === 'true'
  },
  /** MCR-4 — bearer secret of POST /api/internal/recovery/process (scheduler/cron trigger). Unset → endpoint disabled. */
  get recoveryProcessorSecret(): string | undefined {
    const value = process.env.RECOVERY_PROCESSOR_SECRET
    return value && value.trim() !== '' ? value : undefined
  },
  /**
   * MCR-7A — which SMS transport the SMS channel uses: "mobizon" (real
   * Mobizon Kazakhstan API) or "mock". Unset = "mock" outside production and
   * NONE in production (fail closed: production never sends through a mock,
   * and never silently falls back to one).
   */
  get smsProvider(): 'mobizon' | 'mock' | 'none' {
    const value = process.env.SMS_PROVIDER?.trim().toLowerCase()
    if (value === 'mobizon') return 'mobizon'
    if (value === 'mock' || (!value && !this.isProduction)) return this.isProduction ? 'none' : 'mock'
    return 'none'
  },
  /** MCR-7A — Mobizon API key (secret; query parameter `apiKey` per Mobizon docs). Never logged, never returned to a client. */
  get mobizonApiKey(): string | undefined {
    const value = process.env.MOBIZON_API_KEY
    return value && value.trim() !== '' ? value.trim() : undefined
  },
  /**
   * MCR-7A — Mobizon API origin. Default: the official Kazakhstan endpoint.
   * Only https://api.mobizon.<tld> hosts are accepted (no arbitrary provider
   * URL, no SSRF); anything else → undefined → SMS channel unavailable.
   */
  get mobizonApiBaseUrl(): string | undefined {
    const raw = process.env.MOBIZON_API_BASE_URL?.trim() || 'https://api.mobizon.kz'
    try {
      const url = new URL(raw)
      if (url.protocol !== 'https:' || !/^api\.mobizon\.[a-z]{2,3}(\.[a-z]{2})?$/.test(url.hostname) || url.port || url.pathname !== '/') return undefined
      return url.origin
    } catch {
      return undefined
    }
  },
  /** MCR-7A — Mobizon sender ("from"): a shared or registered alphaname. Optional: unset = the account's default sender. */
  get mobizonSender(): string | undefined {
    const value = process.env.MOBIZON_SENDER
    return value && value.trim() !== '' ? value.trim() : undefined
  },
  /** MCR-7A — the secret key of the Mobizon "Статусы SMS" webhook (signature SHA1(eventId|attempt|eventCreateTs|secret)). Unset → webhook rejects everything. */
  get mobizonWebhookSecret(): string | undefined {
    const value = process.env.MOBIZON_WEBHOOK_SECRET
    return value && value.trim() !== '' ? value : undefined
  },
  /**
   * MCR-7A — optional dedicated short FIRST-PARTY origin for SMS bridge links
   * (e.g. https://as.kz), pointing at this same deployment. Shorter links =
   * fewer SMS segments. Unset → APP_URL. Never a third-party shortener.
   */
  get recoveryLinkBaseUrl(): string | undefined {
    const value = process.env.RECOVERY_LINK_BASE_URL
    return value && value.trim() !== '' ? value.trim() : undefined
  },
  /** MCR-7B1 — Twilio Account SID (identifier, not a secret; still never logged in full). */
  get twilioAccountSid(): string | undefined {
    const value = process.env.TWILIO_ACCOUNT_SID?.trim()
    return value && /^AC[0-9a-fA-F]{32}$/.test(value) ? value : undefined
  },
  /** MCR-7B1 — Twilio Auth Token (secret): Basic auth for the API and the key of X-Twilio-Signature. Never logged, never sent to a client. */
  get twilioAuthToken(): string | undefined {
    const value = process.env.TWILIO_AUTH_TOKEN
    return value && value.trim() !== '' ? value.trim() : undefined
  },
  /**
   * MCR-7B1 — which provisioned Twilio WhatsApp senders belong to which
   * business (pilot: one AUTOSERVISE-controlled Twilio account). Format:
   * "+77272500100=<businessId>,+77172500200=<businessId>". Server-side
   * configuration is the authority: an owner can only connect the sender
   * assigned to their own business.
   */
  get twilioWhatsAppSenders(): { senderE164: string; businessId: string }[] {
    return (process.env.TWILIO_WHATSAPP_SENDERS ?? '')
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => {
        const [sender, businessId] = entry.split('=').map((part) => part?.trim() ?? '')
        return { senderE164: sender ?? '', businessId: businessId ?? '' }
      })
      .filter((s) => /^\+[1-9]\d{6,14}$/.test(s.senderE164) && /^[0-9a-f-]{36}$/i.test(s.businessId))
  },
  /** MCR-7B1 — the approved Twilio Content Template (ContentSid "HX…") for MISSED_CALL_RECOVERY_V1. Unset → no business-initiated WhatsApp recovery. */
  get twilioRecoveryTemplateSid(): string | undefined {
    const value = process.env.TWILIO_TEMPLATE_MISSED_CALL_RECOVERY_V1?.trim()
    return value && /^HX[0-9a-fA-F]{32}$/.test(value) ? value : undefined
  },
  /** MCR-2 — enables the MOCK telephony webhook (development/testing only; ignored in production). */
  get telephonyMockWebhookSecret(): string | undefined {
    const value = process.env.TELEPHONY_MOCK_WEBHOOK_SECRET
    return value && value.trim() !== '' ? value : undefined
  },
}

export const SESSION_COOKIE_NAME = 'session_token'

/** Sessions are valid for 30 days from creation; each authenticated request refreshes lastUsedAt. */
export const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000
