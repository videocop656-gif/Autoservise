import { z } from 'zod'
import type { ApiRequest, ApiResponse } from '../../../src/server/types/http'
import { env } from '../../../src/server/lib/env'
import { timingSafeEqualStrings } from '../../../src/server/lib/timingSafeCompare'
import { processPendingRecoveries, processRecovery } from '../../../src/server/services/callRecoveryService'
import { logger } from '../../../src/server/lib/logger'

// ============================================================================
// MCR-4 — POST /api/internal/recovery/process: one recovery processor pass.
//
// MCR-4.1 — NOT the primary trigger any more. Normal production flow is
// intake → Vercel Queues job → api/queues/missed-call-recovery.ts → the same
// processRecovery. This endpoint is the reconciliation / operational
// backstop: READY calls whose queue publish failed, stale CLAIMED calls and
// retryable FAILED calls whose queue job gave up, and local development
// (no queue outside a Vercel deployment). Called by an operator or an
// external scheduler, never by a browser session. The database (READY /
// CLAIMED / FAILED rows) is the durable state. Safe to call repeatedly and
// concurrently with the queue consumer: every call is claimed atomically.
//
// Auth: "Authorization: Bearer <RECOVERY_PROCESSOR_SECRET>" (constant-time
// compare) BEFORE any database access; unset secret → always 401.
// Body (optional): { callId?: uuid } to process one call, { limit?: 1..50 }.
// Response: counts only — never a tenant, call, customer or phone.
// ============================================================================
const bodySchema = z
  .object({ callId: z.string().uuid().optional(), limit: z.number().int().min(1).max(50).optional() })
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
    logger.warn('recovery_processor_unauthorized', { hasHeader: !!provided })
    res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } })
    return
  }
  const parsed = bodySchema.safeParse(req.body ?? {})
  if (!parsed.success) {
    res.status(400).json({ error: { code: 'INVALID_PAYLOAD', message: 'Invalid request' } })
    return
  }
  try {
    if (parsed.data.callId) {
      const outcome = await processRecovery(parsed.data.callId)
      res.status(200).json({ ok: true, outcome })
      return
    }
    const summary = await processPendingRecoveries({ limit: parsed.data.limit })
    res.status(200).json({ ok: true, ...summary })
  } catch (err) {
    logger.error('recovery_processor_failed', { message: err instanceof Error ? err.message : 'unknown' })
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong' } })
  }
}
