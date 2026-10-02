import type { AuthContext } from '../types/auth'
import { ApiError } from '../lib/errors'
import { normalizePhone } from '../lib/phone'
import { requireRole } from '../middleware/requireRole'
import { businessPhoneNumberRepository, isActiveNumberConflict } from '../repositories/businessPhoneNumberRepository'

// MCR-2 — the business's own public numbers (telephony routing identity).
// Settings-style: everyone reads, owner/admin change. A number can be ACTIVE
// for one business only, across all tenants; the conflict message never says
// which business holds it.

const IN_USE = 'Этот номер уже подключён к автосервису. Отключите его там или укажите другой номер.'

export function listBusinessPhoneNumbers(ctx: AuthContext) {
  return businessPhoneNumberRepository.listByBusiness(ctx.tenant.id, ctx.business.id)
}

export async function addBusinessPhoneNumber(ctx: AuthContext, input: { phone: string; label?: string | null }) {
  requireRole(ctx, 'owner', 'admin')
  const phoneE164 = normalizePhone(input.phone, ctx.business.phoneRegion)
  if (!phoneE164) {
    throw new ApiError(400, 'INVALID_PHONE', 'Неверный номер телефона.')
  }
  try {
    return await businessPhoneNumberRepository.create({
      tenantId: ctx.tenant.id,
      businessId: ctx.business.id,
      phoneE164,
      label: input.label?.trim() || null,
    })
  } catch (err) {
    if (isActiveNumberConflict(err)) throw new ApiError(409, 'PHONE_NUMBER_IN_USE', IN_USE)
    throw err
  }
}

export async function setBusinessPhoneNumberActive(ctx: AuthContext, id: string, isActive: boolean) {
  requireRole(ctx, 'owner', 'admin')
  try {
    const updated = await businessPhoneNumberRepository.setActive(ctx.tenant.id, ctx.business.id, id, isActive)
    if (!updated) throw new ApiError(404, 'NOT_FOUND', 'Номер не найден.')
    return updated
  } catch (err) {
    if (isActiveNumberConflict(err)) throw new ApiError(409, 'PHONE_NUMBER_IN_USE', IN_USE)
    throw err
  }
}
