import type { Prisma } from '@prisma/client'
import { prisma } from '../db/prisma'
import { withTenant } from '../lib/tenantScope'

interface ListOptions {
  activeOnly: boolean
  customerId?: string
  search?: string
  skip: number
  take: number
}

function buildSearchOr(search: string): NonNullable<Prisma.VehicleWhereInput['OR']> {
  return [
    { make: { contains: search, mode: 'insensitive' } },
    { model: { contains: search, mode: 'insensitive' } },
    { licensePlate: { contains: search, mode: 'insensitive' } },
    { vin: { contains: search, mode: 'insensitive' } },
  ]
}

export const vehicleRepository = {
  async list(tenantId: string, businessId: string, { activeOnly, customerId, search, skip, take }: ListOptions) {
    const where = withTenant(tenantId, {
      businessId,
      ...(customerId ? { customerId } : {}),
      ...(activeOnly ? { isActive: true } : {}),
      ...(search ? { OR: buildSearchOr(search) } : {}),
    })
    const [items, total] = await Promise.all([
      prisma.vehicle.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take }),
      prisma.vehicle.count({ where }),
    ])
    return { items, total }
  },
  findById(tenantId: string, businessId: string, id: string) {
    return prisma.vehicle.findFirst({ where: withTenant(tenantId, { businessId, id }) })
  },
  create(data: Prisma.VehicleUncheckedCreateInput) {
    return prisma.vehicle.create({ data })
  },
  async updateById(tenantId: string, businessId: string, id: string, data: Prisma.VehicleUpdateInput) {
    const result = await prisma.vehicle.updateMany({ where: withTenant(tenantId, { businessId, id }), data })
    if (result.count === 0) return null
    return prisma.vehicle.findFirst({ where: withTenant(tenantId, { businessId, id }) })
  },
  async deactivate(tenantId: string, businessId: string, id: string): Promise<number> {
    const result = await prisma.vehicle.updateMany({
      where: withTenant(tenantId, { businessId, id }),
      data: { isActive: false },
    })
    return result.count
  },
}
