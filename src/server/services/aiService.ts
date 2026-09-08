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
import type { AiProvider, AiGenerationResult } from '../ai/provider'
import { TOOL_DEFINITIONS, executeTool } from '../ai/tools/registry'
import { EMPTY_AI_ENTITIES, type AiResult, type AiToolExchange } from '../ai/types'
import type { AnalyzeMessageInput } from '../validation/ai.schemas'
import { createOrReuseActiveEscalation, deriveEscalationReason, deriveEscalationSummary } from './escalationService'

/** Only the most recent messages are sent to the provider — spec §"MESSAGE HISTORY": bounded, chronological, not the entire conversation. */
const MAX_HISTORY_MESSAGES = 20

/** Spec §"AI SERVICE LOOP": no more than 3 tool calls per analyze request — prevents runaway execution. */
const MAX_TOOL_CALLS = 3

/** One resolved tool call, sanitized for the API response — never the raw ToolResult.data shape assumed, just tool name + outcome. */
export interface AiToolExecutionSummary {
  tool: string
  success: boolean
  data?: unknown
  errorCode?: string
  message?: string
}

/** Safe, minimal reference to a real AiEscalation row — never tenantId/businessId/internal metadata (spec §"AI ANALYZE RESPONSE"). */
export interface AiEscalationReference {
  id: string
  status: string
}

export interface AiAnalyzeResult extends AiResult {
  /** Present only when at least one tool actually ran this request — additive, so existing non-booking consumers are unaffected. */
  toolExecutions?: AiToolExecutionSummary[]
  /** Present only when needsHuman === true and a real escalation was created or reused (Prompt 12) — absent/undefined otherwise, never a placeholder. */
  escalation?: AiEscalationReference
}

function summarizeExchanges(exchanges: AiToolExchange[]): AiToolExecutionSummary[] | undefined {
  if (exchanges.length === 0) return undefined
  return exchanges.map(({ call, result }) =>
    result.success
      ? { tool: call.name, success: true, data: result.data }
      : { tool: call.name, success: false, errorCode: result.errorCode, message: result.message }
  )
}

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

