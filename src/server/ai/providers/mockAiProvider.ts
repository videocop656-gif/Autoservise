import type { AiProvider, AiGenerationRequest, AiGenerationResult } from '../provider'
import {
  EMPTY_AI_ENTITIES,
  type AiIntent,
  type AiBusinessContext,
  type AiHistoryMessage,
  type AiToolExchange,
  type AiToolCallRequest,
} from '../types'
import { isExplicitConfirmation } from '../confirmation'
import { toBusinessLocalDateTime, businessLocalToUtc } from '../../lib/timezone'

/**
 * Prompt injection defense (spec §"PROMPT INJECTION DEFENSE", Prompt 11):
 * customer-controlled text must never override system instructions,
 * business rules, tenant isolation, or the confirmation gate. This is a
 * deterministic net for the exact documented attack shapes — not a general
 * classifier — the real defense is structural (buildAiContext only ever
 * loads the current conversation's own customer/vehicle/history, so there
 * is no other tenant's or customer's data here to leak regardless of what
 * the message asks for).
 */
const PROMPT_INJECTION_PATTERNS: RegExp[] = [
  /ignore\s+(all\s+|previous\s+|the\s+)?(business\s+)?(instructions|rules|prompt)/iu,
  /reveal.*(key|secret|password)/iu,
  /system\s+prompt/iu,
  /pretend\s+(that|this|you)/iu,
  /(another|чужого|другого)\s+(customer|client|клиент)/iu,
  /притворись/iu,
  /игнорируй\s+(правила|инструкции|бизнес[- ]правила)/iu,
  /the\s+system\s+(says|told|allows|grants)/iu,
  /system\s+(says|allows|grants)\s+you/iu,
  /can\s+access\s+all\s+customers/iu,
]

/**
 * Deterministic, keyword-based provider — no network access, no
 * OPENAI_API_KEY required. Used by:
 *  - every automated test in this codebase (spec: "Mock provider должен
 *    позволять unit/integration тестам работать без OPENAI_API_KEY");
 *  - aiProviderFactory.ts as the automatic production fallback whenever
 *    OPENAI_API_KEY is unset, so the AI Core (including the Tool Layer)
 *    stays fully exercisable end-to-end without ever needing a real key.
 *
 * Prompt 10 extends this with a real (if simple) two-round tool-calling
 * protocol: round 1 may return `tool_calls` for a booking-shaped message;
 * once aiService.ts executes the tool and calls generate() again with the
 * result appended to `toolExchanges`, round 2 always produces the final
 * answer. This is intentionally simple pattern matching, not a real
 * planner — it exists to prove the whole pipeline (confirmation gate,
 * tool whitelist, Zod validation, tenant-scoped execution, conflict
 * re-check) end-to-end, not to produce good answers.
 */
