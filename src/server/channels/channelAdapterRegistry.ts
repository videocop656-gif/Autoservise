import type { ChannelType } from '@prisma/client'
import { env } from '../lib/env'
import { ApiError } from '../lib/errors'
import type { ChannelAdapter } from './types'
import { createMockAdapter } from './adapters/mockAdapter'
import { createTelegramAdapter } from './adapters/telegramAdapter'

/**
 * Selects an adapter by `ChannelType` (spec §"CHANNEL REGISTRY"). WEBSITE
 * and WHATSAPP remain mock-only — unchanged since Prompt 16, and out of
 * scope for Prompt 18 (spec's own critical constraint: "без WhatsApp").
 */
const MOCK_ADAPTERS: Partial<Record<ChannelType, ChannelAdapter>> = {
  WHATSAPP: createMockAdapter('WHATSAPP'),
  WEBSITE: createMockAdapter('WEBSITE'),
}

/**
 * TELEGRAM is the one entry with conditional, real-or-mock dispatch (Prompt
 * 18) — the exact same "optional credential, mock fallback" convention
 * `aiProviderFactory.ts` already established for `OPENAI_API_KEY`: when
 * `TELEGRAM_BOT_TOKEN` is configured server-side, every caller of this
 * registry (the EXISTING, unmodified `receiveIncoming()`/
 * `sendMessageViaChannel()` pipelines) transparently starts talking to the
 * real Telegram Bot API; when it isn't, `ChannelType.TELEGRAM` behaves
 * exactly as it always has since Prompt 16 — the mock adapter, byte-
 * identical. This is why the entire pre-existing test suite (which defaults
 * its example channel connections to `type: 'TELEGRAM'`) needed zero
 * changes: it runs in an environment with no real token configured, so
 * every one of those tests keeps exercising the same mock behavior it
 * always has.
 *
 * Constructed fresh on each call (cheap — no network I/O happens here) so a
 * token configured/rotated at runtime is picked up immediately, with
 * nothing cached at module-load time.
 */
export function getChannelAdapter(type: ChannelType): ChannelAdapter {
  if (type === 'TELEGRAM') {
    const token = env.telegramBotToken
    return token ? createTelegramAdapter(token) : createMockAdapter('TELEGRAM')
  }

  const adapter = MOCK_ADAPTERS[type]
  if (!adapter) {
    // Defensive only — every real `ChannelType` enum value is handled
    // above; this can't actually be reached through validated input (Zod
    // already restricts to the enum), but a wrong/future enum value should
    // still fail safely rather than crash with an undefined lookup.
    throw new ApiError(400, 'CHANNEL_TYPE_UNSUPPORTED', 'This channel type is not supported')
  }
  return adapter
}
