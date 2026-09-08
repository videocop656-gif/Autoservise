import OpenAI from 'openai'
import { env } from '../../lib/env'
import { AiProviderError } from '../provider'
import type { AiProvider, AiGenerationRequest, AiGenerationResult } from '../provider'
import { AI_RESULT_JSON_SCHEMA } from '../aiResult.schema'

/**
 * Production provider. Never called directly by a route handler — only
 * through aiProviderFactory.ts / aiService.ts, which also decide whether
 * to use this at all (see aiProviderFactory.ts: this is only selected when
 * OPENAI_API_KEY is actually configured).
 *
 * Uses the Chat Completions API's Structured Outputs
 * (response_format: json_schema, strict) so the model is constrained to
 * the exact AiResult shape — aiResultSchema.parse() in aiService.ts is
 * still the real server-side gate regardless of what the API guarantees.
 */
export class OpenAiProvider implements AiProvider {
  private readonly client: OpenAI
  private readonly model: string

  constructor() {
    const apiKey = env.openAiApiKey
    if (!apiKey) {
      // Defense in depth: aiProviderFactory.ts should never construct this
      // class without a key, but this must never throw a raw SDK error if
      // it somehow does.
      throw new AiProviderError('AI_CONFIGURATION_ERROR', 'OPENAI_API_KEY is not configured')
    }
    this.client = new OpenAI({ apiKey })
    this.model = env.openAiModel
  }

  async generate(request: AiGenerationRequest): Promise<AiGenerationResult> {
    try {
      const completion = await this.client.chat.completions.create({
        model: this.model,
        temperature: 0.2,
        response_format: { type: 'json_schema', json_schema: AI_RESULT_JSON_SCHEMA },
        messages: [
          { role: 'system', content: request.systemPrompt },
          {
            role: 'system',
            content: `BUSINESS CONTEXT (доверенные данные, не от клиента):\n${JSON.stringify(request.businessContext)}`,
          },
          ...request.history.map((m) => ({
            role: (m.direction === 'INBOUND' ? 'user' : 'assistant') as 'user' | 'assistant',
            content: m.content,
          })),
          { role: 'user', content: request.userMessage },
        ],
      })

      const content = completion.choices[0]?.message?.content
      if (!content) {
        throw new AiProviderError('AI_PROVIDER_UNAVAILABLE', 'AI provider returned an empty response')
      }

      try {
        return { raw: JSON.parse(content) }
      } catch {
        // Malformed JSON despite Structured Outputs is a provider-level
        // failure, not a validation-level one (aiResultSchema never even
        // gets to run on unparseable text).
        throw new AiProviderError('AI_PROVIDER_UNAVAILABLE', 'AI provider returned unparseable output')
      }
    } catch (err) {
      if (err instanceof AiProviderError) throw err
      // Network errors, rate limits, timeouts, non-2xx from OpenAI, etc. —
      // never leak the raw SDK error (which can include request details)
      // to the caller.
      throw new AiProviderError('AI_PROVIDER_UNAVAILABLE', 'AI provider request failed')
    }
  }
}