export class MockAiProvider implements AiProvider {
  async generate(request: AiGenerationRequest): Promise<AiGenerationResult> {
    const { userMessage, businessContext, toolExchanges, history } = request

    if (toolExchanges.length > 0) {
      return { type: 'final', raw: buildFinalFromToolResult(toolExchanges[toolExchanges.length - 1]!) }
    }

    const message = userMessage.trim()
    const lower = message.toLowerCase()
    const confirmed = isExplicitConfirmation(message)

    if (PROMPT_INJECTION_PATTERNS.some((pattern) => pattern.test(message))) {
      return {
        type: 'final',
        raw: finalResult(
          'UNKNOWN',
          0.3,
          'Извините, я не могу выполнить этот запрос. Чем ещё я могу помочь по вопросам автосервиса?',
          true,
          'Message appears to attempt to override system instructions; escalating for safety.'
        ),
      }
    }

    // --- Cancellation ---
    if (/отмен|cancel/.test(lower)) {
      if (confirmed) {
        const appt = pickSingleUpcomingAppointment(businessContext)
        if (!appt) {
          return { type: 'final', raw: finalResult('CANCELLATION_REQUEST', 0.5, askWhichAppointment(businessContext), false, null) }
        }
        return toolCallResult('cancel_appointment', { appointmentId: appt.id })
      }
      return { type: 'final', raw: finalResult('CANCELLATION_REQUEST', 0.7, askCancelConfirmation(businessContext), false, null) }
    }

    // --- Reschedule ---
    if (/перенес|перенос|reschedul/.test(lower)) {
      if (confirmed) {
        const appt = pickSingleUpcomingAppointment(businessContext)
        const time = extractTime(message)
        const dateKey = resolveDateKey(message, history, businessContext.business.timezone)
        if (!appt || !time || !dateKey) {
          return { type: 'final', raw: finalResult('RESCHEDULE_REQUEST', 0.5, askWhichAppointment(businessContext), false, null) }
        }
        const service = businessContext.services.find((s) => s.name === appt.serviceName) ?? businessContext.services[0]
        const duration = service?.durationMinutes ?? 60
        const startAt = businessLocalToUtc(dateKey, time, businessContext.business.timezone)
        const endAt = new Date(startAt.getTime() + duration * 60000)
        return toolCallResult('reschedule_appointment', {
          appointmentId: appt.id,
          startAt: startAt.toISOString(),
          endAt: endAt.toISOString(),
        })
      }
      // Phase 1: identify what's being rescheduled and check availability for the new date — never move it silently.
      const appt = pickSingleUpcomingAppointment(businessContext)
      if (!appt) {
        return { type: 'final', raw: finalResult('RESCHEDULE_REQUEST', 0.6, askWhichAppointment(businessContext), false, null) }
      }
      const service = businessContext.services.find((s) => s.name === appt.serviceName)
      if (!service) {
        return { type: 'final', raw: finalResult('RESCHEDULE_REQUEST', 0.5, 'Не удалось определить услугу для этой записи.', true, null) }
      }
      const dateKey = resolveDateKey(message, history, businessContext.business.timezone) ?? tomorrowKey(businessContext.business.timezone)
      return toolCallResult('check_availability', {
        customerId: businessContext.customer?.id ?? null,
        vehicleId: businessContext.vehicle?.id ?? null,
        serviceId: service.id,
        date: dateKey,
        preferredTimeFrom: null,
        preferredTimeTo: null,
      })
    }

    // --- Booking confirmation (create) — requires a known customer+vehicle and a specific time. ---
    if (confirmed && /\d{1,2}:\d{2}/.test(message)) {
      if (!businessContext.customer || !businessContext.vehicle) {
        return {
          type: 'final',
          raw: finalResult('BOOKING_REQUEST', 0.5, 'Чтобы записать автомобиль, сначала нужно определить клиента и автомобиль.', false, null),
        }
      }
      const time = extractTime(message)!
      const dateKey = resolveDateKey(message, history, businessContext.business.timezone) ?? tomorrowKey(businessContext.business.timezone)
      const service = pickService(businessContext, lower) ?? (businessContext.services.length === 1 ? businessContext.services[0] : null)
      if (!service) {
        return { type: 'final', raw: finalResult('BOOKING_REQUEST', 0.5, askWhichService(businessContext), false, null) }
      }
      const startAt = businessLocalToUtc(dateKey, time, businessContext.business.timezone)
      const endAt = new Date(startAt.getTime() + service.durationMinutes * 60000)
      return toolCallResult('create_appointment', {
        customerId: businessContext.customer.id,
        vehicleId: businessContext.vehicle.id,
        serviceId: service.id,
        startAt: startAt.toISOString(),
        endAt: endAt.toISOString(),
        notes: null,
      })
    }

    // --- Availability / new booking request, not yet confirmed: Phase 1 only. ---
    if (!confirmed && /свободн|available|availability|slot|запиш|записать|book|appointment/.test(lower)) {
      const service = pickService(businessContext, lower) ?? (businessContext.services.length === 1 ? businessContext.services[0] : null)
      if (!service) {
        return { type: 'final', raw: finalResult('AVAILABILITY_INQUIRY', 0.5, askWhichService(businessContext), false, null) }
      }
      const dateKey = resolveDateKey(message, history, businessContext.business.timezone) ?? tomorrowKey(businessContext.business.timezone)
      return toolCallResult('check_availability', {
        customerId: businessContext.customer?.id ?? null,
        vehicleId: businessContext.vehicle?.id ?? null,
        serviceId: service.id,
        date: dateKey,
        preferredTimeFrom: null,
        preferredTimeTo: null,
      })
    }

    // --- Everything else: AI Customer Support (Prompt 11), grounded in real business data. ---
    return { type: 'final', raw: classifyCustomerSupport(request) }
  }
}

