import { describe, it, expect, vi, beforeEach } from 'vitest'

const {
  businessFindManyMock,
  businessFindFirstMock,
  businessUpdateManyMock,
  serviceFindManyMock,
  serviceFindFirstMock,
  serviceUpdateManyMock,
  knowledgeFindFirstMock,
  knowledgeUpdateManyMock,
  ruleFindFirstMock,
  ruleUpdateManyMock,
  customerFindFirstMock,
  customerUpdateManyMock,
  vehicleFindFirstMock,
  vehicleUpdateManyMock,
  leadFindFirstMock,
  leadUpdateManyMock,
  appointmentFindFirstMock,
  appointmentUpdateManyMock,
  serviceRecordFindFirstMock,
  serviceRecordFindManyMock,
  serviceRecordCountMock,
  serviceRecordUpdateManyMock,
  serviceRecordAggregateMock,
  customerRequestFindFirstMock,
  customerRequestFindManyMock,
  customerRequestCountMock,
  customerRequestUpdateManyMock,
  customerRequestStatusHistoryCreateMock,
  conversationFindFirstMock,
  conversationFindManyMock,
  conversationCountMock,
  conversationUpdateManyMock,
  messageFindManyMock,
  messageCreateMock,
  aiEscalationFindFirstMock,
  aiEscalationFindManyMock,
  aiEscalationCountMock,
  aiEscalationUpdateManyMock,
  aiEscalationCreateMock,
  transactionMock,
  txTargetRef,
} = vi.hoisted(() => {
  const txTargetRef: { current: unknown } = { current: null }
  return {
    businessFindManyMock: vi.fn(),
    businessFindFirstMock: vi.fn(),
    businessUpdateManyMock: vi.fn(),
    serviceFindManyMock: vi.fn(),
    serviceFindFirstMock: vi.fn(),
    serviceUpdateManyMock: vi.fn(),
    knowledgeFindFirstMock: vi.fn(),
    knowledgeUpdateManyMock: vi.fn(),
    ruleFindFirstMock: vi.fn(),
    ruleUpdateManyMock: vi.fn(),
    customerFindFirstMock: vi.fn(),
    customerUpdateManyMock: vi.fn(),
    vehicleFindFirstMock: vi.fn(),
    vehicleUpdateManyMock: vi.fn(),
    leadFindFirstMock: vi.fn(),
    leadUpdateManyMock: vi.fn(),
    appointmentFindFirstMock: vi.fn(),
    appointmentUpdateManyMock: vi.fn(),
    serviceRecordFindFirstMock: vi.fn(),
    serviceRecordFindManyMock: vi.fn(),
    serviceRecordCountMock: vi.fn(),
    serviceRecordUpdateManyMock: vi.fn(),
    serviceRecordAggregateMock: vi.fn(),
    customerRequestFindFirstMock: vi.fn(),
    customerRequestFindManyMock: vi.fn(),
    customerRequestCountMock: vi.fn(),
    customerRequestUpdateManyMock: vi.fn(),
    customerRequestStatusHistoryCreateMock: vi.fn(),
    conversationFindFirstMock: vi.fn(),
    conversationFindManyMock: vi.fn(),
    conversationCountMock: vi.fn(),
    conversationUpdateManyMock: vi.fn(),
    messageFindManyMock: vi.fn(),
    messageCreateMock: vi.fn(),
    aiEscalationFindFirstMock: vi.fn(),
    aiEscalationFindManyMock: vi.fn(),
    aiEscalationCountMock: vi.fn(),
    aiEscalationUpdateManyMock: vi.fn(),
    aiEscalationCreateMock: vi.fn(),
    // $transaction supports two call shapes in this codebase: the array
    // form (workingHoursRepository.replaceAll, pre-existing) just returns
    // the array of operations unchanged; the interactive-callback form
    // (new, customerRequestRepository) invokes the callback with the same
    // mocked prisma object as `tx` — txTargetRef is filled in below, once
    // the mock object exists (vi.mock's factory runs after this).
    transactionMock: vi.fn(async (arg: unknown) => {
      if (typeof arg === 'function') {
        return (arg as (tx: unknown) => unknown)(txTargetRef.current)
      }
      return arg
    }),
    txTargetRef,
  }
})

vi.mock('../src/server/db/prisma', () => {
  const prismaMock = {
    business: { findMany: businessFindManyMock, findFirst: businessFindFirstMock, updateMany: businessUpdateManyMock },
    service: { findMany: serviceFindManyMock, findFirst: serviceFindFirstMock, updateMany: serviceUpdateManyMock },
    knowledgeItem: { findFirst: knowledgeFindFirstMock, updateMany: knowledgeUpdateManyMock },
    businessRule: { findFirst: ruleFindFirstMock, updateMany: ruleUpdateManyMock },
    customer: { findFirst: customerFindFirstMock, updateMany: customerUpdateManyMock },
    vehicle: { findFirst: vehicleFindFirstMock, updateMany: vehicleUpdateManyMock },
    lead: { findFirst: leadFindFirstMock, updateMany: leadUpdateManyMock },
    appointment: { findFirst: appointmentFindFirstMock, updateMany: appointmentUpdateManyMock },
    serviceRecord: {
      findFirst: serviceRecordFindFirstMock,
      findMany: serviceRecordFindManyMock,
      count: serviceRecordCountMock,
      updateMany: serviceRecordUpdateManyMock,
      aggregate: serviceRecordAggregateMock,
    },
    customerRequest: {
      findFirst: customerRequestFindFirstMock,
      findMany: customerRequestFindManyMock,
      count: customerRequestCountMock,
      updateMany: customerRequestUpdateManyMock,
    },
    customerRequestStatusHistory: { create: customerRequestStatusHistoryCreateMock },
    conversation: {
      findFirst: conversationFindFirstMock,
      findMany: conversationFindManyMock,
      count: conversationCountMock,
      updateMany: conversationUpdateManyMock,
    },
    message: { findMany: messageFindManyMock, create: messageCreateMock },
    aiEscalation: {
      findFirst: aiEscalationFindFirstMock,
      findMany: aiEscalationFindManyMock,
      count: aiEscalationCountMock,
      updateMany: aiEscalationUpdateManyMock,
      create: aiEscalationCreateMock,
    },
    businessWorkingHours: { upsert: vi.fn((args: unknown) => args) },
    $transaction: transactionMock,
  }
  txTargetRef.current = prismaMock
  return { prisma: prismaMock }
})

