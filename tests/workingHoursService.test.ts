import { describe, it, expect, vi, beforeEach } from 'vitest'
import { makeAuthContext } from './helpers/fixtures'

const { listByBusinessMock, replaceAllMock } = vi.hoisted(() => ({
  listByBusinessMock: vi.fn(),
  replaceAllMock: vi.fn(),
}))

vi.mock('../src/server/repositories/workingHoursRepository', () => ({
  workingHoursRepository: { listByBusiness: listByBusinessMock, replaceAll: replaceAllMock },
}))

import { listWorkingHours, replaceWorkingHours } from '../src/server/services/workingHoursService'

const SAMPLE_WEEK = [{ dayOfWeek: 'MONDAY', isOpen: true, openTime: '09:00', closeTime: '18:00' }] as never

beforeEach(() => {
  vi.clearAllMocks()
  listByBusinessMock.mockResolvedValue([])
  replaceAllMock.mockResolvedValue(undefined)
})

describe('listWorkingHours', () => {
  it('is scoped to the current session business for any authenticated role', async () => {
    for (const role of ['owner', 'admin', 'manager'] as const) {
      const ctx = makeAuthContext(role)
      await listWorkingHours(ctx)
      expect(listByBusinessMock).toHaveBeenCalledWith(ctx.business.id)
    }
  })
})

describe('replaceWorkingHours', () => {
  it('allows owner to replace the schedule', async () => {
    const ctx = makeAuthContext('owner')
    await replaceWorkingHours(ctx, SAMPLE_WEEK)
    expect(replaceAllMock).toHaveBeenCalledWith(ctx.business.id, SAMPLE_WEEK)
  })

  it('allows admin to replace the schedule', async () => {
    const ctx = makeAuthContext('admin')
    await expect(replaceWorkingHours(ctx, SAMPLE_WEEK)).resolves.toBeDefined()
  })

  it('rejects manager from replacing the schedule', async () => {
    const ctx = makeAuthContext('manager')
    await expect(replaceWorkingHours(ctx, SAMPLE_WEEK)).rejects.toMatchObject({ statusCode: 403 })
    expect(replaceAllMock).not.toHaveBeenCalled()
  })

  it("never uses a business id other than the session's current business", async () => {
    const ctx = makeAuthContext('owner', { business: { ...makeAuthContext().business, id: 'business-a' } })
    await replaceWorkingHours(ctx, SAMPLE_WEEK)
    expect(replaceAllMock).toHaveBeenCalledWith('business-a', SAMPLE_WEEK)
  })
})