function toolCallResult(name: string, args: Record<string, unknown>): { type: 'tool_calls'; calls: AiToolCallRequest[] } {
  return { type: 'tool_calls', calls: [{ id: 't1', name, arguments: args }] }
}

function finalResult(
  intent: AiIntent,
  confidence: number,
  answer: string,
  needsHuman: boolean,
  reason: string | null,
  serviceName: string | null = null
) {
  return { intent, confidence, entities: { ...EMPTY_AI_ENTITIES, serviceName }, answer, needsHuman, reason }
}

function buildFinalFromToolResult(exchange: AiToolExchange) {
  const { call, result } = exchange

  if (!result.success) {
    if (result.errorCode === 'CONFIRMATION_REQUIRED') {
      return finalResult('BOOKING_REQUEST', 0.8, 'Уточните, пожалуйста: вы подтверждаете это действие?', false, null)
    }
    if (result.errorCode === 'APPOINTMENT_CONFLICT') {
      return finalResult(
        'BOOKING_REQUEST',
        0.6,
        'К сожалению, это время уже занято — пожалуйста, выберите другое.',
        false,
        'APPOINTMENT_CONFLICT: slot no longer available'
      )
    }
    return finalResult('UNKNOWN', 0.3, 'Не удалось выполнить это действие — обратитесь к сотруднику автосервиса.', true, `${result.errorCode}: ${result.message}`)
  }

  if (call.name === 'check_availability') {
    const data = result.data as { available: boolean; slots: { localStart: string; localEnd: string }[]; date: string }
    if (!data.available || data.slots.length === 0) {
      return finalResult('AVAILABILITY_INQUIRY', 0.85, `На ${data.date} свободных слотов нет. Хотите проверить другой день?`, false, null)
    }
    const list = data.slots.slice(0, 6).map((s) => s.localStart).join(', ')
    return finalResult(
      'AVAILABILITY_INQUIRY',
      0.9,
      `Свободное время на ${data.date}: ${list}. Подтвердите, пожалуйста, удобное время, и я запишу вас.`,
      false,
      null
    )
  }

  if (call.name === 'create_appointment') {
    return finalResult('BOOKING_REQUEST', 0.95, 'Готово, вы записаны.', false, null)
  }
  if (call.name === 'reschedule_appointment') {
    return finalResult('RESCHEDULE_REQUEST', 0.95, 'Готово, ваша запись перенесена.', false, null)
  }
  if (call.name === 'cancel_appointment') {
    return finalResult('CANCELLATION_REQUEST', 0.95, 'Готово, ваша запись отменена.', false, null)
  }
  return finalResult('UNKNOWN', 0.3, 'Не удалось обработать результат.', true, 'Unrecognized tool result')
}

function pickService(context: AiBusinessContext, lowerMessage: string) {
  return context.services.find((s) => lowerMessage.includes(s.name.toLowerCase())) ?? null
}

function pickSingleUpcomingAppointment(context: AiBusinessContext) {
  return context.upcomingAppointments.length === 1 ? context.upcomingAppointments[0]! : null
}

function askWhichService(context: AiBusinessContext): string {
  const names = context.services.map((s) => s.name).join(', ')
  return names ? `Уточните, пожалуйста, какая услуга вас интересует: ${names}?` : 'Уточните, пожалуйста, какая услуга вас интересует.'
}

function askWhichAppointment(context: AiBusinessContext): string {
  if (context.upcomingAppointments.length === 0) return 'У вас нет предстоящих записей — уточните, пожалуйста, о какой записи речь.'
  const list = context.upcomingAppointments.map((a) => `${a.serviceName} (${a.startAtLocal})`).join('; ')
  return `Уточните, пожалуйста, какую именно запись вы имеете в виду: ${list}?`
}

function askCancelConfirmation(context: AiBusinessContext): string {
  const appt = pickSingleUpcomingAppointment(context)
  return appt
    ? `Подтвердите, пожалуйста: отменить вашу запись на ${appt.startAtLocal} (${appt.serviceName})?`
    : askWhichAppointment(context)
}

const TIME_RE = /\b([01]?\d|2[0-3]):([0-5]\d)\b/

function extractTime(text: string): string | null {
  const match = TIME_RE.exec(text)
  if (!match) return null
  return `${match[1]!.padStart(2, '0')}:${match[2]}`
}