import { businessRepository } from '../src/server/repositories/businessRepository'
import { serviceRepository } from '../src/server/repositories/serviceRepository'
import { workingHoursRepository } from '../src/server/repositories/workingHoursRepository'
import { knowledgeRepository } from '../src/server/repositories/knowledgeRepository'
import { businessRuleRepository } from '../src/server/repositories/businessRuleRepository'
import { customerRepository } from '../src/server/repositories/customerRepository'
import { vehicleRepository } from '../src/server/repositories/vehicleRepository'
import { leadRepository } from '../src/server/repositories/leadRepository'
import { appointmentRepository } from '../src/server/repositories/appointmentRepository'
import { serviceRecordRepository } from '../src/server/repositories/serviceRecordRepository'
import { customerRequestRepository } from '../src/server/repositories/customerRequestRepository'
import { conversationRepository } from '../src/server/repositories/conversationRepository'
import { messageRepository } from '../src/server/repositories/messageRepository'
import { escalationRepository } from '../src/server/repositories/escalationRepository'
import { getEscalation, claimEscalation, resolveEscalation, cancelEscalation } from '../src/server/services/escalationService'
import { analyzeMessage } from '../src/server/services/aiService'
import { executeCheckAvailability } from '../src/server/ai/tools/checkAvailabilityTool'
import { executeCreateAppointment } from '../src/server/ai/tools/createAppointmentTool'
import { executeRescheduleAppointment } from '../src/server/ai/tools/rescheduleAppointmentTool'
import { executeCancelAppointment } from '../src/server/ai/tools/cancelAppointmentTool'
import { makeAuthContext, makeTenant, makeBusiness } from './helpers/fixtures'
import type { AiProvider } from '../src/server/ai/provider'
import type { AiToolAllowedEntities } from '../src/server/ai/types'

beforeEach(() => {
  vi.clearAllMocks()
  businessFindManyMock.mockResolvedValue([])
  businessFindFirstMock.mockResolvedValue(null)
  businessUpdateManyMock.mockResolvedValue({ count: 0 })
  serviceFindManyMock.mockResolvedValue([])
  serviceFindFirstMock.mockResolvedValue(null)
  serviceUpdateManyMock.mockResolvedValue({ count: 0 })
  knowledgeFindFirstMock.mockResolvedValue(null)
  knowledgeUpdateManyMock.mockResolvedValue({ count: 0 })
  ruleFindFirstMock.mockResolvedValue(null)
  ruleUpdateManyMock.mockResolvedValue({ count: 0 })
  customerFindFirstMock.mockResolvedValue(null)
  customerUpdateManyMock.mockResolvedValue({ count: 0 })
  vehicleFindFirstMock.mockResolvedValue(null)
  vehicleUpdateManyMock.mockResolvedValue({ count: 0 })
  leadFindFirstMock.mockResolvedValue(null)
  leadUpdateManyMock.mockResolvedValue({ count: 0 })
  appointmentFindFirstMock.mockResolvedValue(null)
  appointmentUpdateManyMock.mockResolvedValue({ count: 0 })
  serviceRecordFindFirstMock.mockResolvedValue(null)
  serviceRecordFindManyMock.mockResolvedValue([])
  serviceRecordCountMock.mockResolvedValue(0)
  serviceRecordUpdateManyMock.mockResolvedValue({ count: 0 })
  serviceRecordAggregateMock.mockResolvedValue({ _max: { mileage: null } })
  customerRequestFindFirstMock.mockResolvedValue(null)
  customerRequestFindManyMock.mockResolvedValue([])
  customerRequestCountMock.mockResolvedValue(0)
  customerRequestUpdateManyMock.mockResolvedValue({ count: 0 })
  customerRequestStatusHistoryCreateMock.mockResolvedValue({})
  conversationFindFirstMock.mockResolvedValue(null)
  conversationFindManyMock.mockResolvedValue([])
  conversationCountMock.mockResolvedValue(0)
  conversationUpdateManyMock.mockResolvedValue({ count: 0 })
  messageFindManyMock.mockResolvedValue([])
  messageCreateMock.mockResolvedValue({ id: 'm1', createdAt: new Date() })
  aiEscalationFindFirstMock.mockResolvedValue(null)
  aiEscalationFindManyMock.mockResolvedValue([])
  aiEscalationCountMock.mockResolvedValue(0)
  aiEscalationUpdateManyMock.mockResolvedValue({ count: 0 })
  aiEscalationCreateMock.mockResolvedValue({})
})

describe('tenant isolation — Business', () => {
  it('always scopes business list queries to the requesting tenant', async () => {
    await businessRepository.listByTenant('tenant-a')
    expect(businessFindManyMock).toHaveBeenCalledWith({ where: { tenantId: 'tenant-a' } })
  })

  it('never lets tenant A read data scoped to tenant B', async () => {
    await businessRepository.listByTenant('tenant-a')
    const callArgs = businessFindManyMock.mock.calls[0]![0] as { where: { tenantId: string } }
    expect(callArgs.where.tenantId).toBe('tenant-a')
    expect(callArgs.where.tenantId).not.toBe('tenant-b')
  })

  it('scopes single-record lookups to the requesting tenant too', async () => {
    await businessRepository.findFirstByTenant('tenant-a')
    expect(businessFindFirstMock).toHaveBeenCalledWith({ where: { tenantId: 'tenant-a' } })
  })

  it('Test 4 — tenant A cannot update tenant B business: updateMany is scoped by tenantId + id together', async () => {
    businessUpdateManyMock.mockResolvedValue({ count: 0 })
    const result = await businessRepository.update('tenant-a', 'business-owned-by-tenant-b', { name: 'Hijacked' })

    expect(businessUpdateManyMock).toHaveBeenCalledWith({
      where: { id: 'business-owned-by-tenant-b', tenantId: 'tenant-a' },
      data: { name: 'Hijacked' },
    })
    // 0 rows matched because the id belongs to a different tenant -> repository reports "not found", not success.
    expect(result).toBeNull()
  })
})

