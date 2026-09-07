import type { DayOfWeek } from '@prisma/client'

export interface DefaultWorkingHour {
  dayOfWeek: DayOfWeek
  isOpen: boolean
  openTime: string | null
  closeTime: string | null
}

/** Calendar order (Prisma/SQL sort of the DayOfWeek enum is alphabetical, not this). */
export const WEEKDAY_ORDER: DayOfWeek[] = [
  'MONDAY',
  'TUESDAY',
  'WEDNESDAY',
  'THURSDAY',
  'FRIDAY',
  'SATURDAY',
  'SUNDAY',
]

/** Applied to every newly registered Business (see authService.registerTenant) and used to backfill the migration. */
export const DEFAULT_WORKING_HOURS: DefaultWorkingHour[] = [
  { dayOfWeek: 'MONDAY', isOpen: true, openTime: '09:00', closeTime: '18:00' },
  { dayOfWeek: 'TUESDAY', isOpen: true, openTime: '09:00', closeTime: '18:00' },
  { dayOfWeek: 'WEDNESDAY', isOpen: true, openTime: '09:00', closeTime: '18:00' },
  { dayOfWeek: 'THURSDAY', isOpen: true, openTime: '09:00', closeTime: '18:00' },
  { dayOfWeek: 'FRIDAY', isOpen: true, openTime: '09:00', closeTime: '18:00' },
  { dayOfWeek: 'SATURDAY', isOpen: true, openTime: '10:00', closeTime: '15:00' },
  { dayOfWeek: 'SUNDAY', isOpen: false, openTime: null, closeTime: null },
]
