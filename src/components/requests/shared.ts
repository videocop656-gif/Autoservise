// ---------------------------------------------------------------------------
// Prompt 24 — Customer Requests v1. Shared types/helpers between the
// requests list (CustomerRequestsSettingsPage.tsx) and RequestDetailPanel.tsx.
// Customer/Vehicle/Service reference shapes, the real CustomerRequestStatus
// enum + its canonical Russian labels, Conversation/Escalation shapes, and
// the attention/formatting helpers are the exact same backend truth already
// declared in components/conversations/shared.ts — reused from there
// instead of redeclared, so status wording and formatting never drift
// between the Conversations, Clients, and Requests screens.
// ---------------------------------------------------------------------------

export type {
  CustomerRefDto,
  VehicleRefDto,
  ServiceRefDto,
  ConversationDto,
  EscalationDto,
  EscalationPriority,
  CustomerRequestStatus,
  Paginated,
} from '../conversations/shared'
export {
  REQUEST_STATUS_LABELS,
  customerName,
  vehicleLabel,
  serviceName,
  formatActivity,
  attentionBadgeVariant,
  isActiveEscalation,
} from '../conversations/shared'

import type { CustomerRequestStatus } from '../conversations/shared'

export type CustomerRequestSource = 'PHONE' | 'WEBSITE' | 'MANUAL' | 'OTHER'

export const SOURCE_LABELS: Record<CustomerRequestSource, string> = {
  PHONE: 'Телефон',
  WEBSITE: 'Сайт',
  MANUAL: 'Вручную',
  OTHER: 'Другое',
}

export interface StatusHistoryDto {
  fromStatus: CustomerRequestStatus | null
  toStatus: CustomerRequestStatus
  changedByUserId: string | null
  changedByUserName: string | null
  createdAt: string
}

export interface CustomerRequestDto {
  id: string
  customerId: string
  vehicleId: string | null
  serviceId: string | null
  appointmentId: string | null
  source: CustomerRequestSource
  status: CustomerRequestStatus
  subject: string
  description: string | null
  requestedDate: string | null
  requestedTimeFrom: string | null
  requestedTimeTo: string | null
  notes: string | null
  createdAt: string
  updatedAt: string
  // Only present on the single-GET response (same convention as
  // ConversationDto/AiEscalationDto elsewhere) — list items omit it.
  statusHistory?: StatusHistoryDto[]
}
