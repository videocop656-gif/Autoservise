// ---------------------------------------------------------------------------
// Prompt 28 — Appointment Detail v1. Shared types/helpers between the
// appointments list (AppointmentsSettingsPage.tsx) and
// AppointmentDetailPanel.tsx. Customer/Vehicle/Service reference shapes,
// CustomerRequestRefDto, and formatActivity are the exact same backend
// truth already declared in components/conversations/shared.ts;
// AppointmentStatus/APPOINTMENT_STATUS_LABELS are the exact same ones
// already declared in components/requests/shared.ts (added there in
// Prompt 27 for Request Detail's "Запись" section) — reused from both
// instead of redeclared, so labels/formatting never drift between screens.
// ---------------------------------------------------------------------------

export type {
  CustomerRefDto,
  VehicleRefDto,
  ServiceRefDto,
  CustomerRequestRefDto,
  Paginated,
} from '../conversations/shared'
export { customerName, serviceName, formatActivity } from '../conversations/shared'
export type { AppointmentStatus } from '../requests/shared'
export { APPOINTMENT_STATUS_LABELS, REQUEST_STATUS_LABELS } from '../requests/shared'
export type { ServiceRecordDto } from '../clients/shared'
// vehicleLabel takes a single vehicle object here (Appointment/Client
// Detail both already resolve one specific VehicleRefDto before calling
// it) — the same single-object helper Client/Vehicle Detail already use,
// not the (vehicles[], id) lookup form conversations/shared exports for
// list-row rendering.
export { formatDate, vehicleLabel } from '../clients/shared'

import type { AppointmentStatus } from '../requests/shared'

export interface AppointmentDto {
  id: string
  customerId: string
  vehicleId: string
  serviceId: string
  startAt: string
  endAt: string
  status: AppointmentStatus
  notes: string | null
  createdAt: string
  updatedAt: string
}

// Frontend mirror of appointmentService.ts's own ALLOWED_TRANSITIONS table
// (audited directly from that file, not guessed) — same convention as
// Prompt 27's request NEXT_STATUSES. The backend remains the sole
// enforcer; this only avoids offering a transition it would reject.
// COMPLETED/CANCELLED/NO_SHOW are real terminal states.
export const APPOINTMENT_NEXT_STATUSES: Record<AppointmentStatus, AppointmentStatus[]> = {
  SCHEDULED: ['CONFIRMED', 'IN_PROGRESS', 'CANCELLED', 'NO_SHOW'],
  CONFIRMED: ['IN_PROGRESS', 'CANCELLED', 'NO_SHOW'],
  IN_PROGRESS: ['COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
  NO_SHOW: [],
}

export function isAppointmentTerminal(status: AppointmentStatus): boolean {
  return APPOINTMENT_NEXT_STATUSES[status].length === 0
}
