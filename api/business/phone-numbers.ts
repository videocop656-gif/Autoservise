import type { ApiRequest, ApiResponse } from '../../src/server/types/http'
import { requireAuth } from '../../src/server/middleware/requireAuth'
import { addBusinessPhoneNumberSchema } from '../../src/server/validation/businessPhoneNumber.schemas'
import { listBusinessPhoneNumbers, addBusinessPhoneNumber } from '../../src/server/services/businessPhoneNumberService'
import { toBusinessPhoneNumberDto } from '../../src/server/lib/dto'
import { sendError, ApiError } from '../../src/server/lib/errors'

// MCR-2 — GET /api/business/phone-numbers (any role), POST { phone, label? } (owner/admin).
// The session's business only; 409 PHONE_NUMBER_IN_USE if the number is active anywhere.
export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  try {
    const ctx = await requireAuth(req)

    if (req.method === 'GET') {
      const numbers = await listBusinessPhoneNumbers(ctx)
      res.status(200).json({ phoneNumbers: numbers.map(toBusinessPhoneNumberDto) })
      return
    }

    if (req.method === 'POST') {
      const input = addBusinessPhoneNumberSchema.parse(req.body)
      const number = await addBusinessPhoneNumber(ctx, input)
      res.status(201).json({ phoneNumber: toBusinessPhoneNumberDto(number) })
      return
    }

    throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed')
  } catch (err) {
    sendError(res, err)
  }
}
