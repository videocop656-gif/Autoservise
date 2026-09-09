import type { Prisma } from '@prisma/client'

/**
 * Shared by channelConnectionService.ts (the original Prompt 16 config
 * writer) and telegramSetupService.ts (Prompt 18, which merges in a safe
 * `telegramUsername` display value after setup) — extracted to its own
 * module so the two services never need to import from each other (that
 * would create a require cycle: channelConnectionService.ts also calls
 * telegramSetupService.ts's `bestEffortDeleteTelegramWebhook()` on
 * deactivation).
 *
 * Blacklist, not whitelist — `config` is meant to hold whatever small,
 * non-secret per-channel settings a real adapter eventually needs, which
 * can't be fully enumerated in advance. So instead: strip anything
 * key-shaped like a credential, and only ever keep primitive values (never
 * nested objects — channel.schemas.ts's channelConfigSchema already
 * enforces this structurally; this is the second, independent layer) —
 * spec §"CONFIG": a bot token/API key/OAuth token/refresh token/webhook
 * secret/password must never be stored here, in any form.
 */
const SECRET_LOOKING_KEY = /token|secret|key|password|credential|auth/i
const MAX_CONFIG_VALUE_LENGTH = 500

export function sanitizeChannelConfig(config: Record<string, unknown> | undefined | null): Prisma.InputJsonObject | undefined {
  if (!config) return undefined
  const safe: Record<string, string | number | boolean> = {}
  for (const [key, value] of Object.entries(config)) {
    if (SECRET_LOOKING_KEY.test(key)) continue
    if (value === null || value === undefined) continue
    if (typeof value === 'string') {
      safe[key] = value.slice(0, MAX_CONFIG_VALUE_LENGTH)
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      safe[key] = value
    }
    // objects/arrays are silently dropped — never nested, never a place to hide a structured secret.
  }
  return Object.keys(safe).length > 0 ? (safe as Prisma.InputJsonObject) : undefined
}
