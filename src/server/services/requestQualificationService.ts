import type { CustomerRequestStatus } from '@prisma/client'
import type { AuthContext } from '../types/auth'
import { ApiError } from '../lib/errors'
import { requireRole } from '../middleware/requireRole'
import { businessLocalToUtc, toBusinessLocalDateTime } from '../lib/timezone'
import { conversationRepository } from '../repositories/conversationRepository'
import { customerRepository } from '../repositories/customerRepository'
import { customerRequestRepository } from '../repositories/customerRequestRepository'
import { vehicleRepository } from '../repositories/vehicleRepository'
import { serviceRepository } from '../repositories/serviceRepository'
import { runQualificationAnalysis } from './aiService'
import { createCustomerRequestFromConversation, inRussian } from './conversationRequestService'
import { updateCustomerRequest } from './customerRequestService'
import type { AiProvider } from '../ai/provider'
import type { AiEntities } from '../ai/types'
import type { ApplyQualificationInput } from '../validation/requestQualification.schemas'

// ---------------------------------------------------------------------------
// Prompt 55 — AI-assisted request qualification ("Разобрать обращение").
//
// analyze: the AI core ('qualify' mode, no tools) reads the conversation and
// returns the existing validated AiResult — names and dates as the customer
// wrote them, never ids. This service turns that into a PROPOSAL whose ids
// are resolved here, server-side, only within this tenant/business:
//   - customer: always the conversation's own linked customer (never the AI's);
//   - vehicle: one of that customer's stored vehicles, or nothing;
//   - service: an ACTIVE configured service whose name the model returned
//     exactly, or nothing ("услуга требует уточнения");
//   - timing: a real, not-past business-local date / a valid HH:mm.
// Nothing is written (only the usual AI_ANALYZE audit row).
//
// apply: the operator-reviewed proposal is persisted ONLY through the
// canonical paths — create = the Prompt 49 bridge (atomic create + link,
// existing request rules), update = updateCustomerRequest (changed fields
// only; never the customer, never the status). The conversation/request
// state the operator reviewed is re-checked first; any change → 409.
// ---------------------------------------------------------------------------

const STALE = () => new ApiError(409, 'QUALIFICATION_STALE', 'Данные обращения изменились. Обновите разбор и проверьте его ещё раз.')
const TERMINAL: CustomerRequestStatus[] = ['CONVERTED', 'CLOSED', 'CANCELLED']
const MAX_DESCRIPTION = 2000
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/

export type QualificationVehicleStatus = 'request' | 'matched' | 'single' | 'ambiguous' | 'unverified' | 'none' | 'no_customer'
export type QualificationServiceStatus = 'request' | 'matched' | 'unresolved'

export interface RequestQualificationProposal {
  /** The state the proposal was built on — sent back on apply and re-checked. */
  basedOn: { customerId: string | null; customerRequestId: string | null; requestUpdatedAt: string | null }
  customer:
    | { status: 'linked'; id: string; name: string; phone: string }
    | { status: 'missing'; mentionedName: string | null; mentionedPhone: string | null }
  vehicle: { status: QualificationVehicleStatus; vehicleId: string | null; mention: string | null }
  /** The linked customer's vehicles (this business only) for the operator's choice. */
  vehicleOptions: { id: string; label: string }[]
  service: { status: QualificationServiceStatus; serviceId: string | null; mention: string | null }
  /** Active services of this business (+ the request's current one, if inactive). */
  serviceOptions: { id: string; name: string; isActive: boolean }[]
  subject: string
  description: string | null
  timing: { requestedDate: string | null; requestedTimeFrom: string | null; requestedTimeTo: string | null; notes: string[] }
  /** What the next step (an appointment needs customer + vehicle + service + time) still lacks. */
  missing: string[]
  needsHuman: boolean
}

function personName(c: { firstName: string; lastName: string | null }): string {
  return `${c.firstName} ${c.lastName ?? ''}`.trim()
}
function vehicleLabel(v: { make: string; model: string; year: number | null; licensePlate: string | null }): string {
  return [`${v.make} ${v.model}`.trim(), v.year ? String(v.year) : null, v.licensePlate].filter(Boolean).join(' · ')
}
const norm = (s: string) => s.trim().toLowerCase()
const plateKey = (s: string) => s.replace(/\s+/g, '').toUpperCase()

