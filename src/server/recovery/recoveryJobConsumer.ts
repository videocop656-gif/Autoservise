import { logger } from '../lib/logger'
import { processRecovery, type RecoveryOutcome } from '../services/callRecoveryService'
import { RECOVERY_JOB_MAX_DELIVERIES, RECOVERY_JOB_RETRY_AFTER_SECONDS, recoveryJobSchema } from './recoveryJobs'

// ---------------------------------------------------------------------------
// MCR-4.1 — the recovery queue consumer, independent of @vercel/queue so it
// is testable without Vercel. It only validates the job, hands the id to the
// SAME processRecovery the internal processor uses, and maps the engine's
// outcome to "acknowledge" (return) or "redeliver" (throw). It never decides
// late answer, anti-spam, channel, template or retry eligibility: on a
// redelivery the engine's claim decides again (a non-retryable or finished
// call comes back SKIPPED and the job is acknowledged).
// ---------------------------------------------------------------------------

export interface RecoveryJobDelivery {
  messageId: string
  deliveryCount: number
}

export type RecoveryJobResult = 'INVALID_PAYLOAD' | RecoveryOutcome

/** Thrown to make the queue redeliver: the engine reported a FAILED attempt it may retry. */
export class RecoveryJobRetryError extends Error {
  constructor() {
    super('RECOVERY_ATTEMPT_FAILED')
    this.name = 'RecoveryJobRetryError'
  }
}

/** Vercel may hand the payload over parsed, as text or as bytes. */
function decode(message: unknown): unknown {
  try {
    if (typeof message === 'string') return JSON.parse(message)
    if (message instanceof Uint8Array) return JSON.parse(Buffer.from(message).toString('utf-8'))
  } catch {
    return undefined
  }
  return message
}

export async function handleRecoveryJob(message: unknown, delivery: RecoveryJobDelivery): Promise<RecoveryJobResult> {
  const parsed = recoveryJobSchema.safeParse(decode(message))
  if (!parsed.success) {
    // Poison message: acknowledge, touch nothing. Never query with an unvalidated id.
    logger.warn('recovery_job_invalid_payload', { queueMessageId: delivery.messageId, deliveryCount: delivery.deliveryCount })
    return 'INVALID_PAYLOAD'
  }
  const { callInteractionId } = parsed.data

  // Tenant/business come from the call row inside the engine, never from the job.
  // A throw here (DB unavailable, crash before send) propagates → redelivery.
  const outcome = await processRecovery(callInteractionId)
  logger.info('recovery_job_processed', { queueMessageId: delivery.messageId, deliveryCount: delivery.deliveryCount, callInteractionId, outcome })

  if (outcome === 'FAILED') throw new RecoveryJobRetryError()
  return outcome
}

/** SDK retry hook: fixed delay past the stale-claim window; give up (ack) after the cap — the DB row remains for reconciliation. */
export function recoveryJobRetry(error: unknown, delivery: RecoveryJobDelivery): { afterSeconds: number } | { acknowledge: true } {
  if (delivery.deliveryCount >= RECOVERY_JOB_MAX_DELIVERIES) {
    logger.warn('recovery_job_gave_up', { queueMessageId: delivery.messageId, deliveryCount: delivery.deliveryCount })
    return { acknowledge: true }
  }
  if (!(error instanceof RecoveryJobRetryError)) {
    logger.error('recovery_job_failed', {
      queueMessageId: delivery.messageId,
      deliveryCount: delivery.deliveryCount,
      errorName: error instanceof Error ? error.name : 'unknown',
    })
  }
  return { afterSeconds: RECOVERY_JOB_RETRY_AFTER_SECONDS }
}
