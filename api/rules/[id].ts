import type { ApiRequest, ApiResponse } from '../../src/server/types/http'
import { requireAuth } from '../../src/server/middleware/requireAuth'
import { updateBusinessRuleSchema, businessRuleIdParamSchema } from '../../src/server/validation/businessRule.schemas'
import { getBusinessRule, updateBusinessRule, deactivateBusinessRule } from '../../src/server/services/businessRuleService'
import { toBusinessRuleDto } from '../../src/server/lib/dto'
import { sendError, ApiError } from '../../src/server/lib/errors'

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  try {
    const idResult = businessRuleIdParamSchema.safeParse(req.query.id)
    if (!idResult.success) {
      throw new ApiError(404, 'NOT_FOUND', 'Business rule not found')
    }
    const id = idResult.data

    const ctx = await requireAuth(req)

    if (req.method === 'GET') {
      const rule = await getBusinessRule(ctx, id)
      res.status(200).json({ rule: toBusinessRuleDto(rule) })
      return
    }

    if (req.method === 'PATCH') {
      const input = updateBusinessRuleSchema.parse(req.body)
      const rule = await updateBusinessRule(ctx, id, input)
      res.status(200).json({ rule: toBusinessRuleDto(rule) })
      return
    }

    if (req.method === 'DELETE') {
      await deactivateBusinessRule(ctx, id)
      res.status(200).json({ success: true })
      return
    }

    throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed')
  } catch (err) {
    sendError(res, err)
  }
}