async function callProvider(
  provider: AiProvider,
  args: Parameters<AiProvider['generate']>[0]
): Promise<AiGenerationResult> {
  try {
    return await provider.generate(args)
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
}

// AI Core reads Conversation/Message/Business/Service/Knowledge/Rules/
// Customer/Vehicle and, via the Tool Layer, may now also create/update a
// real Appointment (Prompt 10) — but ONLY through the whitelisted tools
// below, which themselves only ever call the existing, unchanged
// appointmentService.ts functions. This function itself never touches
// Prisma directly. Owner/admin/manager all get access — same operational
// exception as Appointment/Conversation/etc.
export async function analyzeMessage(ctx: AuthContext, input: AnalyzeMessageInput, deps: AnalyzeDeps = {}): Promise<AiAnalyzeResult> {
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

  // Server-controlled tool-calling loop (spec §"AI TOOL DECISION" /
  // "FUNCTION CALLING / STRUCTURED TOOLS"): the model may only ever
  // request one of the four whitelisted tools; every call is Zod-validated
  // and re-authorized against real tenant-scoped data by the Tool Registry
  // regardless of what the model supplied — see tools/registry.ts. This
  // loop only ever accumulates already-resolved exchanges and asks the
  // provider to continue; it never lets the provider or the tools talk to
  // each other directly.
  const toolExchanges: AiToolExchange[] = []
  let raw: unknown
  let exceededLimit = false

  // Up to MAX_TOOL_CALLS rounds that may each execute one or more tools,
  // plus one final round (round === MAX_TOOL_CALLS) that is only ever
  // allowed to produce an answer, not request another tool — that's what
  // guarantees the provider always gets to see the result of the LAST
  // allowed tool call before being cut off, rather than being cut off one
  // round too early.
  for (let round = 0; round <= MAX_TOOL_CALLS; round++) {
    const generation = await callProvider(provider, {
      systemPrompt,
      businessContext: context,
      history,
      // The one and only untrusted value in this whole call — see
      // provider.ts and promptBuilder.ts for how it stays separated from
      // system instructions and business context. Also the same value the
      // confirmation gate (confirmation.ts) checks before any mutating
      // tool is allowed to execute.
      userMessage: input.message,
      tools: TOOL_DEFINITIONS,
      toolExchanges,
    })

    if (generation.type === 'final') {
      raw = generation.raw
      break
    }

    if (round === MAX_TOOL_CALLS || toolExchanges.length + generation.calls.length > MAX_TOOL_CALLS) {
      exceededLimit = true
      break
    }

    const allowedEntities = {
      customerId: context.customer?.id ?? null,
      vehicleId: context.vehicle?.id ?? null,
      appointmentIds: context.upcomingAppointments.map((a) => a.id),
    }

    for (const call of generation.calls) {
      const result = await executeTool(ctx, call.name, call.arguments, input.message, allowedEntities)
      toolExchanges.push({ call, result })
    }
  }

  // Escalation eligibility (spec §"AI INTEGRATION" step order: "escalation
  // creation must happen only after ... 4. provider result validation; 5.
  // safety validation; 6. needsHuman === true") and spec §"TESTS" items
  // 37-40, which are explicit about what must NEVER create an escalation:
  // provider failure, configuration failure, a malformed/unparseable AI
  // result, and a safety-layer *rejection*. The tool-call-limit fallback is
  // the same category as a malformed result — in both cases there is no
  // trustworthy validated output to build an escalation from, only a
  // hand-built, honest "we couldn't do this" placeholder. A safety
  // *rejection* specifically means the model itself tried to claim a
  // fabricated booking/diagnosis/escalation and got caught — that is a
  // model-behavior problem the safety layer already fully contained, not
  // itself evidence that a human needs to review the underlying customer
  // question, so it deliberately does not escalate either. Only two things
  // count as "genuinely eligible": the model's own honest needsHuman=true,
  // and the confidence policy forcing it (spec §"CONFIDENCE": confidence is
  // itself a validated, trustworthy field — forcing needsHuman from it is
  // not a rejection of anything, just applying the existing policy).
  let finalResult: AiResult
  let eligibleForEscalation = false

  if (exceededLimit) {
    finalResult = buildFallbackResult('AI_TOOL_LIMIT_EXCEEDED: exceeded the maximum of 3 tool calls per request')
  } else {
    // Unlike a provider-call failure, the provider DID respond here — it's
    // just untrustworthy. That's a "controlled AI error" (spec), not an
    // infrastructure failure: it degrades to a safe result (needsHuman:
    // true) rather than throwing, since analyze() completing with an honest
    // "escalate" answer is strictly more useful to staff than a bare 5xx.
    const parsed = aiResultSchema.safeParse(raw)
    if (parsed.success) {
      finalResult = applySafetyLayer(parsed.data)
      eligibleForEscalation = !finalResult.reason?.startsWith('AI_SAFETY_REJECTION')
    } else {
      finalResult = buildFallbackResult('AI_INVALID_RESPONSE: the AI response failed structural validation')
    }
  }

  // Human Escalation integration (Prompt 12) — the single place this
  // happens. AI_PROVIDER_UNAVAILABLE/AI_CONFIGURATION_ERROR never reach
  // here at all (callProvider() already threw out of this function
  // entirely in that case) — there is no AiResult to gate on.
  const escalation = eligibleForEscalation && finalResult.needsHuman
    ? await (async () => {
        const reason = deriveEscalationReason(finalResult.reason)
        const { escalation: row } = await createOrReuseActiveEscalation(ctx, {
          conversationId: conversation.id,
          customerId: conversation.customerId,
          reason,
          summary: deriveEscalationSummary(reason),
        })
        return row ? { id: row.id, status: row.status } : undefined
      })()
    : undefined

  return {
    ...finalResult,
    toolExecutions: summarizeExchanges(toolExchanges),
    ...(escalation ? { escalation } : {}),
  }
}
