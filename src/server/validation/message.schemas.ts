import { z } from 'zod'
import { MessageDirection, MessageSenderType } from '@prisma/client'

// Messages are append-only (no update schema exists — see spec §12): once
// created, content can never be changed through the API.
export const createMessageSchema = z.object({
  direction: z.nativeEnum(MessageDirection),
  // MCR-5 — 'AI' is server-only (automatic replies): a client can never
  // create a message that looks like it came from the AI administrator.
  senderType: z.nativeEnum(MessageSenderType).refine((v) => v !== 'AI', { message: 'senderType AI is reserved for automatic replies' }),
  content: z.string().trim().min(1, 'Content is required').max(10000),
})

export type CreateMessageInput = z.infer<typeof createMessageSchema>
