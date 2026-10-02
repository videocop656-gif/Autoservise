import { describe, it, expect, vi, beforeEach } from 'vitest'
import { makeAuthContext } from './helpers/fixtures'

const mocks = vi.hoisted(() => ({
  findByConnectionAndExternalCustomerId: vi.fn(),
  create: vi.fn(),
  findActiveByPhoneE164: vi.fn(),
}))

vi.mock('../src/server/repositories/customerChannelIdentityRepository', () => ({
  customerChannelIdentityRepository: {
    findByConnectionAndExternalCustomerId: mocks.findByConnectionAndExternalCustomerId,
    create: mocks.create,
  },
}))
vi.mock('../src/server/repositories/customerRepository', () => ({
  customerRepository: { findActiveByPhoneE164: mocks.findActiveByPhoneE164 },
}))

import { resolveCustomerForInbound, linkCustomerIdentityBestEffort } from '../src/server/services/channelCustomerService'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('resolveCustomerForInbound', () => {
  it('an existing identity always wins, never re-matched by phone', async () => {
    mocks.findByConnectionAndExternalCustomerId.mockResolvedValue({ customerId: 'cust-existing' })
    const result = await resolveCustomerForInbound(makeAuthContext('owner'), 'conn-1', {
      externalCustomerId: 'ext-1',
      customerPhone: '+70001112233',
    })
    expect(result).toEqual({ customerId: 'cust-existing', newIdentityToLink: null })
    expect(mocks.findActiveByPhoneE164).not.toHaveBeenCalled()
  })

  it('no externalCustomerId and no phone: no match, never guesses from name alone', async () => {
    const result = await resolveCustomerForInbound(makeAuthContext('owner'), 'conn-1', { customerName: 'John Smith' })
    expect(result).toEqual({ customerId: null, newIdentityToLink: null })
  })

  it('exactly one active phone match: resolved, and flagged for identity linking when an externalCustomerId is present', async () => {
    mocks.findByConnectionAndExternalCustomerId.mockResolvedValue(null)
    mocks.findActiveByPhoneE164.mockResolvedValue([{ id: 'cust-1' }])
    const result = await resolveCustomerForInbound(makeAuthContext('owner'), 'conn-1', {
      externalCustomerId: 'ext-1',
      customerPhone: '+7 (900) 111-22-33',
    })
    expect(result.customerId).toBe('cust-1')
    expect(result.newIdentityToLink).toEqual({ externalCustomerId: 'ext-1', phone: '+7 (900) 111-22-33', displayName: undefined })
  })

  it('MCR-1: the lookup key is the canonical E.164 phone, whatever the formatting / trunk prefix', async () => {
    mocks.findActiveByPhoneE164.mockResolvedValue([{ id: 'cust-1' }])
    await resolveCustomerForInbound(makeAuthContext('owner'), 'conn-1', { customerPhone: '8 (900) 111-22-33' })
    const call = mocks.findActiveByPhoneE164.mock.calls[0]!
    expect(call[2]).toBe('+79001112233')
  })

  it("MCR-1: an international number is looked up as written, never reinterpreted in the business's region", async () => {
    mocks.findActiveByPhoneE164.mockResolvedValue([])
    await resolveCustomerForInbound(makeAuthContext('owner'), 'conn-1', { customerPhone: '+49 30 12345678' })
    expect(mocks.findActiveByPhoneE164.mock.calls[0]![2]).toBe('+493012345678')
  })

  it('MCR-1: an unparseable phone matches nothing and never queries', async () => {
    const result = await resolveCustomerForInbound(makeAuthContext('owner'), 'conn-1', { customerPhone: '12-34' })
    expect(result).toEqual({ customerId: null, newIdentityToLink: null })
    expect(mocks.findActiveByPhoneE164).not.toHaveBeenCalled()
  })

  it('zero phone matches: unresolved, never auto-creates a Customer', async () => {
    mocks.findActiveByPhoneE164.mockResolvedValue([])
    const result = await resolveCustomerForInbound(makeAuthContext('owner'), 'conn-1', { customerPhone: '+79009998877' })
    expect(result).toEqual({ customerId: null, newIdentityToLink: null })
  })

  it('ambiguous (more than one) phone match: unresolved, never guesses which one', async () => {
    mocks.findActiveByPhoneE164.mockResolvedValue([{ id: 'cust-1' }, { id: 'cust-2' }])
    const result = await resolveCustomerForInbound(makeAuthContext('owner'), 'conn-1', { customerPhone: '+79009998877' })
    expect(result).toEqual({ customerId: null, newIdentityToLink: null })
  })

  it('a phone match with no externalCustomerId resolves the customer but never asks for an identity link (nothing to key it by)', async () => {
    mocks.findActiveByPhoneE164.mockResolvedValue([{ id: 'cust-1' }])
    const result = await resolveCustomerForInbound(makeAuthContext('owner'), 'conn-1', { customerPhone: '+79009998877' })
    expect(result).toEqual({ customerId: 'cust-1', newIdentityToLink: null })
  })

  it('resolution is always scoped to this specific channelConnectionId', async () => {
    mocks.findByConnectionAndExternalCustomerId.mockResolvedValue(null)
    await resolveCustomerForInbound(makeAuthContext('owner'), 'conn-specific', { externalCustomerId: 'ext-1' })
    const ctxArg = mocks.findByConnectionAndExternalCustomerId.mock.calls[0]!
    expect(ctxArg[2]).toBe('conn-specific')
  })
})

describe('linkCustomerIdentityBestEffort', () => {
  it('creates the identity mapping scoped to tenant/business/connection', async () => {
    mocks.create.mockResolvedValue({})
    const ctx = makeAuthContext('owner')
    await linkCustomerIdentityBestEffort(ctx, 'conn-1', 'cust-1', { externalCustomerId: 'ext-1', phone: '+7900', displayName: 'John' })
    expect(mocks.create).toHaveBeenCalledWith({
      tenantId: ctx.tenant.id,
      businessId: ctx.business.id,
      customerId: 'cust-1',
      channelConnectionId: 'conn-1',
      externalCustomerId: 'ext-1',
      displayName: 'John',
      phone: '+7900',
    })
  })

  it('never throws — a genuine conflict (spec §"CUSTOMER IDENTITY CONFLICT") is swallowed, never breaking the caller', async () => {
    mocks.create.mockRejectedValue(new Error('P2002 unique constraint'))
    await expect(
      linkCustomerIdentityBestEffort(makeAuthContext('owner'), 'conn-1', 'cust-1', { externalCustomerId: 'ext-1' })
    ).resolves.toBeUndefined()
  })
})
