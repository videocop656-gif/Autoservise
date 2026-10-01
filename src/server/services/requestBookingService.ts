import type { Appointment, AppointmentStatus, Customer, CustomerRequest, CustomerRequestStatus, Service, Vehicle } from '@prisma/client'
import type { AuthContext } from '../types/auth'
import { ApiError } from '../lib/errors'
import { requireRole } from '../middleware/requireRole'
import { toBusinessLocalDateTime } from '../lib/timezone'
import { customerRequestRepository } from '../repositories/customerRequestRepository'
import { customerRepository } from '../repositories/customerRepository'
import { vehicleRepository } from '../repositories/vehicleRepository'
import { serviceRepository } from '../repositories/serviceRepository'
import { appointmentRepository } from '../repositories/appointmentRepository'
import { serviceFollowUpRepository } from '../repositories/serviceFollowUpRepository'
import { createAppointment, WORKING_HOURS_ERROR_MESSAGES } from './appointmentService'
import { canTransitionRequest, TERMINAL_REQUEST_STATUSES } from './customerRequestService'
import { CAPACITY_EXCEEDED_CODE } from '../domain/capacity'

// ---------------------------------------------------------------------------
// Prompt 56 — Booking confirmation from a CustomerRequest.
//
// The persisted request is the only source of what gets booked: its
// customer, vehicle and service (never ids from the browser, never the AI
// proposal of Prompt 55). The operator supplies one thing — the start time
// of a slot the availability endpoint offered — and the end follows from
// the service duration, exactly like the slot generator.
//
// There is no second booking path: the appointment is created by the
// canonical createAppointment (ownership/active checks, working hours,
// vehicle conflict and service-bay capacity under the per-business lock).
// Its transaction hooks make the conversion atomic:
//   afterLock   — lock the request row, re-read it: already linked → the
//                 existing appointment is returned (idempotent); changed
//                 since the operator looked → 409, nothing written;
//   afterCreate — link the appointment (compare-and-set on
//                 appointmentId IS NULL + status) and, where the request
//                 lifecycle allows it (QUALIFIED → CONVERTED), convert it
//                 with its history row and the Prompt 48 follow-up hook.
// Any failure rolls back the appointment and the link together. Nothing is
// sent to the customer.
// ---------------------------------------------------------------------------

export type BookingState = 'booked' | 'ready' | 'not_ready' | 'closed' | 'inconsistent'

export interface RequestBookingView {
  requestId: string
  requestStatus: CustomerRequestStatus
  requestUpdatedAt: Date
  timezone: string
  state: BookingState
  /** Russian labels of what the appointment domain still needs, e.g. «автомобиль». */
  missing: string[]
  /** Will a successful booking also mark the request CONVERTED (existing transition rules)? */
  convertsRequest: boolean
  customer: { id: string; name: string; phone: string; isActive: boolean }
  vehicle: { id: string; label: string; isActive: boolean } | null
  service: { id: string; name: string; durationMinutes: number; isActive: boolean } | null
  /** The customer's wish — never a reservation. Business-local values. */
  preference: { date: string | null; timeFrom: string | null; timeTo: string | null }
  appointment: {
    id: string
    startAt: Date
    endAt: Date
    status: AppointmentStatus
    localDate: string
    localStart: string
    localEnd: string
    vehicleLabel: string | null
    serviceName: string | null
  } | null
}

export const BOOKING_MESSAGES = {
  NOT_READY: 'Для записи не хватает данных.',
  SERVICE_INACTIVE: 'Услуга больше недоступна для записи. Выберите другую услугу.',
  VEHICLE_INACTIVE: 'Автомобиль неактивен — записать его нельзя.',
  CUSTOMER_INACTIVE: 'Клиент неактивен — записать его нельзя.',
  STALE: 'Данные заявки изменились. Обновите страницу и попробуйте ещё раз.',
  FINISHED: 'Заявка закрыта — создать запись по ней нельзя.',
  INCONSISTENT: 'Заявка отмечена как преобразованная, но запись не найдена. Новая запись не создаётся — проверьте заявку.',
  TIME_PASSED: 'Это время уже прошло. Выберите другое свободное время.',
  CAPACITY: 'Это время уже занято. Выберите другое свободное время.',
  VEHICLE_CONFLICT: 'Автомобиль уже записан на это время. Выберите другое свободное время.',
  OUTSIDE_HOURS: 'Это время вне рабочих часов автосервиса. Выберите другое свободное время.',
} as const

