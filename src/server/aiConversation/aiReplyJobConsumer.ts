import { logger } from '../lib/logger'
import { processAiTurn, type AiTurnDeps, type AiTurnOutcome } from '../services/aiConversationService'
import {
  AI_REPLY_JOB_BUSY_RETRY_SECONDS,
  AI_REPLY_JOB_FAILED_RETRY_SECONDS,
  AI_REPLY_JOB_MAX_DELIVERIES,
  AI_REPLY_JOB_RETRY_AFTER_SECONDS,
  aiReplyJobSchema,
} from './aiReplyJobs'

// ---------------------------------------------------------------------------
// MCR-5 — the AI-reply queue consumer, independent of @vercel/queue (testable
// without Vercel). Validates the job, hands the id to processAiTurn, and maps
// the outcome to acknowledge (return) or redeliver (throw). It decides
// nothing about eligibility, content or retry policy: on redelivery the
// turn's claim decides again.
// ---------------------------------------------------------------------------

export interface AiReplyJobDelivery {
  messageId: string
  deliveryCount: number
}

export type AiReplyJobResult = 'INVALID_PAYLOAD' | AiTurnOutcome

/** Thrown to make the queue redeliver; `afterSeconds` is the suggested delay. */
export class AiReplyJobRetryError extends Error {
  constructor(readonly outcome: 'BUSY' | 'FAILED') {
    super(`AI_TURN_${outcome}`)
    this.name = 'AiReplyJobRetryError'
  }
}

function decode(message: unknown): unknown {
  try {
    if (typeof message === 'string') return JSON.parse(message)
    if (message instanceof Uint8Array) return JSON.parse(Buffer.from(message).toString('utf-8'))
  } catch {
    return undefined
  }
  return message
}

export async function handleAiReplyJob(message: unknown, delivery: AiReplyJobDelivery, deps: AiTurnDeps = {}): Promise<AiReplyJobResult> {
  const parsed = aiReplyJobSchema.safeParse(decode(message))
  if (!parsed.success) {
    // Poison message: acknowledge, touch nothing, never query with an unvalidated id.
    logger.warn('ai_reply_job_invalid_payload', { queueMessageId: delivery.messageId, deliveryCount: delivery.deliveryCount })
    return 'INVALID_PAYLOAD'
  }
  // Tenant/business come from the turn's own row, never from the job.
  const outcome = await processAiTurn(parsed.data.messageId, deps)
  logger.info('ai_reply_job_processed', { queueMessageId: delivery.messageId, deliveryCount: delivery.deliveryCount, messageId: parsed.data.messageId, outcome })
  if (outcome === 'BUSY' || outcome === 'FAILED') throw new AiReplyJobRetryError(outcome)
  return outcome
}

export function aiReplyJobRetry(error: unknown, delivery: AiReplyJobDelivery): { afterSeconds: number } | { acknowledge: true } {
  if (delivery.deliveryCount >= AI_REPLY_JOB_MAX_DELIVERIES) {
    logger.warn('ai_reply_job_gave_up', { queueMessageId: delivery.messageId, deliveryCount: delivery.deliveryCount })
    return { acknowledge: true }
  }
  if (error instanceof AiReplyJobRetryError) {
    return { afterSeconds: error.outcome === 'BUSY' ? AI_REPLY_JOB_BUSY_RETRY_SECONDS : AI_REPLY_JOB_FAILED_RETRY_SECONDS }
  }
  logger.error('ai_reply_job_failed', { queueMessageId: delivery.messageId, deliveryCount: delivery.deliveryCount, errorName: error instanceof Error ? error.name : 'unknown' })
  return { afterSeconds: AI_REPLY_JOB_RETRY_AFTER_SECONDS }
}