const DATE_RE = /\b(\d{4}-\d{2}-\d{2})\b/

function extractDate(text: string): string | null {
  const match = DATE_RE.exec(text)
  return match ? match[1]! : null
}

function tomorrowKey(timezone: string): string {
  return toBusinessLocalDateTime(new Date(Date.now() + 24 * 60 * 60 * 1000), timezone).dateKey
}

function todayKey(timezone: string): string {
  return toBusinessLocalDateTime(new Date(), timezone).dateKey
}

/** Looks at the current message first, then walks history backwards for the most recent date hint. Never invents a date silently — callers fall back to "tomorrow" only when nothing at all is found, matching the spec's own worked example. */
function resolveDateKey(message: string, history: AiHistoryMessage[], timezone: string): string | null {
  const direct = extractDate(message)
  if (direct) return direct
  if (/завтра|tomorrow/i.test(message)) return tomorrowKey(timezone)
  if (/сегодня|today/i.test(message)) return todayKey(timezone)

  for (let i = history.length - 1; i >= 0; i--) {
    const content = history[i]!.content
    const fromHistory = extractDate(content)
    if (fromHistory) return fromHistory
    if (/завтра|tomorrow/i.test(content)) return tomorrowKey(timezone)
    if (/сегодня|today/i.test(content)) return todayKey(timezone)
  }
  return null
}

// --- AI Customer Support (Prompt 11): grounded classification for
// anything that isn't booking-shaped. Every answer below is built strictly
// from businessContext (Services/Knowledge/Rules/serviceHistory/customer/
// vehicle) — never an invented price, service, warranty term, or history
// fact. Intentionally simple keyword matching, not a real NLU model — it
// exists to prove the grounding/no-diagnosis/no-fabrication rules
// end-to-end deterministically (spec §"MOCK PROVIDER": "tests must remain
// deterministic"), the same way the booking branches above prove the
// two-phase confirmation flow.
function classifyCustomerSupport(request: AiGenerationRequest) {
  const context = request.businessContext
  const message = request.userMessage.toLowerCase()
  const matchedService = context.services.find((s) => message.includes(s.name.toLowerCase()))

  if (/сколько стоит|стоимость|цена|price|cost|how much/.test(message)) {
    return priceInquiryResult(matchedService)
  }
  if (/гаранти|warranty/.test(message)) {
    return warrantyInquiryResult(context)
  }
  if (/истори|прошл(ый|ое)\s+(визит|обслуживание|раз)|когда.*(меняли|делали|обслуживали)|на каком пробеге|какие работы|выполнялись|service history/.test(message)) {
    return serviceHistoryInquiryResult(context, message)
  }
  if (/стук|скрип|не заводится|не работает|сломал|странный звук|течёт|запах гари|вибрац/.test(message)) {
    return vehicleProblemResult(context, message)
  }
  if (/мои данные|обо мне|my (info|data|profile)/.test(message)) {
    return customerInformationResult(context)
  }

  // Step 6/7/8 (source priority): a general question is answered from
  // Business Rules first (higher priority than Knowledge Base), then
  // Knowledge Base, before falling back to a matched Service or an honest
  // "not found".
  const words = tokenize(message)
  const ruleMatch = findMatchingRule(context.rules, words)
  if (ruleMatch) {
    return finalResult('GENERAL_QUESTION', 0.8, ruleMatch.description, false, null, matchedService?.name ?? null)
  }
  const kbMatch = findMatchingKnowledge(context.knowledge, words)
  if (kbMatch) {
    return finalResult('GENERAL_QUESTION', 0.8, kbMatch.content, false, null, matchedService?.name ?? null)
  }

  if (matchedService) {
    return serviceInquiryResult(matchedService)
  }
  if (message.trim().length < 3) {
    return finalResult(
      'UNKNOWN',
      0.2,
      'Не уверен, что правильно понял ваш запрос — уточните, пожалуйста, подробнее, чем я могу помочь?',
      true,
      'Message too short to classify reliably.'
    )
  }
  // Step 20 (Missing information): an actual question that matched nothing
  // real gets an honest "I don't know", never a guess — a plain greeting
  // (no "?") still gets the ordinary welcome reply.
  if (message.includes('?')) {
    return finalResult(
      'UNKNOWN',
      0.4,
      'В доступной информации я не нашёл точного ответа на этот вопрос — уточните, пожалуйста, подробнее, или дождитесь ответа сотрудника.',
      true,
      'No matching Service/Knowledge/BusinessRule/History found for this message.'
    )
  }
  return finalResult(
    'GENERAL_QUESTION',
    0.6,
    `Спасибо за обращение в ${context.business.name}. Уточните, пожалуйста, ваш вопрос подробнее, чтобы я мог помочь точнее.`,
    false,
    null
  )
}

