import type { ChannelConnection, ChannelType } from '@prisma/client'
import { channelConnectionRepository } from '../repositories/channelConnectionRepository'
import { channelConsentRepository, customerServiceWindowRepository } from '../repositories/recoveryRoutingRepository'
import { getChannelAdapter } from '../channels/channelAdapterRegistry'
import type { BusinessInitiatedCapability } from '../channels/types'
import { WHATSAPP_CUSTOMER_SERVICE_WINDOW_HOURS, recoveryThreadKey } from './policy'
import { MISSED_CALL_RECOVERY_V1 } from './templates'
import { publicBridgeBaseUrl, whatsappEntryPhone } from './bridge'

// ---------------------------------------------------------------------------
// MCR-6 — the ONE Recovery Channel Router. Provider-neutral: it speaks
// WHATSAPP / SMS, never Twilio / Meta / Mobizon. Four separate questions per
// channel, never merged into one boolean:
//
//   capability  — is a provider configured and reachable for this number?
//                 (adapter.businessInitiatedCapability — technical only)
//   consent     — recorded permission to initiate (ChannelConsent; no row =
//                 UNKNOWN, and UNKNOWN is NOT permission)
//   session     — is the WhatsApp customer-service window open (the customer's
//                 own last authoritative inbound WhatsApp message < 24 h ago)?
//   template    — does the provider have an approved recovery template?
//
// Policy (fail safe):
//   1. WHATSAPP when technically available, not opted out, AND (session open
//      OR (consent OPTED_IN AND approved template)).
//   2. else SMS_BRIDGE when SMS is technically available, not opted out, the
//      business has a WhatsApp customer entry and a public bridge URL.
//   3. else NO_ELIGIBLE_CHANNEL.
// Telegram is never a candidate. A missed call is never consent.
// ---------------------------------------------------------------------------

export type ConsentState = 'UNKNOWN' | 'OPTED_IN' | 'OPTED_OUT'

export type WhatsAppEligibilityReason =
  | 'NOT_CONFIGURED'
  | 'PROVIDER_UNAVAILABLE'
  | 'INVALID_DESTINATION'
  | 'OPTED_OUT'
  | 'SESSION_OPEN'
  | 'TEMPLATE_AVAILABLE'
  | 'TEMPLATE_UNAVAILABLE'
  | 'NO_RECORDED_CONSENT'

export type SmsEligibilityReason =
  | 'NOT_CONFIGURED'
  | 'PROVIDER_UNAVAILABLE'
  | 'INVALID_DESTINATION'
  | 'OPTED_OUT'
  | 'WHATSAPP_ENTRY_NOT_CONFIGURED'
  | 'BRIDGE_URL_NOT_CONFIGURED'
  | 'AVAILABLE'

interface EligibilityBase {
  technicallyAvailable: boolean
  consent: ConsentState
  initiationPermitted: boolean
  connection: ChannelConnection | null
}
export interface WhatsAppEligibility extends EligibilityBase {
  channel: 'WHATSAPP'
  sessionOpen: boolean
  approvedRecoveryTemplateAvailable: boolean
  reason: WhatsAppEligibilityReason
}
export interface SmsEligibility extends EligibilityBase {
  channel: 'SMS'
  whatsappEntryPhoneE164: string | null
  reason: SmsEligibilityReason
}

export type RecoveryRouteDecision =
  | { ok: true; route: 'WHATSAPP'; connection: ChannelConnection; reason: string; whatsapp: WhatsAppEligibility; sms: SmsEligibility | null }
  | { ok: true; route: 'SMS_BRIDGE'; connection: ChannelConnection; reason: string; bridgeBaseUrl: string; whatsapp: WhatsAppEligibility; sms: SmsEligibility }
  | { ok: false; reason: string; whatsapp: WhatsAppEligibility; sms: SmsEligibility }

type Scope = { tenantId: string; businessId: string }
type CapabilityReason = Extract<BusinessInitiatedCapability, { eligible: false }>['reason']

/** First ACTIVE connection of the type whose adapter is technically able; else the reason the first one gave. */
function capableConnection(connections: ChannelConnection[], type: ChannelType, destinationE164: string): { connection: ChannelConnection } | { reason: CapabilityReason | 'NOT_CONFIGURED' } {
  const candidates = connections.filter((c) => c.type === type && c.status === 'ACTIVE')
  if (candidates.length === 0) return { reason: 'NOT_CONFIGURED' }
  let firstReason: CapabilityReason | null = null
  for (const connection of candidates) {
    const capability = getChannelAdapter(connection.type).businessInitiatedCapability?.(destinationE164) ?? { eligible: false as const, reason: 'BUSINESS_INITIATION_NOT_PERMITTED' as const }
    if (capability.eligible) return { connection }
    firstReason ??= capability.reason
  }
  return { reason: firstReason ?? 'PROVIDER_UNAVAILABLE' }
}

