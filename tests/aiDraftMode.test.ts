import { describe, it, expect } from 'vitest'
import { buildSystemPrompt } from '../src/server/ai/promptBuilder'
import { isToolAllowed, toolDefinitionsForMode, draftModeToolRefusal } from '../src/server/ai/executionMode'
import { TOOL_DEFINITIONS } from '../src/server/ai/tools/registry'
import { MockAiProvider } from '../src/server/ai/providers/mockAiProvider'
import { aiDraftAvailability, applyAiDraft, aiDraftErrorMessage, AI_DRAFT_FAILED_MESSAGE } from '../src/components/conversations/aiDraft'
import type { AiBusinessContext } from '../src/server/ai/types'

// Prompt 53 — the draft execution mode, the corrected system prompt, the mock
// provider's draft behaviour, and the composer helpers behind
// "Предложить ответ AI" (the project has no component-test stack — the UI
// itself is browser-validated, see final-report-53.md).

describe('system prompt', () => {
  it('no longer tells the model that escalation does not exist (it has since Prompt 12)', () => {
    for (const mode of ['interactive', 'draft'] as const) {
      const prompt = buildSystemPrompt(mode)
      expect(prompt).not.toContain('эскалации как механизма пока не существует')
      expect(prompt).not.toMatch(/escalation mechanism exists/i)
    }
  })

  it('still forbids claiming a manager was contacted', () => {
    expect(buildSystemPrompt()).toContain('Ты НЕ можешь утверждать, что: связался с менеджером/сотрудником')
  })

  it('points the model at the business-local date and the configured working hours', () => {
    const prompt = buildSystemPrompt()
    expect(prompt).toContain('currentDateTime')
    expect(prompt).toContain('workingHours')
  })

  it('draft mode adds the draft rules; the console (interactive) prompt is unchanged by them', () => {
    expect(buildSystemPrompt('draft')).toContain('РЕЖИМ ЧЕРНОВИКА')
    expect(buildSystemPrompt('draft')).toContain('никогда не утверждай, что запись уже создана')
    expect(buildSystemPrompt('interactive')).not.toContain('РЕЖИМ ЧЕРНОВИКА')
    expect(buildSystemPrompt()).toBe(buildSystemPrompt('interactive'))
  })
})

describe('execution mode', () => {
  it('interactive keeps all four tools; draft offers only check_availability', () => {
    expect(toolDefinitionsForMode(TOOL_DEFINITIONS, 'interactive').map((t) => t.name)).toEqual(TOOL_DEFINITIONS.map((t) => t.name))
    expect(toolDefinitionsForMode(TOOL_DEFINITIONS, 'draft').map((t) => t.name)).toEqual(['check_availability'])
  })

  it('draft refuses every mutating tool, including an unknown one', () => {
    expect(isToolAllowed('draft', 'check_availability')).toBe(true)
    for (const name of ['create_appointment', 'reschedule_appointment', 'cancel_appointment', 'whatever']) {
      expect(isToolAllowed('draft', name)).toBe(false)
      expect(isToolAllowed('interactive', name)).toBe(true) // the registry still rejects unknown names there
    }
  })

  it('the refusal is a gate rejection (attempted: false), never logged as a tool execution', () => {
    expect(draftModeToolRefusal('create_appointment')).toMatchObject({ success: false, errorCode: 'NOT_ALLOWED_IN_DRAFT', attempted: false })
  })
})

describe('mock provider after a draft-mode refusal', () => {
  const context = {
    business: { name: 'T', description: null, phone: null, email: null, address: null, locationUrl: null, timezone: 'Europe/Moscow', currency: 'RUB' },
    currentDateTime: { date: '2026-10-05', time: '10:00', dayOfWeek: 'MONDAY' as const },
    workingHours: [],
    services: [],
    knowledge: [],
    rules: [],
    customer: null,
    customerVehicles: [],
    vehicle: null,
    upcomingAppointments: [],
    serviceHistory: [],
  } satisfies AiBusinessContext

  it.each([
    ['create_appointment', 'Администратор оформит запись'],
    ['cancel_appointment', 'Администратор сервиса внесёт это изменение'],
  ])('%s refused → a customer-safe reply that claims nothing was done', async (tool, expected) => {
    const result = await new MockAiProvider().generate({
      systemPrompt: '',
      businessContext: context,
      history: [],
      userMessage: 'Да, 15:30',
      tools: [],
      toolExchanges: [{ call: { id: 'c1', name: tool, arguments: {} }, result: draftModeToolRefusal(tool) }],
    })
    expect(result.type).toBe('final')
    const raw = (result as { raw: { answer: string; needsHuman: boolean } }).raw
    expect(raw.answer).toContain(expected)
    expect(raw.needsHuman).toBe(false)
  })
})

