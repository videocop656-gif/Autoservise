import type { Business, Tenant, UserRole } from '@prisma/client'
import type { AuthContext } from '../../src/server/types/auth'

export function makeTenant(overrides: Partial<Tenant> = {}): Tenant {
  return {
    id: 't1',
    name: 'Test Tenant',
    status: 'trial',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }
}

export function makeBusiness(overrides: Partial<Business> = {}): Business {
  return {
    id: 'b1',
    tenantId: 't1',
    name: 'Test Auto Service',
    description: null,
    phone: null,
    email: null,
    address: null,
    timezone: 'Europe/Moscow',
    website: null,
    currency: 'RUB',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }
}

export function makeAuthContext(role: UserRole = 'owner', overrides: Partial<AuthContext> = {}): AuthContext {
  return {
    user: {
      id: 'u1',
      tenantId: 't1',
      email: 'a@b.com',
      name: 'A',
      role,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    tenant: makeTenant(),
    business: makeBusiness(),
    sessionId: 's1',
    ...overrides,
  }
}
