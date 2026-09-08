import type { AuthContext } from '../types/auth'
import { ApiError } from '../lib/errors'
import { requireRole } from '../middleware/requireRole'
import { conversationRepository } from '../repositories/conversationRepository'
import { messageRepository } from '../repositories/messageRepository'
import { buildAiContext } from '../ai/contextBuilder'
import { buildSystemPrompt } from '../ai/promptBuilder'
import { aiResultSchema } from '../ai/aiResult.schema'
import { applySafetyLayer } from '../ai/safety'
import { getAiProvider } from '../ai/aiProviderFactory'
import { AiProviderError } from '../ai/provider'
import type { AiProvider } from '../ai/provider'
import { EMPTY_AI_ENTITIES, type AiResult } from '../ai/types'
import type { AnalyzeMessageInput } from '../validation/ai.schemas'

/** Only the most recent messages are sent to the provider — spec §"MESSAGE HISTORY": bounded, chronological, not the entire conversation. */
const MAX_HISTORY_MESSAGES = 20

function buildFallbackResult(reason: string): AiResult {
  return {
    intent: 'UNKNOWN',
    confidence: 0,
    entities: { ...EMPTY_AI_ENTITIES },
    answer: 'Не удалось надёжно проанализировать сообщение — требуется участие сотрудника.',
    needsHuman: true,
    reason,
  }
}

interface AnalyzeDeps {
  /** Test-only override; production code always goes through aiProviderFactory.ts. */
  provider?: AiProvider
}

// AI Core is read-only end to end (spec §"AI DOES NOT WRITE TO DATABASE"):
// this function never creates/updates any row. Owner/admin/manager all get
// access — same operational exception as Appointment/Conversation/etc.
export async function analyzeMessage(ctx: AuthContext, input: AnalyzeMessageInput, deps: AnalyzeDeps = {}): Promise<AiResult> {
  requireRole(ctx, 'owner', 'admin', 'manager')

  const conversation = await conversationRepository.findById(ctx.tenant.id, ctx.business.id, input.conversationId)
  if (!conversation) {
    throw new ApiError(404, 'NOT_FOUND', 'Conversation not found')
  }
  if (conversation.status !== 'OPEN') {
    throw new ApiError(409, 'CONVERSATION_CLOSED', 'Cannot analyze a message in a closed conversation — reopen it first')
  }

  const [context, allMessages] = await Promise.all([
    buildAiContext(ctx, conversation),
    messageRepository.listByConversation(ctx.tenant.id, ctx.business.id, conversation.id),
  ])
  const history = allMessages.slice(-MAX_HISTORY_MESSAGES).map((m) => ({ direction: m.direction, content: m.content }))

  const provider = deps.provider ?? getAiProvider()
  const systemPrompt = buildSystemPrompt()

  let raw: unknown
  try {
    const generation = await provider.generate({
      systemPrompt,
      businessContext: context,
      history,
      // The one and only untrusted value in this whole call — see
      // provider.ts and promptBuilder.ts for how it stays separated from
      // system instructions and business context.
      userMessage: input.message,
    })
    raw = generation.raw
  } catch (err) {
    if (err instanceof AiProviderError) {
      // AI_CONFIGURATION_ERROR: the server itself isn't set up to call any
      // real provider (defense-in-depth only — aiProviderFactory.ts
      // already avoids ever reaching this in that case). AI_PROVIDER_
      // UNAVAILABLE: the provider was called but failed (network/API
      // error) — either way there is no model output at all to build even
      // a degraded AiResult from, so this is a real HTTP error, not a
      // fallback result.
      const status = err.code === 'AI_CONFIGURATION_ERROR' ? 500 : 502
      throw new ApiError(status, err.code, 'AI provider is currently unavailable')
    }
    throw new ApiError(502, 'AI_PROVIDER_UNAVAILABLE', 'AI provider is currently unavailable')
  }

  // Unlike a provider-call failure, the provider DID respond here — it's
  // just untrustworthy. That's a "controlled AI error" (spec), not an
  // infrastructure failure: it degrades to a safe result (needsHuman:
  // true) rather than throwing, since analyze() completing with an honest
  // "escalate" answer is strictly more useful to staff than a bare 5xx.
  const parsed = aiResultSchema.safeParse(raw)
  if (!parsed.success) {
    return buildFallbackResult('AI_INVALID_RESPONSE: the AI response failed structural validation')
  }

  return applySafetyLayer(parsed.data)
}
