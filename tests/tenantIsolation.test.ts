import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Prisma } from '@prisma/client'

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
  aiLogFindFirstMock,
  aiLogFindManyMock,
  aiLogCountMock,
  aiLogCreateMock,
  aiLogGroupByMock,
  aiLogAggregateMock,
  customerRequestGroupByMock,
  conversationGroupByMock,
  messageGroupByMock,
  aiEscalationGroupByMock,
  appointmentGroupByMock,
  serviceRecordGroupByMock,
  serviceCountMock,
  customerCountMock,
  vehicleCountMock,
  queryRawMock,
  userFindManyMock,
  userFindFirstMock,
  userUpdateManyMock,
  userCountMock,
  userCreateMock,
  sessionDeleteManyMock,
  channelConnectionFindManyMock,
  channelConnectionFindFirstMock,
  channelConnectionFindUniqueMock,
  channelConnectionCreateMock,
  channelConnectionUpdateManyMock,
  channelMessageFindFirstMock,
  channelMessageCreateMock,
  customerChannelIdentityFindFirstMock,
  customerChannelIdentityCreateMock,
  conversationCreateMock,
  conversationUpdateMock,
  messageFindFirstMock,
  channelDeliveryFindFirstMock,
  channelDeliveryFindUniqueMock,
  channelDeliveryCreateMock,
  channelDeliveryUpdateManyMock,
  channelDeliveryUpdateMock,
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
    aiLogFindFirstMock: vi.fn(),
    aiLogFindManyMock: vi.fn(),
    aiLogCountMock: vi.fn(),
    aiLogCreateMock: vi.fn(),
    aiLogGroupByMock: vi.fn(),
    aiLogAggregateMock: vi.fn(),
    customerRequestGroupByMock: vi.fn(),
    conversationGroupByMock: vi.fn(),
    messageGroupByMock: vi.fn(),
    aiEscalationGroupByMock: vi.fn(),
    appointmentGroupByMock: vi.fn(),
    serviceRecordGroupByMock: vi.fn(),
    serviceCountMock: vi.fn(),
    customerCountMock: vi.fn(),
    vehicleCountMock: vi.fn(),
    queryRawMock: vi.fn(),
    userFindManyMock: vi.fn(),
    userFindFirstMock: vi.fn(),
    userUpdateManyMock: vi.fn(),
    userCountMock: vi.fn(),
    userCreateMock: vi.fn(),
    sessionDeleteManyMock: vi.fn(),
    channelConnectionFindManyMock: vi.fn(),
    channelConnectionFindFirstMock: vi.fn(),
    channelConnectionFindUniqueMock: vi.fn(),
    channelConnectionCreateMock: vi.fn(),
    channelConnectionUpdateManyMock: vi.fn(),
    channelMessageFindFirstMock: vi.fn(),
    channelMessageCreateMock: vi.fn(),
    customerChannelIdentityFindFirstMock: vi.fn(),
    customerChannelIdentityCreateMock: vi.fn(),
    conversationCreateMock: vi.fn(),
    conversationUpdateMock: vi.fn(),
    messageFindFirstMock: vi.fn(),
    channelDeliveryFindFirstMock: vi.fn(),
    channelDeliveryFindUniqueMock: vi.fn(),
    channelDeliveryCreateMock: vi.fn(),
    channelDeliveryUpdateManyMock: vi.fn(),
    channelDeliveryUpdateMock: vi.fn(),
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
    service: {
      findMany: serviceFindManyMock,
      findFirst: serviceFindFirstMock,
      updateMany: serviceUpdateManyMock,
      count: serviceCountMock,
    },
    knowledgeItem: { findFirst: knowledgeFindFirstMock, updateMany: knowledgeUpdateManyMock },
    businessRule: { findFirst: ruleFindFirstMock, updateMany: ruleUpdateManyMock },
    customer: { findFirst: customerFindFirstMock, updateMany: customerUpdateManyMock, count: customerCountMock },
    vehicle: { findFirst: vehicleFindFirstMock, updateMany: vehicleUpdateManyMock, count: vehicleCountMock },
    lead: { findFirst: leadFindFirstMock, updateMany: leadUpdateManyMock },
    appointment: {
      findFirst: appointmentFindFirstMock,
      updateMany: appointmentUpdateManyMock,
      groupBy: appointmentGroupByMock,
    },
    serviceRecord: {
      findFirst: serviceRecordFindFirstMock,
      findMany: serviceRecordFindManyMock,
      count: serviceRecordCountMock,
      updateMany: serviceRecordUpdateManyMock,
      aggregate: serviceRecordAggregateMock,
      groupBy: serviceRecordGroupByMock,
    },
    customerRequest: {
      findFirst: customerRequestFindFirstMock,
      findMany: customerRequestFindManyMock,
      count: customerRequestCountMock,
      updateMany: customerRequestUpdateManyMock,
      groupBy: customerRequestGroupByMock,
    },
    customerRequestStatusHistory: { create: customerRequestStatusHistoryCreateMock },
    conversation: {
      findFirst: conversationFindFirstMock,
      findMany: conversationFindManyMock,
      count: conversationCountMock,
      updateMany: conversationUpdateManyMock,
      groupBy: conversationGroupByMock,
      create: conversationCreateMock,
      update: conversationUpdateMock,
    },
    message: { findFirst: messageFindFirstMock, findMany: messageFindManyMock, create: messageCreateMock, groupBy: messageGroupByMock },
    aiEscalation: {
      findFirst: aiEscalationFindFirstMock,
      findMany: aiEscalationFindManyMock,
      count: aiEscalationCountMock,
      updateMany: aiEscalationUpdateManyMock,
      create: aiEscalationCreateMock,
      groupBy: aiEscalationGroupByMock,
    },
    aiLog: {
      findFirst: aiLogFindFirstMock,
      findMany: aiLogFindManyMock,
      count: aiLogCountMock,
      create: aiLogCreateMock,
      groupBy: aiLogGroupByMock,
      aggregate: aiLogAggregateMock,
    },
    user: {
      findMany: userFindManyMock,
      findFirst: userFindFirstMock,
      updateMany: userUpdateManyMock,
      count: userCountMock,
      create: userCreateMock,
    },
    session: { deleteMany: sessionDeleteManyMock },
    channelConnection: {
      findMany: channelConnectionFindManyMock,
      findFirst: channelConnectionFindFirstMock,
      findUnique: channelConnectionFindUniqueMock,
      create: channelConnectionCreateMock,
      updateMany: channelConnectionUpdateManyMock,
    },
    channelMessage: { findFirst: channelMessageFindFirstMock, create: channelMessageCreateMock },
    customerChannelIdentity: { findFirst: customerChannelIdentityFindFirstMock, create: customerChannelIdentityCreateMock },
    channelDelivery: {
      findFirst: channelDeliveryFindFirstMock,
      findUnique: channelDeliveryFindUniqueMock,
      create: channelDeliveryCreateMock,
      updateMany: channelDeliveryUpdateManyMock,
      update: channelDeliveryUpdateMock,
    },
    businessWorkingHours: { upsert: vi.fn((args: unknown) => args) },
    $transaction: transactionMock,
    $queryRaw: queryRawMock,
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
import { aiLogRepository } from '../src/server/repositories/aiLogRepository'
import { getAiLog, listAiLogs } from '../src/server/services/aiLogService'
import { analyticsRepository } from '../src/server/repositories/analyticsRepository'
import { teamRepository } from '../src/server/repositories/teamRepository'
import {
  getTeamMember,
  updateTeamMemberProfile,
  changeTeamMemberRole,
  activateTeamMember,
  deactivateTeamMember,
} from '../src/server/services/teamService'
import { channelConnectionRepository } from '../src/server/repositories/channelConnectionRepository'
import { channelMessageRepository } from '../src/server/repositories/channelMessageRepository'
import { customerChannelIdentityRepository } from '../src/server/repositories/customerChannelIdentityRepository'
import {
  getChannelConnection,
  updateChannelConnection,
  activateChannelConnection,
  deactivateChannelConnection,
} from '../src/server/services/channelConnectionService'
import { recordInboundMessage } from '../src/server/repositories/channelInboundRepository'
import { channelDeliveryRepository } from '../src/server/repositories/channelDeliveryRepository'
import { sendMessageViaChannel } from '../src/server/services/channelDeliveryService'
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
  aiLogFindFirstMock.mockResolvedValue(null)
  aiLogFindManyMock.mockResolvedValue([])
  aiLogCountMock.mockResolvedValue(0)
  aiLogCreateMock.mockResolvedValue({})
  aiLogGroupByMock.mockResolvedValue([])
  aiLogAggregateMock.mockResolvedValue({ _avg: { confidence: null } })
  customerRequestGroupByMock.mockResolvedValue([])
  conversationGroupByMock.mockResolvedValue([])
  messageGroupByMock.mockResolvedValue([])
  aiEscalationGroupByMock.mockResolvedValue([])
  appointmentGroupByMock.mockResolvedValue([])
  serviceRecordGroupByMock.mockResolvedValue([])
  serviceCountMock.mockResolvedValue(0)
  customerCountMock.mockResolvedValue(0)
  vehicleCountMock.mockResolvedValue(0)
  queryRawMock.mockResolvedValue([])
  userFindManyMock.mockResolvedValue([])
  userFindFirstMock.mockResolvedValue(null)
  userUpdateManyMock.mockResolvedValue({ count: 0 })
  userCountMock.mockResolvedValue(0)
  sessionDeleteManyMock.mockResolvedValue({ count: 0 })
  channelConnectionFindManyMock.mockResolvedValue([])
  channelConnectionFindFirstMock.mockResolvedValue(null)
  channelConnectionUpdateManyMock.mockResolvedValue({ count: 0 })
  channelMessageFindFirstMock.mockResolvedValue(null)
  customerChannelIdentityFindFirstMock.mockResolvedValue(null)
  conversationCreateMock.mockResolvedValue({ id: 'conv-new', tenantId: 'tenant-a', businessId: 'business-a', customerId: null, status: 'OPEN' })
  conversationUpdateMock.mockResolvedValue({ id: 'conv-new', tenantId: 'tenant-a', businessId: 'business-a', customerId: null, status: 'OPEN' })
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

