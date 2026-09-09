import type { ChannelType } from '@prisma/client'
import { ApiError } from '../lib/errors'
import type { ChannelAdapter } from './types'
import { createMockAdapter } from './adapters/mockAdapter'

/**
 * Selects an adapter by `ChannelType` (spec §"CHANNEL REGISTRY"). Every
 * entry is a mock today — swapping one for a real Telegram/WhatsApp/
 * Website adapter later touches only this map, never Conversation/
 * Message/Customer/AI/escalation/analytics code, which only ever depend
 * on the `ChannelAdapter` interface.
 */
const ADAPTERS: Record<ChannelType, ChannelAdapter> = {
  TELEGRAM: createMockAdapter('TELEGRAM'),
  WHATSAPP: createMockAdapter('WHATSAPP'),
  WEBSITE: createMockAdapter('WEBSITE'),
}

/** Defensive only — every real `ChannelType` enum value is registered above; this can't actually be reached through validated input (Zod already restricts to the enum), but a wrong/future enum value should still fail safely rather than crash with an undefined lookup. */
export function getChannelAdapter(type: ChannelType): ChannelAdapter {
  const adapter = ADAPTERS[type]
  if (!adapter) {
    throw new ApiError(400, 'CHANNEL_TYPE_UNSUPPORTED', 'This channel type is not supported')
  }
  return adapter
}
