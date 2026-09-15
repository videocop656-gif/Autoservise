import { describe, expect, it } from 'vitest'
import { splitAppointmentsByActivity, ACTIVE_APPOINTMENT_STATUSES, type AppointmentStatus } from '../src/components/appointments/shared'

// ---------------------------------------------------------------------------
// Prompt 36 — Operations Daily Work Queue.
//
// splitAppointmentsByActivity() is the pure classifier OperationsPage uses
// to decide which of today's appointments render as full rows in the
// active queue vs. get rolled into the small "также сегодня: N
// завершено/отменено" count line (spec §5). Framework-free, no Date/
// timezone dependency — same convention as Prompts 33/35's own pure-
// helper unit tests, no component-test infrastructure introduced.
// ---------------------------------------------------------------------------

function apptWithStatus(status: AppointmentStatus) {
  return { id: status, status }
}

describe('ACTIVE_APPOINTMENT_STATUSES', () => {
  it('is exactly the three non-terminal AppointmentStatus values (audited from appointmentService.ts)', () => {
    expect(ACTIVE_APPOINTMENT_STATUSES.slice().sort()).toEqual(['CONFIRMED', 'IN_PROGRESS', 'SCHEDULED'].sort())
  })
})

describe('splitAppointmentsByActivity', () => {
  it('Prompt 36 §20 Test 4 — SCHEDULED/CONFIRMED/IN_PROGRESS all count as active', () => {
    const appointments = [apptWithStatus('SCHEDULED'), apptWithStatus('CONFIRMED'), apptWithStatus('IN_PROGRESS')]
    const { active, otherCount } = splitAppointmentsByActivity(appointments)
    expect(active).toHaveLength(3)
    expect(otherCount).toBe(0)
  })

  it('Prompt 36 §20 Test 5 — COMPLETED/CANCELLED/NO_SHOW are excluded from the active list and only counted', () => {
    const appointments = [apptWithStatus('COMPLETED'), apptWithStatus('CANCELLED'), apptWithStatus('NO_SHOW')]
    const { active, otherCount } = splitAppointmentsByActivity(appointments)
    expect(active).toHaveLength(0)
    expect(otherCount).toBe(3)
  })

  it('a mixed set of statuses is partitioned correctly, preserving the active items and their order', () => {
    const scheduled = apptWithStatus('SCHEDULED')
    const completed = apptWithStatus('COMPLETED')
    const inProgress = apptWithStatus('IN_PROGRESS')
    const noShow = apptWithStatus('NO_SHOW')
    const { active, otherCount } = splitAppointmentsByActivity([scheduled, completed, inProgress, noShow])
    expect(active).toEqual([scheduled, inProgress])
    expect(otherCount).toBe(2)
  })

  it('an empty list yields an empty active list and a zero count (the genuine "no work today" case)', () => {
    const { active, otherCount } = splitAppointmentsByActivity([])
    expect(active).toEqual([])
    expect(otherCount).toBe(0)
  })
})
