import type { AiProvider, AiGenerationRequest, AiGenerationResult } from '../provider'
import { EMPTY_AI_ENTITIES, type AiIntent } from '../types'

/**
 * Deterministic, keyword-based provider — no network access, no
 * OPENAI_API_KEY required. Used by:
 *  - every automated test in this codebase (spec: "Mock provider должен
 *    позволять unit/integration тестам работать без OPENAI_API_KEY");
 *  - aiProviderFactory.ts as the automatic production fallback whenever
 *    OPENAI_API_KEY is unset, so the AI Core stays fully exercisable (incl.
 *    the real Supabase smoke test) without ever needing a real key.
 *
 * This is intentionally simple pattern matching, not a real classifier —
 * it exists to prove the whole pipeline (context building, prompt
 * separation, Zod validation, safety checks, confidence policy, tenant
 * isolation) end-to-end, not to produce good answers.
 */
export class MockAiProvider implements AiProvider {
  async generate(request: AiGenerationRequest): Promise<AiGenerationResult> {
    const message = request.userMessage.toLowerCase()

    const injectionAttempt = /ignore (all |previous )?instructions|reveal.*(key|secret|password)|system prompt/i.test(
      request.userMessage
    )

    const matchedService = request.businessContext.services.find((s) => message.includes(s.name.toLowerCase()))

    let intent: AiIntent = 'GENERAL_QUESTION'
    let confidence = 0.6
    let needsHuman = false
    let reason: string | null = null

    if (injectionAttempt) {
      intent = 'UNKNOWN'
      confidence = 0.3
      needsHuman = true
      reason = 'Message appears to attempt to override system instructions; escalating for safety.'
    } else if (/сколько стоит|стоимость|цена|price|cost|how much/.test(message)) {
      intent = 'PRICE_INQUIRY'
      confidence = matchedService ? 0.92 : 0.75
    } else if (/перенес|reschedul/.test(message)) {
      intent = 'RESCHEDULE_REQUEST'
      confidence = 0.7
    } else if (/отмен|cancel/.test(message)) {
      intent = 'CANCELLATION_REQUEST'
      confidence = 0.75
    } else if (/свободн|когда можно|available|availability|slot/.test(message)) {
      intent = 'AVAILABILITY_INQUIRY'
      confidence = 0.7
    } else if (/запиш|записать|book|appointment/.test(message)) {
      intent = 'BOOKING_REQUEST'
      confidence = 0.72
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

    const answer = injectionAttempt
      ? 'Извините, я не могу выполнить этот запрос. Чем ещё я могу помочь по вопросам автосервиса?'
      : buildAnswer(intent, matchedService?.name ?? null, request)

    return {
      raw: {
        intent,
        confidence,
        entities: {
          ...EMPTY_AI_ENTITIES,
          serviceName: matchedService?.name ?? null,
        },
        answer,
        needsHuman,
        reason,
      },
    }
  }
}

function buildAnswer(intent: AiIntent, serviceName: string | null, request: AiGenerationRequest): string {
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
    case 'AVAILABILITY_INQUIRY':
    case 'BOOKING_REQUEST':
      return 'Я не могу проверить реальное расписание или создать запись самостоятельно — этим займётся сотрудник автосервиса.'
    case 'RESCHEDULE_REQUEST':
    case 'CANCELLATION_REQUEST':
      return 'Для изменения или отмены записи потребуется участие сотрудника автосервиса.'
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
