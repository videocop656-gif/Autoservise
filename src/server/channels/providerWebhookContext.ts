import type { ChannelConnection } from '@prisma/client'
import type { AuthContext } from '../types/auth'
import { tenantRepository } from '../repositories/tenantRepository'
import { businessRepository } from '../repositories/businessRepository'

/**
 * MCR-7B1 — the tenant/business context of an authenticated provider webhook
 * (Twilio WhatsApp), resolved ONLY from the connection its trusted receiving
 * sender routed to — the same pattern as telegramWebhookContext.ts. `user`
 * is a synthetic, never-persisted placeholder: the inbound pipeline
 * (receiveIncoming) reads only its role, and records the CUSTOMER as sender.
 */
export async function resolveProviderWebhookContext(connection: Pick<ChannelConnection, 'tenantId' | 'businessId' | 'createdAt' | 'updatedAt'>, actor: string): Promise<AuthContext | null> {
  const tenant = await tenantRepository.findById(connection.tenantId)
  if (!tenant) return null
  const business = await businessRepository.findFirstByTenant(connection.tenantId)
  if (!business || business.id !== connection.businessId) return null
  return {
    user: { id: actor, tenantId: tenant.id, email: `${actor}@internal`, name: actor, role: 'owner', createdAt: connection.createdAt, updatedAt: connection.updatedAt },
    tenant,
    business,
    sessionId: actor,
  }
}
