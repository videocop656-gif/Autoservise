import { z } from 'zod'
import { DayOfWeek } from '@prisma/client'

const timeStringSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Invalid time, expected HH:mm')

const workingHourDaySchema = z
  .object({
    dayOfWeek: z.nativeEnum(DayOfWeek),
    isOpen: z.boolean(),
    openTime: timeStringSchema.nullable(),
    closeTime: timeStringSchema.nullable(),
  })
  .superRefine((day, ctx) => {
    if (day.isOpen) {
      if (!day.openTime) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'openTime is required when open', path: ['openTime'] })
      }
      if (!day.closeTime) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'closeTime is required when open', path: ['closeTime'] })
      }
      if (day.openTime && day.closeTime && day.closeTime <= day.openTime) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'closeTime must be later than openTime (overnight shifts are not supported yet)',
          path: ['closeTime'],
        })
      }
    } else {
      if (day.openTime !== null) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'openTime must be null when closed', path: ['openTime'] })
      }
      if (day.closeTime !== null) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'closeTime must be null when closed', path: ['closeTime'] })
      }
    }
  })

export const workingHoursListSchema = z
  .array(workingHourDaySchema)
  .length(7, 'Exactly 7 days are required')
  .superRefine((days, ctx) => {
    const seen = new Set<DayOfWeek>()
    for (const day of days) {
      if (seen.has(day.dayOfWeek)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Duplicate day: ${day.dayOfWeek}` })
      }
      seen.add(day.dayOfWeek)
    }
    for (const day of Object.values(DayOfWeek)) {
      if (!seen.has(day)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Missing day: ${day}` })
      }
    }
  })

export type WorkingHourDayInput = z.infer<typeof workingHourDaySchema>
export type WorkingHoursListInput = z.infer<typeof workingHoursListSchema>
