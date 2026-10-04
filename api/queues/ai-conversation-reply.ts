import { QueueClient } from '@vercel/queue'
import type { ApiRequest, ApiResponse } from '../../src/server/types/http'
import { aiReplyJobRetry, handleAiReplyJob } from '../../src/server/aiConversation/aiReplyJobConsumer'

// ============================================================================
// MCR-5 — Vercel Queues push consumer of topic "ai-conversation-reply".
//
// Wired in vercel.json (queue/v2beta trigger): no public URL on Vercel, only
// the queue infrastructure can invoke it. The SDK acknowledges when the
// handler returns and redelivers when it throws. Outside a Vercel deployment
// (local `vite dev` exposes every api/ file) this route is a 404.
// ============================================================================
let consumer: ((req: ApiRequest, res: ApiResponse) => Promise<void>) | null = null

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  if (!process.env.VERCEL_DEPLOYMENT_ID) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Not found' } })
    return
  }
  consumer ??= new QueueClient().handleNodeCallback(
    async (message, metadata) => {
      await handleAiReplyJob(message, metadata)
    },
    { retry: aiReplyJobRetry }
  )
  await consumer(req, res)
}
