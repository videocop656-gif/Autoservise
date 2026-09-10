// ---------------------------------------------------------------------------
// Prompt 26 — Vehicle Context v1. Shared types/helpers between the vehicle
// list (VehiclesSettingsPage.tsx) and VehicleDetailPanel.tsx. Customer and
// CustomerRequest shapes/labels/helpers are the exact same backend truth
// already declared in components/conversations/shared.ts; the service-record
// shape and its date formatter are the same ones already declared in
// components/clients/shared.ts (Client Detail's own Service History block) —
// reused from both instead of redeclared, so nothing here drifts from those.
// ---------------------------------------------------------------------------

export type { CustomerRefDto, CustomerRequestRefDto, CustomerRequestStatus, Paginated } from '../conversations/shared'
export { customerName, REQUEST_STATUS_LABELS, formatActivity } from '../conversations/shared'
export type { ServiceRecordDto } from '../clients/shared'
export { formatDate, vehicleLabel } from '../clients/shared'

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
  createdAt: string
  updatedAt: string
}