function isRealDate(dateKey: string): boolean {
  if (!DATE_RE.test(dateKey)) return false
  const [y, m, d] = dateKey.split('-').map(Number)
  const date = new Date(Date.UTC(y!, m! - 1, d!))
  return date.getUTCFullYear() === y && date.getUTCMonth() === m! - 1 && date.getUTCDate() === d
}

/**
 * The customer's stored vehicles that the customer's own words point to.
 * Exact plate first; otherwise the stored model must appear in what the
 * customer wrote (and the make too, when they named one). Never fuzzy beyond that.
 */
function vehiclesMatchingMention(
  vehicles: { id: string; make: string; model: string; licensePlate: string | null }[],
  entities: AiEntities
): { id: string }[] {
  if (entities.licensePlate) {
    const byPlate = vehicles.filter((v) => v.licensePlate && plateKey(v.licensePlate) === plateKey(entities.licensePlate!))
    if (byPlate.length > 0) return byPlate
  }
  const text = norm([entities.vehicleMake, entities.vehicleModel].filter(Boolean).join(' '))
  if (!text) return []
  return vehicles.filter((v) => {
    const model = norm(v.model)
    if (model.length < 2 || !text.includes(model)) return false
    return entities.vehicleMake ? text.includes(norm(v.make)) : true
  })
}

