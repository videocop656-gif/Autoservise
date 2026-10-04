import { z } from 'zod'
import { QueueClient } from '@vercel/queue'
import { logger } from '../lib/logger'
import { AI_TURN_STALE_CLAIM_SECONDS } from './policy'

// ---------------------------------------------------------------------------
// MCR-5 — the durable trigger of automatic AI replies (transport only).
// Same shape as MCR-4.1's recovery trigger, on its OWN topic so the two
// payload semantics never mix:
//
//   inbound customer Message + PENDING AiConversationTurn committed together
//   → publish { messageId } → Vercel Queues (Beta, at-least-once)
//   → api/queues/ai-conversation-reply.ts → processAiTurn (the engine decides
//     everything; duplicates are stopped by the turn's claim, not the queue)
//
// Publishing is not processing: a failed publish leaves the turn PENDING,
// found by POST /api/internal/ai-replies/process.
// ---------------------------------------------------------------------------

/** The one topic. Never per tenant/business. Must match vercel.json. */
export const AI_REPLY_QUEUE_TOPIC = 'ai-conversation-reply'

/** The whole job: the inbound message id. No text, phone, customer, tenant or business. */
export const aiReplyJobSchema = z.object({ messageId: z.string().uuid() }).strict()
export type AiReplyJob = z.infer<typeof aiReplyJobSchema>

export function aiReplyJobIdempotencyKey(messageId: string): string {
  return `${AI_REPLY_QUEUE_TOPIC}:${messageId}`
}

/** A turn older than 30 min is not answered automatically; one hour covers that plus retries. */
export const AI_REPLY_JOB_RETENTION_SECONDS = 3600

/** Redelivery after a crash / timeout: past the stale-claim window, so the abandoned claim is re-claimable. Must match vercel.json. */
export const AI_REPLY_JOB_RETRY_AFTER_SECONDS = AI_TURN_STALE_CLAIM_SECONDS + 15

/** Another turn of the same conversation is being processed: come back soon. */
export const AI_REPLY_JOB_BUSY_RETRY_SECONDS = 20

/** A retryable failure (AI provider / delivery): next attempt after this. */
export const AI_REPLY_JOB_FAILED_RETRY_SECONDS = 60

/** Deliveries before the job is dropped (the turn row stays for reconciliation). Must match vercel.json. */
export const AI_REPLY_JOB_MAX_DELIVERIES = 8

export type AiReplyPublishResult = { status: 'PUBLISHED'; messageId: string | null } | { status: 'DISABLED' }

export interface AiReplyJobPublisher {
  readonly kind: 'vercel-queue' | 'disabled' | 'test'
  publish(job: AiReplyJob): Promise<AiReplyPublishResult>
}

export function createVercelAiReplyJobPublisher(client: Pick<QueueClient, 'send'> = new QueueClient()): AiReplyJobPublisher {
  return {
    kind: 'vercel-queue',
    async publish(job) {
      const { messageId } = await client.send(AI_REPLY_QUEUE_TOPIC, job, {
        idempotencyKey: aiReplyJobIdempotencyKey(job.messageId),
        retentionSeconds: AI_REPLY_JOB_RETENTION_SECONDS,
      })
      return { status: 'PUBLISHED', messageId }
    },
  }
}

/** Outside a Vercel deployment (local dev, tests): nothing published; the turn stays PENDING for the internal processor. */
export const disabledAiReplyJobPublisher: AiReplyJobPublisher = {
  kind: 'disabled',
  async publish() {
    return { status: 'DISABLED' }
  },
}

let override: AiReplyJobPublisher | null = null
let vercelPublisher: AiReplyJobPublisher | null = null

export function getAiReplyJobPublisher(): AiReplyJobPublisher {
  if (override) return override
  if (!process.env.VERCEL_DEPLOYMENT_ID) return disabledAiReplyJobPublisher
  vercelPublisher ??= createVercelAiReplyJobPublisher()
  return vercelPublisher
}

/** Tests only: swap the publisher (null restores the environment default). */
export function setAiReplyJobPublisher(publisher: AiReplyJobPublisher | null): void {
  override = publisher
}

export type AiReplyJobPublishStatus = 'PUBLISHED' | 'DISABLED' | 'PUBLISH_FAILED'

/** Publishes the job of a COMMITTED pending turn. Never throws; ids only in logs. */
export async function publishAiReplyJob(messageId: string): Promise<AiReplyJobPublishStatus> {
  const publisher = getAiReplyJobPublisher()
  try {
    const result = await publisher.publish({ messageId })
    if (result.status === 'PUBLISHED') {
      logger.info('ai_reply_job_published', { messageId, queueMessageId: result.messageId, publisher: publisher.kind })
    }
    return result.status
  } catch (err) {
    logger.error('ai_reply_job_publish_failed', { messageId, publisher: publisher.kind, errorName: err instanceof Error ? err.name : 'unknown' })
    return 'PUBLISH_FAILED'
  }
}
