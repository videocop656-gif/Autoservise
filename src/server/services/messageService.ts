import type { AuthContext } from '../types/auth'
import { ApiError } from '../lib/errors'
import { requireRole } from '../middleware/requireRole'
import { conversationRepository } from '../repositories/conversationRepository'
import { messageRepository } from '../repositories/messageRepository'
import type { CreateMessageInput } from '../validation/message.schemas'

// Messages are append-only and can only be created in an OPEN conversation
// (spec §12, §21) — owner/admin/manager all get this operational access,
// same exception as Conversation itself.
export async function createMessage(ctx: AuthContext, conversationId: string, input: CreateMessageInput) {
  requireRole(ctx, 'owner', 'admin', 'manager')

  const conversation = await conversationRepository.findById(ctx.tenant.id, ctx.business.id, conversationId)
  if (!conversation) {
    throw new ApiError(404, 'NOT_FOUND', 'Conversation not found')
  }

  if (conversation.status !== 'OPEN') {
    throw new ApiError(409, 'CONVERSATION_CLOSED', 'Cannot add a message to a closed conversation — reopen it first')
  }

  return messageRepository.createAndTouchConversation(ctx.tenant.id, ctx.business.id, {
    tenantId: ctx.tenant.id,
    businessId: ctx.business.id,
    conversationId,
    direction: input.direction,
    senderType: input.senderType,
    content: input.content,
  })
}