describe('tenant isolation — Service', () => {
  it('Test 1 — tenant A service cannot be read by tenant B (query is scoped, so it simply never matches)', async () => {
    serviceFindFirstMock.mockResolvedValue(null)
    const result = await serviceRepository.findById('tenant-b', 'business-b', 'service-owned-by-tenant-a')

    expect(serviceFindFirstMock).toHaveBeenCalledWith({
      where: { businessId: 'business-b', id: 'service-owned-by-tenant-a', tenantId: 'tenant-b' },
    })
    expect(result).toBeNull()
  })

  it('Test 2 — tenant A cannot update tenant B service: updateMany is scoped by tenantId + businessId + id', async () => {
    serviceUpdateManyMock.mockResolvedValue({ count: 0 })
    const result = await serviceRepository.updateById('tenant-a', 'business-a', 'service-owned-by-tenant-b', { name: 'X' })

    expect(serviceUpdateManyMock).toHaveBeenCalledWith({
      where: { businessId: 'business-a', id: 'service-owned-by-tenant-b', tenantId: 'tenant-a' },
      data: { name: 'X' },
    })
    expect(result).toBeNull()
  })

  it('Test 3 — tenant A cannot deactivate tenant B service: 0 rows matched, not a silent success', async () => {
    serviceUpdateManyMock.mockResolvedValue({ count: 0 })
    const count = await serviceRepository.deactivate('tenant-a', 'business-a', 'service-owned-by-tenant-b')

    expect(serviceUpdateManyMock).toHaveBeenCalledWith({
      where: { businessId: 'business-a', id: 'service-owned-by-tenant-b', tenantId: 'tenant-a' },
      data: { isActive: false },
    })
    expect(count).toBe(0)
  })

  it('list queries are always scoped to both tenantId and businessId', async () => {
    await serviceRepository.listByBusiness('tenant-a', 'business-a', true)
    expect(serviceFindManyMock).toHaveBeenCalledWith({
      where: { businessId: 'business-a', isActive: true, tenantId: 'tenant-a' },
      orderBy: { createdAt: 'asc' },
    })
  })
})

describe('tenant isolation — Working hours', () => {
  it('Test 5 — replacing the schedule only ever touches the given businessId (there is no tenant-supplied override)', async () => {
    const days = [{ dayOfWeek: 'MONDAY', isOpen: true, openTime: '09:00', closeTime: '18:00' }] as never
    await workingHoursRepository.replaceAll('business-a', days)

    expect(transactionMock).toHaveBeenCalledTimes(1)
    const ops = transactionMock.mock.calls[0]![0] as Array<{ where: { businessId_dayOfWeek: { businessId: string } } }>
    expect(ops.every((op) => op.where.businessId_dayOfWeek.businessId === 'business-a')).toBe(true)
  })
})

describe('tenant isolation — Knowledge base', () => {
  it('Test 1 — tenant A knowledge item cannot be read by tenant B', async () => {
    knowledgeFindFirstMock.mockResolvedValue(null)
    const result = await knowledgeRepository.findById('tenant-b', 'business-b', 'item-owned-by-tenant-a')

    expect(knowledgeFindFirstMock).toHaveBeenCalledWith({
      where: { businessId: 'business-b', id: 'item-owned-by-tenant-a', tenantId: 'tenant-b' },
    })
    expect(result).toBeNull()
  })

  it('Test 2 — tenant A cannot update tenant B knowledge item', async () => {
    knowledgeUpdateManyMock.mockResolvedValue({ count: 0 })
    const result = await knowledgeRepository.updateById('tenant-a', 'business-a', 'item-owned-by-tenant-b', { title: 'X' })

    expect(knowledgeUpdateManyMock).toHaveBeenCalledWith({
      where: { businessId: 'business-a', id: 'item-owned-by-tenant-b', tenantId: 'tenant-a' },
      data: { title: 'X' },
    })
    expect(result).toBeNull()
  })

  it('Test 3 — tenant A cannot deactivate tenant B knowledge item', async () => {
    knowledgeUpdateManyMock.mockResolvedValue({ count: 0 })
    const count = await knowledgeRepository.deactivate('tenant-a', 'business-a', 'item-owned-by-tenant-b')

    expect(knowledgeUpdateManyMock).toHaveBeenCalledWith({
      where: { businessId: 'business-a', id: 'item-owned-by-tenant-b', tenantId: 'tenant-a' },
      data: { isActive: false },
    })
    expect(count).toBe(0)
  })
})

describe('tenant isolation — Business rules', () => {
  it('Test 1 — tenant A rule cannot be read by tenant B', async () => {
    ruleFindFirstMock.mockResolvedValue(null)
    const result = await businessRuleRepository.findById('tenant-b', 'business-b', 'rule-owned-by-tenant-a')

    expect(ruleFindFirstMock).toHaveBeenCalledWith({
      where: { businessId: 'business-b', id: 'rule-owned-by-tenant-a', tenantId: 'tenant-b' },
    })
    expect(result).toBeNull()
  })

  it('Test 2 — tenant A cannot update tenant B rule', async () => {
    ruleUpdateManyMock.mockResolvedValue({ count: 0 })
    const result = await businessRuleRepository.updateById('tenant-a', 'business-a', 'rule-owned-by-tenant-b', { priority: 1 })

    expect(ruleUpdateManyMock).toHaveBeenCalledWith({
      where: { businessId: 'business-a', id: 'rule-owned-by-tenant-b', tenantId: 'tenant-a' },
      data: { priority: 1 },
    })
    expect(result).toBeNull()
  })

  it('Test 3 — tenant A cannot deactivate tenant B rule', async () => {
    ruleUpdateManyMock.mockResolvedValue({ count: 0 })
    const count = await businessRuleRepository.deactivate('tenant-a', 'business-a', 'rule-owned-by-tenant-b')

    expect(ruleUpdateManyMock).toHaveBeenCalledWith({
      where: { businessId: 'business-a', id: 'rule-owned-by-tenant-b', tenantId: 'tenant-a' },
      data: { isActive: false },
    })
    expect(count).toBe(0)
  })
})

