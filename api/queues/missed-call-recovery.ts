import { QueueClient } from '@vercel/queue'
import type { ApiRequest, ApiResponse } from '../../src/server/types/http'
import { handleRecoveryJob, recoveryJobRetry } from '../../src/server/recovery/recoveryJobConsumer'

// ============================================================================
// MCR-4.1 — Vercel Queues push consumer of topic "missed-call-recovery".
//
// Wired in vercel.json ("experimentalTriggers": queue/v2beta). A function with
// a queue trigger has no public URL on Vercel: only Vercel's queue
// infrastructure can invoke it, so there is no bearer secret here. The SDK
// (handleNodeCallback) parses the CloudEvent, keeps the lease, acknowledges
// when handleRecoveryJob returns and asks for a redelivery when it throws.
//
// Outside a Vercel deployment (the local `vite dev` API emulation exposes
// every api/ file) this route does nothing: 404.
// ============================================================================
let consumer: ((req: ApiRequest, res: ApiResponse) => Promise<void>) | null = null

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  if (!process.env.VERCEL_DEPLOYMENT_ID) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Not found' } })
    return
  }
  consumer ??= new QueueClient().handleNodeCallback(
    async (message, metadata) => {
      await handleRecoveryJob(message, metadata)
    },
    { retry: recoveryJobRetry }
  )
  await consumer(req, res)
}