export async function analyzeRequestQualification(
  ctx: AuthContext,
  conversationId: string,
  deps: { provider?: AiProvider } = {}
): Promise<RequestQualificationProposal> {
  const analysis = await runQualificationAnalysis(ctx, conversationId, deps)
  if (analysis.outcome === 'FAILED') {
    throw new ApiError(502, 'AI_QUALIFICATION_UNAVAILABLE', 'Не удалось разобрать обращение. Попробуйте ещё раз.')
  }
  const { conversation, result } = analysis
  const entities = result.entities

  // Trusted state, read fresh and tenant-scoped (never from the model).
  const [customer, request, activeServices] = await Promise.all([
    conversation.customerId ? customerRepository.findById(ctx.tenant.id, ctx.business.id, conversation.customerId) : null,
    conversation.customerRequestId ? customerRequestRepository.findById(ctx.tenant.id, ctx.business.id, conversation.customerRequestId) : null,
    serviceRepository.listByBusiness(ctx.tenant.id, ctx.business.id, true),
  ])
  const vehicles = customer
    ? (await vehicleRepository.list(ctx.tenant.id, ctx.business.id, { activeOnly: true, customerId: customer.id, skip: 0, take: 50 })).items
    : []

  // ---- vehicle ----
  const vehicleOptions = vehicles.map((v) => ({ id: v.id, label: vehicleLabel(v) }))
  if (request?.vehicleId && !vehicleOptions.some((o) => o.id === request.vehicleId)) {
    const current = await vehicleRepository.findById(ctx.tenant.id, ctx.business.id, request.vehicleId)
    if (current) vehicleOptions.unshift({ id: current.id, label: vehicleLabel(current) })
  }
  const mention = [entities.vehicleMake, entities.vehicleModel, entities.licensePlate].filter(Boolean).join(' ') || null
  let vehicle: RequestQualificationProposal['vehicle']
  if (!customer) {
    vehicle = { status: 'no_customer', vehicleId: null, mention }
  } else if (request?.vehicleId) {
    vehicle = { status: 'request', vehicleId: request.vehicleId, mention }
  } else if (mention) {
    const matches = vehiclesMatchingMention(vehicles, entities)
    vehicle =
      matches.length === 1
        ? { status: 'matched', vehicleId: matches[0]!.id, mention }
        : { status: matches.length > 1 ? 'ambiguous' : 'unverified', vehicleId: null, mention }
  } else if (vehicles.length === 1) {
    vehicle = { status: 'single', vehicleId: vehicles[0]!.id, mention: null }
  } else {
    vehicle = { status: vehicles.length > 1 ? 'ambiguous' : 'none', vehicleId: null, mention: null }
  }

  // ---- service ----
  const serviceOptions = activeServices.map((s) => ({ id: s.id, name: s.name, isActive: true }))
  if (request?.serviceId && !serviceOptions.some((o) => o.id === request.serviceId)) {
    const current = await serviceRepository.findById(ctx.tenant.id, ctx.business.id, request.serviceId)
    if (current) serviceOptions.unshift({ id: current.id, name: current.name, isActive: current.isActive })
  }
  let service: RequestQualificationProposal['service']
  if (request?.serviceId) {
    service = { status: 'request', serviceId: request.serviceId, mention: entities.serviceName }
  } else {
    // Only an exact name of an ACTIVE configured service resolves to an id.
    const matched = entities.serviceName ? activeServices.find((s) => norm(s.name) === norm(entities.serviceName!)) : undefined
    service = matched
      ? { status: 'matched', serviceId: matched.id, mention: entities.serviceName }
      : { status: 'unresolved', serviceId: null, mention: entities.serviceName }
  }

  // ---- description (the AI's factual summary; the safety layer already rejected diagnoses) ----
  const rejected = analysis.outcome === 'REJECTED'
  const aiDescription = rejected ? null : result.answer.trim().slice(0, MAX_DESCRIPTION) || null
  const description = aiDescription ?? request?.description ?? null

  // ---- timing (business-local; sanitized) ----
  const notes: string[] = []
  const today = toBusinessLocalDateTime(new Date(), ctx.business.timezone).dateKey
  let requestedDate: string | null = null
  if (entities.requestedDate) {
    if (!isRealDate(entities.requestedDate)) notes.push('Дата из сообщения не распознана.')
    else if (entities.requestedDate < today) notes.push('Дата из сообщения уже прошла.')
    else requestedDate = entities.requestedDate
  }
  let requestedTimeFrom: string | null = null
  if (entities.requestedTime) {
    if (TIME_RE.test(entities.requestedTime)) requestedTimeFrom = entities.requestedTime
    else notes.push('Время из сообщения не распознано.')
  }
  const existingDate = request?.requestedDate ? request.requestedDate.toISOString().slice(0, 10) : null
  const timing = {
    requestedDate: requestedDate ?? existingDate,
    requestedTimeFrom: requestedTimeFrom ?? request?.requestedTimeFrom ?? null,
    requestedTimeTo: requestedTimeFrom ? null : (request?.requestedTimeTo ?? null),
    notes,
  }

  // ---- subject: keep a linked request's own subject; otherwise the service or the need ----
  const matchedServiceName = service.serviceId ? serviceOptions.find((o) => o.id === service.serviceId)?.name : undefined
  const subject = (request?.subject ?? matchedServiceName ?? (aiDescription ? aiDescription.slice(0, 80) : 'Обращение из диалога')).slice(0, 200)

  // ---- what the next step still lacks (an appointment needs customer, vehicle, service, time) ----
  const missing: string[] = []
  if (!customer) missing.push('Клиент не связан с диалогом — найдите или создайте клиента в разделе «Клиент и автомобиль».')
  if (customer && !vehicle.vehicleId) {
    missing.push(
      vehicle.status === 'unverified'
        ? `Автомобиль «${mention}» из сообщения не сохранён — добавьте его в «Автомобили клиента» и выберите.`
        : vehicle.status === 'ambiguous'
          ? 'Нужно выбрать автомобиль — у клиента их несколько.'
          : 'Автомобиль не выбран.'
    )
  }
  if (!service.serviceId) missing.push('Услуга требует уточнения.')
  if (!timing.requestedDate) missing.push('Клиент не указал удобную дату.')
  if (rejected) missing.push('Описание не сформировано автоматически — заполните его вручную.')

  return {
    basedOn: { customerId: conversation.customerId, customerRequestId: conversation.customerRequestId, requestUpdatedAt: request ? request.updatedAt.toISOString() : null },
    customer: customer
      ? { status: 'linked', id: customer.id, name: personName(customer), phone: customer.phone }
      : { status: 'missing', mentionedName: entities.customerName, mentionedPhone: entities.phone },
    vehicle,
    vehicleOptions,
    service,
    serviceOptions,
    subject,
    description,
    timing,
    missing,
    needsHuman: result.needsHuman,
  }
}

