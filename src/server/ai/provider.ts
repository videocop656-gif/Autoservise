import type { AiBusinessContext, AiHistoryMessage, AiToolDefinition, AiToolCallRequest, AiToolExchange } from './types'

/**
 * Everything a provider needs to produce a result, kept as separate fields
 * (never pre-concatenated into one blob) so every implementation is forced
 * to keep system instructions, trusted business context, conversation
 * history, and the untrusted current user message apart — see
 * docs/AI_BEHAVIOR_CONTRACT.md and the prompt-injection section of the
 * Prompt 09 spec. The current user message is the one and only untrusted
 * value here; everything else originates server-side.
 *
 * Prompt 10 adds `tools` (the whitelist the model may call this round) and
 * `toolExchanges` — every tool call + result already resolved so far in
 * THIS analyze request. It starts empty on the first call; aiService.ts's
 * loop appends to it and calls generate() again until the provider returns
 * a final answer or the tool-call limit is reached. A provider that never
 * needs tools (or a non-booking message) simply always returns `type:
 * 'final'` — see MockAiProvider's fallback path.
 */
export interface AiGenerationRequest {
  systemPrompt: string
  businessContext: AiBusinessContext
  history: AiHistoryMessage[]
  userMessage: string
  tools: AiToolDefinition[]
  toolExchanges: AiToolExchange[]
}

/**
 * A provider round either asks the server to run one or more whitelisted
 * tools, or produces the final structured answer. `raw` is the provider's
 * raw structured output, not yet Zod-validated — aiService.ts owns that step.
 */
export type AiGenerationResult = { type: 'final'; raw: unknown } | { type: 'tool_calls'; calls: AiToolCallRequest[] }

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
