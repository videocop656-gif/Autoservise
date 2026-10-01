import { describe, it, expect } from 'vitest'
import { isToolAllowed, toolDefinitionsForMode } from '../src/server/ai/executionMode'
import { TOOL_DEFINITIONS } from '../src/server/ai/tools/registry'
import { buildSystemPrompt } from '../src/server/ai/promptBuilder'
import {
  initialForm,
  vehicleStatusText,
  serviceStatusText,
  applyBody,
  qualificationErrorMessage,
  type RequestQualificationDto,
} from '../src/components/conversations/qualification'

// Prompt 55 — qualify execution mode, its prompt rules, and the pure helpers
// behind the "Разбор обращения" review UI (browser-validated otherwise).

describe("execution mode 'qualify'", () => {
  it('offers and allows no tool at all — not even the read-only availability check', () => {
    expect(toolDefinitionsForMode(TOOL_DEFINITIONS, 'qualify')).toEqual([])
    for (const t of TOOL_DEFINITIONS) expect(isToolAllowed('qualify', t.name)).toBe(false)
  })

  it('leaves the other modes as they were', () => {
    expect(toolDefinitionsForMode(TOOL_DEFINITIONS, 'draft').map((t) => t.name)).toEqual(['check_availability'])
    expect(toolDefinitionsForMode(TOOL_DEFINITIONS, 'interactive')).toHaveLength(TOOL_DEFINITIONS.length)
  })

  it('the qualify prompt asks for names (never ids), a factual description without diagnosis, and business-local dates', () => {
    const prompt = buildSystemPrompt('qualify')
    expect(prompt).toContain('РЕЖИМ РАЗБОРА ОБРАЩЕНИЯ')
    expect(prompt).toContain('Никогда не придумывай название и не пиши id')
    expect(prompt).toContain('Без диагноза')
    expect(prompt).toContain('по currentDateTime')
    expect(buildSystemPrompt('draft')).not.toContain('РЕЖИМ РАЗБОРА ОБРАЩЕНИЯ')
  })
})

const proposal = (o: Partial<RequestQualificationDto> = {}): RequestQualificationDto => ({
  basedOn: { customerId: 'c1', customerRequestId: null, requestUpdatedAt: null },
  customer: { status: 'linked', id: 'c1', name: 'Алиса', phone: '+7900' },
  vehicle: { status: 'matched', vehicleId: 'v1', mention: 'Kia Rio' },
  vehicleOptions: [{ id: 'v1', label: 'Kia Rio · 2019' }],
  service: { status: 'matched', serviceId: 's1', mention: 'Замена масла' },
  serviceOptions: [{ id: 's1', name: 'Замена масла', isActive: true }],
  subject: 'Замена масла',
  description: 'Клиент просит заменить масло.',
  timing: { requestedDate: '2026-10-06', requestedTimeFrom: '15:00', requestedTimeTo: null, notes: [] },
  missing: [],
  needsHuman: false,
  ...o,
})

describe('review form helpers', () => {
  it('pre-fills the form from the proposal; empty values stay empty (never invented)', () => {
    expect(initialForm(proposal())).toEqual({
      vehicleId: 'v1',
      serviceId: 's1',
      subject: 'Замена масла',
      description: 'Клиент просит заменить масло.',
      requestedDate: '2026-10-06',
      requestedTimeFrom: '15:00',
      requestedTimeTo: '',
    })
    expect(initialForm(proposal({ vehicle: { status: 'ambiguous', vehicleId: null, mention: null }, description: null })).vehicleId).toBe('')
  })

  it('status lines tell the truth about where data came from', () => {
    expect(vehicleStatusText({ status: 'unverified', vehicleId: null, mention: 'Toyota Camry 2021' })).toBe(
      'Из сообщения: «Toyota Camry 2021» — такого автомобиля у клиента нет. Добавьте его в «Автомобили клиента».'
    )
    expect(vehicleStatusText({ status: 'matched', vehicleId: 'v1', mention: 'Kia Rio' })).toBe('Предложено по сообщению — проверьте.')
    expect(vehicleStatusText({ status: 'ambiguous', vehicleId: null, mention: null })).toBe('Нужно выбрать автомобиль.')
    expect(serviceStatusText({ status: 'unresolved', serviceId: null, mention: null })).toBe('Услуга требует уточнения.')
    expect(serviceStatusText({ status: 'unresolved', serviceId: null, mention: 'Чистка' })).toContain('нет среди услуг')
  })

  it('create body carries the reviewed values and the customer the proposal was built on', () => {
    expect(applyBody(proposal(), initialForm(proposal()))).toEqual({
      action: 'create',
      expectedCustomerId: 'c1',
      vehicleId: 'v1',
      serviceId: 's1',
      subject: 'Замена масла',
      description: 'Клиент просит заменить масло.',
      requestedDate: '2026-10-06',
      requestedTimeFrom: '15:00',
      requestedTimeTo: null,
    })
  })

  it('with a linked request the body is an update pinned to that request version', () => {
    const q = proposal({ basedOn: { customerId: 'c1', customerRequestId: 'r1', requestUpdatedAt: '2026-10-01T10:00:00.000Z' } })
    expect(applyBody(q, initialForm(q))).toMatchObject({ action: 'update', expectedRequestId: 'r1', expectedRequestUpdatedAt: '2026-10-01T10:00:00.000Z' })
  })

  it('error messages: server Russian passes through, raw/English never does', () => {
    expect(qualificationErrorMessage('apply', 'QUALIFICATION_STALE', 'Данные обращения изменились. Обновите разбор и проверьте его ещё раз.')).toBe(
      'Данные обращения изменились. Обновите разбор и проверьте его ещё раз.'
    )
    expect(qualificationErrorMessage('apply', 'VALIDATION_ERROR', 'Автомобиль не принадлежит выбранному клиенту')).toBe('Автомобиль не принадлежит выбранному клиенту')
    expect(qualificationErrorMessage('apply', 'VALIDATION_ERROR', 'Invalid request data')).toBe('Проверьте заполненные поля.')
    expect(qualificationErrorMessage('analyze', 'AI_PROVIDER_UNAVAILABLE', 'upstream 503')).toBe('Не удалось разобрать обращение. Попробуйте ещё раз.')
    expect(qualificationErrorMessage('apply', undefined, undefined)).toBe('Не удалось сохранить обращение.')
  })
})