describe('mock provider answers working hours from the context (Prompt 53)', () => {
  const base = {
    business: { name: 'T', description: null, phone: null, email: null, address: null, locationUrl: null, timezone: 'Europe/Moscow', currency: 'RUB' },
    services: [],
    knowledge: [],
    rules: [],
    customer: null,
    customerVehicles: [],
    vehicle: null,
    upcomingAppointments: [],
    serviceHistory: [],
  }
  const ask = (context: AiBusinessContext) =>
    new MockAiProvider()
      .generate({ systemPrompt: '', businessContext: context, history: [], userMessage: 'До скольки вы сегодня работаете?', tools: [], toolExchanges: [] })
      .then((r) => (r as { raw: { answer: string; needsHuman: boolean } }).raw)

  it("uses today's weekday (business-local) and the configured hours", async () => {
    const raw = await ask({
      ...base,
      currentDateTime: { date: '2026-10-05', time: '10:00', dayOfWeek: 'MONDAY' },
      workingHours: [{ dayOfWeek: 'MONDAY', isOpen: true, openTime: '09:00', closeTime: '18:00' }],
    })
    expect(raw).toMatchObject({ answer: 'Сегодня (понедельник) мы работаем с 09:00 до 18:00.', needsHuman: false })
  })

  it('a closed day is reported as a day off', async () => {
    const raw = await ask({
      ...base,
      currentDateTime: { date: '2026-10-04', time: '10:00', dayOfWeek: 'SUNDAY' },
      workingHours: [{ dayOfWeek: 'SUNDAY', isOpen: false, openTime: null, closeTime: null }],
    })
    expect(raw.answer).toBe('Сегодня (воскресенье) у нас выходной.')
  })

  it('no configured schedule → no invented hours, hand-off to staff', async () => {
    const raw = await ask({ ...base, currentDateTime: { date: '2026-10-05', time: '10:00', dayOfWeek: 'MONDAY' }, workingHours: [] })
    expect(raw.needsHuman).toBe(true)
    expect(raw.answer).not.toMatch(/\d{2}:\d{2}/)
  })
})

describe('composer helpers', () => {
  it('offered only when the last message is from the customer and the composer is empty', () => {
    expect(aiDraftAvailability({ composer: '', generating: false, lastMessageDirection: 'INBOUND' })).toEqual({ enabled: true, hint: null })
    expect(aiDraftAvailability({ composer: '   ', generating: false, lastMessageDirection: 'INBOUND' }).enabled).toBe(true)
  })

  it('operator text in the composer blocks generation, with an explanation', () => {
    expect(aiDraftAvailability({ composer: 'Здравствуйте', generating: false, lastMessageDirection: 'INBOUND' })).toEqual({
      enabled: false,
      hint: 'Чтобы получить ответ AI, сначала очистите поле сообщения.',
    })
  })

  it('nothing to answer (no messages, or staff replied last) → disabled with a hint', () => {
    for (const direction of [null, 'OUTBOUND'] as const) {
      expect(aiDraftAvailability({ composer: '', generating: false, lastMessageDirection: direction })).toEqual({
        enabled: false,
        hint: 'Нет нового сообщения клиента, на которое нужно ответить.',
      })
    }
  })

  it('no second request while one is running', () => {
    expect(aiDraftAvailability({ composer: '', generating: true, lastMessageDirection: 'INBOUND' }).enabled).toBe(false)
  })

  it('a finished draft fills an empty composer as ordinary text', () => {
    expect(applyAiDraft('', 'Добрый день! Замена масла — от 5000 ₽.')).toEqual({ composer: 'Добрый день! Замена масла — от 5000 ₽.', applied: true })
  })

  it('a draft that arrives after the operator started typing never overwrites that text', () => {
    expect(applyAiDraft('Сейчас уточню', 'AI draft')).toEqual({ composer: 'Сейчас уточню', applied: false })
  })

  it('errors: known Russian server messages pass through, everything else is one retryable message', () => {
    expect(aiDraftErrorMessage('NO_CUSTOMER_MESSAGE', 'Нет нового сообщения клиента, на которое нужно ответить')).toBe(
      'Нет нового сообщения клиента, на которое нужно ответить'
    )
    expect(aiDraftErrorMessage('AI_PROVIDER_UNAVAILABLE', 'whatever')).toBe(AI_DRAFT_FAILED_MESSAGE)
    expect(aiDraftErrorMessage(undefined, undefined)).toBe('Не удалось подготовить ответ AI. Попробуйте ещё раз.')
  })
})

describe('system prompt — trusted vs. untrusted identity (Prompt 54)', () => {
  it('separates stored customer/vehicles from what the customer writes', () => {
    const prompt = buildSystemPrompt()
    expect(prompt).toContain('customerVehicles')
    expect(prompt).toContain('непроверенные слова клиента')
  })
})
