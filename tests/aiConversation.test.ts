import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

// ---------------------------------------------------------------------------
// MCR-5 — automatic AI conversation. The REAL code runs end to end on one
// in-memory Prisma double: MCR-2 intake → MCR-4 recovery → inbound channel
// pipeline (receiveIncoming + recordInboundMessage) → aiTurnRepository
// (claim / finalize, with the raw FOR UPDATE locks modelled by serialized
// transactions) → the AI core (aiService, contextBuilder, safety, tools,
// checkAvailability) with the deterministic MockAiProvider → reply
// validation → escalationRepository → deliverSystemMessage + mock WhatsApp
// adapter. Vercel Queues is a test publisher whose jobs are replayed into the
// real consumer (handleAiReplyJob): once, twice, concurrently, late.
// LOCAL integration only — no real OpenAI, no real Vercel Queue.
// ---------------------------------------------------------------------------

type Row = Record<string, any>
const { db, trapHits, hooks, fakePrisma, trap } = vi.hoisted(() => {
  const tableNames = ['tenants', 'businesses', 'conversations', 'messages', 'channelMessages', 'turns', 'escalations', 'aiLogs', 'calls', 'hours', 'deliveries', 'connections', 'services', 'knowledge', 'rules', 'numbers'] as const
  const db = Object.fromEntries(tableNames.map((t) => [t, [] as Row[]])) as Record<(typeof tableNames)[number], Row[]> & Record<string, Row[]>
  const trapHits: string[] = []
  const hooks = {
    onGenerate: null as null | ((req: any) => void | Promise<void>),
    override: null as null | ((req: any) => any),
    providerError: false,
    generateCalls: 0,
    uniqueError: (msg: string): Error => new Error(msg),
  }

  function matchValue(value: any, cond: any): boolean {
    if (cond === null) return value === null || value === undefined
    if (cond instanceof Date) return value instanceof Date && value.getTime() === cond.getTime()
    if (typeof cond !== 'object' || Array.isArray(cond)) return value === cond
    return Object.entries(cond).every(([op, arg]: [string, any]) => {
      if (op === 'not') return arg === null ? value !== null && value !== undefined : !matchValue(value, arg)
      if (op === 'in') return arg.includes(value)
      if (op === 'lt') return value != null && value < arg
      if (op === 'lte') return value != null && value <= arg
      if (op === 'gt') return value != null && value > arg
      if (op === 'gte') return value != null && value >= arg
      return false
    })
  }
  function matches(row: Row, where: any): boolean {
    return Object.entries(where ?? {}).every(([key, cond]: [string, any]) => {
      if (key === 'OR') return cond.some((w: any) => matches(row, w))
      if (key === 'AND') return (Array.isArray(cond) ? cond : [cond]).every((w: any) => matches(row, w))
      if (key === 'NOT') return !matches(row, cond)
      return matchValue(row[key], cond)
    })
  }
  const clone = <T,>(v: T): T => structuredClone(v)
  function sortRows(rows: Row[], orderBy: any): Row[] {
    const orders = (Array.isArray(orderBy) ? orderBy : orderBy ? [orderBy] : []).flatMap((o: any) => Object.entries(o))
    return [...rows].sort((a, b) => {
      for (const [k, dir] of orders as [string, string][]) {
        if (a[k] < b[k]) return dir === 'asc' ? -1 : 1
        if (a[k] > b[k]) return dir === 'asc' ? 1 : -1
      }
      return 0
    })
  }
  function apply(row: Row, data: Row) {
    for (const [k, v] of Object.entries(data)) {
      if (v === undefined) continue
      row[k] = v && typeof v === 'object' && !(v instanceof Date) && 'increment' in v ? row[k] + v.increment : v
    }
    row.updatedAt = new Date()
  }
  function model(table: string, defaults: () => Row = () => ({}), uniques: string[][] = []) {
    const rows = () => db[table] as Row[]
    const violates = (row: Row, except?: Row) =>
      uniques.some((cols) => cols.every((c) => row[c] !== null && row[c] !== undefined) && rows().some((r) => r !== except && cols.every((c) => r[c] === row[c])))
    const self = {
      findFirst: async ({ where, orderBy, select }: any = {}) => {
        const found = sortRows(rows().filter((r) => matches(r, where)), orderBy)[0]
        return found ? clone(found) : null
      },
      findFirstOrThrow: async (args: any) => {
        const r = await self.findFirst(args)
        if (!r) throw new Error(`${table} not found`)
        return r
      },
      findUnique: async ({ where }: any) => self.findFirst({ where }),
      findUniqueOrThrow: async ({ where }: any) => self.findFirstOrThrow({ where }),
      findMany: async ({ where, orderBy, take }: any = {}) => {
        const list = sortRows(rows().filter((r) => matches(r, where)), orderBy)
        return clone(take ? list.slice(0, take) : list)
      },
      count: async ({ where }: any = {}) => rows().filter((r) => matches(r, where)).length,
      create: async ({ data }: any) => {
        const now = new Date()
        const row: Row = { ...defaults(), id: randomUUID(), createdAt: now, updatedAt: now, ...data }
        if (violates(row)) throw hooks.uniqueError(`Unique constraint failed on ${table}`)
        rows().push(row)
        return clone(row)
      },
      createMany: async ({ data, skipDuplicates }: any) => {
        let count = 0
        for (const d of data) {
          const now = new Date()
          const row: Row = { ...defaults(), id: randomUUID(), createdAt: now, updatedAt: now, ...d }
          if (violates(row)) {
            if (skipDuplicates) continue
            throw hooks.uniqueError(`Unique constraint failed on ${table}`)
          }
          rows().push(row)
          count++
        }
        return { count }
      },
      update: async ({ where, data }: any) => {
        const row = rows().find((r) => matches(r, where))
        if (!row) throw new Error(`${table} not found for update`)
        const next = { ...row }
        apply(next, data)
        if (violates(next, row)) throw hooks.uniqueError(`Unique constraint failed on ${table}`)
        Object.assign(row, next)
        return clone(row)
      },
      updateMany: async ({ where, data }: any) => {
        const list = rows().filter((r) => matches(r, where))
        for (const row of list) apply(row, data)
        return { count: list.length }
      },
    }
    return self
  }

  let chain: Promise<unknown> = Promise.resolve()
  const fakePrisma: any = {
    $transaction: (fn: (tx: unknown) => Promise<unknown>) => {
      const run = async () => {
        const snapshot = structuredClone(db)
        try {
          return await fn(fakePrisma)
        } catch (err) {
          Object.assign(db, snapshot)
          throw err
        }
      }
      const result = chain.then(run, run)
      chain = result.catch(() => undefined)
      return result
    },
    // SELECT "id" FROM <table> WHERE <col> = $1 FOR UPDATE — the locking is the serialized $transaction above.
    $queryRaw: async (sql: { strings: string[]; values: unknown[] }) => {
      const text = sql.strings.join('?')
      const value = sql.values[0]
      const table = text.includes('ai_conversation_turns') ? 'turns' : text.includes('call_interactions') ? 'calls' : text.includes('"conversations"') ? 'conversations' : null
      if (!table) return []
      const col = text.includes('"inboundMessageId"') ? 'inboundMessageId' : 'id'
      const found = (db[table] as Row[]).find((r) => r[col] === value)
      return found ? [{ id: found.id }] : []
    },
    $executeRaw: async () => 1,
    tenant: model('tenants'),
    business: model('businesses'),
    businessWorkingHours: model('hours'),
    conversation: model(
      'conversations',
      () => ({ status: 'OPEN', customerId: null, customerRequestId: null, subject: null, closedAt: null, lastMessageAt: null, aiAutomationPausedAt: null, aiAutomationPausedReason: null, aiAutomationResumedAt: null }),
      [['channelConnectionId', 'externalConversationId']]
    ),
    message: model('messages'),
    channelMessage: model('channelMessages', () => ({}), [['channelConnectionId', 'externalMessageId'], ['messageId']]),
    aiConversationTurn: model(
      'turns',
      () => ({ state: 'PENDING', decision: null, reasonCode: null, attemptCount: 0, claimedAt: null, completedAt: null, replyMessageId: null, escalationId: null }),
      [['inboundMessageId'], ['replyMessageId']]
    ),
    aiEscalation: model('escalations', () => ({ assignedUserId: null, resolvedAt: null }), [['tenantId', 'businessId', 'activeConversationId']]),
    aiLog: model('aiLogs'),
    callInteraction: model('calls'),
  }
  const trap = (name: string, allowed: Record<string, unknown> = {}) =>
    new Proxy(allowed, {
      get: (target, prop) =>
        prop in target
          ? (target as any)[prop]
          : () => {
              trapHits.push(`${name}.${String(prop)}`)
              throw new Error(`${name}.${String(prop)} must not be used`)
            },
    })
  return { db, trapHits, hooks, fakePrisma, trap }
})

