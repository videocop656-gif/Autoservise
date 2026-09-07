import type { Business, BusinessWorkingHours, Service } from '@prisma/client'

/**
 * Never return raw Prisma objects to the client. These DTOs are the single
 * place that decides what a Business/WorkingHours/Service looks like over
 * the wire — in particular, converting Decimal money fields to fixed-point
 * strings and omitting internal-only fields (tenantId/businessId, which the
 * client never needs since the server always resolves them from the
 * session).
 */

export interface BusinessDto {
  id: string
  name: string
  description: string | null
  phone: string | null
  email: string | null
  address: string | null
  timezone: string
  website: string | null
  currency: string
  createdAt: Date
  updatedAt: Date
}

export function toBusinessDto(business: Business): BusinessDto {
  return {
    id: business.id,
    name: business.name,
    description: business.description,
    phone: business.phone,
    email: business.email,
    address: business.address,
    timezone: business.timezone,
    website: business.website,
    currency: business.currency,
    createdAt: business.createdAt,
    updatedAt: business.updatedAt,
  }
}

export interface WorkingHourDto {
  dayOfWeek: BusinessWorkingHours['dayOfWeek']
  isOpen: boolean
  openTime: string | null
  closeTime: string | null
}

export function toWorkingHourDto(hours: BusinessWorkingHours): WorkingHourDto {
  return {
    dayOfWeek: hours.dayOfWeek,
    isOpen: hours.isOpen,
    openTime: hours.openTime,
    closeTime: hours.closeTime,
  }
}

export interface ServiceDto {
  id: string
  name: string
  description: string | null
  priceFrom: string | null
  priceTo: string | null
  currency: string
  durationMinutes: number
  isActive: boolean
  createdAt: Date
  updatedAt: Date
}

export function toServiceDto(service: Service): ServiceDto {
  return {
    id: service.id,
    name: service.name,
    description: service.description,
    priceFrom: service.priceFrom ? service.priceFrom.toFixed(2) : null,
    priceTo: service.priceTo ? service.priceTo.toFixed(2) : null,
    currency: service.currency,
    durationMinutes: service.durationMinutes,
    isActive: service.isActive,
    createdAt: service.createdAt,
    updatedAt: service.updatedAt,
  }
}
