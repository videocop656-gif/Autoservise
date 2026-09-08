import { z } from 'zod'

// tenantId/businessId are deliberately absent — they are never accepted
// from the client anywhere in this project, and AI analyze is no
// exception; the service resolves both from the authenticated session.
export const analyzeMessageSchema = z.object({
  conversationId: z.string().uuid('Invalid conversation id'),
  message: z.string().trim().min(1, 'Message is required').max(4000, 'Message is too long'),
})

export type AnalyzeMessageInput = z.infer<typeof analyzeMessageSchema>