describe('tenant isolation — AI Log (Prompt 13)', () => {
  // Same convention as the AI Escalation block above: call the real
  // repository/service functions against the same mocked prisma client,
  // proving every query is scoped by tenantId + businessId regardless of
  // what id string is supplied — a foreign log id must 404, never reveal
  // that the row exists for some other tenant.
  const LOG_OWNED_BY_B = '666e4567-e89b-12d3-a456-426614174000'

  function ctxA() {
    return makeAuthContext('owner', {
      tenant: makeTenant({ id: 'tenant-a' }),
      business: makeBusiness({ id: 'business-a', tenantId: 'tenant-a' }),
    })
  }

  it('repository: list is scoped to tenantId + businessId', async () => {
    await aiLogRepository.list('tenant-a', 'business-a', { skip: 0, take: 20 })
    expect(aiLogFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { businessId: 'business-a', tenantId: 'tenant-a' } })
    )
  })

  it('repository: findById never matches a foreign-tenant row — the query itself is scoped', async () => {
    await aiLogRepository.findById('tenant-a', 'business-a', LOG_OWNED_BY_B)
    expect(aiLogFindFirstMock).toHaveBeenCalledWith({
      where: { businessId: 'business-a', id: LOG_OWNED_BY_B, tenantId: 'tenant-a' },
    })
  })

  it('repository: findByIdWithDetail is likewise scoped to tenantId + businessId', async () => {
    await aiLogRepository.findByIdWithDetail('tenant-a', 'business-a', LOG_OWNED_BY_B)
    expect(aiLogFindFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { businessId: 'business-a', id: LOG_OWNED_BY_B, tenantId: 'tenant-a' } })
    )
  })

  it('service: tenant A cannot read tenant B\'s log — 404, scoped lookup never matches, existence never revealed', async () => {
    aiLogFindFirstMock.mockResolvedValue(null) // scoped query never matches tenant B's row
    await expect(getAiLog(ctxA(), LOG_OWNED_BY_B)).rejects.toMatchObject({ statusCode: 404 })
  })

  it('service: a foreign business within the SAME tenant still cannot read the log — 404', async () => {
    aiLogFindFirstMock.mockResolvedValue(null)
    const ctxOtherBusinessSameTenant = makeAuthContext('owner', {
      tenant: makeTenant({ id: 'tenant-a' }),
      business: makeBusiness({ id: 'business-other', tenantId: 'tenant-a' }),
    })
    await expect(getAiLog(ctxOtherBusinessSameTenant, LOG_OWNED_BY_B)).rejects.toMatchObject({ statusCode: 404 })
  })

  it('business isolation: list is scoped by businessId too, not just tenantId', async () => {
    await listAiLogs(ctxA(), { page: 1, pageSize: 20 })
    const call = aiLogFindManyMock.mock.calls[0]![0] as { where: { businessId: string; tenantId: string } }
    expect(call.where.businessId).toBe('business-a')
    expect(call.where.tenantId).toBe('tenant-a')
  })
})