/** A business-local "YYYY-MM-DD" as the ISO instant the request rules expect (local noon — never ambiguous). */
function localDateToIso(dateKey: string | null | undefined, timezone: string): string | null | undefined {
  if (dateKey === undefined) return undefined
  if (dateKey === null) return null
  if (!isRealDate(dateKey)) throw new ApiError(400, 'VALIDATION_ERROR', 'Некорректная дата')
  return businessLocalToUtc(dateKey, '12:00', timezone).toISOString()
}

export async function applyRequestQualification(ctx: AuthContext, conversationId: string, input: ApplyQualificationInput) {
  requireRole(ctx, 'owner', 'admin', 'manager')

  const conversation = await conversationRepository.findById(ctx.tenant.id, ctx.business.id, conversationId)
  if (!conversation) {
    throw new ApiError(404, 'NOT_FOUND', 'Диалог не найден')
  }
  if (conversation.customerId !== input.expectedCustomerId) {
    throw STALE()
  }
  if (!conversation.customerId) {
    throw new ApiError(409, 'CONVERSATION_HAS_NO_CUSTOMER', 'Сначала свяжите диалог с клиентом.')
  }
  const requestedDate = localDateToIso(input.requestedDate, ctx.business.timezone)

  if (input.action === 'create') {
    if (conversation.customerRequestId) {
      throw STALE() // someone created/linked a request since the proposal
    }
    // The canonical Prompt 49 bridge: the conversation's own customer,
    // existing request rules (vehicle of that customer, active service,
    // status NEW + history), atomic create + link, no appointment.
    const result = await createCustomerRequestFromConversation(ctx, conversationId, {
      vehicleId: input.vehicleId ?? null,
      serviceId: input.serviceId ?? null,
      subject: input.subject,
      description: input.description ?? null,
      requestedDate: requestedDate ?? null,
      requestedTimeFrom: input.requestedTimeFrom ?? null,
      requestedTimeTo: input.requestedTimeTo ?? null,
    })
    if (!result.created) {
      throw STALE() // lost a race: another request got linked first
    }
    return { request: result.request, created: true }
  }

  // ---- update the linked request ----
  if (conversation.customerRequestId !== input.expectedRequestId) {
    throw STALE()
  }
  const existing = await customerRequestRepository.findById(ctx.tenant.id, ctx.business.id, input.expectedRequestId)
  if (!existing) {
    throw new ApiError(404, 'NOT_FOUND', 'Обращение не найдено')
  }
  if (existing.updatedAt.toISOString() !== input.expectedRequestUpdatedAt) {
    throw STALE()
  }
  if (TERMINAL.includes(existing.status)) {
    throw new ApiError(409, 'REQUEST_FINISHED', 'Обращение уже завершено — изменять его нельзя.')
  }

  // Only what actually changes; never customerId, status or appointment.
  const existingDate = existing.requestedDate ? existing.requestedDate.toISOString().slice(0, 10) : null
  const patch = {
    ...(input.vehicleId !== undefined && input.vehicleId !== existing.vehicleId ? { vehicleId: input.vehicleId } : {}),
    ...(input.serviceId !== undefined && input.serviceId !== existing.serviceId ? { serviceId: input.serviceId } : {}),
    ...(input.subject !== existing.subject ? { subject: input.subject } : {}),
    ...(input.description !== undefined && input.description !== existing.description ? { description: input.description } : {}),
    ...(input.requestedDate !== undefined && input.requestedDate !== existingDate ? { requestedDate: requestedDate ?? null } : {}),
    ...(input.requestedTimeFrom !== undefined && input.requestedTimeFrom !== existing.requestedTimeFrom ? { requestedTimeFrom: input.requestedTimeFrom } : {}),
    ...(input.requestedTimeTo !== undefined && input.requestedTimeTo !== existing.requestedTimeTo ? { requestedTimeTo: input.requestedTimeTo } : {}),
  }
  if (Object.keys(patch).length === 0) {
    return { request: existing, created: false }
  }
  const updated = await inRussian(() => updateCustomerRequest(ctx, existing.id, patch))
  return { request: updated, created: false }
}
