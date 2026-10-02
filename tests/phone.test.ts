import { describe, it, expect, vi, beforeEach } from 'vitest'
import { makeAuthContext, makeBusiness } from './helpers/fixtures'
import { normalizePhone, parsePhone, maskPhone, isSupportedPhoneRegion } from '../src/server/lib/phone'
import { planPhoneBackfill, phoneCollisionCounts } from '../src/server/lib/phoneBackfill'
import { businessProfileSchema } from '../src/server/validation/business.schemas'

// ---------------------------------------------------------------------------
// MCR-1 — Phone Identity Foundation: the canonical E.164 contract
// (libphonenumber-js, per-business default region), masking, the backfill
// planner, and customerService keeping Customer.phoneE164 in step.
// ---------------------------------------------------------------------------

const { createMock, updateByIdMock } = vi.hoisted(() => ({ createMock: vi.fn(), updateByIdMock: vi.fn() }))
vi.mock('../src/server/repositories/customerRepository', () => ({
  customerRepository: { create: createMock, updateById: updateByIdMock, findActiveByEmail: vi.fn().mockResolvedValue(null) },
}))
vi.mock('../src/server/repositories/vehicleRepository', () => ({ vehicleRepository: { list: vi.fn() } }))

import { createCustomer, updateCustomer } from '../src/server/services/customerService'

describe('normalizePhone — Kazakhstan (default region KZ)', () => {
  it.each([
    ['+7 701 123 45 67', '+77011234567'],
    ['+77011234567', '+77011234567'],
    ['87011234567', '+77011234567'],
    ['8 (701) 123-45-67', '+77011234567'],
    ['7011234567', '+77011234567'],
    ['  8 701 123-45-67  ', '+77011234567'],
    ['8 727 250 00 00', '+77272500000'], // Almaty landline
  ])('%j → %s (all forms of one number are one identity)', (raw, e164) => {
    expect(normalizePhone(raw, 'KZ')).toBe(e164)
  })
})

describe('normalizePhone — Russia (default region RU)', () => {
  it.each([
    ['8 (900) 111-22-33', '+79001112233'],
    ['9001112233', '+79001112233'],
    ['+7 495 123-45-67', '+74951234567'],
  ])('%j → %s', (raw, e164) => {
    expect(normalizePhone(raw, 'RU')).toBe(e164)
  })

  it('KZ and RU share +7: a Russian number entered in a KZ business is still the same canonical number', () => {
    expect(normalizePhone('8 (900) 111-22-33', 'KZ')).toBe('+79001112233')
    expect(normalizePhone('8 701 123 45 67', 'RU')).toBe('+77011234567')
  })
})

describe('normalizePhone — international numbers are kept, never reinterpreted', () => {
  it.each([
    ['+49 30 12345678', '+493012345678'], // Germany
    ['+1 212 555 0123', '+12125550123'], // USA
    ['+998 90 123 45 67', '+998901234567'], // Uzbekistan
    ['+44 20 7946 0958', '+442079460958'], // UK
    ['+380 44 123 4567', '+380441234567'], // Ukraine
  ])('%j → %s even with default region KZ', (raw, e164) => {
    expect(normalizePhone(raw, 'KZ')).toBe(e164)
  })

  it('a non-+7 default region parses national input in that plan (not hard-coded to +7)', () => {
    expect(normalizePhone('030 12345678', 'DE')).toBe('+493012345678')
    expect(normalizePhone('90 123 45 67', 'UZ')).toBe('+998901234567')
  })
})

describe('parsePhone — empty vs invalid vs valid', () => {
  it('empty / whitespace / null / undefined → empty', () => {
    for (const v of ['', '   ', null, undefined]) expect(parsePhone(v, 'KZ')).toEqual({ status: 'empty' })
  })

  it.each([
    ['телефон'],
    ['12345'],
    ['+7 701 123 45'], // too short
    ['+8 701 123 45 67'], // "+8" is not a country — never "fixed" into +7
    ['+0 123 456 789'],
  ])('%j → invalid (never an identity, no digits invented)', (raw) => {
    expect(parsePhone(raw, 'KZ')).toEqual({ status: 'invalid' })
    expect(normalizePhone(raw, 'KZ')).toBeNull()
  })

  it('national input with no (or an unknown) default region is invalid — never assumed to be KZ', () => {
    expect(parsePhone('87011234567', null)).toEqual({ status: 'invalid' })
    expect(parsePhone('87011234567', 'XX')).toEqual({ status: 'invalid' })
    expect(normalizePhone('+77011234567', null)).toBe('+77011234567') // "+" input needs no region
  })

  it('valid results report the detected country', () => {
    expect(parsePhone('8 701 123 45 67', 'KZ')).toEqual({ status: 'valid', e164: '+77011234567', country: 'KZ' })
    expect(parsePhone('+1 212 555 0123', 'KZ')).toMatchObject({ status: 'valid', country: 'US' })
  })

  it('is idempotent on canonical values', () => {
    for (const v of ['+77011234567', '+79001112233', '+493012345678']) expect(normalizePhone(v, 'KZ')).toBe(v)
  })
})

describe('isSupportedPhoneRegion / business setting', () => {
  it('accepts libphonenumber ISO codes only', () => {
    expect(isSupportedPhoneRegion('KZ')).toBe(true)
    expect(isSupportedPhoneRegion('RU')).toBe(true)
    expect(isSupportedPhoneRegion('XX')).toBe(false)
    expect(isSupportedPhoneRegion('kz')).toBe(false)
    expect(isSupportedPhoneRegion('Kazakhstan')).toBe(false)
  })

  it('the business profile accepts a region code (normalized to upper case) and rejects unknown ones', () => {
    expect(businessProfileSchema.parse({ phoneRegion: 'kz' })).toEqual({ phoneRegion: 'KZ' })
    expect(businessProfileSchema.safeParse({ phoneRegion: 'XX' }).success).toBe(false)
    expect(businessProfileSchema.safeParse({ phoneRegion: 'Казахстан' }).success).toBe(false)
  })
})