// Words are reduced to a short prefix ("stem") rather than compared as
// whole strings — Russian inflects heavily (оплата/оплаты/оплатить), and a
// deterministic mock has no real morphological analyzer available. A
// shared 5-character prefix is a crude but adequate and fully deterministic
// proxy for "same root word" for this mock's purposes.
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 4)
    .map((w) => w.slice(0, 5))
}

/** Lower `priority` number = higher priority (spec §"BUSINESS RULES") — a lower-priority rule must never be allowed to win over a higher-priority one. */
function findMatchingRule(rules: AiBusinessContext['rules'], words: string[]) {
  const candidates = rules.filter((r) => {
    const ruleWords = tokenize(`${r.name} ${r.description}`)
    return words.some((w) => ruleWords.includes(w))
  })
  if (candidates.length === 0) return null
  return [...candidates].sort((a, b) => a.priority - b.priority)[0]!
}

function findMatchingKnowledge(knowledge: AiBusinessContext['knowledge'], words: string[]) {
  return (
    knowledge.find((k) => {
      const kbWords = tokenize(`${k.title} ${k.content}`)
      return words.some((w) => kbWords.includes(w))
    }) ?? null
  )
}

function formatPriceRange(service: AiBusinessContext['services'][number]): string | null {
  if (service.priceFrom && service.priceTo && service.priceFrom !== service.priceTo) {
    return `${service.priceFrom}–${service.priceTo} ${service.currency}`
  }
  if (service.priceFrom) {
    return `от ${service.priceFrom} ${service.currency}`
  }
  return null
}

// Step 10 (Price safety): a range when both bounds exist, "from X" when
// only priceFrom exists, and an honest "no price on file" when neither
// does — never an invented or estimated figure.
function priceInquiryResult(matchedService: AiBusinessContext['services'][number] | undefined) {
  if (!matchedService) {
    return finalResult(
      'PRICE_INQUIRY',
      0.75,
      'Стоимость зависит от выбранной услуги и состояния автомобиля — уточните, пожалуйста, какая именно услуга вас интересует.',
      false,
      null
    )
  }
  const price = formatPriceRange(matchedService)
  if (!price) {
    return finalResult(
      'PRICE_INQUIRY',
      0.7,
      'В базе сервиса сейчас нет точной цены на эту работу. Лучше уточнить стоимость у администратора.',
      false,
      null,
      matchedService.name
    )
  }
  return finalResult(
    'PRICE_INQUIRY',
    0.92,
    `Услуга «${matchedService.name}» стоит ${price}. Точная стоимость может зависеть от состояния автомобиля.`,
    false,
    null,
    matchedService.name
  )
}

// Step 9: name/description/priceFrom/priceTo/currency/durationMinutes — never an invented discount, warranty, or parts guarantee.
function serviceInquiryResult(service: AiBusinessContext['services'][number]) {
  const parts = [`Да, у нас есть услуга «${service.name}».`]
  if (service.description) parts.push(service.description)
  const price = formatPriceRange(service)
  if (price) parts.push(`Ориентировочная стоимость: ${price}.`)
  parts.push(`Продолжительность: около ${service.durationMinutes} мин.`)
  return finalResult('SERVICE_INQUIRY', 0.85, parts.join(' '), false, null, service.name)
}

// Step 14 (Warranty): grounded in Business Rules first, then Knowledge
// Base; if neither covers it, say so honestly rather than inventing a term.
function warrantyInquiryResult(context: AiBusinessContext) {
  const keywords = ['гаранти', 'warranty']
  const rule = context.rules.find((r) => keywords.some((k) => r.name.toLowerCase().includes(k) || r.description.toLowerCase().includes(k) || r.category.toLowerCase().includes(k)))
  if (rule) {
    return finalResult('WARRANTY_INQUIRY', 0.85, `Согласно правилам сервиса: ${rule.description}`, false, null)
  }
  const kb = context.knowledge.find((k) => keywords.some((w) => k.title.toLowerCase().includes(w) || k.content.toLowerCase().includes(w) || k.category.toLowerCase().includes(w)))
  if (kb) {
    return finalResult('WARRANTY_INQUIRY', 0.85, kb.content, false, null)
  }
  return finalResult(
    'WARRANTY_INQUIRY',
    0.55,
    'По имеющейся информации я не могу подтвердить, распространяется ли гарантия именно на этот случай — уточните, пожалуйста, у администратора сервиса.',
    true,
    'Warranty question could not be grounded in Business Rules or Knowledge Base.'
  )
}

