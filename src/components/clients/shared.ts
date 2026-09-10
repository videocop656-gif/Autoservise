// ---------------------------------------------------------------------------
// Prompt 23 — Clients v1. Shared types/helpers between the client list
// (CustomersSettingsPage.tsx) and ClientDetailPanel.tsx. Conversation- and
// request-related shapes/labels are the exact same backend enums already
// declared in components/conversations/shared.ts — imported from there
// instead of re-declared, so the two feature areas never drift apart on
// what is, underneath, the identical Conversation/CustomerRequest data.
// ---------------------------------------------------------------------------

export type { ConversationChannel, ConversationDto, CustomerRequestStatus } from '../conversations/shared'
export { CHANNEL_LABELS, REQUEST_STATUS_LABELS, formatActivity } from '../conversations/shared'

export interface CustomerDto {
  id: string
  firstName: string
  lastName: string | null
  phone: string
  email: string | null
  notes: string | null
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export interface VehicleDto {
  id: string
  customerId: string
  make: string
  model: string
  year: number | null
  licensePlate: string | null
  vin: string | null
  mileage: number | null
  notes: string | null
  isActive: boolean
}

export interface CustomerRequestDto {
  id: string
  customerId: string
  subject: string
  status: import('../conversations/shared').CustomerRequestStatus
  createdAt: string
}

export interface ServiceRecordDto {
  id: string
  customerId: string
  vehicleId: string
  appointmentId: string | null
  performedAt: string
  workDescription: string
  totalPrice: string
  currency: string
}

export interface Paginated<T> {
  items: T[]
  page: number
  pageSize: number
  total: number
  totalPages: number
}

export function customerDisplayName(customer: Pick<CustomerDto, 'firstName' | 'lastName'>): string {
  return `${customer.firstName} ${customer.lastName ?? ''}`.trim()
}

export function vehicleLabel(vehicle: Pick<VehicleDto, 'make' | 'model' | 'year'>): string {
  return [vehicle.make, vehicle.model, vehicle.year ? `(${vehicle.year})` : null].filter(Boolean).join(' ')
}

/** "12.08.2026" — a plain calendar date, used for service history rows (no time-of-day is meaningful there). */
export function formatDate(iso: string): string {
  return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(iso))
}
