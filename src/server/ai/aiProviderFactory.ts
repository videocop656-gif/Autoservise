import { env } from '../lib/env'
import type { AiProvider } from './provider'
import { OpenAiProvider } from './providers/openAiProvider'
import { MockAiProvider } from './providers/mockAiProvider'

/**
 * Selects the active AiProvider for production use (tests inject their own
 * mock directly into aiService's functions — see aiService.ts's optional
 * `provider` parameter — and never go through this factory).
 *
 * When OPENAI_API_KEY is configured, OpenAiProvider is used. When it is
 * not, this falls back to MockAiProvider rather than making the entire AI
 * Core unusable — the spec explicitly anticipates this exact situation
 * ("если реальный OpenAI API key отсутствует, это НЕ является причиной
 * добавлять тестовый ключ... явно указать отсутствие real OpenAI call")
 * and the whole point of the provider abstraction is that the rest of the
 * system (context building, prompt separation, Zod validation, safety
 * checks, confidence policy, tenant isolation) is fully exercisable and
 * correct regardless of which concrete provider answers the request.
 * OpenAiProvider's own constructor still guards against being built
 * without a key, as defense in depth.
 */
export function getAiProvider(): AiProvider {
  if (env.openAiApiKey) {
    return new OpenAiProvider()
  }
  return new MockAiProvider()
}
