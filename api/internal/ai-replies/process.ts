import { z } from 'zod'
import type { ApiRequest, ApiResponse } from '../../../src/server/types/http'
import { env } from '../../../src/server/lib/env'
import { timingSafeEqualStrings } from '../../../src/server/lib/timingSafeCompare'
import { processAiTurn, processPendingAiTurns } from '../../../src/server/services/aiConversationService'
import { logger } from '../../../src/server/lib/logger'

// ============================================================================
// MCR-5 — POST /api/internal/ai-replies/process: one reconciliation pass over
// automatic AI turns. NOT the normal trigger (that is the Vercel Queues topic
// "ai-conversation-reply"): the backstop for PENDING turns whose publish
// failed, retryable FAILED turns whose job gave up, abandoned PROCESSING
// claims, and local development (no queue outside a Vercel deployment).
//
// Same protection as the recovery processor: "Authorization: Bearer
// <RECOVERY_PROCESSOR_SECRET>" (the one internal-processor secret), checked in
// constant time BEFORE any database access; unset → always 401.
// Body (optional): { messageId?: uuid } for one turn, { limit?: 1..50 }.
// Response: counts / one outcome only — never a tenant, message or text.
// ============================================================================
const bodySchema = z
  .object({ messageId: z.string().uuid().optional(), limit: z.number().int().min(1).max(50).optional() })
  .strict()

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Not found' } })
    return
  }
  const expected = env.recoveryProcessorSecret
  const header = req.headers.authorization
  const provided = typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7) : undefined
  if (!expected || !provided || !timingSafeEqualStrings(provided, expected)) {
    logger.warn('ai_reply_processor_unauthorized', { hasHeader: !!provided })
    res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } })
    return
  }
  const parsed = bodySchema.safeParse(req.body ?? {})
  if (!parsed.success) {
    res.status(400).json({ error: { code: 'INVALID_PAYLOAD', message: 'Invalid request' } })
    return
  }
  try {
    if (parsed.data.messageId) {
      const outcome = await processAiTurn(parsed.data.messageId)
      res.status(200).json({ ok: true, outcome })
      return
    }
    const summary = await processPendingAiTurns({ limit: parsed.data.limit })
    res.status(200).json({ ok: true, ...summary })
  } catch (err) {
    logger.error('ai_reply_processor_failed', { message: err instanceof Error ? err.message : 'unknown' })
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong' } })
  }
}
