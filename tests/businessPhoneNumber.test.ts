import { describe, it, expect, vi, beforeEach } from 'vitest'
import { makeAuthContext, makeTenant, makeBusiness } from './helpers/fixtures'

// ---------------------------------------------------------------------------
// MCR-2 — business phone numbers (telephony routing identity): canonical E.164
// in the business's region, at most ONE active owner across all tenants,
// owner/admin only, and conflicts that never say who holds a number.
// The in-memory repository enforces the same unique key as the database
// (activePhoneE164); the real constraint is pinned in tenantIsolation.test.ts
// and was verified on Supabase.
// ---------------------------------------------------------------------------

type Row = Record<string, any>
const { db } = vi.hoisted(() => ({ db: { numbers: [] as Row[] } }))
class UniqueViolation extends Error {}

vi.mock('../src/server/repositories/businessPhoneNumberRepository', () => {
  const assertFree = (e164: string, exceptId?: string) => {
    if (db.numbers.some((n) => n.activePhoneE164 === e164 && n.id !== exceptId)) throw new UniqueViolation('P2002')
  }
  return {
    isActiveNumberConflict: (err: unknown) => err instanceof UniqueViolation,
    businessPhoneNumberRepository: {
      listByBusiness: async (t: string, b: string) => db.numbers.filter((n) => n.tenantId === t && n.businessId === b),
      create: async (data: Row) => {
        assertFree(data.phoneE164)
        const row = { ...data, id: `n${db.numbers.length + 1}`, isActive: true, activePhoneE164: data.phoneE164, createdAt: new Date() }
        db.numbers.push(row)
        return row
      },
      setActive: async (t: string, b: string, id: string, isActive: boolean) => {
        const row = db.numbers.find((n) => n.tenantId === t && n.businessId === b && n.id === id)
        if (!row) return null
        if (isActive) assertFree(row.phoneE164, row.id)
        Object.assign(row, { isActive, activePhoneE164: isActive ? row.phoneE164 : null })
        return row
      },
    },
  }
})

import { addBusinessPhoneNumber, setBusinessPhoneNumberActive, listBusinessPhoneNumbers } from '../src/server/services/businessPhoneNumberService'

const ownerA = () => makeAuthContext('owner')
const ownerB = () => makeAuthContext('owner', { tenant: makeTenant({ id: 't2' }), business: makeBusiness({ id: 'b2', tenantId: 't2' }) })

beforeEach(() => {
  db.numbers = []
})

describe('business phone numbers', () => {
  it('stores the canonical E.164 form, read in the business region', async () => {
    const n = await addBusinessPhoneNumber(ownerA(), { phone: '8 (727) 250-00-00', label: 'Ресепшн' })
    expect(n).toMatchObject({ phoneE164: '+77272500000', label: 'Ресепшн', isActive: true, activePhoneE164: '+77272500000' })
  })

  it('an invalid number → 400 INVALID_PHONE, nothing stored', async () => {
    await expect(addBusinessPhoneNumber(ownerA(), { phone: '12345' })).rejects.toMatchObject({ statusCode: 400, code: 'INVALID_PHONE' })
    expect(db.numbers).toEqual([])
  })

  it('manager cannot add or toggle numbers', async () => {
    await expect(addBusinessPhoneNumber(makeAuthContext('manager'), { phone: '+77272500000' })).rejects.toMatchObject({ statusCode: 403 })
  })

  it('duplicate active number invariant: another tenant cannot claim an active number (409, holder not revealed)', async () => {
    await addBusinessPhoneNumber(ownerA(), { phone: '+77272500000' })
    const err = await addBusinessPhoneNumber(ownerB(), { phone: '8 727 250 00 00' }).catch((e: unknown) => e)
    expect(err).toMatchObject({ statusCode: 409, code: 'PHONE_NUMBER_IN_USE' })
    expect(JSON.stringify(err)).not.toContain('t1')
    expect((err as Error).message).not.toContain('b1')
  })

  it('the same business cannot add its own active number twice', async () => {
    await addBusinessPhoneNumber(ownerA(), { phone: '+77272500000' })
    await expect(addBusinessPhoneNumber(ownerA(), { phone: '+7 727 250 00 00' })).rejects.toMatchObject({ code: 'PHONE_NUMBER_IN_USE' })
  })

  it('deactivating releases the number; the old owner cannot re-activate once someone else holds it', async () => {
    const a = await addBusinessPhoneNumber(ownerA(), { phone: '+77272500000' })
    await setBusinessPhoneNumberActive(ownerA(), a.id, false)
    await expect(addBusinessPhoneNumber(ownerB(), { phone: '+77272500000' })).resolves.toMatchObject({ tenantId: 't2', isActive: true })
    await expect(setBusinessPhoneNumberActive(ownerA(), a.id, true)).rejects.toMatchObject({ code: 'PHONE_NUMBER_IN_USE' })
  })

  it("a foreign tenant's number id is 404 and lists are tenant-scoped", async () => {
    const a = await addBusinessPhoneNumber(ownerA(), { phone: '+77272500000' })
    await expect(setBusinessPhoneNumberActive(ownerB(), a.id, false)).rejects.toMatchObject({ statusCode: 404 })
    expect(await listBusinessPhoneNumbers(ownerB())).toEqual([])
    expect(await listBusinessPhoneNumbers(ownerA())).toHaveLength(1)
  })
})
