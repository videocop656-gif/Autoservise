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
  EscalationStatus,
  EscalationPriority,
  CustomerRequestStatus,
  Paginated,
} from '../conversations/shared'
export {
  REQUEST_STATUS_LABELS,
  ESCALATION_STATUS_LABELS,
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

// ---------------------------------------------------------------------------
// Prompt 27 — Request Lifecycle v2.
//
// A frontend mirror of customerRequestService.ts's own ALLOWED_TRANSITIONS
// table (audited directly from that file, not guessed) — the backend is
// still the sole enforcer (this only prevents offering a transition the
// server would reject anyway). Keep in sync if the backend table changes.
// CONVERTED/CLOSED/CANCELLED are real terminal states: no outgoing
// transitions exist for them server-side.
// ---------------------------------------------------------------------------
export const NEXT_STATUSES: Record<CustomerRequestStatus, CustomerRequestStatus[]> = {
  NEW: ['IN_PROGRESS', 'CLOSED', 'CANCELLED'],
  IN_PROGRESS: ['WAITING_CUSTOMER', 'QUALIFIED', 'CLOSED', 'CANCELLED'],
  WAITING_CUSTOMER: ['IN_PROGRESS', 'CLOSED', 'CANCELLED'],
  QUALIFIED: ['CONVERTED', 'CLOSED', 'CANCELLED'],
  CONVERTED: [],
  CLOSED: [],
  CANCELLED: [],
}

export function isTerminalStatus(status: CustomerRequestStatus): boolean {
  return NEXT_STATUSES[status].length === 0
}

// CONVERTED's real meaning (audited from customerRequestService.ts): a
// request may only become CONVERTED once it already references a real,
// existing Appointment (`appointmentId`) — the backend rejects the
// transition otherwise. This is the actual, existing downstream entity;
// no WorkOrder/Job/ServiceOrder model exists anywhere in this codebase.
export type AppointmentStatus = 'SCHEDULED' | 'CONFIRMED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW'

export const APPOINTMENT_STATUS_LABELS: Record<AppointmentStatus, string> = {
  SCHEDULED: 'Запланирована',
  CONFIRMED: 'Подтверждена',
  IN_PROGRESS: 'Выполняется',
  COMPLETED: 'Завершена',
  CANCELLED: 'Отменена',
  NO_SHOW: 'Клиент не пришёл',
}

/** Just enough of AppointmentDto for the "куда ведёт CONVERTED" summary — no vehicle/service/customer fields, those are already known from the request itself. */
export interface AppointmentSummaryDto {
  id: string
  startAt: string
  endAt: string
  status: AppointmentStatus
}