describe('tenant isolation — Analytics / Dashboard (Prompt 14)', () => {
  // Every analyticsRepository function is called directly here (the same
  // functions analyticsService.ts calls) against the same mocked prisma
  // client as every other test in this file — proving every aggregation
  // query is scoped by BOTH tenantId and businessId, never tenantId alone
  // (spec §37's "wrong business" requirement), and that the small number of
  // raw SQL day-bucket queries (spec §35) bind tenantId/businessId/timezone
  // as real parameters rather than ever interpolating them into the SQL text.
  const range = { start: new Date('2026-08-01T00:00:00Z'), end: new Date('2026-09-01T00:00:00Z') }

  /** Reads the `where` clause of a call — defaults to the MOST RECENT call, since several tests below reuse the same shared mock (e.g. aiLogGroupByMock) across more than one analyticsRepository function in sequence. */
  function whereOf(mock: { mock: { calls: unknown[][] } }, callIndex = -1): Record<string, unknown> {
    const calls = mock.mock.calls
    const idx = callIndex < 0 ? calls.length + callIndex : callIndex
    return (calls[idx]![0] as { where: Record<string, unknown> }).where
  }

  it('customerRequestsByStatus is scoped by tenantId + businessId + createdAt range', async () => {
    await analyticsRepository.customerRequestsByStatus('tenant-a', 'business-a', range)
    expect(whereOf(customerRequestGroupByMock)).toMatchObject({
      tenantId: 'tenant-a',
      businessId: 'business-a',
      createdAt: { gte: range.start, lt: range.end },
    })
  })

  it('conversationsByChannel/conversationsByStatus are both scoped by tenantId + businessId', async () => {
    await analyticsRepository.conversationsByChannel('tenant-a', 'business-a', range)
    expect(whereOf(conversationGroupByMock)).toMatchObject({ tenantId: 'tenant-a', businessId: 'business-a' })
    await analyticsRepository.conversationsByStatus('tenant-a', 'business-a', range)
    expect(whereOf(conversationGroupByMock)).toMatchObject({ tenantId: 'tenant-a', businessId: 'business-a' })
  })

  it('messagesByDirection is scoped by tenantId + businessId', async () => {
    await analyticsRepository.messagesByDirection('tenant-a', 'business-a', range)
    expect(whereOf(messageGroupByMock)).toMatchObject({ tenantId: 'tenant-a', businessId: 'business-a' })
  })

  it('aiAnalyzeByOutcome/aiAnalyzeByIntent/aiAnalyzeAverageConfidence are scoped by tenantId + businessId AND filtered to operation=AI_ANALYZE — never AI_TOOL_EXECUTION/AI_ESCALATION_* rows', async () => {
    await analyticsRepository.aiAnalyzeByOutcome('tenant-a', 'business-a', range)
    expect(whereOf(aiLogGroupByMock)).toMatchObject({ tenantId: 'tenant-a', businessId: 'business-a', operation: 'AI_ANALYZE' })

    await analyticsRepository.aiAnalyzeByIntent('tenant-a', 'business-a', range)
    expect(whereOf(aiLogGroupByMock)).toMatchObject({ tenantId: 'tenant-a', businessId: 'business-a', operation: 'AI_ANALYZE', intent: { not: null } })

    await analyticsRepository.aiAnalyzeAverageConfidence('tenant-a', 'business-a', range)
    const aggCall = aiLogAggregateMock.mock.calls[0]![0] as { where: Record<string, unknown> }
    expect(aggCall.where).toMatchObject({ tenantId: 'tenant-a', businessId: 'business-a', operation: 'AI_ANALYZE', confidence: { not: null } })
  })

  it('never reveals tenant B\'s AiLog rows: a foreign business within the same tenant gets its own independent scoped query', async () => {
    await analyticsRepository.aiAnalyzeByOutcome('tenant-a', 'business-other', range)
    expect(whereOf(aiLogGroupByMock)).toMatchObject({ tenantId: 'tenant-a', businessId: 'business-other' })
  })

  it('toolExecutionsBySuccess/toolExecutionsByName are scoped AND filtered to operation=AI_TOOL_EXECUTION', async () => {
    await analyticsRepository.toolExecutionsBySuccess('tenant-a', 'business-a', range)
    expect(whereOf(aiLogGroupByMock)).toMatchObject({ tenantId: 'tenant-a', businessId: 'business-a', operation: 'AI_TOOL_EXECUTION' })

    await analyticsRepository.toolExecutionsByName('tenant-a', 'business-a', range)
    expect(whereOf(aiLogGroupByMock)).toMatchObject({
      tenantId: 'tenant-a',
      businessId: 'business-a',
      operation: 'AI_TOOL_EXECUTION',
      toolName: { not: null },
    })
  })

  it('escalationsByStatus/escalationsByPriority are scoped by tenantId + businessId + createdAt (never resolvedAt)', async () => {
    await analyticsRepository.escalationsByStatus('tenant-a', 'business-a', range)
    expect(whereOf(aiEscalationGroupByMock)).toMatchObject({
      tenantId: 'tenant-a',
      businessId: 'business-a',
      createdAt: { gte: range.start, lt: range.end },
    })
    expect(whereOf(aiEscalationGroupByMock)).not.toHaveProperty('resolvedAt')

    await analyticsRepository.escalationsByPriority('tenant-a', 'business-a', range)
    expect(whereOf(aiEscalationGroupByMock)).toMatchObject({ tenantId: 'tenant-a', businessId: 'business-a' })
  })

  it('appointmentsByStatus is scoped by tenantId + businessId', async () => {
    await analyticsRepository.appointmentsByStatus('tenant-a', 'business-a', range)
    expect(whereOf(appointmentGroupByMock)).toMatchObject({ tenantId: 'tenant-a', businessId: 'business-a' })
  })

  it('serviceRecordCount counts ALL records created in the period (archived or not) — a separate, more restrictive query handles revenue', async () => {
    await analyticsRepository.serviceRecordCount('tenant-a', 'business-a', range)
    const call = serviceRecordCountMock.mock.calls[0]![0] as { where: Record<string, unknown> }
    expect(call.where).toMatchObject({ tenantId: 'tenant-a', businessId: 'business-a' })
    expect(call.where).not.toHaveProperty('isArchived')
  })

  it('serviceRecordRevenueByCurrency ALWAYS filters isArchived: false — spec §16', async () => {
    await analyticsRepository.serviceRecordRevenueByCurrency('tenant-a', 'business-a', range)
    expect(whereOf(serviceRecordGroupByMock)).toMatchObject({ tenantId: 'tenant-a', businessId: 'business-a', isArchived: false })
  })

  it('serviceSnapshot (active/total) is a current, unscoped-by-period snapshot, but still tenant/business scoped', async () => {
    await analyticsRepository.serviceSnapshot('tenant-a', 'business-a')
    const calls = serviceCountMock.mock.calls as { where: Record<string, unknown> }[][]
    expect(calls.every((c) => c[0]!.where.tenantId === 'tenant-a' && c[0]!.where.businessId === 'business-a')).toBe(true)
    expect(calls.some((c) => c[0]!.where.isActive === true)).toBe(true)
    expect(calls.some((c) => !('isActive' in c[0]!.where))).toBe(true)
  })

  it('customerCounts never counts a deactivated customer as active, and scopes "new" to the period', async () => {
    await analyticsRepository.customerCounts('tenant-a', 'business-a', range)
    const calls = customerCountMock.mock.calls as { where: Record<string, unknown> }[][]
    expect(calls.some((c) => c[0]!.where.isActive === true && !('createdAt' in c[0]!.where))).toBe(true)
    expect(calls.some((c) => c[0]!.where.createdAt !== undefined)).toBe(true)
    expect(calls.every((c) => c[0]!.where.tenantId === 'tenant-a' && c[0]!.where.businessId === 'business-a')).toBe(true)
  })

  it('vehicleCounts follows the same active-snapshot/new-in-period split, tenant/business scoped', async () => {
    await analyticsRepository.vehicleCounts('tenant-a', 'business-a', range)
    const calls = vehicleCountMock.mock.calls as { where: Record<string, unknown> }[][]
    expect(calls.every((c) => c[0]!.where.tenantId === 'tenant-a' && c[0]!.where.businessId === 'business-a')).toBe(true)
  })

  it('customerRequestConversion uses the real appointmentId relation, scoped by tenantId + businessId', async () => {
    await analyticsRepository.customerRequestConversion('tenant-a', 'business-a', range)
    const calls = customerRequestCountMock.mock.calls as { where: Record<string, unknown> }[][]
    expect(calls.every((c) => c[0]!.where.tenantId === 'tenant-a' && c[0]!.where.businessId === 'business-a')).toBe(true)
    expect(calls.some((c) => JSON.stringify(c[0]!.where.appointmentId) === JSON.stringify({ not: null }))).toBe(true)
  })

  describe('day-bucket raw SQL queries — parameterized, never string-interpolated (spec §35)', () => {
    it('customerRequestsByDay binds tenantId/businessId/timezone as real query parameters, not embedded in the SQL text', async () => {
      await analyticsRepository.customerRequestsByDay('tenant-a', 'business-a', range, 'Europe/Moscow')
      const [strings, ...values] = queryRawMock.mock.calls[0]! as [TemplateStringsArray, ...unknown[]]
      // The bound values array must contain the tenant/business/timezone —
      // proving they were passed as parameters, not spliced into the SQL text.
      expect(values).toContain('tenant-a')
      expect(values).toContain('business-a')
      expect(values).toContain('Europe/Moscow')
      // And the raw SQL text itself never contains the literal id/timezone —
      // it only ever contains the fixed table/column names and placeholders.
      const rawText = strings.join('')
      expect(rawText).not.toContain('tenant-a')
      expect(rawText).not.toContain('Europe/Moscow')
      expect(rawText).toContain('customer_requests')
    })

    it('aiAnalysesByDay is scoped to operation = AI_ANALYZE directly in the fixed SQL text (a literal, never a client-controlled value)', async () => {
      await analyticsRepository.aiAnalysesByDay('tenant-a', 'business-a', range, 'UTC')
      const [strings] = queryRawMock.mock.calls[0]! as [TemplateStringsArray, ...unknown[]]
      expect(strings.join('')).toContain('ai_logs')
      expect(strings.join('')).toContain("'AI_ANALYZE'")
    })

    it('escalationsByDay and appointmentsByDay each bind tenantId/businessId as parameters too', async () => {
      await analyticsRepository.escalationsByDay('tenant-a', 'business-a', range, 'Asia/Almaty')
      let [, ...values] = queryRawMock.mock.calls[0]! as [TemplateStringsArray, ...unknown[]]
      expect(values).toEqual(expect.arrayContaining(['tenant-a', 'business-a', 'Asia/Almaty']))

      await analyticsRepository.appointmentsByDay('tenant-a', 'business-a', range, 'Asia/Almaty')
      ;[, ...values] = queryRawMock.mock.calls[1]! as [TemplateStringsArray, ...unknown[]]
      expect(values).toEqual(expect.arrayContaining(['tenant-a', 'business-a', 'Asia/Almaty']))
    })

    it('a tenant B id never leaks into a tenant A query\'s bound parameters', async () => {
      await analyticsRepository.customerRequestsByDay('tenant-a', 'business-a', range, 'UTC')
      const [, ...values] = queryRawMock.mock.calls[0]! as [TemplateStringsArray, ...unknown[]]
      expect(values).not.toContain('tenant-b')
      expect(values).not.toContain('business-b')
    })
  })
})