export function vehicleDisplayLabel(vehicle: Pick<Vehicle, 'make' | 'model' | 'year' | 'licensePlate'>): string {
  const base = [vehicle.make, vehicle.model].filter(Boolean).join(' ')
  const withYear = vehicle.year ? `${base} (${vehicle.year})` : base
  return vehicle.licensePlate ? `${withYear} · ${vehicle.licensePlate}` : withYear
}

/**
 * What the Appointment domain requires that this request doesn't have yet.
 * Mirrors createAppointment's own rules — an active customer, an active
 * vehicle of that customer, an active service — and nothing more: no VIN,
 * plate, email or preferred date (the operator picks the date in the slot
 * picker; the request's date is only a wish).
 */
export function bookingMissing(
  customer: Pick<Customer, 'isActive'> | null,
  vehicle: Pick<Vehicle, 'isActive'> | null,
  service: Pick<Service, 'isActive'> | null
): string[] {
  const missing: string[] = []
  if (!customer) missing.push('клиент')
  else if (!customer.isActive) missing.push('активный клиент')
  if (!vehicle) missing.push('автомобиль')
  else if (!vehicle.isActive) missing.push('активный автомобиль')
  if (!service) missing.push('услуга')
  else if (!service.isActive) missing.push('активная услуга')
  return missing
}

/** QUALIFIED → CONVERTED is the request lifecycle's only way into CONVERTED; other statuses keep theirs. */
export function bookingTargetStatus(status: CustomerRequestStatus): CustomerRequestStatus {
  return canTransitionRequest(status, 'CONVERTED') ? 'CONVERTED' : status
}

function dateKeyOf(requestedDate: Date | null): string | null {
  // requestedDate is stored as UTC midnight of the business-local date.
  return requestedDate ? requestedDate.toISOString().slice(0, 10) : null
}

async function loadRefs(ctx: AuthContext, request: Pick<CustomerRequest, 'customerId' | 'vehicleId' | 'serviceId'>) {
  const [customer, vehicle, service] = await Promise.all([
    customerRepository.findById(ctx.tenant.id, ctx.business.id, request.customerId),
    request.vehicleId ? vehicleRepository.findById(ctx.tenant.id, ctx.business.id, request.vehicleId) : Promise.resolve(null),
    request.serviceId ? serviceRepository.findById(ctx.tenant.id, ctx.business.id, request.serviceId) : Promise.resolve(null),
  ])
  return { customer, vehicle, service }
}

async function appointmentView(ctx: AuthContext, appointment: Appointment): Promise<NonNullable<RequestBookingView['appointment']>> {
  const tz = ctx.business.timezone
  const [vehicle, service] = await Promise.all([
    vehicleRepository.findById(ctx.tenant.id, ctx.business.id, appointment.vehicleId),
    serviceRepository.findById(ctx.tenant.id, ctx.business.id, appointment.serviceId),
  ])
  const start = toBusinessLocalDateTime(appointment.startAt, tz)
  const end = toBusinessLocalDateTime(appointment.endAt, tz)
  return {
    id: appointment.id,
    startAt: appointment.startAt,
    endAt: appointment.endAt,
    status: appointment.status,
    localDate: start.dateKey,
    localStart: start.timeKey,
    localEnd: end.timeKey,
    vehicleLabel: vehicle ? vehicleDisplayLabel(vehicle) : null,
    serviceName: service?.name ?? null,
  }
}