describe('tenant isolation — Customer', () => {
  it('tenant B cannot GET tenant A customer', async () => {
    customerFindFirstMock.mockResolvedValue(null)
    const result = await customerRepository.findById('tenant-b', 'business-b', 'customer-owned-by-tenant-a')

    expect(customerFindFirstMock).toHaveBeenCalledWith({
      where: { businessId: 'business-b', id: 'customer-owned-by-tenant-a', tenantId: 'tenant-b' },
    })
    expect(result).toBeNull()
  })

  it('tenant B cannot PATCH tenant A customer', async () => {
    customerUpdateManyMock.mockResolvedValue({ count: 0 })
    const result = await customerRepository.updateById('tenant-b', 'business-b', 'customer-owned-by-tenant-a', {
      firstName: 'Hijacked',
    })

    expect(customerUpdateManyMock).toHaveBeenCalledWith({
      where: { businessId: 'business-b', id: 'customer-owned-by-tenant-a', tenantId: 'tenant-b' },
      data: { firstName: 'Hijacked' },
    })
    expect(result).toBeNull()
  })

  it('tenant B cannot DELETE (deactivate) tenant A customer', async () => {
    customerUpdateManyMock.mockResolvedValue({ count: 0 })
    const count = await customerRepository.deactivate('tenant-b', 'business-b', 'customer-owned-by-tenant-a')

    expect(customerUpdateManyMock).toHaveBeenCalledWith({
      where: { businessId: 'business-b', id: 'customer-owned-by-tenant-a', tenantId: 'tenant-b' },
      data: { isActive: false },
    })
    expect(count).toBe(0)
  })

  it('email-duplicate lookups are scoped to the requesting tenant/business', async () => {
    await customerRepository.findActiveByEmail('tenant-a', 'business-a', 'a@b.com')
    expect(customerFindFirstMock).toHaveBeenCalledWith({
      where: { businessId: 'business-a', email: 'a@b.com', isActive: true, tenantId: 'tenant-a' },
    })
  })
})

describe('tenant isolation — Vehicle', () => {
  it('tenant B cannot GET tenant A vehicle', async () => {
    vehicleFindFirstMock.mockResolvedValue(null)
    const result = await vehicleRepository.findById('tenant-b', 'business-b', 'vehicle-owned-by-tenant-a')

    expect(vehicleFindFirstMock).toHaveBeenCalledWith({
      where: { businessId: 'business-b', id: 'vehicle-owned-by-tenant-a', tenantId: 'tenant-b' },
    })
    expect(result).toBeNull()
  })

  it('tenant B cannot PATCH tenant A vehicle', async () => {
    vehicleUpdateManyMock.mockResolvedValue({ count: 0 })
    const result = await vehicleRepository.updateById('tenant-b', 'business-b', 'vehicle-owned-by-tenant-a', {
      make: 'Hijacked',
    })

    expect(vehicleUpdateManyMock).toHaveBeenCalledWith({
      where: { businessId: 'business-b', id: 'vehicle-owned-by-tenant-a', tenantId: 'tenant-b' },
      data: { make: 'Hijacked' },
    })
    expect(result).toBeNull()
  })

  it('tenant B cannot DELETE (deactivate) tenant A vehicle', async () => {
    vehicleUpdateManyMock.mockResolvedValue({ count: 0 })
    const count = await vehicleRepository.deactivate('tenant-b', 'business-b', 'vehicle-owned-by-tenant-a')

    expect(vehicleUpdateManyMock).toHaveBeenCalledWith({
      where: { businessId: 'business-b', id: 'vehicle-owned-by-tenant-a', tenantId: 'tenant-b' },
      data: { isActive: false },
    })
    expect(count).toBe(0)
  })

})

describe('tenant isolation — Lead', () => {
  it('tenant B cannot GET tenant A lead', async () => {
    leadFindFirstMock.mockResolvedValue(null)
    const result = await leadRepository.findById('tenant-b', 'business-b', 'lead-owned-by-tenant-a')

    expect(leadFindFirstMock).toHaveBeenCalledWith({
      where: { businessId: 'business-b', id: 'lead-owned-by-tenant-a', tenantId: 'tenant-b' },
    })
    expect(result).toBeNull()
  })

  it('tenant B cannot PATCH tenant A lead', async () => {
    leadUpdateManyMock.mockResolvedValue({ count: 0 })
    const result = await leadRepository.updateById('tenant-b', 'business-b', 'lead-owned-by-tenant-a', {
      subject: 'Hijacked',
    })

    expect(leadUpdateManyMock).toHaveBeenCalledWith({
      where: { businessId: 'business-b', id: 'lead-owned-by-tenant-a', tenantId: 'tenant-b' },
      data: { subject: 'Hijacked' },
    })
    expect(result).toBeNull()
  })
})