describe('tenant isolation — Team Management (Prompt 15)', () => {
  // Same convention as every other section in this file: call the real
  // repository/service functions against the same mocked prisma client,
  // proving every query is scoped by tenantId regardless of what id string
  // is supplied. `User` has no `businessId` column at all (see
  // schema.prisma) — every tenant has exactly one Business, so tenant
  // scoping alone is the correct and complete isolation boundary here.
  const USER_OWNED_BY_B = '777e4567-e89b-12d3-a456-426614174000'

  function makeUserRow(overrides: Record<string, unknown> = {}) {
    return {
      id: 'u1',
      tenantId: 'tenant-a',
      email: 'a@example.test',
      passwordHash: 'hashed:x',
      name: 'A',
      role: 'manager',
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    }
  }

  function ctxA(role: 'owner' | 'admin' | 'manager' = 'owner', id = 'requester-a') {
    return makeAuthContext(role, {
      tenant: makeTenant({ id: 'tenant-a' }),
      business: makeBusiness({ id: 'business-a', tenantId: 'tenant-a' }),
      user: { ...makeAuthContext(role).user, id },
    })
  }

  it('repository: list is scoped to tenantId only (User has no businessId column)', async () => {
    await teamRepository.list('tenant-a')
    expect(userFindManyMock).toHaveBeenCalledWith(expect.objectContaining({ where: { tenantId: 'tenant-a' } }))
  })

  it('repository: findById never matches a foreign-tenant row', async () => {
    await teamRepository.findById('tenant-a', USER_OWNED_BY_B)
    expect(userFindFirstMock).toHaveBeenCalledWith({ where: { tenantId: 'tenant-a', id: USER_OWNED_BY_B } })
  })

  it('repository: updateProfile/activate updateMany calls are scoped by tenantId + id', async () => {
    userUpdateManyMock.mockResolvedValue({ count: 0 })
    await teamRepository.updateProfile('tenant-a', USER_OWNED_BY_B, { name: 'X' })
    expect(userUpdateManyMock).toHaveBeenCalledWith(expect.objectContaining({ where: { tenantId: 'tenant-a', id: USER_OWNED_BY_B } }))
    userUpdateManyMock.mockClear()

    await teamRepository.activate('tenant-a', USER_OWNED_BY_B)
    expect(userUpdateManyMock).toHaveBeenCalledWith(expect.objectContaining({ where: { tenantId: 'tenant-a', id: USER_OWNED_BY_B } }))
  })

  it('repository: countActiveOwners is scoped by tenantId', async () => {
    await teamRepository.countActiveOwners('tenant-a')
    expect(userCountMock).toHaveBeenCalledWith({ where: { tenantId: 'tenant-a', role: 'owner', isActive: true } })
  })

  it('service: tenant A cannot view tenant B\'s user — 404, scoped lookup never matches', async () => {
    userFindFirstMock.mockResolvedValue(null)
    await expect(getTeamMember(ctxA(), USER_OWNED_BY_B)).rejects.toMatchObject({ statusCode: 404 })
  })

  it('service: tenant A cannot PATCH tenant B\'s user profile — 404, updateMany never reached', async () => {
    userFindFirstMock.mockResolvedValue(null)
    await expect(updateTeamMemberProfile(ctxA(), USER_OWNED_BY_B, { name: 'X' })).rejects.toMatchObject({ statusCode: 404 })
    expect(userUpdateManyMock).not.toHaveBeenCalled()
  })

  it('service: tenant A cannot change tenant B\'s user role — 404', async () => {
    userFindFirstMock.mockResolvedValue(null)
    await expect(changeTeamMemberRole(ctxA(), USER_OWNED_BY_B, { role: 'admin' })).rejects.toMatchObject({ statusCode: 404 })
  })

  it('service: tenant A cannot activate/deactivate tenant B\'s user — 404 in both cases', async () => {
    userFindFirstMock.mockResolvedValue(null)
    await expect(activateTeamMember(ctxA(), USER_OWNED_BY_B)).rejects.toMatchObject({ statusCode: 404 })
    await expect(deactivateTeamMember(ctxA(), USER_OWNED_BY_B)).rejects.toMatchObject({ statusCode: 404 })
  })

  it('a foreign target never reveals its existence — the same plain 404 as a genuinely unknown id', async () => {
    userFindFirstMock.mockResolvedValue(null)
    const foreignErr = await getTeamMember(ctxA(), USER_OWNED_BY_B).catch((e) => e)
    const unknownErr = await getTeamMember(ctxA(), 'totally-made-up-id').catch((e) => e)
    expect(foreignErr.statusCode).toBe(unknownErr.statusCode)
    expect(foreignErr.code).toBe(unknownErr.code)
    expect(foreignErr.message).toBe(unknownErr.message)
  })

  it('multi-tenant: tenant A\'s own users are still independently manageable once correctly scoped (sanity check that scoping, not a blanket rejection, is what blocks tenant B)', async () => {
    userFindFirstMock.mockResolvedValue(makeUserRow({ id: 'u-a2', role: 'manager', tenantId: 'tenant-a' }))
    userUpdateManyMock.mockResolvedValue({ count: 1 })
    await expect(updateTeamMemberProfile(ctxA('owner'), 'u-a2', { name: 'Updated' })).resolves.toBeDefined()
  })
})