/** Adapter reasons → the router's reason vocabulary (technical unavailability only). */
function technicalReason(reason: CapabilityReason | 'NOT_CONFIGURED'): 'NOT_CONFIGURED' | 'PROVIDER_UNAVAILABLE' | 'INVALID_DESTINATION' {
  return reason === 'NOT_CONFIGURED' || reason === 'INVALID_DESTINATION' ? reason : 'PROVIDER_UNAVAILABLE'
}

async function consentOf(scope: Scope, channel: ChannelType, destinationE164: string): Promise<ConsentState> {
  const row = await channelConsentRepository.find(scope.tenantId, scope.businessId, channel, destinationE164)
  return row?.status ?? 'UNKNOWN'
}

/** isCustomerServiceWindowOpen(business, destination, WHATSAPP, now) — derived from authoritative inbound messages. */
export async function isWhatsAppSessionOpen(scope: Scope, destinationE164: string, now: Date): Promise<boolean> {
  const last = await customerServiceWindowRepository.latestInboundAt(scope.tenantId, scope.businessId, 'WHATSAPP', recoveryThreadKey(destinationE164))
  return !!last && last.getTime() > now.getTime() - WHATSAPP_CUSTOMER_SERVICE_WINDOW_HOURS * 3_600_000
}

export async function evaluateWhatsApp(scope: Scope, connections: ChannelConnection[], destinationE164: string, now: Date): Promise<WhatsAppEligibility> {
  const base = { channel: 'WHATSAPP' as const, sessionOpen: false, approvedRecoveryTemplateAvailable: false, initiationPermitted: false }
  const capable = capableConnection(connections, 'WHATSAPP', destinationE164)
  const consent = await consentOf(scope, 'WHATSAPP', destinationE164)
  if (!('connection' in capable)) return { ...base, technicallyAvailable: false, consent, connection: null, reason: technicalReason(capable.reason) }
  const { connection } = capable
  const sessionOpen = await isWhatsAppSessionOpen(scope, destinationE164, now)
  const approvedRecoveryTemplateAvailable = getChannelAdapter('WHATSAPP').recoveryTemplateAvailable?.(connection, MISSED_CALL_RECOVERY_V1) ?? false
  const facts = { ...base, technicallyAvailable: true, consent, connection, sessionOpen, approvedRecoveryTemplateAvailable }
  if (consent === 'OPTED_OUT') return { ...facts, reason: 'OPTED_OUT' }
  if (sessionOpen) return { ...facts, initiationPermitted: true, reason: 'SESSION_OPEN' }
  if (consent === 'OPTED_IN') {
    return approvedRecoveryTemplateAvailable ? { ...facts, initiationPermitted: true, reason: 'TEMPLATE_AVAILABLE' } : { ...facts, reason: 'TEMPLATE_UNAVAILABLE' }
  }
  return { ...facts, reason: 'NO_RECORDED_CONSENT' }
}

export async function evaluateSms(scope: Scope, connections: ChannelConnection[], destinationE164: string): Promise<SmsEligibility> {
  const capable = capableConnection(connections, 'SMS', destinationE164)
  const consent = await consentOf(scope, 'SMS', destinationE164)
  const whatsappEntryPhoneE164 = whatsappEntryPhone(connections)
  const base = { channel: 'SMS' as const, consent, whatsappEntryPhoneE164, initiationPermitted: false }
  if (!('connection' in capable)) return { ...base, technicallyAvailable: false, connection: null, reason: technicalReason(capable.reason) }
  const facts = { ...base, technicallyAvailable: true, connection: capable.connection }
  if (consent === 'OPTED_OUT') return { ...facts, reason: 'OPTED_OUT' }
  if (!whatsappEntryPhoneE164) return { ...facts, reason: 'WHATSAPP_ENTRY_NOT_CONFIGURED' }
  if (!publicBridgeBaseUrl()) return { ...facts, reason: 'BRIDGE_URL_NOT_CONFIGURED' }
  return { ...facts, initiationPermitted: true, reason: 'AVAILABLE' }
}

export async function selectRecoveryChannel(scope: Scope, destinationE164: string, now: Date = new Date()): Promise<RecoveryRouteDecision> {
  const connections = await channelConnectionRepository.list(scope.tenantId, scope.businessId)
  const whatsapp = await evaluateWhatsApp(scope, connections, destinationE164, now)
  if (whatsapp.initiationPermitted && whatsapp.connection) {
    return { ok: true, route: 'WHATSAPP', connection: whatsapp.connection, reason: `WHATSAPP_${whatsapp.reason}`, whatsapp, sms: null }
  }
  const sms = await evaluateSms(scope, connections, destinationE164)
  const bridgeBaseUrl = publicBridgeBaseUrl()
  if (sms.initiationPermitted && sms.connection && bridgeBaseUrl) {
    // The reason records why WhatsApp was NOT used for the first message.
    return { ok: true, route: 'SMS_BRIDGE', connection: sms.connection, reason: `WHATSAPP_${whatsapp.reason}`, bridgeBaseUrl, whatsapp, sms }
  }
  return { ok: false, reason: `WHATSAPP_${whatsapp.reason}|SMS_${sms.reason}`, whatsapp, sms }
}