async function buildView(ctx: AuthContext, request: CustomerRequest): Promise<RequestBookingView> {
  const { customer, vehicle, service } = await loadRefs(ctx, request)
  const linked = request.appointmentId ? await appointmentRepository.findById(ctx.tenant.id, ctx.business.id, request.appointmentId) : null
  const missing = bookingMissing(customer, vehicle, service)

  let state: BookingState
  if (linked) state = 'booked'
  else if (request.appointmentId || request.status === 'CONVERTED') state = 'inconsistent'
  else if (TERMINAL_REQUEST_STATUSES.includes(request.status)) state = 'closed'
  else state = missing.length === 0 ? 'ready' : 'not_ready'

  return {
    requestId: request.id,
    requestStatus: request.status,
    requestUpdatedAt: request.updatedAt,
    timezone: ctx.business.timezone,
    state,
    missing,
    convertsRequest: bookingTargetStatus(request.status) === 'CONVERTED',
    customer: {
      id: request.customerId,
      name: customer ? `${customer.firstName} ${customer.lastName ?? ''}`.trim() : '—',
      phone: customer?.phone ?? '',
      isActive: customer?.isActive ?? false,
    },
    vehicle: vehicle ? { id: vehicle.id, label: vehicleDisplayLabel(vehicle), isActive: vehicle.isActive } : null,
    service: service ? { id: service.id, name: service.name, durationMinutes: service.durationMinutes, isActive: service.isActive } : null,
    preference: { date: dateKeyOf(request.requestedDate), timeFrom: request.requestedTimeFrom, timeTo: request.requestedTimeTo },
    appointment: linked ? await appointmentView(ctx, linked) : null,
  }
}

async function loadRequest(ctx: AuthContext, requestId: string): Promise<CustomerRequest> {
  const request = await customerRequestRepository.findById(ctx.tenant.id, ctx.business.id, requestId)
  if (!request) {
    throw new ApiError(404, 'NOT_FOUND', 'Заявка не найдена.')
  }
  return request
}

/** Read-only booking state of one request — what both Request Detail and Conversation Detail show. */
export async function getRequestBooking(ctx: AuthContext, requestId: string): Promise<RequestBookingView> {
  return buildView(ctx, await loadRequest(ctx, requestId))
}

export interface ConfirmBookingInput {
  startAt: Date
  /** request.updatedAt the operator's screen was built from. */
  expectedRequestUpdatedAt: Date
}

export interface ConfirmBookingResult {
  booking: RequestBookingView
  /** false: the request was already booked (double click, second tab) — nothing new was created. */
  created: boolean
}

/** Internal: the locked re-read found the request already linked. */
class AlreadyBooked extends Error {}

/** Translates the canonical booking errors into the operator's language; the codes stay. */
function toBookingError(err: unknown): unknown {
  if (!(err instanceof ApiError)) return err
  if (err.code === CAPACITY_EXCEEDED_CODE) return new ApiError(409, CAPACITY_EXCEEDED_CODE, BOOKING_MESSAGES.CAPACITY)
  if (err.code === 'APPOINTMENT_CONFLICT') return new ApiError(409, 'APPOINTMENT_CONFLICT', BOOKING_MESSAGES.VEHICLE_CONFLICT)
  if (err.statusCode === 400 && WORKING_HOURS_ERROR_MESSAGES.includes(err.message)) {
    return new ApiError(409, 'OUTSIDE_WORKING_HOURS', BOOKING_MESSAGES.OUTSIDE_HOURS)
  }
  if (err.statusCode === 400 && err.message === 'Service is not active') return new ApiError(400, 'SERVICE_INACTIVE', BOOKING_MESSAGES.SERVICE_INACTIVE)
  if (err.statusCode === 400 && err.message === 'Vehicle is not active') return new ApiError(400, 'VEHICLE_INACTIVE', BOOKING_MESSAGES.VEHICLE_INACTIVE)
  if (err.statusCode === 400 && err.message === 'Customer is not active') return new ApiError(400, 'CUSTOMER_INACTIVE', BOOKING_MESSAGES.CUSTOMER_INACTIVE)
  return err
}

/**
 * The mutation boundary: books the request's own customer/vehicle/service
 * at `startAt` and links the appointment to the request, atomically. At
 * most one appointment per request — a repeated or concurrent confirmation
 * returns the existing one (created: false).
 */