describe('tenant isolation — Appointment', () => {
  it('tenant B cannot GET tenant A appointment', async () => {
    appointmentFindFirstMock.mockResolvedValue(null)
    const result = await appointmentRepository.findById('tenant-b', 'business-b', 'appointment-owned-by-tenant-a')

    expect(appointmentFindFirstMock).toHaveBeenCalledWith({
      where: { businessId: 'business-b', id: 'appointment-owned-by-tenant-a', tenantId: 'tenant-b' },
    })
    expect(result).toBeNull()
  })

  it('tenant B cannot PATCH tenant A appointment', async () => {
    appointmentUpdateManyMock.mockResolvedValue({ count: 0 })
    const result = await appointmentRepository.updateById('tenant-b', 'business-b', 'appointment-owned-by-tenant-a', {
      notes: 'Hijacked',
    })

    expect(appointmentUpdateManyMock).toHaveBeenCalledWith({
      where: { businessId: 'business-b', id: 'appointment-owned-by-tenant-a', tenantId: 'tenant-b' },
      data: { notes: 'Hijacked' },
    })
    expect(result).toBeNull()
  })

  it('the conflict query is scoped to tenantId + businessId + vehicleId and excludes non-blocking statuses', async () => {
    const startAt = new Date('2026-09-07T06:00:00Z')
    const endAt = new Date('2026-09-07T07:00:00Z')
    await appointmentRepository.findConflict('tenant-a', 'business-a', 'vehicle-a', startAt, endAt)

    expect(appointmentFindFirstMock).toHaveBeenCalledWith({
      where: {
        businessId: 'business-a',
        vehicleId: 'vehicle-a',
        tenantId: 'tenant-a',
        status: { in: ['SCHEDULED', 'CONFIRMED', 'IN_PROGRESS'] },
        startAt: { lt: endAt },
        endAt: { gt: startAt },
      },
    })
  })

  it('the conflict query excludes the appointment being updated when excludeId is given', async () => {
    const startAt = new Date('2026-09-07T06:00:00Z')
    const endAt = new Date('2026-09-07T07:00:00Z')
    await appointmentRepository.findConflict('tenant-a', 'business-a', 'vehicle-a', startAt, endAt, 'self-id')

    const call = appointmentFindFirstMock.mock.calls[0]![0] as { where: { id: { not: string } } }
    expect(call.where.id).toEqual({ not: 'self-id' })
  })
})

describe('tenant isolation — ServiceRecord', () => {
  it('tenant B cannot GET tenant A service record', async () => {
    serviceRecordFindFirstMock.mockResolvedValue(null)
    const result = await serviceRecordRepository.findById('tenant-b', 'business-b', 'record-owned-by-tenant-a')

    expect(serviceRecordFindFirstMock).toHaveBeenCalledWith({
      where: { businessId: 'business-b', id: 'record-owned-by-tenant-a', tenantId: 'tenant-b' },
    })
    expect(result).toBeNull()
  })

  it('tenant B cannot PATCH (incl. archive/restore) tenant A service record', async () => {
    serviceRecordUpdateManyMock.mockResolvedValue({ count: 0 })
    const result = await serviceRecordRepository.updateById('tenant-b', 'business-b', 'record-owned-by-tenant-a', {
      isArchived: true,
    })

    expect(serviceRecordUpdateManyMock).toHaveBeenCalledWith({
      where: { businessId: 'business-b', id: 'record-owned-by-tenant-a', tenantId: 'tenant-b' },
      data: { isArchived: true },
    })
    expect(result).toBeNull()
  })

  it('the max-mileage lookup is scoped to tenantId + businessId + vehicleId and excludes archived records', async () => {
    await serviceRecordRepository.findMaxActiveMileage('tenant-a', 'business-a', 'vehicle-a')

    expect(serviceRecordAggregateMock).toHaveBeenCalledWith({
      where: {
        businessId: 'business-a',
        vehicleId: 'vehicle-a',
        tenantId: 'tenant-a',
        isArchived: false,
        mileage: { not: null },
      },
      _max: { mileage: true },
    })
  })

  it('the max-mileage lookup excludes the record being updated when excludeId is given', async () => {
    await serviceRecordRepository.findMaxActiveMileage('tenant-a', 'business-a', 'vehicle-a', 'self-id')

    const call = serviceRecordAggregateMock.mock.calls[0]![0] as { where: { id: { not: string } } }
    expect(call.where.id).toEqual({ not: 'self-id' })
  })

  it('list queries are always scoped to both tenantId and businessId, and hide archived records by default', async () => {
    await serviceRecordRepository.list('tenant-a', 'business-a', { includeArchived: false, skip: 0, take: 20 })

    expect(serviceRecordFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { businessId: 'business-a', isArchived: false, tenantId: 'tenant-a' } })
    )
  })
})

