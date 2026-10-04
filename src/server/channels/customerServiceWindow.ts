import { customerServiceWindowRepository } from '../repositories/recoveryRoutingRepository'
import { WHATSAPP_CUSTOMER_SERVICE_WINDOW_HOURS, recoveryThreadKey } from '../recovery/policy'

// ---------------------------------------------------------------------------
// MCR-6 / MCR-7B1 — the WhatsApp customer-service window, in ONE place.
//
// Open while the customer's last AUTHORITATIVE inbound WhatsApp message
// (received through the channel pipeline — a real Twilio webhook, or the
// mock pipeline in dev/test) is younger than
// WHATSAPP_CUSTOMER_SERVICE_WINDOW_HOURS. Boundary: open for t < T0 + 24 h,
// closed at exactly T0 + 24 h. A bridge click, a missed call or an SMS never
// opens it. Used by the recovery router (may we initiate?) and by the
// delivery core (may we send free-form text?).
// ---------------------------------------------------------------------------

export async function isWhatsAppSessionOpen(scope: { tenantId: string; businessId: string }, destinationE164: string, now: Date): Promise<boolean> {
  const last = await customerServiceWindowRepository.latestInboundAt(scope.tenantId, scope.businessId, 'WHATSAPP', recoveryThreadKey(destinationE164))
  return !!last && now.getTime() < last.getTime() + WHATSAPP_CUSTOMER_SERVICE_WINDOW_HOURS * 3_600_000
}