export async function confirmRequestBooking(ctx: AuthContext, requestId: string, input: ConfirmBookingInput): Promise<ConfirmBookingResult> {
  requireRole(ctx, 'owner', 'admin', 'manager')

  const request = await loadRequest(ctx, requestId)

  // Already booked: show it, never book again.
  if (request.appointmentId) {
    const view = await buildView(ctx, request)
    if (view.state === 'booked') return { booking: view, created: false }
    throw new ApiError(409, 'REQUEST_INCONSISTENT', BOOKING_MESSAGES.INCONSISTENT)
  }
  if (request.status === 'CONVERTED') throw new ApiError(409, 'REQUEST_INCONSISTENT', BOOKING_MESSAGES.INCONSISTENT)
  if (TERMINAL_REQUEST_STATUSES.includes(request.status)) throw new ApiError(409, 'REQUEST_FINISHED', BOOKING_MESSAGES.FINISHED)
  if (request.updatedAt.getTime() !== input.expectedRequestUpdatedAt.getTime()) {
    throw new ApiError(409, 'BOOKING_STALE', BOOKING_MESSAGES.STALE)
  }

  const { customer, vehicle, service } = await loadRefs(ctx, request)
  if (!customer || !vehicle || !service) {
    const missing = bookingMissing(customer, vehicle, service)
    throw new ApiError(400, 'BOOKING_NOT_READY', `Для записи не хватает: ${missing.join(', ')}.`, { missing })
  }
  if (!service.isActive) throw new ApiError(400, 'SERVICE_INACTIVE', BOOKING_MESSAGES.SERVICE_INACTIVE)
  if (!vehicle.isActive) throw new ApiError(400, 'VEHICLE_INACTIVE', BOOKING_MESSAGES.VEHICLE_INACTIVE)
  if (!customer.isActive) throw new ApiError(400, 'CUSTOMER_INACTIVE', BOOKING_MESSAGES.CUSTOMER_INACTIVE)

  // The slot generator never offers a started slot; a page left open can.
  if (input.startAt.getTime() <= Date.now()) throw new ApiError(409, 'BOOKING_TIME_PASSED', BOOKING_MESSAGES.TIME_PASSED)

  const startAt = input.startAt
  const endAt = new Date(startAt.getTime() + service.durationMinutes * 60_000)
  const fromStatus = request.status
  const toStatus = bookingTargetStatus(fromStatus)

  try {
    await createAppointment(
      ctx,
      { customerId: request.customerId, vehicleId: vehicle.id, serviceId: service.id, startAt, endAt, notes: null },
      {
        afterLock: async (tx) => {
          const current = await customerRequestRepository.findByIdForUpdate(ctx.tenant.id, ctx.business.id, requestId, tx)
          if (!current) throw new ApiError(404, 'NOT_FOUND', 'Заявка не найдена.')
          if (current.appointmentId) throw new AlreadyBooked()
          if (
            current.status !== fromStatus ||
            current.updatedAt.getTime() !== request.updatedAt.getTime() ||
            current.customerId !== request.customerId ||
            current.vehicleId !== request.vehicleId ||
            current.serviceId !== request.serviceId
          ) {
            throw new ApiError(409, 'BOOKING_STALE', BOOKING_MESSAGES.STALE)
          }
        },
        afterCreate: async (tx, created) => {
          const linked = await customerRequestRepository.linkBookedAppointment(
            ctx.tenant.id,
            ctx.business.id,
            requestId,
            { appointmentId: created.id, fromStatus, toStatus, changedByUserId: ctx.user.id },
            tx
          )
          if (!linked) throw new ApiError(409, 'BOOKING_STALE', BOOKING_MESSAGES.STALE)
          // Prompt 48 — a request from a follow-up that becomes CONVERTED books its follow-up.
          if (toStatus === 'CONVERTED') {
            await serviceFollowUpRepository.markBookedByCustomerRequest(ctx.tenant.id, ctx.business.id, requestId, tx)
          }
        },
      }
    )
  } catch (err) {
    if (err instanceof AlreadyBooked) {
      return { booking: await getRequestBooking(ctx, requestId), created: false }
    }
    throw toBookingError(err)
  }

  return { booking: await getRequestBooking(ctx, requestId), created: true }
}
