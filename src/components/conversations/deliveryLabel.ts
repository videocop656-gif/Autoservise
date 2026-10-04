import type { ChannelDeliveryDto } from './shared'

// ---------------------------------------------------------------------------
// MCR-7A — what an operator sees about one outbound message's delivery.
// Pure (unit-tested). Raw provider codes ("DELIVRD") never appear here; they
// stay in the DTO as technical detail.
//
//   SENT = the provider ACCEPTED the message; carrier delivery comes later
//   (providerDeliveryState, from delivery reports).
// ---------------------------------------------------------------------------

export type DeliveryBadgeVariant = 'success' | 'warning' | 'destructive' | 'default'

export function deliveryLabel(delivery: Pick<ChannelDeliveryDto, 'status' | 'errorCode' | 'provider' | 'providerDeliveryState'>): { label: string; variant: DeliveryBadgeVariant } {
  if (delivery.status === 'FAILED') return { label: 'Ошибка доставки', variant: 'destructive' }
  if (delivery.status !== 'SENT') {
    // SENDING with DELIVERY_UNCERTAIN: the provider may have it — never resent automatically.
    if (delivery.errorCode === 'DELIVERY_UNCERTAIN') return { label: 'Отправка не подтверждена', variant: 'warning' }
    return { label: 'Отправляется', variant: 'default' }
  }
  switch (delivery.providerDeliveryState) {
    case 'DELIVERED':
      return { label: 'Доставлено', variant: 'success' }
    case 'PARTIALLY_DELIVERED':
      return { label: 'Доставлено частично', variant: 'warning' }
    case 'UNDELIVERED':
    case 'EXPIRED':
    case 'REJECTED':
      return { label: 'Не доставлено', variant: 'destructive' }
    case 'ACCEPTED':
      return { label: 'Принято оператором', variant: 'success' }
    default:
      // Providers with delivery reports (SMS): accepted, report pending.
      return delivery.provider === 'mobizon' ? { label: 'Принято оператором', variant: 'success' } : { label: 'Отправлено', variant: 'success' }
  }
}