vi.mock('../src/server/db/prisma', () => ({ prisma: fakePrisma }))
vi.mock('../src/server/ai/aiProviderFactory', async () => {
  const { MockAiProvider } = await import('../src/server/ai/providers/mockAiProvider')
  const { AiProviderError } = await import('../src/server/ai/provider')
  return {
    getAiProvider: () => ({
      async generate(req: any) {
        hooks.generateCalls++
        await hooks.onGenerate?.(req)
        if (hooks.providerError) throw new AiProviderError('AI_PROVIDER_UNAVAILABLE', 'provider down')
        if (hooks.override) return hooks.override(req)
        return new MockAiProvider().generate(req)
      },
    }),
  }
})
vi.mock('../src/server/repositories/channelConnectionRepository', () => ({
  channelConnectionRepository: {
    findById: async (t: string, b: string, id: string) => db.connections.find((c) => c.tenantId === t && c.businessId === b && c.id === id) ?? null,
    list: async (t: string, b: string) => db.connections.filter((c) => c.tenantId === t && c.businessId === b),
  },
}))
// MCR-6 — the recovery here is the PERMITTED WhatsApp path (recorded consent +
// approved template); routing itself is covered in tests/recoveryRouting.test.ts.
vi.mock('../src/server/repositories/recoveryRoutingRepository', () => ({
  channelConsentRepository: { find: async (_t: string, _b: string, channel: string) => (channel === 'WHATSAPP' ? { status: 'OPTED_IN' } : null) },
  customerServiceWindowRepository: { latestInboundAt: async () => null },
  bridgeLinkRepository: { create: async () => undefined },
}))
vi.mock('../src/server/repositories/channelDeliveryRepository', () => ({
  channelDeliveryRepository: {
    claimForSending: async (t: string, b: string, conn: string, mid: string) => {
      await new Promise((r) => setTimeout(r, 1))
      let row = db.deliveries.find((d) => d.channelConnectionId === conn && d.messageId === mid)
      if (!row) {
        row = { id: randomUUID(), tenantId: t, businessId: b, channelConnectionId: conn, messageId: mid, status: 'PENDING', attemptCount: 0, deliveredAt: null }
        db.deliveries.push(row)
      }
      if (row.status === 'SENT') return { outcome: 'ALREADY_SENT', delivery: { ...row } }
      if (row.status === 'SENDING') return { outcome: 'IN_PROGRESS', delivery: { ...row } }
      Object.assign(row, { status: 'SENDING', attemptCount: row.attemptCount + 1 })
      return { outcome: 'CLAIMED', delivery: { ...row } }
    },
    markSent: async (id: string, ext: string | null) => Object.assign(db.deliveries.find((d) => d.id === id)!, { status: 'SENT', externalMessageId: ext, deliveredAt: new Date() }),
    markFailed: async (id: string, code: string, msg: string) => Object.assign(db.deliveries.find((d) => d.id === id)!, { status: 'FAILED', errorCode: code, errorMessage: msg }),
  },
}))
vi.mock('../src/server/services/channelCustomerService', () => ({
  resolveCustomerForInbound: async () => ({ customerId: null, newIdentityToLink: null }),
  linkCustomerIdentityBestEffort: async () => undefined,
}))
vi.mock('../src/server/repositories/businessRepository', () => ({
  businessRepository: {
    findFirstByTenant: async (t: string) => structuredClone(db.businesses.find((b) => b.tenantId === t) ?? null),
    update: async (t: string, b: string, data: Row) => {
      const row = db.businesses.find((x) => x.tenantId === t && x.id === b)
      if (!row) return null
      Object.assign(row, data)
      return structuredClone(row)
    },
  },
}))
vi.mock('../src/server/repositories/businessPhoneNumberRepository', () => ({
  isActiveNumberConflict: () => false,
  businessPhoneNumberRepository: { findActiveByPhoneE164ForRouting: async (e164: string) => db.numbers.find((n) => n.phoneE164 === e164) ?? null },
}))
vi.mock('../src/server/repositories/callInteractionRepository', () => ({
  callInteractionRepository: {
    insertIfAbsent: async (data: Row) => {
      if (db.calls.some((c) => c.provider === data.provider && c.providerCallId === data.providerCallId)) return
      db.calls.push({
        id: randomUUID(), outcome: 'IN_PROGRESS', startedAt: null, answeredAt: null, endedAt: null, outcomeDetectedAt: null, recoveryIneligibleReason: null,
        recoveryClaimedAt: null, recoverySentAt: null, recoveryAttemptCount: 0, recoveryFailureCode: null, recoveryTemplateKey: null,
        recoveryConversationId: null, recoveryMessageId: null, updatedAt: new Date(), ...data,
      })
    },
    lockByProviderCall: async (p: string, id: string) => structuredClone(db.calls.find((c) => c.provider === p && c.providerCallId === id) ?? null),
    insertEventIfAbsent: async () => true,
    update: async (id: string, data: Row) => Object.assign(db.calls.find((c) => c.id === id)!, data, { updatedAt: new Date() }),
  },
}))
vi.mock('../src/server/repositories/serviceRepository', () => ({
  serviceRepository: trap('serviceRepository', {
    listByBusiness: async (t: string, b: string, activeOnly: boolean) => db.services.filter((s) => s.tenantId === t && s.businessId === b && (!activeOnly || s.isActive)),
    findById: async (t: string, b: string, id: string) => db.services.find((s) => s.tenantId === t && s.businessId === b && s.id === id) ?? null,
  }),
}))
vi.mock('../src/server/repositories/knowledgeRepository', () => ({
  knowledgeRepository: { listByBusiness: async (t: string, b: string) => db.knowledge.filter((k) => k.tenantId === t && k.businessId === b) },
}))
vi.mock('../src/server/repositories/businessRuleRepository', () => ({
  businessRuleRepository: { listByBusiness: async (t: string, b: string) => db.rules.filter((r) => r.tenantId === t && r.businessId === b) },
}))
vi.mock('../src/server/repositories/appointmentRepository', () => ({
  CONFLICT_BLOCKING_STATUSES: ['SCHEDULED', 'CONFIRMED', 'IN_PROGRESS'],
  appointmentRepository: trap('appointmentRepository', {
    listCapacityOccupants: async () => [],
    findConflict: async () => null,
    list: async () => ({ items: [], total: 0 }),
  }),
}))
// Nothing below may ever be written by automatic AI.
vi.mock('../src/server/repositories/customerRepository', () => ({
  customerRepository: trap('customerRepository', { findActiveByPhoneE164: async () => [], findById: async () => null }),
}))
vi.mock('../src/server/repositories/vehicleRepository', () => ({ vehicleRepository: trap('vehicleRepository', { list: async () => ({ items: [], total: 0 }) }) }))
vi.mock('../src/server/repositories/customerRequestRepository', () => ({ customerRequestRepository: trap('customerRequestRepository') }))
vi.mock('../src/server/repositories/serviceRecordRepository', () => ({ serviceRecordRepository: trap('serviceRecordRepository') }))

