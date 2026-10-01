import type { ApiRequest, ApiResponse } from '../../../src/server/types/http'
import { requireAuth } from '../../../src/server/middleware/requireAuth'
import { conversationIdParamSchema } from '../../../src/server/validation/conversation.schemas'
import { conversationVehicleCreateSchema } from '../../../src/server/validation/conversationIntake.schemas'
import { createVehicleForConversation } from '../../../src/server/services/conversationIntakeService'
import { toVehicleDto } from '../../../src/server/lib/dto'
import { sendError, ApiError } from '../../../src/server/lib/errors'

// Prompt 54 — POST /api/conversations/:id/vehicles: add a vehicle for the
// conversation's linked customer (owner taken from the conversation, never
// the request body). 201 { vehicle }; 409 CONVERSATION_HAS_NO_CUSTOMER /
// VEHICLE_EXISTS (details.vehicle, same customer only); 403 for manager
// (vehicle creation is owner/admin, same as the Vehicles screen).
export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  try {
    const idResult = conversationIdParamSchema.safeParse(req.query.id)
    if (!idResult.success) {
      throw new ApiError(404, 'NOT_FOUND', 'Диалог не найден')
    }
    const ctx = await requireAuth(req)

    if (req.method === 'POST') {
      const input = conversationVehicleCreateSchema.parse(req.body)
      const vehicle = await createVehicleForConversation(ctx, idResult.data, input)
      res.status(201).json({ vehicle: toVehicleDto(vehicle) })
      return
    }

    throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed')
  } catch (err) {
    sendError(res, err)
  }
}
