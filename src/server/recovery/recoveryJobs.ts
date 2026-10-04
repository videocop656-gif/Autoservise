import { z } from 'zod'
import { QueueClient } from '@vercel/queue'
import { logger } from '../lib/logger'
import { RECOVERY_STALE_CLAIM_SECONDS } from './policy'

// ---------------------------------------------------------------------------
// MCR-4.1 — the durable recovery TRIGGER (transport only, no business rules).
//
//   intake commits CallInteraction READY → publish { callInteractionId }
//   → Vercel Queues (durable, at-least-once) → consumer
//   → the existing MCR-4 engine (processRecovery), which alone decides
//     claim / late answer / anti-spam / channel / message / delivery.
//
// Queue delivery is at-least-once: a job may arrive twice, concurrently, or
// after the call was answered. That is harmless because the engine's atomic
// claim and ChannelDelivery idempotency are the duplicate protection — the
// queue is never trusted to be exactly-once. Publishing a job is not recovery
// success and changes no database state; a READY call whose publish failed is
// still READY and is found by POST /api/internal/recovery/process.
//
// Vercel Queues is a BETA product. Everything Vercel-specific stays behind
// RecoveryJobPublisher + the one consumer route, so another durable queue
// could replace it without touching MCR-4.
// ---------------------------------------------------------------------------

/** The one topic. Never per tenant/business. Must match vercel.json. */
export const RECOVERY_QUEUE_TOPIC = 'missed-call-recovery'

/**
 * The whole job: the durable record's id. Nothing else — no tenant/business
 * (resolved from the database row), no phone, no name, no message text.
 */
export const recoveryJobSchema = z.object({ callInteractionId: z.string().uuid() }).strict()
export type RecoveryJob = z.infer<typeof recoveryJobSchema>

/**
 * Deterministic publish dedupe key — one job per call. Vercel drops a repeat
 * publish with the same key for min(retention, 24 h); beyond that (or if the
 * dedupe ever misses) the engine's claim still makes a second job a no-op.
 */
export function recoveryJobIdempotencyKey(callInteractionId: string): string {
  return `${RECOVERY_QUEUE_TOPIC}:${callInteractionId}`
}

/**
 * Message TTL: a missed call stops being recoverable after
 * RECOVERY_MAX_AGE_MINUTES (30); one hour covers that plus retries.
 */
export const RECOVERY_JOB_RETENTION_SECONDS = 3600

/**
 * Redelivery delay after a failed delivery. Longer than the engine's stale
 * claim window, so a delivery that crashed while holding the claim finds
 * that claim re-claimable when the job comes back. Must match vercel.json
 * ("retryAfterSeconds") for crashes/timeouts, where the SDK retry hook
 * doesn't run.
 */
export const RECOVERY_JOB_RETRY_AFTER_SECONDS = RECOVERY_STALE_CLAIM_SECONDS + 15

/**
 * After this many deliveries the job is acknowledged (dropped). The call
 * itself stays in the database in whatever state the engine left it; the
 * reconciliation processor remains the backstop. Must match vercel.json
 * ("maxDeliveries").
 */
export const RECOVERY_JOB_MAX_DELIVERIES = 6

export type PublishResult = { status: 'PUBLISHED'; messageId: string | null } | { status: 'DISABLED' }

export interface RecoveryJobPublisher {
  readonly kind: 'vercel-queue' | 'disabled' | 'test'
  publish(job: RecoveryJob): Promise<PublishResult>
}

/** Vercel Queues producer (@vercel/queue send). Auth is the deployment's OIDC token, managed by Vercel. */
export function createVercelRecoveryJobPublisher(client: Pick<QueueClient, 'send'> = new QueueClient()): RecoveryJobPublisher {
  return {
    kind: 'vercel-queue',
    async publish(job) {
      const { messageId } = await client.send(RECOVERY_QUEUE_TOPIC, job, {
        idempotencyKey: recoveryJobIdempotencyKey(job.callInteractionId),
        retentionSeconds: RECOVERY_JOB_RETENTION_SECONDS,
      })
      return { status: 'PUBLISHED', messageId }
    },
  }
}

/**
 * Outside a Vercel deployment (local `vite dev`, tests, scripts) there is no
 * queue and no OIDC token: nothing is published, READY stays READY, and the
 * internal processor recovers it — exactly the publish-failure path.
 */
export const disabledRecoveryJobPublisher: RecoveryJobPublisher = {
  kind: 'disabled',
  async publish() {
    return { status: 'DISABLED' }
  },
}

/** VERCEL_DEPLOYMENT_ID is set by Vercel on every deployment's functions and is what @vercel/queue itself requires. */
function onVercelDeployment(): boolean {
  return !!process.env.VERCEL_DEPLOYMENT_ID
}

let override: RecoveryJobPublisher | null = null
let vercelPublisher: RecoveryJobPublisher | null = null

export function getRecoveryJobPublisher(): RecoveryJobPublisher {
  if (override) return override
  if (!onVercelDeployment()) return disabledRecoveryJobPublisher
  vercelPublisher ??= createVercelRecoveryJobPublisher()
  return vercelPublisher
}

/** Tests only: swap the publisher (null restores the environment default). */
export function setRecoveryJobPublisher(publisher: RecoveryJobPublisher | null): void {
  override = publisher
}

export type RecoveryJobPublishStatus = 'PUBLISHED' | 'DISABLED' | 'PUBLISH_FAILED'

/**
 * Publishes the recovery job of a call that is READY in COMMITTED database
 * state. Never throws: a failure is logged (ids only) and reported, and the
 * call stays READY for reconciliation.
 */
export async function publishRecoveryJob(callInteractionId: string): Promise<RecoveryJobPublishStatus> {
  const publisher = getRecoveryJobPublisher()
  try {
    const result = await publisher.publish({ callInteractionId })
    if (result.status === 'PUBLISHED') {
      logger.info('recovery_job_published', { callInteractionId, queueMessageId: result.messageId, publisher: publisher.kind })
    }
    return result.status
  } catch (err) {
    logger.error('recovery_job_publish_failed', {
      callInteractionId,
      publisher: publisher.kind,
      errorName: err instanceof Error ? err.name : 'unknown',
    })
    return 'PUBLISH_FAILED'
  }
}