import { Prisma } from '@prisma/client'
import { makeAuthContext, makeBusiness, makeTenant } from './helpers/fixtures'
import { receiveIncoming } from '../src/server/services/channelMessageService'
import { createMessage } from '../src/server/services/messageService'
import { setConversationAiAutomation } from '../src/server/services/conversationService'
import { updateBusinessProfile } from '../src/server/services/businessService'
import { generateConversationDraft } from '../src/server/services/aiService'
import { checkAvailability } from '../src/server/services/appointmentService'
import { processAiTurn } from '../src/server/services/aiConversationService'
import { ingestCallEvent } from '../src/server/services/callIntakeService'
import { setRecoveryJobPublisher, type RecoveryJob } from '../src/server/recovery/recoveryJobs'
import { handleRecoveryJob } from '../src/server/recovery/recoveryJobConsumer'
import {
  setAiReplyJobPublisher,
  aiReplyJobIdempotencyKey,
  createVercelAiReplyJobPublisher,
  AI_REPLY_QUEUE_TOPIC,
  AI_REPLY_JOB_MAX_DELIVERIES,
  AI_REPLY_JOB_RETRY_AFTER_SECONDS,
  type AiReplyJob,
} from '../src/server/aiConversation/aiReplyJobs'
import { handleAiReplyJob, aiReplyJobRetry, AiReplyJobRetryError } from '../src/server/aiConversation/aiReplyJobConsumer'
import { AI_HANDOFF_NOTICE, AI_MAX_CONSECUTIVE_AUTO_TURNS, AI_TURN_STALE_CLAIM_SECONDS } from '../src/server/aiConversation/policy'
import { createMessageSchema } from '../src/server/validation/message.schemas'
import { businessProfileSchema } from '../src/server/validation/business.schemas'
import aiReplyProcessor from '../api/internal/ai-replies/process'
import type { ApiRequest, ApiResponse } from '../src/server/types/http'

// --- fixtures ---------------------------------------------------------------
const NOW = new Date('2026-10-05T05:00:00Z') // Monday 10:00 in Asia/Almaty
const PAINT = '11111111-1111-4111-8111-111111111111'
const OIL = '22222222-2222-4222-8222-222222222222'
const TIRES = '33333333-3333-4333-8333-333333333333'
const SUSPENSION = '44444444-4444-4444-8444-444444444444'
const CALLER = '+77011234567'
const THREAD = '77011234567'
const ADDRESS = 'г. Алматы, ул. Абая, 10'
const MAP = 'https://2gis.kz/almaty/firm/100'

const tick = (seconds = 1) => vi.setSystemTime(new Date(Date.now() + seconds * 1000))
const ctxFor = (tenantId = 't1', role: 'owner' | 'admin' | 'manager' = 'owner') => {
  const business = structuredClone(db.businesses.find((b) => b.tenantId === tenantId)!) as ReturnType<typeof makeBusiness>
  return makeAuthContext(role, { tenant: makeTenant({ id: tenantId }), business, user: { ...makeAuthContext(role).user, tenantId } })
}
const queue = { jobs: [] as { job: AiReplyJob; key: string }[], fail: false, seq: 0 }
const deliverAi = (job: unknown, deliveryCount = 1) => handleAiReplyJob(job, { messageId: `q-${++queue.seq}`, deliveryCount })
const lastJob = () => queue.jobs[queue.jobs.length - 1]!.job

let extSeq = 0
async function customerSays(text: string, o: { tenantId?: string; connection?: string; thread?: string; externalMessageId?: string } = {}) {
  tick()
  return receiveIncoming(ctxFor(o.tenantId ?? 't1'), o.connection ?? 'wa-1', {
    externalMessageId: o.externalMessageId ?? `wamid-${++extSeq}`,
    externalConversationId: o.thread ?? THREAD,
    text,
    sentAt: new Date(),
  })
}
const conv = (id?: string) => (id ? db.conversations.find((c) => c.id === id)! : db.conversations[0]!)
const aiMessages = () => db.messages.filter((m) => m.senderType === 'AI')
const turnOf = (messageId: string) => db.turns.find((t) => t.inboundMessageId === messageId)!
const sentAiDeliveries = () => db.deliveries.filter((d) => d.status === 'SENT' && aiMessages().some((m) => m.id === d.messageId))

function service(id: string, name: string, over: Row = {}): Row {
  return { id, tenantId: 't1', businessId: 'b1', name, description: null, priceFrom: null, priceTo: null, currency: 'KZT', priceNote: null, requiresInspection: false, durationMinutes: 60, isActive: true, ...over }
}