describe('maskPhone', () => {
  it('keeps the country code and the last 4 digits only', () => {
    expect(maskPhone('+7 (701) 123-45-67', 'KZ')).toBe('+7******4567')
    expect(maskPhone('8 701 123 45 67', 'KZ')).toBe('+7******4567')
    expect(maskPhone('+998 90 123 45 67')).toBe('+998*****4567')
  })

  it('never echoes a short, invalid or empty value', () => {
    for (const v of ['12345', '+7 701 12', 'телефон', '', null]) expect(maskPhone(v, 'KZ')).toBe('***')
  })

  it('the masked form never contains the full number', () => {
    const masked = maskPhone('+77011234567')
    expect(masked).not.toContain('7011234567')
    expect(masked.replace(/\D/g, '').length).toBeLessThan(8)
  })
})

describe('planPhoneBackfill (the backfill runner\'s pure half)', () => {
  const rows = [
    { id: 'a', phone: '8 701 123 45 67', phoneE164: null }, // valid → set
    { id: 'b', phone: '+77011234567', phoneE164: '+77011234567' }, // already current
    { id: 'c', phone: 'не помню', phoneE164: '+70000000000' }, // invalid → cleared, never guessed
    { id: 'd', phone: '+49 30 12345678', phoneE164: null }, // international kept
  ]

  it('plans only real changes and counts statuses', () => {
    const plan = planPhoneBackfill(rows, 'KZ')
    expect(plan.updates).toEqual([
      { id: 'a', phoneE164: '+77011234567' },
      { id: 'c', phoneE164: null },
      { id: 'd', phoneE164: '+493012345678' },
    ])
    expect(plan.counts).toEqual({ total: 4, valid: 3, invalid: 1, empty: 0, changed: 3, unchanged: 1 })
  })

  it('is idempotent: applying the plan and planning again changes nothing', () => {
    const first = planPhoneBackfill(rows, 'KZ')
    const applied = rows.map((r) => {
      const update = first.updates.find((u) => u.id === r.id)
      return update ? { ...r, phoneE164: update.phoneE164 } : r
    })
    expect(planPhoneBackfill(applied, 'KZ').updates).toEqual([])
  })

  it('collision audit: duplicates are counted per business (active only), cross-business sharing separately', () => {
    const counts = phoneCollisionCounts([
      { tenantId: 't1', businessId: 'b1', isActive: true, phoneE164: '+77011234567' },
      { tenantId: 't1', businessId: 'b1', isActive: true, phoneE164: '+77011234567' },
      { tenantId: 't1', businessId: 'b1', isActive: false, phoneE164: '+77011234567' },
      { tenantId: 't2', businessId: 'b2', isActive: true, phoneE164: '+77011234567' },
      { tenantId: 't2', businessId: 'b2', isActive: true, phoneE164: null },
    ])
    expect(counts).toEqual({ activeDuplicateGroupsWithinBusiness: 1, largestActiveDuplicateGroup: 2, numbersSharedAcrossBusinesses: 1 })
  })
})

describe('customerService keeps phoneE164 in step with phone', () => {
  beforeEach(() => {
    createMock.mockReset().mockImplementation(async (data: unknown) => data)
    updateByIdMock.mockReset().mockImplementation(async (_t: string, _b: string, _id: string, data: unknown) => data)
  })

  it("create stores the entered phone as-is and its canonical form in the business's region", async () => {
    await createCustomer(makeAuthContext('owner'), { firstName: 'Иван', phone: '8 (701) 123-45-67' } as never)
    expect(createMock.mock.calls[0]![0]).toMatchObject({ phone: '8 (701) 123-45-67', phoneE164: '+77011234567' })
  })

  it('the business region decides national input (a DE business reads "030 …" as German)', async () => {
    const ctx = makeAuthContext('owner', { business: makeBusiness({ phoneRegion: 'DE' }) })
    await createCustomer(ctx, { firstName: 'Hans', phone: '030 12345678' } as never)
    expect(createMock.mock.calls[0]![0]).toMatchObject({ phoneE164: '+493012345678' })
  })

  it('an invalid phone is still accepted as entered (existing free-form rule) but gets NO identity', async () => {
    await createCustomer(makeAuthContext('owner'), { firstName: 'Иван', phone: '12345' } as never)
    expect(createMock.mock.calls[0]![0]).toMatchObject({ phone: '12345', phoneE164: null })
  })

  it('a phone change recomputes phoneE164 (valid → canonical, invalid → cleared); other updates leave it alone', async () => {
    await updateCustomer(makeAuthContext('owner'), 'c1', { phone: '+7 900 111-22-33' } as never)
    expect(updateByIdMock.mock.calls[0]![3]).toEqual({ phone: '+7 900 111-22-33', phoneE164: '+79001112233' })

    await updateCustomer(makeAuthContext('owner'), 'c1', { phone: 'нет номера' } as never)
    expect(updateByIdMock.mock.calls[1]![3]).toEqual({ phone: 'нет номера', phoneE164: null })

    await updateCustomer(makeAuthContext('owner'), 'c1', { notes: 'x' } as never)
    expect(updateByIdMock.mock.calls[2]![3]).toEqual({ notes: 'x' })
  })
})
