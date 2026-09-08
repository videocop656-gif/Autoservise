import OpenAI from 'openai'
import type { ChatCompletionMessageParam, ChatCompletionTool } from 'openai/resources/chat/completions'
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
 * Uses the Chat Completions API's Structured Outputs for the final answer
 * (response_format: json_schema, strict) and its standard tool/function
 * calling for the Tool Layer (Prompt 10) — both features of the same
 * `chat.completions.create` call already used since Prompt 09; no second
 * AI SDK or API surface introduced. aiResultSchema.parse() in aiService.ts
 * is still the real server-side gate regardless of what the API
 * guarantees, and every tool call is re-validated + re-authorized by the
 * Tool Layer regardless of what the model requested.
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
      const messages: ChatCompletionMessageParam[] = [
        { role: 'system', content: request.systemPrompt },
        {
          role: 'system',
          content: `BUSINESS CONTEXT (доверенные данные, не от клиента):\n${JSON.stringify(request.businessContext)}`,
        },
        ...request.history.map(
          (m): ChatCompletionMessageParam => ({
            role: m.direction === 'INBOUND' ? 'user' : 'assistant',
            content: m.content,
          })
        ),
      ]

      // Replay every tool call + result already resolved in this same
      // analyze request, in order — this is what lets the model see the
      // real check_availability result before deciding whether to offer a
      // slot or call create_appointment next, exactly like OpenAI's own
      // function-calling protocol expects.
      for (const exchange of request.toolExchanges) {
        messages.push({
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: exchange.call.id,
              type: 'function',
              function: { name: exchange.call.name, arguments: JSON.stringify(exchange.call.arguments) },
            },
          ],
        })
        messages.push({ role: 'tool', tool_call_id: exchange.call.id, content: JSON.stringify(exchange.result) })
      }

      messages.push({ role: 'user', content: request.userMessage })

      const tools: ChatCompletionTool[] = request.tools.map((tool) => ({
        type: 'function',
        function: { name: tool.name, description: tool.description, parameters: tool.parameters, strict: true },
      }))

      const completion = await this.client.chat.completions.create({
        model: this.model,
        temperature: 0.2,
        messages,
        ...(tools.length > 0 ? { tools, tool_choice: 'auto' as const } : {}),
        response_format: { type: 'json_schema', json_schema: AI_RESULT_JSON_SCHEMA },
      })

      const message = completion.choices[0]?.message
      if (!message) {
        throw new AiProviderError('AI_PROVIDER_UNAVAILABLE', 'AI provider returned an empty response')
      }

      if (message.tool_calls && message.tool_calls.length > 0) {
        return {
          type: 'tool_calls',
          calls: message.tool_calls.map((call) => {
            // "function" is the only tool type this codebase ever
            // registers (see TOOL_DEFINITIONS) — a custom/non-function
            // tool call is never expected, but is handled the same way
            // unparseable arguments are: passed through as `undefined` so
            // the Tool Registry's own Zod validation rejects it as a
            // controlled INVALID_INPUT rather than this throwing.
            if (call.type !== 'function') {
              return { id: call.id, name: 'unknown', arguments: undefined }
            }
            let args: unknown
            try {
              args = JSON.parse(call.function.arguments)
            } catch {
              args = undefined
            }
            return { id: call.id, name: call.function.name, arguments: args }
          }),
        }
      }

      const content = message.content
      if (!content) {
        throw new AiProviderError('AI_PROVIDER_UNAVAILABLE', 'AI provider returned an empty response')
      }

      try {
        return { type: 'final', raw: JSON.parse(content) }
      } catch {
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