beforeEach(() => {
  extSeq = 0
  trapHits.length = 0
  Object.assign(hooks, { onGenerate: null, override: null, providerError: false, generateCalls: 0, uniqueError: (msg: string) => new Prisma.PrismaClientKnownRequestError(msg, { code: 'P2002', clientVersion: 'test' }) })
  for (const t of ['conversations', 'messages', 'channelMessages', 'turns', 'escalations', 'aiLogs', 'calls', 'deliveries']) db[t] = []
  db.tenants = [makeTenant({ id: 't1' }), makeTenant({ id: 't2' })]
  db.businesses = [
    makeBusiness({ id: 'b1', tenantId: 't1', name: 'Автосервис Тест', timezone: 'Asia/Almaty', currency: 'KZT', address: ADDRESS, locationUrl: MAP, aiAutoReplyEnabled: true }),
    makeBusiness({ id: 'b2', tenantId: 't2', name: 'Чужой сервис', timezone: 'Asia/Almaty', currency: 'KZT', aiAutoReplyEnabled: true }),
  ]
  db.hours = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'].flatMap((d) => [
    { id: randomUUID(), businessId: 'b1', dayOfWeek: d, isOpen: true, openTime: '09:00', closeTime: '19:00' },
    { id: randomUUID(), businessId: 'b2', dayOfWeek: d, isOpen: true, openTime: '10:00', closeTime: '18:00' },
  ])
  db.connections = [
    { id: 'wa-1', tenantId: 't1', businessId: 'b1', type: 'WHATSAPP', status: 'ACTIVE', config: { approvedTemplates: 'MISSED_CALL_RECOVERY_V1' }, createdAt: new Date(0) },
    { id: 'tg-1', tenantId: 't1', businessId: 'b1', type: 'TELEGRAM', status: 'ACTIVE' },
    { id: 'wa-2', tenantId: 't2', businessId: 'b2', type: 'WHATSAPP', status: 'ACTIVE', config: { approvedTemplates: 'MISSED_CALL_RECOVERY_V1' }, createdAt: new Date(0) },
  ]
  db.services = [
    service(PAINT, 'Кузовная покраска', { priceFrom: 40000, requiresInspection: true, durationMinutes: 120, priceNote: 'Точная стоимость зависит от состояния детали и объёма подготовительных работ' }),
    service(OIL, 'Замена масла', { priceFrom: 15000, priceTo: 15000 }),
    service(TIRES, 'Шиномонтаж', { priceFrom: 10000, priceTo: 20000 }),
    service(SUSPENSION, 'Ремонт подвески', { requiresInspection: true }),
    { ...service(randomUUID(), 'Кузовная покраска (чужая)', { priceFrom: 1 }), tenantId: 't2', businessId: 'b2', name: 'Полировка кузова', priceFrom: 30000 },
  ]
  db.knowledge = [{ tenantId: 't1', businessId: 'b1', title: 'Покраска элемента', content: 'Покраска элемента обычно стоит 25 000 ₸.', category: 'GENERAL' }]
  db.rules = []
  db.numbers = [{ id: 'n1', tenantId: 't1', businessId: 'b1', phoneE164: '+77272500000', isActive: true }]
  queue.jobs = []
  queue.fail = false
  setAiReplyJobPublisher({
    kind: 'test',
    async publish(job) {
      if (queue.fail) throw new Error('queue down')
      queue.jobs.push({ job, key: aiReplyJobIdempotencyKey(job.messageId) })
      return { status: 'PUBLISHED', messageId: `vq-${queue.jobs.length}` }
    },
  })
  process.env.RECOVERY_MOCK_CHANNEL_ENABLED = 'true'
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})
afterEach(() => {
  vi.useRealTimers()
  setAiReplyJobPublisher(null)
  setRecoveryJobPublisher(null)
  delete process.env.RECOVERY_MOCK_CHANNEL_ENABLED
  // S/T/U/V/R: never a Customer / Vehicle / CustomerRequest / Appointment / ServiceRecord write — in every test.
  expect(trapHits).toEqual([])
})

// ---------------------------------------------------------------------------
describe('kill switch & activation', () => {
  it('A. aiAutoReplyEnabled defaults to OFF in the schema and the migration', () => {
    const schema = fs.readFileSync(path.resolve(__dirname, '../prisma/schema.prisma'), 'utf-8')
    expect(schema).toMatch(/aiAutoReplyEnabled Boolean @default\(false\)/)
    const migration = fs.readFileSync(path.resolve(__dirname, '../prisma/migrations/20261006120000_automatic_ai_conversation/migration.sql'), 'utf-8')
    expect(migration).toContain('"aiAutoReplyEnabled" BOOLEAN NOT NULL DEFAULT false')
    expect(makeBusiness().aiAutoReplyEnabled).toBe(false)
  })

  it('B. OFF → an inbound message creates no AI turn, publishes nothing, calls no AI', async () => {
    db.businesses[0]!.aiAutoReplyEnabled = false
    const r = await customerSays('Сколько стоит замена масла?')
    expect(r.aiReplyJob).toBeUndefined()
    expect(db.turns).toHaveLength(0)
    expect(queue.jobs).toHaveLength(0)
    expect(hooks.generateCalls).toBe(0)
  })

  it('C. ON → the inbound message and its PENDING turn are committed together, then { messageId } is published', async () => {
    const r = await customerSays('Сколько стоит замена масла?')
    expect(r.aiReplyJob).toBe('PUBLISHED')
    expect(db.turns).toEqual([expect.objectContaining({ inboundMessageId: r.messageId, state: 'PENDING', conversationId: r.conversationId, tenantId: 't1' })])
    expect(queue.jobs).toEqual([{ job: { messageId: r.messageId }, key: `ai-conversation-reply:${r.messageId}` }])
    expect(Object.keys(queue.jobs[0]!.job)).toEqual(['messageId'])
    expect(hooks.generateCalls).toBe(0) // the webhook path never runs the AI
    expect(aiMessages()).toHaveLength(0)
  })

  it('Telegram is not an auto-reply channel: its inbound behaviour is unchanged (no turn)', async () => {
    await customerSays('Сколько стоит замена масла?', { connection: 'tg-1', thread: 'tg-chat-1' })
    expect(db.turns).toHaveLength(0)
    expect(queue.jobs).toHaveLength(0)
  })

  it('owner/admin can switch it; a manager cannot', async () => {
    expect(businessProfileSchema.parse({ aiAutoReplyEnabled: true })).toEqual({ aiAutoReplyEnabled: true })
    db.businesses[0]!.aiAutoReplyEnabled = false
    await updateBusinessProfile(ctxFor('t1', 'admin'), { aiAutoReplyEnabled: true })
    expect(db.businesses[0]!.aiAutoReplyEnabled).toBe(true)
    await expect(updateBusinessProfile(ctxFor('t1', 'manager'), { aiAutoReplyEnabled: false })).rejects.toMatchObject({ statusCode: 403 })
    expect(db.businesses[0]!.aiAutoReplyEnabled).toBe(true)
  })
})

