import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// MCR-2 — tenant isolation of the telephony repositories, at the query level
// (same approach as tenantIsolation.test.ts): every tenant-owned read/write
// carries tenantId + businessId; the only unscoped lookup is routing by the
// globally-unique ACTIVE number; the call row lock is by provider + call id
// with bound parameters.
// ---------------------------------------------------------------------------

const m = vi.hoisted(() => ({
  bpnFindMany: vi.fn(),
  bpnFindFirst: vi.fn(),
  bpnFindUnique: vi.fn(),
  bpnUpdateMany: vi.fn(),
  bpnCreate: vi.fn(),
  callFindFirst: vi.fn(),
}))
vi.mock('../src/server/db/prisma', () => ({
  prisma: {
    businessPhoneNumber: { findMany: m.bpnFindMany, findFirst: m.bpnFindFirst, findUnique: m.bpnFindUnique, updateMany: m.bpnUpdateMany, create: m.bpnCreate },
    callInteraction: { findFirst: m.callFindFirst },
  },
}))

import { businessPhoneNumberRepository } from '../src/server/repositories/businessPhoneNumberRepository'
import { callInteractionRepository } from '../src/server/repositories/callInteractionRepository'

beforeEach(() => {
  for (const fn of Object.values(m)) fn.mockReset()
  m.bpnFindMany.mockResolvedValue([])
  m.bpnFindFirst.mockResolvedValue(null)
  m.bpnFindUnique.mockResolvedValue(null)
  m.callFindFirst.mockResolvedValue(null)
})

describe('tenant isolation — business phone numbers', () => {
  it('list is scoped by tenantId + businessId', async () => {
    await businessPhoneNumberRepository.listByBusiness('tenant-b', 'business-b')
    expect(m.bpnFindMany.mock.calls[0]![0].where).toEqual({ tenantId: 'tenant-b', businessId: 'business-b' })
  })

  it('findById is scoped; a foreign id reads nothing', async () => {
    expect(await businessPhoneNumberRepository.findById('tenant-b', 'business-b', 'number-of-a')).toBeNull()
    expect(m.bpnFindFirst).toHaveBeenCalledWith({ where: { tenantId: 'tenant-b', businessId: 'business-b', id: 'number-of-a' } })
  })

  it("setActive on another tenant's number writes nothing", async () => {
    expect(await businessPhoneNumberRepository.setActive('tenant-b', 'business-b', 'number-of-a', false)).toBeNull()
    expect(m.bpnUpdateMany).not.toHaveBeenCalled()
  })

  it('create always writes activePhoneE164 = phoneE164 (the unique routing key) for the caller tenant', async () => {
    await businessPhoneNumberRepository.create({ tenantId: 'tenant-a', businessId: 'business-a', phoneE164: '+77272500000', label: null })
    expect(m.bpnCreate).toHaveBeenCalledWith({
      data: { tenantId: 'tenant-a', businessId: 'business-a', phoneE164: '+77272500000', label: null, isActive: true, activePhoneE164: '+77272500000' },
    })
  })

  it('routing lookup is by the unique ACTIVE number only (inactive rows have activePhoneE164 = NULL)', async () => {
    await businessPhoneNumberRepository.findActiveByPhoneE164ForRouting('+77272500000')
    expect(m.bpnFindUnique).toHaveBeenCalledWith({ where: { activePhoneE164: '+77272500000' } })
  })
})

describe('tenant isolation — call interactions', () => {
  it('findById is scoped by tenantId + businessId', async () => {
    await callInteractionRepository.findById('tenant-b', 'business-b', 'call-of-a')
    expect(m.callFindFirst).toHaveBeenCalledWith({ where: { tenantId: 'tenant-b', businessId: 'business-b', id: 'call-of-a' } })
  })

  it('the call row lock is SELECT … FOR UPDATE by provider + providerCallId, bound parameters', async () => {
    const queryRaw = vi.fn().mockResolvedValue([])
    const tx = { $queryRaw: queryRaw, callInteraction: { findUnique: vi.fn() } }
    expect(await callInteractionRepository.lockByProviderCall('mock', "x' OR 1=1 --", tx as never)).toBeNull()
    const sql = queryRaw.mock.calls[0]![0] as { text: string; values: unknown[] }
    expect(sql.text).toContain('FROM "call_interactions"')
    expect(sql.text).toContain('FOR UPDATE')
    expect(sql.values).toEqual(['mock', "x' OR 1=1 --"])
    expect(tx.callInteraction.findUnique).not.toHaveBeenCalled()
  })

  it('event and call inserts are ON CONFLICT DO NOTHING (skipDuplicates), so redelivery never aborts the transaction', async () => {
    const tx = {
      callInteraction: { createMany: vi.fn().mockResolvedValue({ count: 0 }) },
      callEvent: { createMany: vi.fn().mockResolvedValue({ count: 0 }) },
    }
    await callInteractionRepository.insertIfAbsent({} as never, tx as never)
    const fresh = await callInteractionRepository.insertEventIfAbsent({} as never, tx as never)
    expect(tx.callInteraction.createMany.mock.calls[0]![0]).toMatchObject({ skipDuplicates: true })
    expect(tx.callEvent.createMany.mock.calls[0]![0]).toMatchObject({ skipDuplicates: true })
    expect(fresh).toBe(false)
  })
})