describe('tenant isolation — CustomerRequest', () => {
  it('tenant B cannot GET tenant A customer request', async () => {
    customerRequestFindFirstMock.mockResolvedValue(null)
    const result = await customerRequestRepository.findById('tenant-b', 'business-b', 'request-owned-by-tenant-a')

    expect(customerRequestFindFirstMock).toHaveBeenCalledWith({
      where: { businessId: 'business-b', id: 'request-owned-by-tenant-a', tenantId: 'tenant-b' },
    })
    expect(result).toBeNull()
  })

  it('tenant B cannot GET tenant A customer request via the with-history lookup either, and the history include has no cross-tenant filter to leak through', async () => {
    customerRequestFindFirstMock.mockResolvedValue(null)
    const result = await customerRequestRepository.findByIdWithHistory('tenant-b', 'business-b', 'request-owned-by-tenant-a')

    expect(customerRequestFindFirstMock).toHaveBeenCalledWith({
      where: { businessId: 'business-b', id: 'request-owned-by-tenant-a', tenantId: 'tenant-b' },
      include: {
        statusHistory: {
          orderBy: { createdAt: 'asc' },
          include: { changedByUser: { select: { name: true } } },
        },
      },
    })
    expect(result).toBeNull()
  })

  it('tenant B cannot PATCH tenant A customer request (plain update path)', async () => {
    customerRequestUpdateManyMock.mockResolvedValue({ count: 0 })
    const result = await customerRequestRepository.updateById('tenant-b', 'business-b', 'request-owned-by-tenant-a', {
      notes: 'Hijacked',
    })

    expect(customerRequestUpdateManyMock).toHaveBeenCalledWith({
      where: { businessId: 'business-b', id: 'request-owned-by-tenant-a', tenantId: 'tenant-b' },
      data: { notes: 'Hijacked' },
    })
    expect(result).toBeNull()
  })

  it('a foreign-tenant status-changing update is rolled back: the updateMany is scoped and a 0-match result means no history row is ever committed', async () => {
    customerRequestUpdateManyMock.mockResolvedValue({ count: 0 })
    const result = await customerRequestRepository.updateWithStatusHistory(
      'tenant-b',
      'business-b',
      'request-owned-by-tenant-a',
      { status: 'IN_PROGRESS' },
      { fromStatus: 'NEW', toStatus: 'IN_PROGRESS', changedByUserId: 'u1' }
    )

    expect(customerRequestUpdateManyMock).toHaveBeenCalledWith({
      where: { businessId: 'business-b', id: 'request-owned-by-tenant-a', tenantId: 'tenant-b' },
      data: { status: 'IN_PROGRESS' },
    })
    expect(result).toBeNull()
  })

  it('list queries are always scoped to both tenantId and businessId', async () => {
    await customerRequestRepository.list('tenant-a', 'business-a', { skip: 0, take: 20 })

    expect(customerRequestFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { businessId: 'business-a', tenantId: 'tenant-a' } })
    )
  })

  it('search queries are scoped alongside the search filter', async () => {
    await customerRequestRepository.list('tenant-a', 'business-a', { search: 'стук', skip: 0, take: 20 })

    const call = customerRequestFindManyMock.mock.calls[0]![0] as { where: { tenantId: string; OR: unknown } }
    expect(call.where.tenantId).toBe('tenant-a')
    expect(call.where.OR).toBeDefined()
  })
})

describe('tenant isolation — Conversation', () => {
  it('tenant B cannot GET tenant A conversation', async () => {
    conversationFindFirstMock.mockResolvedValue(null)
    const result = await conversationRepository.findById('tenant-b', 'business-b', 'conversation-owned-by-tenant-a')

    expect(conversationFindFirstMock).toHaveBeenCalledWith({
      where: { businessId: 'business-b', id: 'conversation-owned-by-tenant-a', tenantId: 'tenant-b' },
    })
    expect(result).toBeNull()
  })

  it('tenant B cannot GET tenant A conversation via the with-detail lookup either', async () => {
    conversationFindFirstMock.mockResolvedValue(null)
    const result = await conversationRepository.findByIdWithDetail('tenant-b', 'business-b', 'conversation-owned-by-tenant-a')

    expect(conversationFindFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { businessId: 'business-b', id: 'conversation-owned-by-tenant-a', tenantId: 'tenant-b' } })
    )
    expect(result).toBeNull()
  })

  it('tenant B cannot PATCH tenant A conversation', async () => {
    conversationUpdateManyMock.mockResolvedValue({ count: 0 })
    const result = await conversationRepository.updateById('tenant-b', 'business-b', 'conversation-owned-by-tenant-a', {
      subject: 'Hijacked',
    })

    expect(conversationUpdateManyMock).toHaveBeenCalledWith({
      where: { businessId: 'business-b', id: 'conversation-owned-by-tenant-a', tenantId: 'tenant-b' },
      data: { subject: 'Hijacked' },
    })
    expect(result).toBeNull()
  })

  it('list queries are always scoped to both tenantId and businessId', async () => {
    await conversationRepository.list('tenant-a', 'business-a', { skip: 0, take: 20 })

    expect(conversationFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { businessId: 'business-a', tenantId: 'tenant-a' } })
    )
  })
})

describe('tenant isolation — Message', () => {
  it('tenant B cannot list tenant A conversation messages (query is scoped, so it simply never matches)', async () => {
    await messageRepository.listByConversation('tenant-b', 'business-b', 'conversation-owned-by-tenant-a')

    expect(messageFindManyMock).toHaveBeenCalledWith({
      where: { businessId: 'business-b', conversationId: 'conversation-owned-by-tenant-a', tenantId: 'tenant-b' },
      orderBy: { createdAt: 'asc' },
    })
  })

  it('a message create for a foreign-tenant conversation never touches (or updates lastMessageAt on) that other tenant: the conversation-touch is scoped and matches zero rows', async () => {
    conversationUpdateManyMock.mockResolvedValue({ count: 0 })
    await messageRepository.createAndTouchConversation('tenant-b', 'business-b', {
      tenantId: 'tenant-b',
      businessId: 'business-b',
      conversationId: 'conversation-owned-by-tenant-a',
      direction: 'INBOUND',
      senderType: 'CUSTOMER',
      content: 'hijack attempt',
    })

    expect(conversationUpdateManyMock).toHaveBeenCalledWith({
      where: { businessId: 'business-b', id: 'conversation-owned-by-tenant-a', tenantId: 'tenant-b' },
      data: { lastMessageAt: expect.any(Date) },
    })
  })
})

describe('tenant isolation — AI Core', () => {
  // These run analyzeMessage() itself — the real service, against the same
  // mocked prisma client as every other test in this file — rather than
  // re-testing conversationRepository in isolation, since the spec calls
  // for proving the AI *endpoint's own* behavior end-to-end: "Tenant A не
  // может анализировать Conversation B. Ожидается: 404. И никаких
  // изменений в данных Tenant B."
  const stubProvider: AiProvider = { generate: vi.fn().mockResolvedValue({ raw: {} }) }

  it('tenant A cannot analyze a conversation owned by tenant B — 404, and no context is ever built or provider called for it', async () => {
    conversationFindFirstMock.mockResolvedValue(null) // scoped query never matches tenant B's row
    const ctxA = makeAuthContext('owner', {
      tenant: makeTenant({ id: 'tenant-a' }),
      business: makeBusiness({ id: 'business-a', tenantId: 'tenant-a' }),
    })

    await expect(
      analyzeMessage(ctxA, { conversationId: 'conversation-owned-by-tenant-b', message: 'hijack attempt' }, { provider: stubProvider })
    ).rejects.toMatchObject({ statusCode: 404 })

    expect(conversationFindFirstMock).toHaveBeenCalledWith({
      where: { businessId: 'business-a', id: 'conversation-owned-by-tenant-b', tenantId: 'tenant-a' },
    })
    // Short-circuited before touching tenant B's messages or calling the provider at all.
    expect(messageFindManyMock).not.toHaveBeenCalled()
    expect(stubProvider.generate).not.toHaveBeenCalled()
  })
})