// ---------------------------------------------------------------------------
describe('idempotency & concurrency — one inbound, at most one AI action', () => {
  it('D. the same inbound webhook twice → one Message, one turn; the retry re-publishes the same key; one AI reply', async () => {
    const first = await customerSays('Сколько стоит замена масла?', { externalMessageId: 'wamid-dup' })
    const second = await customerSays('Сколько стоит замена масла?', { externalMessageId: 'wamid-dup' })
    expect(second).toMatchObject({ duplicate: true, messageId: first.messageId, aiReplyJob: 'PUBLISHED' })
    expect(db.turns).toHaveLength(1)
    expect(new Set(queue.jobs.map((j) => j.key)).size).toBe(1)
    for (const { job } of queue.jobs) await deliverAi(job)
    expect(aiMessages()).toHaveLength(1)
  })

  it('E. the same queue job delivered twice → one AI reply, one provider generation', async () => {
    await customerSays('Сколько стоит замена масла?')
    expect(await deliverAi(lastJob())).toBe('REPLIED')
    expect(await deliverAi(lastJob(), 2)).toBe('SKIPPED')
    expect(aiMessages()).toHaveLength(1)
    expect(sentAiDeliveries()).toHaveLength(1)
    expect(hooks.generateCalls).toBe(1)
  })

  it('F. five concurrent workers on one job → exactly one AI reply', async () => {
    await customerSays('Сколько стоит замена масла?')
    const results = await Promise.all(Array.from({ length: 5 }, () => deliverAi(lastJob()).catch((e) => e)))
    expect(results.filter((r) => r === 'REPLIED')).toHaveLength(1)
    expect(aiMessages()).toHaveLength(1)
    expect(db.deliveries).toHaveLength(1)
  })

  it('the Vercel publisher sends topic + id-only payload + deterministic idempotency key', async () => {
    const send = vi.fn(async () => ({ messageId: 'vq' }))
    const id = randomUUID()
    await createVercelAiReplyJobPublisher({ send } as any).publish({ messageId: id })
    expect(send).toHaveBeenCalledWith('ai-conversation-reply', { messageId: id }, { idempotencyKey: `ai-conversation-reply:${id}`, retentionSeconds: 3600 })
  })
})

// ---------------------------------------------------------------------------
describe('grounded replies (MCR-3 pricing / location / hours / availability)', () => {
  async function replyTo(text: string) {
    await customerSays(text)
    const outcome = await deliverAi(lastJob()).catch((e) => e)
    return { outcome, text: aiMessages().at(-1)?.content as string | undefined }
  }

  it('G/H/L. FROM price stays «от 40 000 ₸» with the inspection caveat and the business price note', async () => {
    const { outcome, text } = await replyTo('Нужно покрасить капот')
    expect(outcome).toBe('REPLIED')
    expect(text).toMatch(/от 40[   ]000 ₸/)
    expect(text).toMatch(/осмотр/)
    expect(text).toContain('Точная стоимость зависит от состояния детали')
  })

  it('J. FIXED stays FIXED', async () => {
    const { text } = await replyTo('Сколько стоит замена масла?')
    expect(text).toMatch(/15[   ]000 ₸/)
    expect(text).not.toMatch(/от 15/)
  })

  it('I. RANGE stays RANGE', async () => {
    const { text } = await replyTo('Нужен шиномонтаж')
    expect(text).toMatch(/10[   ]000–20[   ]000 ₸/)
  })

  it('K. UNAVAILABLE never gets a number', async () => {
    const { outcome, text } = await replyTo('Нужен ремонт подвески, сколько стоит?')
    expect(outcome).toBe('REPLIED')
    expect(text).not.toMatch(/\d/)
  })

  it('M. a Knowledge price that contradicts the Service is never sent', async () => {
    const { text } = await replyTo('Нужно покрасить капот')
    expect(text).not.toMatch(/25[   ]000/)
    // and a model that DOES use the knowledge price is stopped before sending:
    hooks.override = () => ({ type: 'final', raw: { intent: 'PRICE_INQUIRY', confidence: 0.9, entities: {}, answer: 'Покраска элемента стоит 25 000 ₸.', needsHuman: false, reason: null } })
    const second = await replyTo('А крышу?')
    expect(second.outcome).toBe('HANDED_OFF')
    expect(second.text).toBe(AI_HANDOFF_NOTICE)
    expect(db.messages.some((m) => /25[   ]000/.test(m.content) && m.direction === 'OUTBOUND')).toBe(false)
  })

  it('N. location uses only the configured address and map link', async () => {
    const { text } = await replyTo('Где вы находитесь?')
    expect(text).toContain(ADDRESS)
    expect(text).toContain(MAP)
  })

  it('O. no configured address → nothing invented (handoff), and an invented street is never sent', async () => {
    Object.assign(db.businesses[0]!, { address: null, locationUrl: null })
    const { outcome, text } = await replyTo('Где вы находитесь?')
    expect(outcome).toBe('HANDED_OFF')
    expect(text).toBe(AI_HANDOFF_NOTICE)
  })

  it('P. hours come from the configured schedule for the business-local day', async () => {
    const { text } = await replyTo('До скольки вы работаете?')
    expect(text).toBe('Сегодня (понедельник) мы работаем с 09:00 до 19:00.')
  })

  it('Q. availability is the real read-only availability; the AI never books (R)', async () => {
    await customerSays('Нужно покрасить капот')
    await deliverAi(lastJob())
    const { text } = await replyTo('А завтра после 15 можно?')
    const real = await checkAvailability(ctxFor(), { serviceId: PAINT, date: '2026-10-06', preferredTimeFrom: '15:00', preferredTimeTo: null } as any)
    const offered = [...(text ?? '').matchAll(/\b\d{2}:\d{2}\b/g)].map((m) => m[0])
    expect(offered.length).toBeGreaterThan(0)
    expect(offered).toEqual(real.slots.slice(0, 3).map((s) => s.localStart))
    expect(text).not.toMatch(/вы записаны|запись подтверждена/i)
  })

  it('R. a model that asks to create an appointment is refused before anything executes', async () => {
    hooks.override = (req: any) =>
      req.toolExchanges.length === 0
        ? { type: 'tool_calls', calls: [{ id: 'x', name: 'create_appointment', arguments: { serviceId: PAINT, customerId: randomUUID(), vehicleId: randomUUID(), startAt: '2026-10-06T10:00:00Z', endAt: '2026-10-06T12:00:00Z', notes: null } }] }
        : { type: 'final', raw: { intent: 'BOOKING_REQUEST', confidence: 0.8, entities: {}, answer: 'Администратор подтвердит запись в этом чате.', needsHuman: false, reason: null } }
    const { outcome } = await replyTo('Да, записывайте на завтра')
    expect(outcome).toBe('REPLIED')
    expect(db.aiLogs.some((l) => l.operation === 'AI_TOOL_EXECUTION')).toBe(false) // never attempted
  })
})