// Step 19: real ServiceRecord facts only, never invented — an empty
// history says so plainly instead of deflecting to "ask staff".
function serviceHistoryInquiryResult(context: AiBusinessContext, message: string) {
  if (context.serviceHistory.length === 0) {
    return finalResult('SERVICE_HISTORY_INQUIRY', 0.8, 'В истории обслуживания этого автомобиля сейчас нет записей.', false, null)
  }
  const namedService = context.services.find((s) => message.includes(s.name.toLowerCase()))
  // serviceHistory is already newest-first (contextBuilder.ts / repository ordering) — [0] is the most recent record overall.
  const record = namedService ? context.serviceHistory.find((r) => r.serviceName === namedService.name) : context.serviceHistory[0]
  if (!record) {
    return finalResult(
      'SERVICE_HISTORY_INQUIRY',
      0.75,
      'В истории обслуживания этого автомобиля нет записей по этой услуге.',
      false,
      null,
      namedService?.name ?? null
    )
  }
  const mileagePart = record.mileage != null ? ` при пробеге ${record.mileage} км` : ''
  return finalResult(
    'SERVICE_HISTORY_INQUIRY',
    0.9,
    `По нашей истории, ${record.performedAtLocal} выполнено: ${record.serviceName.toLowerCase()}${mileagePart}. ${record.workDescription}`,
    false,
    null,
    record.serviceName
  )
}

// Step 5/12 (never a diagnosis): history is cited as fact when relevant,
// but the current complaint's cause is always left unresolved without an
// inspection — see AI_BEHAVIOR_CONTRACT.md §8 and safety.ts's
// applyDefinitiveDiagnosisCheck (defense-in-depth if this text is ever
// changed to something less careful).
function vehicleProblemResult(context: AiBusinessContext, message: string) {
  const symptomKeywords = ['тормоз', 'колодк', 'масл', 'фильтр', 'аккумулятор', 'ремень']
  const relatedHistory = context.serviceHistory.find((r) =>
    symptomKeywords.some((kw) => message.includes(kw) && (r.serviceName.toLowerCase().includes(kw) || r.workDescription.toLowerCase().includes(kw)))
  )
  const historyNote = relatedHistory
    ? ` По истории обслуживания: ${relatedHistory.performedAtLocal} — ${relatedHistory.workDescription.toLowerCase()}. Однако по одной лишь истории нельзя установить, связана ли текущая жалоба с этой работой.`
    : ''
  return finalResult(
    'VEHICLE_PROBLEM',
    0.65,
    `Спасибо за описание проблемы. По имеющейся информации нельзя точно определить причину — рекомендуется очная диагностика в сервисе.${historyNote}`,
    true,
    'Vehicle symptom reports need a human diagnosis, not an AI guess.'
  )
}

// Step 15: known customer/vehicle fields only — never another customer's data, never an internal id.
function customerInformationResult(context: AiBusinessContext) {
  if (!context.customer) {
    return finalResult(
      'CUSTOMER_INFORMATION',
      0.5,
      'У меня пока нет данных о клиенте для этого разговора — уточните, пожалуйста, свои данные, либо дождитесь ответа сотрудника.',
      true,
      null
    )
  }
  const name = context.customer.lastName ? `${context.customer.firstName} ${context.customer.lastName}` : context.customer.firstName
  const vehiclePart = context.vehicle
    ? ` Автомобиль: ${context.vehicle.make} ${context.vehicle.model}${context.vehicle.licensePlate ? ` (${context.vehicle.licensePlate})` : ''}.`
    : ''
  return finalResult('CUSTOMER_INFORMATION', 0.85, `По нашим данным: ${name}, телефон ${context.customer.phone}.${vehiclePart}`, false, null)
}