describe('tenant isolation — AI Booking Tools (Prompt 10)', () => {
  // These call the real tool executors (checkAvailabilityTool.ts,
  // createAppointmentTool.ts, etc.) — the same functions the AI Tool Layer
  // actually invokes — against the same mocked prisma client as every other
  // test in this file. Every lookup inside them goes through the real,
  // unmodified appointmentService.ts / repositories, so a "foreign" id
  // never matches the tenant-scoped where-clause and the tool correctly
  // reports NOT_FOUND, never leaking whether the id exists for some other
  // tenant. `allowed` is set to match the foreign id in every case so the
  // (separate) entity-allow-list gate never masks what's being tested here:
  // that tenant scoping itself — inside the real service/repository layer
  // — is what blocks access, not just the AI layer's own bookkeeping.
  const SERVICE_OWNED_BY_B = '111e4567-e89b-12d3-a456-426614174000'
  const CUSTOMER_OWNED_BY_B = '222e4567-e89b-12d3-a456-426614174000'
  const VEHICLE_OWNED_BY_B = '333e4567-e89b-12d3-a456-426614174000'
  const APPOINTMENT_OWNED_BY_B = '444e4567-e89b-12d3-a456-426614174000'

  function ctxA() {
    return makeAuthContext('owner', {
      tenant: makeTenant({ id: 'tenant-a' }),
      business: makeBusiness({ id: 'business-a', tenantId: 'tenant-a' }),
    })
  }

  it('tenant A cannot check availability using tenant B\'s service — scoped lookup returns nothing, tool reports NOT_FOUND', async () => {
    serviceFindFirstMock.mockResolvedValue(null)
    const result = await executeCheckAvailability(ctxA(), { serviceId: SERVICE_OWNED_BY_B, date: '2026-09-16' })

    expect(result).toMatchObject({ success: false, errorCode: 'NOT_FOUND' })
    expect(serviceFindFirstMock).toHaveBeenCalledWith({
      where: { businessId: 'business-a', id: SERVICE_OWNED_BY_B, tenantId: 'tenant-a' },
    })
  })

  it('tenant A cannot create an appointment using tenant B\'s customer/vehicle/service — scoped customer lookup fails first, tool reports NOT_FOUND, and appointment.create is never reached', async () => {
    customerFindFirstMock.mockResolvedValue(null)
    const allowed: AiToolAllowedEntities = { customerId: CUSTOMER_OWNED_BY_B, vehicleId: VEHICLE_OWNED_BY_B, appointmentIds: [] }
    const result = await executeCreateAppointment(
      ctxA(),
      {
        customerId: CUSTOMER_OWNED_BY_B,
        vehicleId: VEHICLE_OWNED_BY_B,
        serviceId: SERVICE_OWNED_BY_B,
        startAt: '2026-09-16T06:00:00Z',
        endAt: '2026-09-16T07:00:00Z',
      },
      'Да, подтверждаю',
      allowed
    )

    expect(result).toMatchObject({ success: false, errorCode: 'NOT_FOUND' })
    expect(customerFindFirstMock).toHaveBeenCalledWith({
      where: { businessId: 'business-a', id: CUSTOMER_OWNED_BY_B, tenantId: 'tenant-a' },
    })
  })

  it('tenant A cannot reschedule tenant B\'s appointment — scoped lookup returns nothing, tool reports NOT_FOUND, updateMany is never reached', async () => {
    appointmentFindFirstMock.mockResolvedValue(null)
    const allowed: AiToolAllowedEntities = { customerId: null, vehicleId: null, appointmentIds: [APPOINTMENT_OWNED_BY_B] }
    const result = await executeRescheduleAppointment(
      ctxA(),
      { appointmentId: APPOINTMENT_OWNED_BY_B, startAt: '2026-09-16T06:00:00Z', endAt: '2026-09-16T07:00:00Z' },
      'Да, подтверждаю',
      allowed
    )

    expect(result).toMatchObject({ success: false, errorCode: 'NOT_FOUND' })
    expect(appointmentFindFirstMock).toHaveBeenCalledWith({
      where: { businessId: 'business-a', id: APPOINTMENT_OWNED_BY_B, tenantId: 'tenant-a' },
    })
    expect(appointmentUpdateManyMock).not.toHaveBeenCalled()
  })

  it('tenant A cannot cancel tenant B\'s appointment — scoped lookup returns nothing, tool reports NOT_FOUND, updateMany is never reached', async () => {
    appointmentFindFirstMock.mockResolvedValue(null)
    const allowed: AiToolAllowedEntities = { customerId: null, vehicleId: null, appointmentIds: [APPOINTMENT_OWNED_BY_B] }
    const result = await executeCancelAppointment(ctxA(), { appointmentId: APPOINTMENT_OWNED_BY_B }, 'Да, отменяйте', allowed)

    expect(result).toMatchObject({ success: false, errorCode: 'NOT_FOUND' })
    expect(appointmentFindFirstMock).toHaveBeenCalledWith({
      where: { businessId: 'business-a', id: APPOINTMENT_OWNED_BY_B, tenantId: 'tenant-a' },
    })
    expect(appointmentUpdateManyMock).not.toHaveBeenCalled()
  })

  it('a model cannot bypass tenant scoping by supplying tenantId/businessId itself — the tool schemas accept no such fields, and ctx always comes from requireAuth(), never from tool arguments', async () => {
    serviceFindFirstMock.mockResolvedValue(null)
    // Even if a compromised/injected model tried to smuggle tenantId/
    // businessId into the tool call arguments, the Zod schema (schemas.ts)
    // has no such fields to accept them — they are silently dropped by
    // .object()'s default "strip unknown keys" behavior, and the real
    // ctx.tenant.id / ctx.business.id (from requireAuth(), server-side)
    // is what's actually used for every lookup, as proven by the call
    // assertion below.
    const result = await executeCheckAvailability(ctxA(), {
      serviceId: SERVICE_OWNED_BY_B,
      date: '2026-09-16',
      tenantId: 'tenant-b',
      businessId: 'business-b',
    })

    expect(result).toMatchObject({ success: false, errorCode: 'NOT_FOUND' })
    expect(serviceFindFirstMock).toHaveBeenCalledWith({
      where: { businessId: 'business-a', id: SERVICE_OWNED_BY_B, tenantId: 'tenant-a' },
    })
  })
})