// ---------------------------------------------------------------------------
describe('handoff', () => {
  it('W. «Хочу поговорить с человеком» → deterministic handoff: no AI call, escalation, pause, one notice', async () => {
    await customerSays('Хочу поговорить с человеком')
    expect(await deliverAi(lastJob())).toBe('HANDED_OFF')
    expect(hooks.generateCalls).toBe(0)
    expect(db.escalations).toEqual([expect.objectContaining({ status: 'OPEN', conversationId: conv().id, reason: 'Клиент попросил связать его с сотрудником.' })])
    expect(conv()).toMatchObject({ aiAutomationPausedReason: 'CUSTOMER_REQUESTED_HUMAN' })
    expect(aiMessages().map((m) => m.content)).toEqual([AI_HANDOFF_NOTICE])
    expect(db.turns[0]).toMatchObject({ state: 'COMPLETED', decision: 'HANDOFF', escalationId: db.escalations[0]!.id })
    expect(db.aiLogs.some((l) => l.operation === 'AI_ANALYZE' && l.outcome === 'ESCALATED' && l.messageId === db.turns[0]!.inboundMessageId)).toBe(true)
  })

  it('X. a vehicle problem needing diagnosis → handoff, no diagnosis sent', async () => {
    await customerSays('Стук в подвеске на кочках, что это?')
    expect(await deliverAi(lastJob())).toBe('HANDED_OFF')
    expect(conv().aiAutomationPausedReason).toBe('AI_NEEDS_HUMAN')
    expect(aiMessages().map((m) => m.content)).toEqual([AI_HANDOFF_NOTICE])
  })

  it('Y. an unsafe reply (invented price / booking claim / unknown link) is not sent → handoff', async () => {
    for (const answer of ['Покраска капота будет стоить 37 000 ₸.', 'Готово, вы записаны на завтра в 15:00.', 'Наш сайт: https://example.com']) {
      db.conversations = []
      db.turns = []
      db.escalations = []
      db.messages = []
      hooks.override = () => ({ type: 'final', raw: { intent: 'GENERAL_QUESTION', confidence: 0.9, entities: {}, answer, needsHuman: false, reason: null } })
      await customerSays('Подскажите, пожалуйста')
      expect(await deliverAi(lastJob())).toBe('HANDED_OFF')
      expect(aiMessages().map((m) => m.content)).toEqual([AI_HANDOFF_NOTICE])
      expect(conv().aiAutomationPausedReason).toBe('UNSAFE_REPLY')
    }
  })

  it('AK. the automatic-turn limit → pause + escalation instead of another AI reply', async () => {
    for (let i = 0; i < AI_MAX_CONSECUTIVE_AUTO_TURNS; i++) {
      await customerSays('Сколько стоит замена масла?')
      expect(await deliverAi(lastJob())).toBe('REPLIED')
    }
    const callsBefore = hooks.generateCalls
    await customerSays('А ещё вопрос про масло')
    expect(await deliverAi(lastJob())).toBe('HANDED_OFF')
    expect(hooks.generateCalls).toBe(callsBefore) // no model call for the limit decision
    expect(conv().aiAutomationPausedReason).toBe('TURN_LIMIT')
    expect(db.escalations).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
describe('human takeover', () => {
  it('Z/AA/AB. a staff reply pauses AI; the next inbound gets no AI; resume (after the escalation) brings it back', async () => {
    await customerSays('Сколько стоит замена масла?')
    await deliverAi(lastJob())
    const conversationId = conv().id
    await createMessage(ctxFor(), conversationId, { direction: 'OUTBOUND', senderType: 'STAFF', content: 'Здравствуйте, это Иван.' })
    expect(conv()).toMatchObject({ aiAutomationPausedReason: 'HUMAN_TAKEOVER' })

    const r = await customerSays('Спасибо! А шиномонтаж?')
    expect(r.aiReplyJob).toBeUndefined()
    expect(db.turns).toHaveLength(1) // no turn for a paused conversation
    expect(aiMessages()).toHaveLength(1)

    await setConversationAiAutomation(ctxFor('t1', 'manager'), conversationId, 'resume')
    expect(conv()).toMatchObject({ aiAutomationPausedAt: null, aiAutomationPausedReason: null })
    await customerSays('Нужен шиномонтаж')
    expect(await deliverAi(lastJob())).toBe('REPLIED')
    expect(aiMessages()).toHaveLength(2)
  })

  it('resume is refused while an escalation is open; pause is explicit and durable', async () => {
    await customerSays('Позовите лучше мастера')
    await deliverAi(lastJob())
    await expect(setConversationAiAutomation(ctxFor(), conv().id, 'resume')).rejects.toMatchObject({ code: 'ESCALATION_ACTIVE' })
    const paused = await setConversationAiAutomation(ctxFor(), conv().id, 'pause')
    expect(paused.aiAutomationPausedReason).toBe('CUSTOMER_REQUESTED_HUMAN') // first reason kept
  })

  it('AD. a staff reply while the AI is generating → the AI reply is NOT sent', async () => {
    await customerSays('Сколько стоит замена масла?')
    hooks.onGenerate = async () => {
      hooks.onGenerate = null
      await createMessage(ctxFor(), conv().id, { direction: 'OUTBOUND', senderType: 'STAFF', content: 'Отвечу сам.' })
    }
    expect(await deliverAi(lastJob())).toBe('SKIPPED')
    expect(aiMessages()).toHaveLength(0)
    expect(db.turns[0]).toMatchObject({ state: 'SKIPPED', reasonCode: 'AUTOMATION_PAUSED' })
  })

  it('AC. the owner switches AI off while it is generating → the reply is NOT sent', async () => {
    await customerSays('Сколько стоит замена масла?')
    hooks.onGenerate = () => {
      db.businesses[0]!.aiAutoReplyEnabled = false
    }
    expect(await deliverAi(lastJob())).toBe('SKIPPED')
    expect(aiMessages()).toHaveLength(0)
    expect(db.turns[0]).toMatchObject({ state: 'SKIPPED', reasonCode: 'AUTOMATION_DISABLED' })
  })

  it('AP. the manual draft still works on a paused conversation and does not resume AI', async () => {
    await customerSays('Сколько стоит замена масла?')
    await setConversationAiAutomation(ctxFor(), conv().id, 'pause')
    const draft = await generateConversationDraft(ctxFor(), conv().id)
    expect(draft.draft).toMatch(/15[   ]000/)
    expect(conv().aiAutomationPausedReason).toBe('OPERATOR_PAUSED')
    expect(aiMessages()).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
describe('loop prevention & rapid messages', () => {
  it('AE/AF/AG. only a genuine channel inbound creates AI work — never AI / SYSTEM / staff / manual messages or delivery updates', async () => {
    await customerSays('Сколько стоит замена масла?')
    await deliverAi(lastJob())
    const turns = db.turns.length
    await createMessage(ctxFor(), conv().id, { direction: 'OUTBOUND', senderType: 'SYSTEM', content: 'служебное' })
    await createMessage(ctxFor(), conv().id, { direction: 'INBOUND', senderType: 'CUSTOMER', content: 'записано вручную' })
    expect(db.turns).toHaveLength(turns)
    expect(await deliverAi({ messageId: aiMessages()[0]!.id })).toBe('NOT_FOUND') // its own reply has no turn
    expect(() => createMessageSchema.parse({ direction: 'OUTBOUND', senderType: 'AI', content: 'подделка' })).toThrow()
  })

  it('AH. two quick messages → one AI reply, using the newest context (the older turn is superseded)', async () => {
    const first = await customerSays('Нужно покрасить капот')
    const second = await customerSays('BMW X5 2018 года')
    const results = await Promise.all([deliverAi({ messageId: first.messageId }), deliverAi({ messageId: second.messageId })].map((p) => p.catch((e) => e)))
    expect(results).toContain('REPLIED')
    expect(aiMessages()).toHaveLength(1)
    expect(turnOf(first.messageId)).toMatchObject({ state: 'SKIPPED', reasonCode: 'SUPERSEDED' })
    expect(aiMessages()[0]!.content).toMatch(/от 40[   ]000 ₸/)
    expect(aiMessages()[0]!.content).not.toMatch(/какого года/) // the year was already given
  })

  it('AH. a message arriving while the AI generates → the stale reply is dropped; the newer turn is BUSY, then answers', async () => {
    const first = await customerSays('Нужно покрасить капот')
    let second: Awaited<ReturnType<typeof customerSays>> | null = null
    hooks.onGenerate = async () => {
      hooks.onGenerate = null
      second = await customerSays('BMW X5 2018 года')
      await expect(deliverAi({ messageId: second.messageId })).rejects.toBeInstanceOf(AiReplyJobRetryError) // BUSY
    }
    expect(await deliverAi({ messageId: first.messageId })).toBe('SKIPPED')
    expect(aiMessages()).toHaveLength(0)
    expect(await deliverAi({ messageId: second!.messageId }, 2)).toBe('REPLIED')
    expect(aiMessages()).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
describe('failures', () => {
  it('AI. provider failure: nothing sent, bounded retries, then handoff (never an error text to the customer)', async () => {
    hooks.providerError = true
    await customerSays('Сколько стоит замена масла?')
    await expect(deliverAi(lastJob(), 1)).rejects.toBeInstanceOf(AiReplyJobRetryError)
    expect(aiMessages()).toHaveLength(0)
    expect(db.turns[0]).toMatchObject({ state: 'FAILED', reasonCode: 'AI_PROVIDER_UNAVAILABLE', attemptCount: 1 })
    await expect(deliverAi(lastJob(), 2)).rejects.toBeInstanceOf(AiReplyJobRetryError)
    expect(await deliverAi(lastJob(), 3)).toBe('HANDED_OFF')
    expect(aiMessages().map((m) => m.content)).toEqual([AI_HANDOFF_NOTICE])
    expect(conv().aiAutomationPausedReason).toBe('AI_FAILURE')
    expect(db.messages.some((m) => /provider|OpenAI|API|error/i.test(m.content))).toBe(false)
  })

  it('AJ. delivery failure → the SAME generated message is retried, never regenerated', async () => {
    await customerSays('Сколько стоит замена масла?', { thread: '77010000000' }) // mock provider rejects …0000
    await expect(deliverAi(lastJob())).rejects.toBeInstanceOf(AiReplyJobRetryError)
    expect(db.turns[0]).toMatchObject({ state: 'FAILED', reasonCode: 'DELIVERY_FAILED' })
    const messageId = db.turns[0]!.replyMessageId
    await expect(deliverAi(lastJob(), 2)).rejects.toBeInstanceOf(AiReplyJobRetryError)
    expect(aiMessages()).toHaveLength(1)
    expect(db.turns[0]!.replyMessageId).toBe(messageId)
    expect(hooks.generateCalls).toBe(1)
    expect(db.deliveries).toEqual([expect.objectContaining({ messageId, status: 'FAILED', attemptCount: 2 })])
  })

  it('a crash while sending (delivery stuck SENDING) → DELIVERY_UNCERTAIN, never resent', async () => {
    await customerSays('Сколько стоит замена масла?')
    hooks.override = null
    // Simulate: the worker created the reply and died mid-send.
    await deliverAi(lastJob())
    const turn = db.turns[0]!
    Object.assign(db.deliveries[0]!, { status: 'SENDING' })
    const stale = new Date(Date.now() - (AI_TURN_STALE_CLAIM_SECONDS + 5) * 1000)
    Object.assign(turn, { state: 'PROCESSING', claimedAt: stale })
    await expect(deliverAi(lastJob(), 2)).rejects.toBeInstanceOf(AiReplyJobRetryError)
    expect(turn).toMatchObject({ state: 'FAILED', reasonCode: 'DELIVERY_UNCERTAIN' })
    expect(await deliverAi(lastJob(), 3)).toBe('SKIPPED')
    expect(db.deliveries).toHaveLength(1)
  })

  it('publish failure keeps the turn PENDING; the internal processor answers it later', async () => {
    queue.fail = true
    const r = await customerSays('Сколько стоит замена масла?')
    expect(r.aiReplyJob).toBe('PUBLISH_FAILED')
    expect(db.turns[0]).toMatchObject({ state: 'PENDING' })
    process.env.RECOVERY_PROCESSOR_SECRET = 'internal-secret'
    try {
      const res = { statusCode: 0, body: undefined as any }
      const api: any = { status: (c: number) => ((res.statusCode = c), api), json: (b: unknown) => ((res.body = b), api) }
      await aiReplyProcessor({ method: 'POST', headers: { authorization: 'Bearer internal-secret' }, body: {}, query: {} } as unknown as ApiRequest, api as ApiResponse)
      expect(res.body).toMatchObject({ ok: true, processed: 1, replied: 1 })
      await aiReplyProcessor({ method: 'POST', headers: {}, body: {}, query: {} } as unknown as ApiRequest, api as ApiResponse)
      expect(res.statusCode).toBe(401)
    } finally {
      delete process.env.RECOVERY_PROCESSOR_SECRET
    }
    expect(aiMessages()).toHaveLength(1)
  })

  it('the retry hook: BUSY / FAILED / crash delays, and gives up after the delivery cap', () => {
    expect(aiReplyJobRetry(new AiReplyJobRetryError('BUSY'), { messageId: 'm', deliveryCount: 1 })).toEqual({ afterSeconds: 20 })
    expect(aiReplyJobRetry(new AiReplyJobRetryError('FAILED'), { messageId: 'm', deliveryCount: 1 })).toEqual({ afterSeconds: 60 })
    expect(aiReplyJobRetry(new Error('crash'), { messageId: 'm', deliveryCount: 1 })).toEqual({ afterSeconds: AI_REPLY_JOB_RETRY_AFTER_SECONDS })
    expect(aiReplyJobRetry(new Error('crash'), { messageId: 'm', deliveryCount: AI_REPLY_JOB_MAX_DELIVERIES })).toEqual({ acknowledge: true })
  })
})

// ---------------------------------------------------------------------------
describe('tenant isolation & payload safety', () => {
  it('AL. a tenant-2 turn runs only in tenant 2 (its services, connection, conversation)', async () => {
    await customerSays('Нужна полировка кузова', { tenantId: 't2', connection: 'wa-2' })
    expect(await deliverAi(lastJob())).toBe('REPLIED')
    const reply = aiMessages()[0]!
    expect(reply).toMatchObject({ tenantId: 't2', businessId: 'b2' })
    expect(reply.content).toMatch(/30[   ]000/)
    expect(reply.content).not.toMatch(/40[   ]000|Кузовная/)
    expect(db.deliveries[0]).toMatchObject({ tenantId: 't2', channelConnectionId: 'wa-2' })
  })

  it.each([
    ['missing id', {}],
    ['not a uuid', { messageId: "1' OR 1=1" }],
    ['garbage', 'xx'],
    ['AO. tenant/business in the payload', { messageId: randomUUID(), tenantId: 't2', businessId: 'b2' }],
  ])('AM/AO. %s → INVALID_PAYLOAD, acknowledged, no database access', async (_label, payload) => {
    const spy = vi.spyOn(fakePrisma, '$queryRaw')
    expect(await deliverAi(payload)).toBe('INVALID_PAYLOAD')
    expect(spy).not.toHaveBeenCalled()
  })

  it('AN. a well-formed id with no turn → NOT_FOUND, nothing written', async () => {
    expect(await deliverAi({ messageId: randomUUID() })).toBe('NOT_FOUND')
    expect(db.messages).toHaveLength(0)
  })

  it('vercel.json wires the consumer to the topic with the delays/cap the code assumes', () => {
    const config = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../vercel.json'), 'utf-8'))
    const fn = 'api/queues/ai-conversation-reply.ts'
    expect(fs.existsSync(path.resolve(__dirname, '..', fn))).toBe(true)
    expect(config.functions[fn].experimentalTriggers).toEqual([
      { type: 'queue/v2beta', topic: AI_REPLY_QUEUE_TOPIC, retryAfterSeconds: AI_REPLY_JOB_RETRY_AFTER_SECONDS, maxDeliveries: AI_REPLY_JOB_MAX_DELIVERIES },
    ])
  })
})

// ---------------------------------------------------------------------------
describe('vertical slice: missed call → recovery → customer reply → AI administrator', () => {
  it('missed call → SYSTEM recovery message → «Нужно покрасить капот и крышу BMW X5» → grounded AI reply → availability → «Позовите лучше мастера» → handoff', async () => {
    const recoveryJobs: RecoveryJob[] = []
    setRecoveryJobPublisher({ kind: 'test', publish: async (job) => (recoveryJobs.push(job), { status: 'PUBLISHED', messageId: 'r1' }) })

    // 1. MCR-2 + MCR-4.1 + MCR-4: the missed call is recovered with the deterministic SYSTEM message.
    const call = await ingestCallEvent({ provider: 'mock', providerEventId: 'ev-1', providerCallId: 'pc-1', eventType: 'MISSED', direction: 'INBOUND', callerPhone: '8 701 123 45 67', calledPhone: '+77272500000', occurredAt: null, wasAnswered: null })
    expect(call.recoveryState).toBe('READY')
    expect(await handleRecoveryJob(recoveryJobs[0], { messageId: 'r1', deliveryCount: 1 })).toBe('SENT')
    const recovery = db.messages.find((m) => m.senderType === 'SYSTEM')!
    expect(recovery.content).toContain('Вы только что звонили')
    expect(db.turns).toHaveLength(0) // the SYSTEM message never triggers AI

    // 2. The customer replies in the same WhatsApp thread.
    const reply = await customerSays('Нужно покрасить капот и крышу BMW X5', { thread: THREAD })
    expect(reply.conversationId).toBe(recovery.conversationId)
    expect(await deliverAi(lastJob())).toBe('REPLIED')
    const answer = aiMessages()[0]!.content
    expect(answer).toMatch(/^Да, «Кузовная покраска» у нас делают\./)
    expect(answer).toMatch(/от 40[   ]000 ₸/)
    expect(answer).toMatch(/осмотр/)
    expect(answer).toMatch(/BMW X5 какого года\?$/)
    expect((answer.match(/\?/g) ?? []).length).toBe(1) // one small question, not a questionnaire
    expect(answer).not.toMatch(/неисправ|диагноз|итого|окончательн/i)

    // 3. Availability — real slots only, no booking.
    await customerSays('А завтра после трех можно?', { thread: THREAD })
    expect(await deliverAi(lastJob())).toBe('REPLIED')
    const slots = aiMessages()[1]!.content
    const real = await checkAvailability(ctxFor(), { serviceId: PAINT, date: '2026-10-06', preferredTimeFrom: '15:00', preferredTimeTo: null } as any)
    expect([...slots.matchAll(/\b\d{2}:\d{2}\b/g)].map((m) => m[0])).toEqual(real.slots.slice(0, 3).map((s) => s.localStart))

    // 4. «Позовите лучше мастера» → escalation + pause; no further automatic replies.
    await customerSays('Позовите лучше мастера', { thread: THREAD })
    expect(await deliverAi(lastJob())).toBe('HANDED_OFF')
    expect(db.escalations).toEqual([expect.objectContaining({ status: 'OPEN', conversationId: recovery.conversationId })])
    expect(conv(recovery.conversationId).aiAutomationPausedReason).toBe('CUSTOMER_REQUESTED_HUMAN')
    const after = await customerSays('Алло?', { thread: THREAD })
    expect(after.aiReplyJob).toBeUndefined()
    expect(aiMessages().map((m) => m.senderType)).toEqual(['AI', 'AI', 'AI'])
    expect(sentAiDeliveries()).toHaveLength(3)

    // Every automatic action is auditable by its triggering inbound message.
    expect(db.aiLogs.filter((l) => l.operation === 'AI_ANALYZE' && l.metadata?.mode === 'auto_reply').map((l) => l.outcome)).toEqual(['SUCCESS', 'SUCCESS', 'ESCALATED'])
    expect(await processAiTurn(randomUUID())).toBe('NOT_FOUND')
  })
})