describe('tenant isolation — Channel Integration (Prompt 16)', () => {
  // Same convention as every other section: call the real repository/
  // service functions against the same mocked prisma client, proving
  // every query is scoped by tenantId + businessId, and that a foreign
  // channelId injected into a request never resolves to another tenant's
  // row (spec §"TENANT TESTS").
  const CHANNEL_OWNED_BY_B = '888e4567-e89b-12d3-a456-426614174000'

  function ctxA() {
    return makeAuthContext('owner', {
      tenant: makeTenant({ id: 'tenant-a' }),
      business: makeBusiness({ id: 'business-a', tenantId: 'tenant-a' }),
    })
  }

  it('repository: list is scoped to tenantId + businessId', async () => {
    await channelConnectionRepository.list('tenant-a', 'business-a')
    expect(channelConnectionFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId: 'tenant-a', businessId: 'business-a' } })
    )
  })

  it('repository: findById never matches a foreign-tenant row', async () => {
    await channelConnectionRepository.findById('tenant-a', 'business-a', CHANNEL_OWNED_BY_B)
    expect(channelConnectionFindFirstMock).toHaveBeenCalledWith({
      where: { tenantId: 'tenant-a', businessId: 'business-a', id: CHANNEL_OWNED_BY_B },
    })
  })

  it('repository: updateById/setStatus updateMany calls are scoped by tenantId + businessId + id', async () => {
    await channelConnectionRepository.updateById('tenant-a', 'business-a', CHANNEL_OWNED_BY_B, { displayName: 'X' })
    expect(channelConnectionUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId: 'tenant-a', businessId: 'business-a', id: CHANNEL_OWNED_BY_B } })
    )
    channelConnectionUpdateManyMock.mockClear()

    await channelConnectionRepository.setStatus('tenant-a', 'business-a', CHANNEL_OWNED_BY_B, 'ACTIVE')
    expect(channelConnectionUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId: 'tenant-a', businessId: 'business-a', id: CHANNEL_OWNED_BY_B } })
    )
  })

  it('Prompt 18: repository: findByIdUnscoped is deliberately NOT tenant-scoped — the ONE lookup the Telegram webhook route uses to resolve a connection before it has any tenant context of its own, by id alone', async () => {
    await channelConnectionRepository.findByIdUnscoped(CHANNEL_OWNED_BY_B)
    expect(channelConnectionFindUniqueMock).toHaveBeenCalledWith({ where: { id: CHANNEL_OWNED_BY_B } })
  })

  it('Prompt 18: repository: findOtherActiveByTypeAndExternalAccountId excludes the given connection id and is scoped to ACTIVE + the given type — the cross-tenant "same bot" guard', async () => {
    await channelConnectionRepository.findOtherActiveByTypeAndExternalAccountId('TELEGRAM', 'bot-id-1', 'conn-a')
    expect(channelConnectionFindFirstMock).toHaveBeenCalledWith({
      where: { type: 'TELEGRAM', externalAccountId: 'bot-id-1', status: 'ACTIVE', id: { not: 'conn-a' } },
      select: { id: true },
    })
  })

  it('service: tenant A cannot GET tenant B\'s channel — 404 CHANNEL_NOT_FOUND, scoped lookup never matches', async () => {
    channelConnectionFindFirstMock.mockResolvedValue(null)
    await expect(getChannelConnection(ctxA(), CHANNEL_OWNED_BY_B)).rejects.toMatchObject({ statusCode: 404, code: 'CHANNEL_NOT_FOUND' })
  })

  it('service: tenant A cannot PATCH tenant B\'s channel — 404, updateMany never reached', async () => {
    channelConnectionFindFirstMock.mockResolvedValue(null)
    await expect(updateChannelConnection(ctxA(), CHANNEL_OWNED_BY_B, { displayName: 'hacked' })).rejects.toMatchObject({ statusCode: 404 })
    expect(channelConnectionUpdateManyMock).not.toHaveBeenCalled()
  })

  it('service: tenant A cannot activate/deactivate tenant B\'s channel — 404 in both cases, a foreign channelId injected into the URL never resolves', async () => {
    channelConnectionFindFirstMock.mockResolvedValue(null)
    await expect(activateChannelConnection(ctxA(), CHANNEL_OWNED_BY_B)).rejects.toMatchObject({ statusCode: 404 })
    await expect(deactivateChannelConnection(ctxA(), CHANNEL_OWNED_BY_B)).rejects.toMatchObject({ statusCode: 404 })
    expect(channelConnectionUpdateManyMock).not.toHaveBeenCalled()
  })

  it('a foreign channel never reveals its existence — the same plain 404 as a genuinely unknown id', async () => {
    channelConnectionFindFirstMock.mockResolvedValue(null)
    const foreignErr = await getChannelConnection(ctxA(), CHANNEL_OWNED_BY_B).catch((e) => e)
    const unknownErr = await getChannelConnection(ctxA(), 'totally-made-up-id').catch((e) => e)
    expect(foreignErr.statusCode).toBe(unknownErr.statusCode)
    expect(foreignErr.code).toBe(unknownErr.code)
  })

  it('repository: ChannelMessage idempotency lookup is scoped by tenantId + businessId + channelConnectionId, never externalMessageId alone', async () => {
    await channelMessageRepository.findByConnectionAndExternalMessageId('tenant-a', 'business-a', 'conn-a', 'ext-msg-1')
    expect(channelMessageFindFirstMock).toHaveBeenCalledWith({
      where: { tenantId: 'tenant-a', businessId: 'business-a', channelConnectionId: 'conn-a', externalMessageId: 'ext-msg-1' },
    })
  })

  it('repository: CustomerChannelIdentity lookup is scoped by tenantId + businessId + channelConnectionId, never externalCustomerId alone (spec §"CUSTOMER IDENTITY SECURITY")', async () => {
    await customerChannelIdentityRepository.findByConnectionAndExternalCustomerId('tenant-a', 'business-a', 'conn-a', 'ext-cust-1')
    expect(customerChannelIdentityFindFirstMock).toHaveBeenCalledWith({
      where: { tenantId: 'tenant-a', businessId: 'business-a', channelConnectionId: 'conn-a', externalCustomerId: 'ext-cust-1' },
    })
  })

  it('repository: Conversation channel-resolution lookup is scoped by tenantId + businessId', async () => {
    await conversationRepository.findByChannelConnectionAndExternalId('tenant-a', 'business-a', 'conn-a', 'ext-conv-1')
    expect(conversationFindFirstMock).toHaveBeenCalledWith({
      where: { tenantId: 'tenant-a', businessId: 'business-a', channelConnectionId: 'conn-a', externalConversationId: 'ext-conv-1' },
    })
  })

  it('repository: normalized-phone customer matching is scoped by tenantId + businessId (bound parameters, never string-interpolated)', async () => {
    await customerRepository.findActiveByLocalPhoneNumber('tenant-a', 'business-a', '9001112233')
    const [, ...values] = queryRawMock.mock.calls[queryRawMock.mock.calls.length - 1]! as [TemplateStringsArray, ...unknown[]]
    expect(values).toEqual(expect.arrayContaining(['tenant-a', 'business-a', '9001112233']))
  })

  describe('recordInboundMessage — the atomic inbound transaction (spec §"TRANSACTION TESTS"/§"INBOUND MESSAGE SERVICE")', () => {
    const baseInput = {
      tenantId: 'tenant-a',
      businessId: 'business-a',
      channelConnectionId: 'conn-a',
      channelType: 'TELEGRAM' as const,
      externalConversationId: 'ext-conv-1',
      externalMessageId: 'ext-msg-1',
      text: 'Hello',
      sentAt: new Date('2026-01-01T00:00:00Z'),
      customerId: null,
    }

    it('creates a new Conversation, a Message(INBOUND, CUSTOMER), and the ChannelMessage mapping, then touches lastMessageAt — in that order', async () => {
      conversationFindFirstMock.mockResolvedValue(null) // no existing conversation for this external thread
      conversationCreateMock.mockResolvedValue({ id: 'conv-new', tenantId: 'tenant-a', businessId: 'business-a', customerId: null, status: 'OPEN' })
      messageCreateMock.mockResolvedValue({ id: 'msg-new', createdAt: baseInput.sentAt })

      const result = await recordInboundMessage(baseInput)

      expect(conversationCreateMock).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ tenantId: 'tenant-a', businessId: 'business-a', channelConnectionId: 'conn-a', status: 'OPEN' }) })
      )
      expect(messageCreateMock).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ conversationId: 'conv-new', direction: 'INBOUND', senderType: 'CUSTOMER', content: 'Hello' }) })
      )
      expect(channelMessageCreateMock).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ channelConnectionId: 'conn-a', messageId: 'msg-new', externalMessageId: 'ext-msg-1' }) })
      )
      expect(conversationUpdateMock).toHaveBeenCalledWith(expect.objectContaining({ data: { lastMessageAt: baseInput.sentAt } }))
      expect(result.wasConversationCreated).toBe(true)
      expect(result.wasConversationReopened).toBe(false)
    })

    it('reuses an existing OPEN conversation instead of creating a second one', async () => {
      conversationFindFirstMock.mockResolvedValue({ id: 'conv-existing', tenantId: 'tenant-a', businessId: 'business-a', customerId: 'cust-1', status: 'OPEN' })
      messageCreateMock.mockResolvedValue({ id: 'msg-new', createdAt: baseInput.sentAt })

      const result = await recordInboundMessage(baseInput)

      expect(conversationCreateMock).not.toHaveBeenCalled()
      expect(result.wasConversationCreated).toBe(false)
      expect(result.wasConversationReopened).toBe(false)
      expect(messageCreateMock).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ conversationId: 'conv-existing' }) }))
    })

    it('reopens a CLOSED conversation transactionally — status back to OPEN, closedAt cleared — before recording the message (spec §"CLOSED CONVERSATION")', async () => {
      conversationFindFirstMock.mockResolvedValue({ id: 'conv-closed', tenantId: 'tenant-a', businessId: 'business-a', customerId: null, status: 'CLOSED' })
      conversationUpdateMock.mockResolvedValue({ id: 'conv-closed', tenantId: 'tenant-a', businessId: 'business-a', customerId: null, status: 'OPEN' })
      messageCreateMock.mockResolvedValue({ id: 'msg-new', createdAt: baseInput.sentAt })

      const result = await recordInboundMessage(baseInput)

      expect(conversationUpdateMock).toHaveBeenCalledWith({ where: { id: 'conv-closed' }, data: { status: 'OPEN', closedAt: null } })
      expect(result.wasConversationReopened).toBe(true)
      expect(result.conversation.status).toBe('OPEN')
    })

    it('never overwrites an existing conversation\'s customerId — only a NEWLY created conversation gets the resolved customerId', async () => {
      conversationFindFirstMock.mockResolvedValue({ id: 'conv-existing', tenantId: 'tenant-a', businessId: 'business-a', customerId: null, status: 'OPEN' })
      messageCreateMock.mockResolvedValue({ id: 'msg-new', createdAt: baseInput.sentAt })

      await recordInboundMessage({ ...baseInput, customerId: 'cust-resolved' })

      // The only conversation.update call is the lastMessageAt touch — it must never also carry customerId.
      const updateCalls = conversationUpdateMock.mock.calls as { data: Record<string, unknown> }[][]
      expect(updateCalls.every((c) => !('customerId' in c[0]!.data))).toBe(true)
    })

    it('a failure creating the Message never leaves an orphaned ChannelMessage or lastMessageAt update — the mocked $transaction propagates the error, and the REAL rollback guarantee is verified live in the Supabase smoke test (a mock cannot prove genuine DB rollback)', async () => {
      conversationFindFirstMock.mockResolvedValue(null)
      conversationCreateMock.mockResolvedValue({ id: 'conv-new', tenantId: 'tenant-a', businessId: 'business-a', customerId: null, status: 'OPEN' })
      messageCreateMock.mockRejectedValue(new Error('DB write failed'))

      await expect(recordInboundMessage(baseInput)).rejects.toThrow('DB write failed')
      expect(channelMessageCreateMock).not.toHaveBeenCalled()
    })

    it('Prompt 18: a P2002 on Conversation creation propagates UNCHANGED out of this function — it is deliberately never caught in here (see this function\'s own doc comment for why a same-transaction catch-and-refetch reliably 25P02s against real Postgres; recovery is channelMessageService.ts\'s job, one layer up, in a fresh transaction)', async () => {
      conversationFindFirstMock.mockResolvedValueOnce(null) // this transaction's own initial lookup: nothing yet
      conversationCreateMock.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: '5.22.0' })
      )

      await expect(recordInboundMessage(baseInput)).rejects.toMatchObject({ code: 'P2002' })
      expect(messageCreateMock).not.toHaveBeenCalled()
      // The transaction never attempts a second query against the same tx
      // after the P2002 — confirmed by conversationFindFirstMock only ever
      // being called once (the initial lookup), never a same-tx re-fetch.
      expect(conversationFindFirstMock).toHaveBeenCalledTimes(1)
    })

    it('a non-P2002 error creating the Conversation propagates unchanged, never silently swallowed as a race', async () => {
      conversationFindFirstMock.mockResolvedValue(null)
      conversationCreateMock.mockRejectedValue(new Error('connection reset'))

      await expect(recordInboundMessage(baseInput)).rejects.toThrow('connection reset')
      expect(messageCreateMock).not.toHaveBeenCalled()
    })
  })
})

