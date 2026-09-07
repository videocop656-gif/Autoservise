import type { ApiRequest, ApiResponse } from '../../src/server/types/http'
import { requireAuth } from '../../src/server/middleware/requireAuth'
import { updateCustomerSchema, customerIdParamSchema } from '../../src/server/validation/customer.schemas'
import { getCustomerDetail, updateCustomer, deactivateCustomer } from '../../src/server/services/customerService'
import { toCustomerDto, toVehicleDto } from '../../src/server/lib/dto'
import { sendError, ApiError } from '../../src/server/lib/errors'

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  try {
    const idResult = customerIdParamSchema.safeParse(req.query.id)
    if (!idResult.success) {
      throw new ApiError(404, 'NOT_FOUND', 'Customer not found')
    }
    const id = idResult.data

    const ctx = await requireAuth(req)

    if (req.method === 'GET') {
      const includeVehicles = req.query.includeVehicles === 'true'
      const { customer, vehicles } = await getCustomerDetail(ctx, id, includeVehicles)
      res.status(200).json({
        customer: toCustomerDto(customer),
        ...(vehicles ? { vehicles: vehicles.map(toVehicleDto) } : {}),
      })
      return
    }

    if (req.method === 'PATCH') {
      const input = updateCustomerSchema.parse(req.body)
      const customer = await updateCustomer(ctx, id, input)
      res.status(200).json({ customer: toCustomerDto(customer) })
      return
    }

    if (req.method === 'DELETE') {
      await deactivateCustomer(ctx, id)
      res.status(200).json({ success: true })
      return
    }

    throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed')
  } catch (err) {
    sendError(res, err)
  }
}
