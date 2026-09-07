import { z } from 'zod'
import { MessageDirection, MessageSenderType } from '@prisma/client'

// Messages are append-only (no update schema exists — see spec §12): once
// created, content can never be changed through the API.
export const createMessageSchema = z.object({
  direction: z.nativeEnum(MessageDirection),
  senderType: z.nativeEnum(MessageSenderType),
  content: z.string().trim().min(1, 'Content is required').max(10000),
})

export type CreateMessageInput = z.infer<typeof createMessageSchema>
