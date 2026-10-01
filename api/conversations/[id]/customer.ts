import type { ApiRequest, ApiResponse } from '../../../src/server/types/http'
import { requireAuth } from '../../../src/server/middleware/requireAuth'
import { conversationIdParamSchema } from '../../../src/server/validation/conversation.schemas'
import { conversationCustomerActionSchema } from '../../../src/server/validation/conversationIntake.schemas'
import { linkConversationCustomer, createCustomerForConversation } from '../../../src/server/services/conversationIntakeService'
import { toConversationDto, toCustomerDto } from '../../../src/server/lib/dto'
import { sendError, ApiError } from '../../../src/server/lib/errors'

// Prompt 54 — POST /api/conversations/:id/customer: operator intake.
//   { action: "link", customerId, expectedCustomerId }  → link an existing customer (compare-and-set)
//   { action: "create", customer: { firstName, lastName?, phone, email?, notes? } } → create + link (one transaction)
// Responses: 200 { conversation } for link; 201 { conversation, customer } for create.
// Errors (Russian messages): 404 conversation/customer, 409 CONVERSATION_CHANGED /
// CONVERSATION_HAS_CUSTOMER / CUSTOMER_PHONE_EXISTS (details.matches, this
// business only) / CUSTOMER_REQUEST_CONFLICT / CUSTOMER_EMAIL_EXISTS, 403 by role.
export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  try {
    const idResult = conversationIdParamSchema.safeParse(req.query.id)
    if (!idResult.success) {
      throw new ApiError(404, 'NOT_FOUND', 'Диалог не найден')
    }
    const ctx = await requireAuth(req)

    if (req.method === 'POST') {
      const input = conversationCustomerActionSchema.parse(req.body)
      if (input.action === 'link') {
        const conversation = await linkConversationCustomer(ctx, idResult.data, input)
        res.status(200).json({ conversation: toConversationDto(conversation) })
        return
      }
      const { conversation, customer } = await createCustomerForConversation(ctx, idResult.data, input.customer)
      res.status(201).json({ conversation: toConversationDto(conversation), customer: toCustomerDto(customer) })
      return
    }

    throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed')
  } catch (err) {
    sendError(res, err)
  }
}
