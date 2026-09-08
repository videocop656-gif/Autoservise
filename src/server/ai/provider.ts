import type { AiBusinessContext, AiHistoryMessage } from './types'

/**
 * Everything a provider needs to produce a result, kept as separate fields
 * (never pre-concatenated into one blob) so every implementation is forced
 * to keep system instructions, trusted business context, conversation
 * history, and the untrusted current user message apart — see
 * docs/AI_BEHAVIOR_CONTRACT.md and the prompt-injection section of the
 * Prompt 09 spec. The current user message is the one and only untrusted
 * value here; everything else originates server-side.
 */
export interface AiGenerationRequest {
  systemPrompt: string
  businessContext: AiBusinessContext
  history: AiHistoryMessage[]
  userMessage: string
}

export interface AiGenerationResult {
  /** The provider's raw structured output, not yet Zod-validated — aiService.ts owns that step. */
  raw: unknown
}

export interface AiProvider {
  generate(request: AiGenerationRequest): Promise<AiGenerationResult>
}

/** Errors a provider can't recover from on its own — no model output exists at all to fall back on. */
export const AI_PROVIDER_ERROR_CODES = ['AI_PROVIDER_UNAVAILABLE', 'AI_CONFIGURATION_ERROR'] as const
export type AiProviderErrorCode = (typeof AI_PROVIDER_ERROR_CODES)[number]

export class AiProviderError extends Error {
  readonly code: AiProviderErrorCode
  constructor(code: AiProviderErrorCode, message: string) {
    super(message)
    this.code = code
  }
}
