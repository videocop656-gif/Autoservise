// ---------------------------------------------------------------------------
// Prompt 55 — pure helpers behind "Разобрать обращение" in Conversation
// Detail. The server builds the proposal (AI + tenant-checked ids) and
// enforces every rule on apply; these only render it honestly and build the
// operator-reviewed request body.
// ---------------------------------------------------------------------------

export type QualificationVehicleStatus = 'request' | 'matched' | 'single' | 'ambiguous' | 'unverified' | 'none' | 'no_customer'
export type QualificationServiceStatus = 'request' | 'matched' | 'unresolved'

export interface RequestQualificationDto {
  basedOn: { customerId: string | null; customerRequestId: string | null; requestUpdatedAt: string | null }
  customer:
    | { status: 'linked'; id: string; name: string; phone: string }
    | { status: 'missing'; mentionedName: string | null; mentionedPhone: string | null }
  vehicle: { status: QualificationVehicleStatus; vehicleId: string | null; mention: string | null }
  vehicleOptions: { id: string; label: string }[]
  service: { status: QualificationServiceStatus; serviceId: string | null; mention: string | null }
  serviceOptions: { id: string; name: string; isActive: boolean }[]
  subject: string
  description: string | null
  timing: { requestedDate: string | null; requestedTimeFrom: string | null; requestedTimeTo: string | null; notes: string[] }
  missing: string[]
  needsHuman: boolean
}

export interface QualificationForm {
  vehicleId: string
  serviceId: string
  subject: string
  description: string
  requestedDate: string
  requestedTimeFrom: string
  requestedTimeTo: string
}

export function initialForm(q: RequestQualificationDto): QualificationForm {
  return {
    vehicleId: q.vehicle.vehicleId ?? '',
    serviceId: q.service.serviceId ?? '',
    subject: q.subject,
    description: q.description ?? '',
    requestedDate: q.timing.requestedDate ?? '',
    requestedTimeFrom: q.timing.requestedTimeFrom ?? '',
    requestedTimeTo: q.timing.requestedTimeTo ?? '',
  }
}

/** Short, honest status line under the vehicle field. */
export function vehicleStatusText(v: RequestQualificationDto['vehicle']): string {
  switch (v.status) {
    case 'request':
      return 'Автомобиль из обращения.'
    case 'matched':
      return 'Предложено по сообщению — проверьте.'
    case 'single':
      return 'Единственный автомобиль клиента — проверьте.'
    case 'ambiguous':
      return 'Нужно выбрать автомобиль.'
    case 'unverified':
      return `Из сообщения: «${v.mention ?? ''}» — такого автомобиля у клиента нет. Добавьте его в «Автомобили клиента».`
    case 'none':
      return 'У клиента нет сохранённых автомобилей.'
    case 'no_customer':
      return v.mention ? `Из сообщения: «${v.mention}» (не проверено).` : 'Сначала свяжите клиента.'
  }
}

export function serviceStatusText(s: RequestQualificationDto['service']): string {
  if (s.status === 'request') return 'Услуга из обращения.'
  if (s.status === 'matched') return 'Предложено по сообщению — проверьте.'
  return s.mention ? `Услуга требует уточнения (AI: «${s.mention}» — нет среди услуг).` : 'Услуга требует уточнения.'
}

/** The apply body: what the operator reviewed + the state they reviewed it on. */
export function applyBody(q: RequestQualificationDto, form: QualificationForm) {
  const fields = {
    expectedCustomerId: q.basedOn.customerId,
    vehicleId: form.vehicleId || null,
    serviceId: form.serviceId || null,
    subject: form.subject,
    description: form.description || null,
    requestedDate: form.requestedDate || null,
    requestedTimeFrom: form.requestedTimeFrom || null,
    requestedTimeTo: form.requestedTimeTo || null,
  }
  return q.basedOn.customerRequestId
    ? { action: 'update' as const, ...fields, expectedRequestId: q.basedOn.customerRequestId, expectedRequestUpdatedAt: q.basedOn.requestUpdatedAt }
    : { action: 'create' as const, ...fields }
}

const PASS_THROUGH = new Set([
  'QUALIFICATION_STALE',
  'CONVERSATION_HAS_NO_CUSTOMER',
  'REQUEST_FINISHED',
  'NO_CUSTOMER_MESSAGE',
  'NOT_FOUND',
  'CUSTOMER_REQUIRED',
  'CONFLICT',
])

export const ANALYZE_FAILED = 'Не удалось разобрать обращение. Попробуйте ещё раз.'
export const APPLY_FAILED = 'Не удалось сохранить обращение.'

/**
 * Russian operator message. The server's own messages for these codes (and
 * the bridge's translated validation messages) are already Russian; raw
 * English/internal text never reaches the operator.
 */
export function qualificationErrorMessage(stage: 'analyze' | 'apply', code: string | undefined, serverMessage: string | undefined): string {
  if (code && PASS_THROUGH.has(code) && serverMessage) return serverMessage
  if (stage === 'apply' && code === 'VALIDATION_ERROR' && serverMessage && /[а-яё]/i.test(serverMessage)) return serverMessage
  if (stage === 'apply' && code === 'VALIDATION_ERROR') return 'Проверьте заполненные поля.'
  if (code === 'FORBIDDEN') return 'Недостаточно прав для этого действия.'
  return stage === 'analyze' ? ANALYZE_FAILED : APPLY_FAILED
}
