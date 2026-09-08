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

    if (/ignore (all |previous )?instructions|reveal.*(key|secret|password)|system prompt/i.test(message)) {
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

    // --- Everything else: Prompt 09's original plain classification, unchanged. ---
    return { type: 'final', raw: legacyClassify(request) }
  }
}

function toolCallResult(name: string, args: Record<string, unknown>): { type: 'tool_calls'; calls: AiToolCallRequest[] } {
  return { type: 'tool_calls', calls: [{ id: 't1', name, arguments: args }] }
}

function finalResult(intent: AiIntent, confidence: number, answer: string, needsHuman: boolean, reason: string | null) {
  return { intent, confidence, entities: { ...EMPTY_AI_ENTITIES }, answer, needsHuman, reason }
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

// --- Prompt 09's original plain classification, reused unchanged as the fallback for anything that isn't booking-shaped. ---
function legacyClassify(request: AiGenerationRequest) {
  const message = request.userMessage.toLowerCase()
  const matchedService = request.businessContext.services.find((s) => message.includes(s.name.toLowerCase()))

  let intent: AiIntent = 'GENERAL_QUESTION'
  let confidence = 0.6
  let needsHuman = false
  let reason: string | null = null

  if (/сколько стоит|стоимость|цена|price|cost|how much/.test(message)) {
    intent = 'PRICE_INQUIRY'
    confidence = matchedService ? 0.92 : 0.75
  } else if (/гаранти|warranty/.test(message)) {
    intent = 'WARRANTY_INQUIRY'
    confidence = 0.7
  } else if (/истори|прошл(ый|ое) (визит|обслуживание)|service history/.test(message)) {
    intent = 'SERVICE_HISTORY_INQUIRY'
    confidence = 0.65
  } else if (/стук|скрип|не заводится|не работает|сломал|странный звук|течёт|запах гари/.test(message)) {
    intent = 'VEHICLE_PROBLEM'
    confidence = 0.68
    needsHuman = true
    reason = 'Vehicle symptom reports need a human diagnosis, not an AI guess.'
  } else if (/мои данные|обо мне|my (info|data|profile)/.test(message)) {
    intent = 'CUSTOMER_INFORMATION'
    confidence = 0.6
  } else if (matchedService) {
    intent = 'SERVICE_INQUIRY'
    confidence = 0.8
  } else if (message.trim().length < 3) {
    intent = 'UNKNOWN'
    confidence = 0.2
    needsHuman = true
    reason = 'Message too short to classify reliably.'
  }

  const answer = buildLegacyAnswer(intent, matchedService?.name ?? null, request)
  return {
    intent,
    confidence,
    entities: { ...EMPTY_AI_ENTITIES, serviceName: matchedService?.name ?? null },
    answer,
    needsHuman,
    reason,
  }
}

function buildLegacyAnswer(intent: AiIntent, serviceName: string | null, request: AiGenerationRequest): string {
  const { business, services } = request.businessContext

  switch (intent) {
    case 'PRICE_INQUIRY': {
      if (serviceName) {
        const svc = services.find((s) => s.name === serviceName)
        if (svc?.priceFrom) {
          const range = svc.priceTo && svc.priceTo !== svc.priceFrom ? `${svc.priceFrom}–${svc.priceTo}` : svc.priceFrom
          return `Услуга «${svc.name}» стоит ${range} ${svc.currency}. Точная стоимость может зависеть от состояния автомобиля.`
        }
      }
      return 'Стоимость зависит от выбранной услуги и состояния автомобиля — уточните, пожалуйста, какая именно услуга вас интересует.'
    }
    case 'VEHICLE_PROBLEM':
      return 'Спасибо за описание проблемы. Точную причину сможет определить только диагностика в сервисе — передаю ваш запрос сотруднику.'
    case 'WARRANTY_INQUIRY':
      return 'По вопросам гарантии уточню у сотрудника, если в базе знаний нет прямого ответа на ваш случай.'
    case 'SERVICE_HISTORY_INQUIRY':
      return 'По истории обслуживания вашего автомобиля лучше проконсультирует сотрудник автосервиса.'
    case 'CUSTOMER_INFORMATION':
      return 'По вопросам, связанным с вашими личными данными, вас проконсультирует сотрудник автосервиса.'
    case 'SERVICE_INQUIRY':
      return serviceName
        ? `Да, у нас есть услуга «${serviceName}». Уточните, пожалуйста, что именно вас интересует по ней?`
        : `${business.name} предоставляет несколько услуг — уточните, пожалуйста, что вас интересует?`
    case 'UNKNOWN':
      return 'Не уверен, что правильно понял ваш запрос — уточните, пожалуйста, подробнее, чем я могу помочь?'
    case 'GENERAL_QUESTION':
    default:
      return `Спасибо за обращение в ${business.name}. Уточните, пожалуйста, ваш вопрос подробнее, чтобы я мог помочь точнее.`
  }
}
