import { prisma } from '../db/prisma'
import { WEEKDAY_ORDER } from '../domain/workingHoursDefaults'
import type { WorkingHoursListInput } from '../validation/businessHours.schemas'

export const workingHoursRepository = {
  async listByBusiness(businessId: string) {
    const records = await prisma.businessWorkingHours.findMany({ where: { businessId } })
    // The DayOfWeek enum sorts alphabetically at the DB level, not by
    // calendar order, so we sort application-side for display.
    return [...records].sort(
      (a, b) => WEEKDAY_ORDER.indexOf(a.dayOfWeek) - WEEKDAY_ORDER.indexOf(b.dayOfWeek)
    )
  },
  /** Transaction-safe full-week replace via per-day upsert, keyed on the (businessId, dayOfWeek) unique constraint. */
  replaceAll(businessId: string, days: WorkingHoursListInput) {
    return prisma.$transaction(
      days.map((day) =>
        prisma.businessWorkingHours.upsert({
          where: { businessId_dayOfWeek: { businessId, dayOfWeek: day.dayOfWeek } },
          create: {
            businessId,
            dayOfWeek: day.dayOfWeek,
            isOpen: day.isOpen,
            openTime: day.openTime,
            closeTime: day.closeTime,
          },
          update: {
            isOpen: day.isOpen,
            openTime: day.openTime,
            closeTime: day.closeTime,
          },
        })
      )
    )
  },
}
