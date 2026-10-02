import type { ChannelConnection, ChannelType } from '@prisma/client'
import { channelConnectionRepository } from '../repositories/channelConnectionRepository'
import { getChannelAdapter } from '../channels/channelAdapterRegistry'
import type { BusinessInitiatedCapability } from '../channels/types'
import { RECOVERY_CHANNEL_PRIORITY } from './policy'

// ---------------------------------------------------------------------------
// MCR-4 — Recovery Channel Router. Provider-neutral: walks the preferred
// channel types in order and returns the first ACTIVE connection of THIS
// business whose adapter says it can start a conversation with this number
// right now. "Configured" is not enough — the adapter's capability decides
// (a real WhatsApp adapter will check template / consent / window there).
// Never falls back to a channel type that isn't in the priority list.
// ---------------------------------------------------------------------------

type Blocked = Extract<BusinessInitiatedCapability, { eligible: false }>['reason']

export type RecoveryChannelChoice =
  | { ok: true; connection: ChannelConnection }
  | { ok: false; blocked: { channelType: ChannelType; reason: Blocked }[] }

export async function selectRecoveryChannel(scope: { tenantId: string; businessId: string }, destinationE164: string): Promise<RecoveryChannelChoice> {
  const connections = await channelConnectionRepository.list(scope.tenantId, scope.businessId)
  const blocked: { channelType: ChannelType; reason: Blocked }[] = []

  for (const channelType of RECOVERY_CHANNEL_PRIORITY) {
    const candidates = connections.filter((c) => c.type === channelType && c.status === 'ACTIVE')
    if (candidates.length === 0) {
      blocked.push({ channelType, reason: 'NOT_CONFIGURED' })
      continue
    }
    for (const connection of candidates) {
      const adapter = getChannelAdapter(connection.type)
      const capability: BusinessInitiatedCapability = adapter.businessInitiatedCapability?.(destinationE164) ?? {
        eligible: false,
        reason: 'BUSINESS_INITIATION_NOT_PERMITTED',
      }
      if (capability.eligible) return { ok: true, connection }
      blocked.push({ channelType, reason: capability.reason })
    }
  }
  return { ok: false, blocked }
}
