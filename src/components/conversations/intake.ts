// ---------------------------------------------------------------------------
// Prompt 54 — pure helpers behind the "Клиент и автомобиль" section of
// Conversation Detail. The server decides every rule (tenant scope,
// duplicates, request consistency, roles); these only turn its answers into
// truthful operator-facing UI.
// ---------------------------------------------------------------------------

export type IntakeAction = 'link' | 'create-customer' | 'create-vehicle'

const FALLBACK: Record<IntakeAction, string> = {
  link: 'Не удалось связать клиента.',
  'create-customer': 'Не удалось создать клиента.',
  'create-vehicle': 'Не удалось добавить автомобиль.',
}

/** Server codes whose message is already operator-facing Russian. */
const PASS_THROUGH = new Set([
  'CONVERSATION_CHANGED',
  'CONVERSATION_HAS_CUSTOMER',
  'CONVERSATION_HAS_NO_CUSTOMER',
  'CUSTOMER_REQUEST_CONFLICT',
  'CUSTOMER_PHONE_EXISTS',
  'VEHICLE_EXISTS',
  'NOT_FOUND',
])

export function intakeErrorMessage(action: IntakeAction, code: string | undefined, serverMessage: string | undefined): string {
  if (code && PASS_THROUGH.has(code) && serverMessage) return serverMessage
  if (code === 'CUSTOMER_EMAIL_EXISTS') return 'Клиент с таким email уже существует.'
  if (code === 'FORBIDDEN') return 'Недостаточно прав для этого действия.'
  if (code === 'VALIDATION_ERROR') return 'Проверьте заполненные поля.'
  return FALLBACK[action]
}

export interface PhoneMatch {
  id: string
  firstName: string
  lastName: string | null
  phone: string
}

/** The same-business customers the server reported for CUSTOMER_PHONE_EXISTS — defensive about shape. */
export function phoneMatchesFrom(details: unknown): PhoneMatch[] {
  const matches = (details as { matches?: unknown } | null | undefined)?.matches
  if (!Array.isArray(matches)) return []
  return matches.filter(
    (m): m is PhoneMatch => !!m && typeof m === 'object' && typeof (m as PhoneMatch).id === 'string' && typeof (m as PhoneMatch).firstName === 'string'
  )
}

export function personName(c: { firstName: string; lastName: string | null }): string {
  return `${c.firstName} ${c.lastName ?? ''}`.trim()
}

export interface IdentityState {
  customerRequestId: string | null
  customerId: string | null
  /** Customer of the linked request, when the detail API returned it. */
  requestCustomerId?: string | null
}

/**
 * Whether the operator may switch the conversation to another customer.
 * With a linked request the customer is fixed by that request (the server
 * refuses any other one), so the UI doesn't offer it.
 */
export function canChangeCustomer(state: IdentityState): { allowed: boolean; reason: string | null } {
  if (state.customerRequestId) {
    return { allowed: false, reason: 'Клиент определён связанным обращением — сменить его нельзя.' }
  }
  return { allowed: true, reason: null }
}

/** Legacy/test data where the conversation and its linked request disagree — shown, never auto-fixed. */
export function identityMismatch(state: IdentityState): boolean {
  return !!(state.customerId && state.requestCustomerId && state.customerId !== state.requestCustomerId)
}

export function vehicleTitle(v: { make: string; model: string; year: number | null }): string {
  return [`${v.make} ${v.model}`.trim(), v.year ? String(v.year) : null].filter(Boolean).join(' · ')
}