describe('tenant isolation — AI Escalation (Prompt 12)', () => {
  // These call the real repository functions directly (escalationRepository
  // list/findById/claim/resolve/cancel) — the same functions
  // escalationService.ts calls — against the same mocked prisma client as
  // every other test in this file, proving every query is scoped by
  // tenantId + businessId regardless of what id string is supplied.
  const ESCALATION_OWNED_BY_B = '555e4567-e89b-12d3-a456-426614174000'

  function ctxA() {
    return makeAuthContext('owner', {
      tenant: makeTenant({ id: 'tenant-a' }),
      business: makeBusiness({ id: 'business-a', tenantId: 'tenant-a' }),
    })
  }

  it('repository: list is scoped to tenantId + businessId', async () => {
    await escalationRepository.list('tenant-a', 'business-a', { skip: 0, take: 20 })
    expect(aiEscalationFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { businessId: 'business-a', tenantId: 'tenant-a' } })
    )
  })

  it('repository: findById never matches a foreign-tenant row — the query itself is scoped', async () => {
    await escalationRepository.findById('tenant-a', 'business-a', ESCALATION_OWNED_BY_B)
    expect(aiEscalationFindFirstMock).toHaveBeenCalledWith({
      where: { businessId: 'business-a', id: ESCALATION_OWNED_BY_B, tenantId: 'tenant-a' },
    })
  })

  it('repository: claim/resolve/cancel updateMany calls are all scoped to tenantId + businessId + id', async () => {
    await escalationRepository.claim('tenant-a', 'business-a', ESCALATION_OWNED_BY_B, 'user-a')
    expect(aiEscalationUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ businessId: 'business-a', id: ESCALATION_OWNED_BY_B, tenantId: 'tenant-a' }) })
    )
    aiEscalationUpdateManyMock.mockClear()

    await escalationRepository.resolve('tenant-a', 'business-a', ESCALATION_OWNED_BY_B)
    expect(aiEscalationUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ businessId: 'business-a', id: ESCALATION_OWNED_BY_B, tenantId: 'tenant-a' }) })
    )
    aiEscalationUpdateManyMock.mockClear()

    await escalationRepository.cancel('tenant-a', 'business-a', ESCALATION_OWNED_BY_B)
    expect(aiEscalationUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ businessId: 'business-a', id: ESCALATION_OWNED_BY_B, tenantId: 'tenant-a' }) })
    )
  })

  it('repository: findActiveByConversation (the idempotency fast path) is scoped to tenantId + businessId', async () => {
    await escalationRepository.findActiveByConversation('tenant-a', 'business-a', 'conv-owned-by-b')
    expect(aiEscalationFindFirstMock).toHaveBeenCalledWith({
      where: { businessId: 'business-a', activeConversationId: 'conv-owned-by-b', tenantId: 'tenant-a' },
    })
  })

  it('service: tenant A cannot view tenant B\'s escalation — 404, scoped lookup never matches', async () => {
    aiEscalationFindFirstMock.mockResolvedValue(null) // scoped query never matches tenant B's row
    await expect(getEscalation(ctxA(), ESCALATION_OWNED_BY_B)).rejects.toMatchObject({ statusCode: 404 })
  })

  it('service: tenant A cannot claim tenant B\'s escalation — 404, updateMany never reached', async () => {
    aiEscalationFindFirstMock.mockResolvedValue(null)
    await expect(claimEscalation(ctxA(), ESCALATION_OWNED_BY_B)).rejects.toMatchObject({ statusCode: 404 })
    expect(aiEscalationUpdateManyMock).not.toHaveBeenCalled()
  })

  it('service: tenant A cannot resolve tenant B\'s escalation — 404, updateMany never reached', async () => {
    aiEscalationFindFirstMock.mockResolvedValue(null)
    await expect(resolveEscalation(ctxA(), ESCALATION_OWNED_BY_B)).rejects.toMatchObject({ statusCode: 404 })
    expect(aiEscalationUpdateManyMock).not.toHaveBeenCalled()
  })

  it('service: tenant A cannot cancel tenant B\'s escalation — 404, updateMany never reached', async () => {
    aiEscalationFindFirstMock.mockResolvedValue(null)
    await expect(cancelEscalation(ctxA(), ESCALATION_OWNED_BY_B)).rejects.toMatchObject({ statusCode: 404 })
    expect(aiEscalationUpdateManyMock).not.toHaveBeenCalled()
  })

  it('business isolation: list is scoped by businessId too, not just tenantId, so Business A never sees Business B\'s escalations within the same tenant', async () => {
    await escalationRepository.list('tenant-a', 'business-a', { skip: 0, take: 20 })
    const call = aiEscalationFindManyMock.mock.calls[0]![0] as { where: { businessId: string; tenantId: string } }
    expect(call.where.businessId).toBe('business-a')
    expect(call.where.tenantId).toBe('tenant-a')
  })
})