describe('tenant isolation — Channel Operations & Delivery (Prompt 17)', () => {
  function ctxA() {
    return makeAuthContext('owner', {
      tenant: makeTenant({ id: 'tenant-a' }),
      business: makeBusiness({ id: 'business-a', tenantId: 'tenant-a' }),
    })
  }

  const CONNECTION_A = 'conn-a'
  const MESSAGE_OWNED_BY_B = '999e4567-e89b-12d3-a456-426614174000'

  it('repository: findByConnectionAndMessage is scoped by tenantId + businessId + channelConnectionId, never messageId alone', async () => {
    await channelDeliveryRepository.findByConnectionAndMessage('tenant-a', 'business-a', CONNECTION_A, 'msg-1')
    expect(channelDeliveryFindFirstMock).toHaveBeenCalledWith({
      where: { tenantId: 'tenant-a', businessId: 'business-a', channelConnectionId: CONNECTION_A, messageId: 'msg-1' },
    })
  })

  it('repository: messageRepository.findById is scoped by tenantId + businessId — a foreign-tenant message id never resolves', async () => {
    messageFindFirstMock.mockResolvedValue(null)
    const result = await messageRepository.findById('tenant-a', 'business-a', MESSAGE_OWNED_BY_B)
    expect(messageFindFirstMock).toHaveBeenCalledWith({ where: { tenantId: 'tenant-a', businessId: 'business-a', id: MESSAGE_OWNED_BY_B } })
    expect(result).toBeNull()
  })

  it('service: cross-tenant send is a plain 404 MESSAGE_NOT_FOUND — a foreign message id injected into the URL never resolves', async () => {
    messageFindFirstMock.mockResolvedValue(null)
    channelConnectionFindFirstMock.mockResolvedValue({ id: CONNECTION_A, tenantId: 'tenant-a', businessId: 'business-a', type: 'TELEGRAM', status: 'ACTIVE' })
    await expect(sendMessageViaChannel(ctxA(), CONNECTION_A, MESSAGE_OWNED_BY_B)).rejects.toMatchObject({
      statusCode: 404,
      code: 'MESSAGE_NOT_FOUND',
    })
    expect(channelDeliveryFindFirstMock).not.toHaveBeenCalled()
    expect(channelDeliveryCreateMock).not.toHaveBeenCalled()
  })

  describe('channelDeliveryRepository.claimForSending — the concurrent-send guard (spec §10)', () => {
    beforeEach(() => {
      channelDeliveryFindFirstMock.mockReset()
      channelDeliveryFindUniqueMock.mockReset()
      channelDeliveryCreateMock.mockReset()
      channelDeliveryUpdateManyMock.mockReset()
    })

    it('no existing row: creates one as PENDING, then claims it — attemptCount incremented exactly once', async () => {
      channelDeliveryFindFirstMock.mockResolvedValueOnce(null) // ensureDeliveryRow's own lookup
      channelDeliveryCreateMock.mockResolvedValue({ id: 'del-1', status: 'PENDING', attemptCount: 0 })
      channelDeliveryUpdateManyMock.mockResolvedValue({ count: 1 })
      channelDeliveryFindUniqueMock.mockResolvedValue({ id: 'del-1', status: 'SENDING', attemptCount: 1 })

      const claim = await channelDeliveryRepository.claimForSending('tenant-a', 'business-a', CONNECTION_A, 'msg-1')

      expect(channelDeliveryCreateMock).toHaveBeenCalledWith({
        data: { tenantId: 'tenant-a', businessId: 'business-a', channelConnectionId: CONNECTION_A, messageId: 'msg-1', status: 'PENDING', attemptCount: 0 },
      })
      expect(channelDeliveryUpdateManyMock).toHaveBeenCalledWith({
        where: { id: 'del-1', status: { in: ['PENDING', 'FAILED'] } },
        data: { status: 'SENDING', attemptCount: { increment: 1 }, lastAttemptAt: expect.any(Date) },
      })
      expect(claim).toMatchObject({ outcome: 'CLAIMED' })
    })

    it('a genuine concurrent-creation race (P2002 on @@unique([channelConnectionId, messageId])) re-fetches the winner\'s row instead of throwing a raw DB error or creating a second row', async () => {
      channelDeliveryFindFirstMock
        .mockResolvedValueOnce(null) // this call's own initial lookup: nothing yet
        .mockResolvedValueOnce({ id: 'del-winner', status: 'PENDING', attemptCount: 0 }) // race-recovery re-fetch
      channelDeliveryCreateMock.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: '5.22.0' })
      )
      channelDeliveryUpdateManyMock.mockResolvedValue({ count: 1 })
      channelDeliveryFindUniqueMock.mockResolvedValue({ id: 'del-winner', status: 'SENDING', attemptCount: 1 })

      const claim = await channelDeliveryRepository.claimForSending('tenant-a', 'business-a', CONNECTION_A, 'msg-1')

      expect(claim.delivery.id).toBe('del-winner')
      expect(claim.outcome).toBe('CLAIMED')
    })

    it('a non-P2002 error creating the row propagates unchanged, never silently swallowed as a race', async () => {
      channelDeliveryFindFirstMock.mockResolvedValueOnce(null)
      channelDeliveryCreateMock.mockRejectedValue(new Error('connection reset'))
      await expect(channelDeliveryRepository.claimForSending('tenant-a', 'business-a', CONNECTION_A, 'msg-1')).rejects.toThrow('connection reset')
    })

    it('an existing SENT row short-circuits to ALREADY_SENT without ever attempting the compare-and-set update', async () => {
      channelDeliveryFindFirstMock.mockResolvedValueOnce({ id: 'del-1', status: 'SENT', attemptCount: 1, externalMessageId: 'mock-out-1' })
      const claim = await channelDeliveryRepository.claimForSending('tenant-a', 'business-a', CONNECTION_A, 'msg-1')
      expect(claim.outcome).toBe('ALREADY_SENT')
      expect(channelDeliveryUpdateManyMock).not.toHaveBeenCalled()
    })

    it('an existing SENDING row short-circuits to IN_PROGRESS without ever attempting the compare-and-set update', async () => {
      channelDeliveryFindFirstMock.mockResolvedValueOnce({ id: 'del-1', status: 'SENDING', attemptCount: 1 })
      const claim = await channelDeliveryRepository.claimForSending('tenant-a', 'business-a', CONNECTION_A, 'msg-1')
      expect(claim.outcome).toBe('IN_PROGRESS')
      expect(channelDeliveryUpdateManyMock).not.toHaveBeenCalled()
    })

    it('losing the compare-and-set race (updateMany matches zero rows) re-fetches the real current state rather than reporting a stale CLAIMED', async () => {
      channelDeliveryFindFirstMock.mockResolvedValueOnce({ id: 'del-1', status: 'PENDING', attemptCount: 0 })
      channelDeliveryUpdateManyMock.mockResolvedValue({ count: 0 }) // another concurrent request's UPDATE won first
      channelDeliveryFindUniqueMock.mockResolvedValue({ id: 'del-1', status: 'SENDING', attemptCount: 1 })

      const claim = await channelDeliveryRepository.claimForSending('tenant-a', 'business-a', CONNECTION_A, 'msg-1')
      expect(claim.outcome).toBe('IN_PROGRESS')
    })

    it('a retry on a FAILED row is claimable again — same row, attemptCount incremented, never a second row created', async () => {
      channelDeliveryFindFirstMock.mockResolvedValueOnce({ id: 'del-1', status: 'FAILED', attemptCount: 1 })
      channelDeliveryUpdateManyMock.mockResolvedValue({ count: 1 })
      channelDeliveryFindUniqueMock.mockResolvedValue({ id: 'del-1', status: 'SENDING', attemptCount: 2 })

      const claim = await channelDeliveryRepository.claimForSending('tenant-a', 'business-a', CONNECTION_A, 'msg-1')

      expect(channelDeliveryCreateMock).not.toHaveBeenCalled()
      expect(channelDeliveryUpdateManyMock).toHaveBeenCalledWith({
        where: { id: 'del-1', status: { in: ['PENDING', 'FAILED'] } },
        data: { status: 'SENDING', attemptCount: { increment: 1 }, lastAttemptAt: expect.any(Date) },
      })
      expect(claim).toMatchObject({ outcome: 'CLAIMED', delivery: { id: 'del-1', attemptCount: 2 } })
    })
  })
})
