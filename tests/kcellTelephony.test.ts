import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { randomUUID } from 'node:crypto'
import type { ApiRequest, ApiResponse } from '../src/server/types/http'

// ---------------------------------------------------------------------------
// MCR-8A — production telephony: Kcell Virtual PBX CRM API. The REAL Kcell
// webhook route + service + adapter, the REAL MCR-2 intake (state machine,
// customer link, routing by the called number), the REAL MCR-4.1 job publish
// path and the REAL MCR-4/6/7A recovery engine → router → Mobizon SMS bridge
// run on an in-memory Prisma double. Kcell callbacks are posted as the PBX
// documents them (form fields, crm_token in the body). No test reaches Kcell,
// Mobizon or Twilio — every provider is an in-process fake.
// ---------------------------------------------------------------------------

type Row = Record<string, any>
const { db, trapHits, hooks, fakePrisma, trap } = vi.hoisted(() => {
  const names = ['tenants', 'businesses', 'conversations', 'messages', 'channelMessages', 'calls', 'consents', 'links', 'deliveries', 'connections', 'numbers', 'turns', 'webhookEvents', 'escalations', 'aiLogs', 'hours', 'customers', 'identities', 'callEvents', 'telephonyConnections'] as const
  const db = Object.fromEntries(names.map((t) => [t, [] as Row[]])) as Record<(typeof names)[number], Row[]> & Record<string, Row[]>
  const trapHits: string[] = []
  const hooks = { uniqueError: (msg: string): Error => new Error(msg), generateCalls: 0 }

  function matchValue(value: any, cond: any): boolean {
    if (cond === null) return value === null || value === undefined
    if (cond instanceof Date) return value instanceof Date && value.getTime() === cond.getTime()
    if (typeof cond !== 'object' || Array.isArray(cond)) return value === cond
    return Object.entries(cond).every(([op, arg]: [string, any]) => {
      if (op === 'not') return arg === null ? value !== null && value !== undefined : !matchValue(value, arg)
      if (op === 'in') return arg.includes(value)
      if (op === 'lt') return value != null && value < arg
      if (op === 'gt') return value != null && value > arg
      if (op === 'gte') return value != null && value >= arg
      return false
    })
  }
  const relations: Record<string, Record<string, (row: Row, cond: any) => boolean>> = {
    messages: {
      channelMessage: (row, cond) => {
        const has = db.channelMessages.some((cm) => cm.messageId === row.id)
        return cond?.isNot === null ? has : !has
      },
      conversation: (row, cond) => {
        const conv = db.conversations.find((c) => c.id === row.conversationId)
        return !!conv && matches(conv, cond)
      },
    },
    links: {
      callInteraction: (row, cond) => {
        const call = db.calls.find((c) => c.id === row.callInteractionId)
        return !!call && matches(call, cond)
      },
    },
  }
  function matches(row: Row, where: any, table?: string): boolean {
    return Object.entries(where ?? {}).every(([key, cond]: [string, any]) => {
      if (key === 'OR') return cond.some((w: any) => matches(row, w, table))
      if (key === 'NOT') return !matches(row, cond, table)
      const rel = table ? relations[table]?.[key] : undefined
      if (rel) return rel(row, cond)
      return matchValue(row[key], cond)
    })
  }
  const clone = <T,>(v: T): T => structuredClone(v)
  function apply(row: Row, data: Row) {
    for (const [k, v] of Object.entries(data)) {
      if (v === undefined) continue
      row[k] = v && typeof v === 'object' && !(v instanceof Date) && 'increment' in v ? row[k] + v.increment : v
    }
    row.updatedAt = new Date()
  }
  function flat(where: Row): Row {
    const out: Row = {}
    for (const [k, v] of Object.entries(where ?? {})) {
      if (k.includes('_') && v && typeof v === 'object' && !(v instanceof Date)) Object.assign(out, v)
      else out[k] = v
    }
    return out
  }
  function model(table: string, defaults: () => Row = () => ({}), uniques: string[][] = []) {
    const rows = () => db[table] as Row[]
    const violates = (row: Row, except?: Row) =>
      uniques.some((cols) => cols.every((c) => row[c] != null) && rows().some((r) => r !== except && cols.every((c) => r[c] === row[c])))
    const sort = (list: Row[], orderBy: any) => {
      const [k, dir] = orderBy ? (Object.entries(Array.isArray(orderBy) ? orderBy[0] : orderBy)[0] as [string, string]) : ['', 'asc']
      return k ? [...list].sort((a, b) => (a[k] < b[k] ? -1 : a[k] > b[k] ? 1 : 0) * (dir === 'asc' ? 1 : -1)) : list
    }
    const self: any = {
      findFirst: async ({ where, orderBy }: any = {}) => {
        const found = sort(rows().filter((r) => matches(r, flat(where), table)), orderBy)[0]
        return found ? clone(found) : null
      },
      findFirstOrThrow: async (args: any) => (await self.findFirst(args)) ?? Promise.reject(new Error(`${table} not found`)),
      findUnique: async ({ where }: any) => self.findFirst({ where }),
      findUniqueOrThrow: async ({ where }: any) => self.findFirstOrThrow({ where }),
      findMany: async ({ where, orderBy, take }: any = {}) => {
        const list = sort(rows().filter((r) => matches(r, where, table)), orderBy)
        return clone(take ? list.slice(0, take) : list)
      },
      count: async ({ where }: any = {}) => rows().filter((r) => matches(r, where, table)).length,
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
        const row = rows().find((r) => matches(r, flat(where), table))
        if (!row) throw new Error(`${table} not found for update`)
        const next = { ...row }
        apply(next, data)
        if (violates(next, row)) throw hooks.uniqueError(`Unique constraint failed on ${table}`)
        Object.assign(row, next)
        return clone(row)
      },
      updateMany: async ({ where, data }: any) => {
        const list = rows().filter((r) => matches(r, where, table))
        for (const row of list) {
          const next = { ...row }
          apply(next, data)
          if (violates(next, row)) throw hooks.uniqueError(`Unique constraint failed on ${table}`)
          Object.assign(row, next)
        }
        return { count: list.length }
      },
      upsert: async ({ where, create, update }: any) => {
        const row = rows().find((r) => matches(r, flat(where), table))
        if (row) {
          apply(row, update)
          return clone(row)
        }
        return self.create({ data: create })
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
    $queryRaw: async (sql: { strings: string[]; values: unknown[] }) => {
      const text = sql.strings.join('?')
      const table = text.includes('ai_conversation_turns') ? 'turns' : text.includes('call_interactions') ? 'calls' : text.includes('"conversations"') ? 'conversations' : null
      const col = text.includes('"inboundMessageId"') ? 'inboundMessageId' : 'id'
      const found = table ? (db[table] as Row[]).find((r) => r[col] === sql.values[0]) : null
      return found ? [{ id: found.id }] : []
    },
    $executeRaw: async () => 1,
    tenant: model('tenants'),
    business: model('businesses'),
    businessWorkingHours: model('hours'),
    callInteraction: model('calls'),
    businessPhoneNumber: model('numbers'),
    telephonyConnection: model('telephonyConnections', () => ({ status: 'ACTIVE', disabledAt: null, connectedAt: new Date() }), [['businessId', 'provider']]),
    channelConnection: model('connections', () => ({ provider: null, senderE164: null, routingKey: null, config: null }), [['routingKey']]),
    conversation: model(
      'conversations',
      () => ({ status: 'OPEN', customerId: null, customerRequestId: null, subject: null, closedAt: null, lastMessageAt: null, aiAutomationPausedAt: null, aiAutomationPausedReason: null, aiAutomationResumedAt: null }),
      [['channelConnectionId', 'externalConversationId']]
    ),
    message: model('messages'),
    channelMessage: model('channelMessages', () => ({}), [['channelConnectionId', 'externalMessageId']]),
    channelConsent: model('consents', () => ({ revokedAt: null }), [['tenantId', 'businessId', 'channel', 'destinationE164']]),
    recoveryBridgeLink: model('links', () => ({ revokedAt: null, firstOpenedAt: null, lastOpenedAt: null, openCount: 0, whatsappInboundAt: null }), [['tokenHash'], ['callInteractionId']]),
    channelDelivery: model(
      'deliveries',
      () => ({ status: 'PENDING', attemptCount: 0, lastAttemptAt: null, deliveredAt: null, failedAt: null, errorCode: null, errorMessage: null, externalMessageId: null, provider: null, providerDeliveryState: null, providerStatus: null, providerStatusAt: null, providerSegments: null }),
      [['channelConnectionId', 'messageId']]
    ),
    providerWebhookEvent: model('webhookEvents', () => ({ channelDeliveryId: null }), [['provider', 'eventId']]),
    aiConversationTurn: model(
      'turns',
      () => ({ state: 'PENDING', decision: null, reasonCode: null, attemptCount: 0, claimedAt: null, completedAt: null, replyMessageId: null, escalationId: null }),
      [['inboundMessageId'], ['replyMessageId']]
    ),
    aiEscalation: model('escalations', () => ({ assignedUserId: null, resolvedAt: null }), [['tenantId', 'businessId', 'activeConversationId']]),
    aiLog: model('aiLogs'),
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
  return {
    getAiProvider: () => ({
      async generate(req: any) {
        hooks.generateCalls++
        return new MockAiProvider().generate(req)
      },
    }),
  }
})
vi.mock('../src/server/repositories/businessRepository', () => ({
  businessRepository: { findFirstByTenant: async (t: string) => structuredClone(db.businesses.find((b) => b.tenantId === t) ?? null) },
}))
vi.mock('../src/server/db/prisma', () => ({ prisma: fakePrisma }))
vi.mock('../src/server/ai/aiProviderFactory', () => ({ getAiProvider: () => trap('aiProvider') }))
vi.mock('../src/server/repositories/businessRepository', () => ({
  businessRepository: { findFirstByTenant: async (t: string) => structuredClone(db.businesses.find((b) => b.tenantId === t) ?? null) },
}))
vi.mock('../src/server/repositories/businessPhoneNumberRepository', () => ({
  isActiveNumberConflict: () => false,
  businessPhoneNumberRepository: {
    findActiveByPhoneE164ForRouting: async (e164: string) => structuredClone(db.numbers.find((n) => n.phoneE164 === e164 && n.isActive) ?? null),
    listByBusiness: async (t: string, b: string) => structuredClone(db.numbers.filter((n) => n.tenantId === t && n.businessId === b)),
  },
}))
// A faithful double of the MCR-2 repository: one call per (provider, providerCallId),
// one CallEvent per (provider, providerEventId) — the idempotency the database enforces.
vi.mock('../src/server/repositories/callInteractionRepository', () => ({
  callInteractionRepository: {
    insertIfAbsent: async (data: Row) => {
      if (db.calls.some((c) => c.provider === data.provider && c.providerCallId === data.providerCallId)) return
      db.calls.push({
        id: randomUUID(), outcome: 'IN_PROGRESS', startedAt: null, answeredAt: null, endedAt: null, outcomeDetectedAt: null, recoveryIneligibleReason: null,
        recoveryClaimedAt: null, recoverySentAt: null, recoveryAttemptCount: 0, recoveryFailureCode: null, recoveryTemplateKey: null,
        recoveryConversationId: null, recoveryMessageId: null, recoveryChannel: null, recoveryRouteReason: null, outcomeConflictAt: null, createdAt: new Date(), updatedAt: new Date(), ...data,
      })
    },
    lockByProviderCall: async (p: string, id: string) => structuredClone(db.calls.find((c) => c.provider === p && c.providerCallId === id) ?? null),
    insertEventIfAbsent: async (data: Row) => {
      if (db.callEvents.some((e) => e.provider === data.provider && e.providerEventId === data.providerEventId)) return false
      db.callEvents.push({ id: randomUUID(), ...data })
      return true
    },
    update: async (id: string, data: Row) => structuredClone(Object.assign(db.calls.find((c) => c.id === id)!, data, { updatedAt: new Date() })),
  },
}))
vi.mock('../src/server/repositories/customerChannelIdentityRepository', () => ({
  customerChannelIdentityRepository: {
    findByConnectionAndExternalCustomerId: async () => null,
    create: async (data: Row) => (db.identities.push(data), data),
  },
}))
vi.mock('../src/server/repositories/serviceRepository', () => ({
  serviceRepository: trap('serviceRepository', {
    listByBusiness: async (t: string, b: string) => [
      { id: '22222222-2222-4222-8222-222222222222', tenantId: t, businessId: b, name: 'Замена масла', description: null, priceFrom: 15000, priceTo: 15000, currency: 'KZT', priceNote: null, requiresInspection: false, durationMinutes: 60, isActive: true },
    ],
  }),
}))
vi.mock('../src/server/repositories/knowledgeRepository', () => ({ knowledgeRepository: { listByBusiness: async () => [] } }))
vi.mock('../src/server/repositories/businessRuleRepository', () => ({ businessRuleRepository: { listByBusiness: async () => [] } }))
vi.mock('../src/server/repositories/appointmentRepository', () => ({
  CONFLICT_BLOCKING_STATUSES: ['SCHEDULED', 'CONFIRMED', 'IN_PROGRESS'],
  appointmentRepository: trap('appointmentRepository', { list: async () => ({ items: [], total: 0 }) }),
}))
// Never a Customer / Vehicle / Request write.
vi.mock('../src/server/repositories/customerRepository', () => ({
  customerRepository: trap('customerRepository', {
    findActiveByPhoneE164: async (t: string, b: string, e164: string) => db.customers.filter((c) => c.tenantId === t && c.businessId === b && c.phoneE164 === e164).map((c) => ({ id: c.id })),
    findById: async () => null,
  }),
}))
vi.mock('../src/server/repositories/vehicleRepository', () => ({ vehicleRepository: trap('vehicleRepository', { list: async () => ({ items: [], total: 0 }) }) }))
vi.mock('../src/server/repositories/customerRequestRepository', () => ({ customerRequestRepository: trap('customerRequestRepository') }))
vi.mock('../src/server/repositories/serviceRecordRepository', () => ({ serviceRecordRepository: trap('serviceRecordRepository') }))


import { Prisma } from '@prisma/client'
import { makeAuthContext, makeBusiness, makeTenant } from './helpers/fixtures'
import { setRecoveryJobPublisher, type RecoveryJob } from '../src/server/recovery/recoveryJobs'
import { handleRecoveryJob } from '../src/server/recovery/recoveryJobConsumer'
import { setMobizonFetchForTests } from '../src/server/channels/smsTransport'
import type { FetchLike } from '../src/server/channels/adapters/mobizon/mobizonClient'
import { env } from '../src/server/lib/env'
import { applyCallEvent } from '../src/server/telephony/callStateMachine'
import {
  createKcellTelephonyAdapter, kcellBusinessForToken, kcellNumber, mapKcellEvent, mapKcellHistory, parseKcell, parseKcellTime,
} from '../src/server/telephony/adapters/kcell/kcellTelephonyAdapter'
import { connectKcell, disconnectKcell, telephonyStatus } from '../src/server/services/kcellConnectionService'
import { telephonyView } from '../src/components/channels/recoverySetup'
import kcellRoute from '../api/webhooks/telephony/kcell'

// --- constants ---------------------------------------------------------------
const B1 = '0b1b1b1b-1111-4111-8111-111111111111'
const B2 = '0b2b2b2b-2222-4222-8222-222222222222'
const TOKEN_1 = 'kcell-crm-token-business-one-7f3a9c1e'
const TOKEN_2 = 'kcell-crm-token-business-two-2d8b4e6f'
const NUMBER_1 = '77272500000' // as Kcell sends it (no "+")
const NUMBER_2 = '77172500000'
const CALLER = '77011234567'
const RECORDING = 'https://records.kcell.test/rec-123.mp3'
const NOW = new Date('2026-10-05T05:00:00Z')
let CALL = 'B10D0EB124F4E64AF4EA-1511'

// --- Kcell callbacks (form fields, exactly as documented) ----------------------------
const event = (type: string, over: Record<string, string> = {}) => ({ cmd: 'event', type, direction: 'in', phone: CALLER, diversion: NUMBER_1, user: 'andy', callid: CALL, crm_token: TOKEN_1, ...over })
const history = (status: string, over: Record<string, string> = {}) => ({
  cmd: 'history', type: 'in', status, phone: CALLER, diversion: NUMBER_1, user: 'andy', start: '20261005T045800Z', duration: '35', callid: CALL, link: RECORDING, crm_token: TOKEN_1, ...over,
})
async function kcell(body: unknown) {
  const res = { statusCode: 0, body: undefined as unknown }
  const api: any = { status: (c: number) => ((res.statusCode = c), api), json: (b: unknown) => ((res.body = b), api) }
  await kcellRoute({ method: 'POST', url: '/api/webhooks/telephony/kcell', headers: {}, query: {}, body } as unknown as ApiRequest, api as ApiResponse)
  return res
}
const tick = (ms: number) => vi.setSystemTime(new Date(Date.now() + ms))

// --- the recovery side: captured jobs, the real consumer, a fake Mobizon -------------
const jobs: RecoveryJob[] = []
const mobizonRequests: URLSearchParams[] = []
const mobizonFetch: FetchLike = async (_url, init) => {
  mobizonRequests.push(new URLSearchParams(init.body))
  return { status: 200, text: async () => JSON.stringify({ code: 0, data: { campaignId: 1, messageId: 9000 + mobizonRequests.length, status: 2 }, message: '' }) }
}
/** Deliver every published job (at-least-once: duplicates included) to the real consumer. */
async function drainJobs() {
  const out = []
  for (const [i, job] of jobs.splice(0).entries()) out.push(await handleRecoveryJob(job, { messageId: `q-${i}`, deliveryCount: 1 }).catch((e) => e))
  return out
}
const call = () => db.calls.find((c) => c.providerCallId === CALL)
const connection = (id: string, over: Row): Row => ({ id, status: 'ACTIVE', displayName: id, externalAccountId: id, config: null, provider: null, senderE164: null, routingKey: null, createdAt: new Date(0), updatedAt: new Date(0), ...over })

const ENV = { APP_URL: 'https://app.autoservise.test', KCELL_CRM_TOKENS: `${B1}=${TOKEN_1},${B2}=${TOKEN_2}`, SMS_PROVIDER: 'mobizon', MOBIZON_API_KEY: 'mobizon-key' }
const logs: string[] = []

beforeEach(() => {
  CALL = 'B10D0EB124F4E64AF4EA-1511'
  trapHits.length = 0
  hooks.uniqueError = (msg: string) => new Prisma.PrismaClientKnownRequestError(msg, { code: 'P2002', clientVersion: 'test' })
  for (const t of ['conversations', 'messages', 'channelMessages', 'calls', 'callEvents', 'consents', 'links', 'deliveries', 'turns', 'webhookEvents', 'escalations', 'aiLogs', 'customers', 'identities']) db[t] = []
  db.tenants = [makeTenant({ id: 't1' }), makeTenant({ id: 't2' })]
  db.businesses = [
    makeBusiness({ id: B1, tenantId: 't1', name: 'Автосервис Тест', timezone: 'Asia/Almaty', currency: 'KZT', phoneRegion: 'KZ' }),
    makeBusiness({ id: B2, tenantId: 't2', name: 'Другой сервис', timezone: 'Asia/Almaty', currency: 'KZT', phoneRegion: 'KZ' }),
  ]
  db.hours = []
  db.numbers = [
    { id: 'n1', tenantId: 't1', businessId: B1, phoneE164: `+${NUMBER_1}`, isActive: true },
    { id: 'n2', tenantId: 't2', businessId: B2, phoneE164: `+${NUMBER_2}`, isActive: true },
  ]
  db.telephonyConnections = [
    { id: 'tc1', tenantId: 't1', businessId: B1, provider: 'kcell', status: 'ACTIVE', connectedAt: new Date(0), disabledAt: null },
    { id: 'tc2', tenantId: 't2', businessId: B2, provider: 'kcell', status: 'ACTIVE', connectedAt: new Date(0), disabledAt: null },
  ]
  db.connections = [
    connection('sms-1', { tenantId: 't1', businessId: B1, type: 'SMS' }),
    connection('wa-1', { tenantId: 't1', businessId: B1, type: 'WHATSAPP', config: { customerEntryPhone: '+77272500100' } }),
    connection('sms-2', { tenantId: 't2', businessId: B2, type: 'SMS' }),
    connection('wa-2', { tenantId: 't2', businessId: B2, type: 'WHATSAPP', config: { customerEntryPhone: '+77172500100' } }),
  ]
  jobs.length = 0
  mobizonRequests.length = 0
  setMobizonFetchForTests(mobizonFetch)
  setRecoveryJobPublisher({ kind: 'test', publish: async (job) => (jobs.push(job), { status: 'PUBLISHED', messageId: 'x' }) })
  Object.assign(process.env, ENV)
  logs.length = 0
  for (const level of ['log', 'warn', 'error'] as const) vi.spyOn(console, level).mockImplementation((...args: unknown[]) => void logs.push(args.map(String).join(' ')))
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})
afterEach(() => {
  vi.useRealTimers()
  setMobizonFetchForTests(null)
  setRecoveryJobPublisher(null)
  for (const key of Object.keys(ENV)) delete process.env[key]
  expect(trapHits).toEqual([]) // no Customer / Vehicle / Request / Appointment write, no AI — in every test
  for (const line of logs) {
    expect(line).not.toContain(TOKEN_1)
    expect(line).not.toContain(TOKEN_2)
    expect(line).not.toContain(CALLER) // the full caller number is never logged
    expect(line).not.toContain(RECORDING)
  }
})

// ---------------------------------------------------------------------------
describe('Kcell contract: configuration, parsing, mapping', () => {
  it('tokens: one per business; short / malformed / shared tokens are dropped; constant-time lookup', () => {
    process.env.KCELL_CRM_TOKENS = `${B1}=${TOKEN_1}, ${B2}=short, not-a-uuid=${TOKEN_2}, ${B2}=${TOKEN_1}`
    expect(env.kcellCrmTokens).toEqual([]) // TOKEN_1 listed for two businesses → never guessed between
    process.env.KCELL_CRM_TOKENS = `${B1}=${TOKEN_1},${B1}=${TOKEN_1}-rotated-new`
    expect(env.kcellCrmTokens.map((e) => e.businessId)).toEqual([B1, B1]) // rotation: two tokens, one business
    expect(kcellBusinessForToken(`${TOKEN_1}-rotated-new`)).toBe(B1)
    expect(kcellBusinessForToken(TOKEN_2)).toBeNull()
    expect(kcellBusinessForToken(undefined)).toBeNull()
    expect(kcellBusinessForToken('')).toBeNull()
  })

  it('numbers and times exactly as documented ("79101234567", "20170703T121110Z")', () => {
    expect(kcellNumber('77011234567')).toBe('+77011234567')
    expect(kcellNumber('87011234567')).toBe('87011234567') // national trunk form: left for region normalization
    expect(kcellNumber('+77011234567')).toBe('+77011234567')
    expect(kcellNumber('')).toBeNull()
    expect(parseKcellTime('20170703T121110Z')).toEqual(new Date('2017-07-03T12:11:10Z'))
    expect(parseKcellTime('20170231T121110Z')).toBeNull()
    expect(parseKcellTime('2017-07-03 12:11')).toBeNull()
  })

  it('event mapping: CANCELLED / TRANSFERRED / unknown make NO outcome claim', () => {
    expect(mapKcellEvent('INCOMING')).toEqual({ eventType: 'RINGING', wasAnswered: null })
    expect(mapKcellEvent('ACCEPTED')).toEqual({ eventType: 'ANSWERED', wasAnswered: null })
    expect(mapKcellEvent('COMPLETED')).toEqual({ eventType: 'COMPLETED', wasAnswered: true })
    expect(mapKcellEvent('CANCELLED')).toEqual({ eventType: 'OBSERVED', wasAnswered: null })
    expect(mapKcellEvent('TRANSFERRED')).toEqual({ eventType: 'OBSERVED', wasAnswered: null })
    expect(mapKcellEvent('SOMETHING_NEW')).toEqual({ eventType: 'OBSERVED', wasAnswered: null })
  })

  it('history mapping: Success answered; Missed / Cancel missed; outbound-only statuses never inbound leads', () => {
    expect(mapKcellHistory('Success', 'INBOUND')).toEqual({ eventType: 'COMPLETED', wasAnswered: true })
    expect(mapKcellHistory('Missed', 'INBOUND')).toEqual({ eventType: 'COMPLETED', wasAnswered: false })
    expect(mapKcellHistory('missed', 'INBOUND')).toEqual({ eventType: 'COMPLETED', wasAnswered: false })
    expect(mapKcellHistory('Cancel', 'INBOUND')).toEqual({ eventType: 'COMPLETED', wasAnswered: false })
    expect(mapKcellHistory('Busy', 'OUTBOUND')).toEqual({ eventType: 'COMPLETED', wasAnswered: false })
    expect(mapKcellHistory('Busy', 'INBOUND')).toEqual({ eventType: 'OBSERVED', wasAnswered: null })
    expect(mapKcellHistory('Whatever', 'INBOUND')).toEqual({ eventType: 'OBSERVED', wasAnswered: null })
  })

  it('parse: callid is the call id; fingerprint deterministic (never time/random); history times; no token / link / user in the result', () => {
    const h = parseKcell(history('Missed'))
    expect(h).toMatchObject({
      provider: 'kcell', providerCallId: CALL, direction: 'INBOUND', eventType: 'COMPLETED', wasAnswered: false,
      callerPhone: '+77011234567', calledPhone: '+77272500000', providerStatus: 'history:in:Missed',
      callStartedAt: new Date('2026-10-05T04:58:00Z'), callEndedAt: new Date('2026-10-05T04:58:35Z'), occurredAt: new Date('2026-10-05T04:58:35Z'),
    })
    tick(5000)
    expect(parseKcell(history('Missed')).providerEventId).toBe(h.providerEventId) // a redelivery is the same event
    expect(parseKcell(history('Missed', { link: 'https://other' })).providerEventId).toBe(h.providerEventId) // the link is not identity
    expect(parseKcell(event('CANCELLED')).providerEventId).not.toBe(parseKcell(event('CANCELLED', { user: 'bob' })).providerEventId) // legs differ
    expect(JSON.stringify(h)).not.toMatch(/crm|token|records\.kcell|andy/)
    expect(parseKcell(event('INCOMING', { phone: 'anonymous' })).callerPhone).toBeNull()
    expect(() => parseKcell(event('INCOMING', { callid: '' }))).toThrow()
    expect(() => parseKcell(history('Missed', { type: 'sideways' }))).toThrow()
    expect(parseKcell(event('OUTGOING', { direction: 'out' }))).toMatchObject({ direction: 'OUTBOUND', callerPhone: '+77272500000', calledPhone: '+77011234567' })
  })

  it('TelephonyAdapter boundary: verify → the token’s business; parse → normalized; OBSERVED changes nothing in the state machine', () => {
    const adapter = createKcellTelephonyAdapter()
    expect(adapter.verify({ headers: {}, body: event('INCOMING') })).toEqual({ ok: true, accountBusinessId: B1 })
    expect(adapter.verify({ headers: {}, body: event('INCOMING', { crm_token: 'x'.repeat(30) }) })).toEqual({ ok: false })
    expect(adapter.verify({ headers: {}, body: `cmd=event&crm_token=${TOKEN_2}` })).toEqual({ ok: true, accountBusinessId: B2 }) // raw form body
    expect(adapter.parse(history('Missed')).providerCallId).toBe(CALL)
    const state = { direction: 'INBOUND' as const, remotePhoneE164: '+77011234567', outcome: 'IN_PROGRESS' as const, startedAt: null, answeredAt: null, endedAt: null, outcomeDetectedAt: null }
    expect(applyCallEvent(state, { eventType: 'OBSERVED', wasAnswered: null, occurredAt: NOW }, NOW)).toEqual(state)
  })
})

// ---------------------------------------------------------------------------
describe('authentication & routing (before any write)', () => {
  it('missing / wrong token, no tokens configured, inactive connection → 401 and nothing written', async () => {
    const { crm_token: _omit, ...noToken } = history('Missed')
    for (const body of [noToken, history('Missed', { crm_token: 'kcell-crm-token-business-one-WRONG' }), history('Missed', { crm_token: TOKEN_1.toUpperCase() })]) {
      expect(await kcell(body)).toEqual({ statusCode: 401, body: { error: 'Invalid token' } })
    }
    delete process.env.KCELL_CRM_TOKENS
    expect((await kcell(history('Missed'))).statusCode).toBe(401) // unconfigured → closed, never mock
    process.env.KCELL_CRM_TOKENS = ENV.KCELL_CRM_TOKENS
    db.telephonyConnections[0]!.status = 'DISABLED'
    expect((await kcell(history('Missed'))).statusCode).toBe(401)
    expect(db.calls).toHaveLength(0)
    expect(db.callEvents).toHaveLength(0)
    expect(jobs).toHaveLength(0)
  })

  it('a valid token for ANOTHER business, or an unknown called number → 200 {}, nothing written, nothing revealed', async () => {
    const foreign = await kcell(history('Missed', { crm_token: TOKEN_2 })) // B2's token, B1's number
    const unknown = await kcell(history('Missed', { diversion: '77172999999' }))
    expect(foreign).toEqual({ statusCode: 200, body: {} })
    expect(unknown).toEqual(foreign) // indistinguishable
    expect(db.calls).toHaveLength(0)
    expect(db.callEvents).toHaveLength(0)
    expect(jobs).toHaveLength(0)
  })

  it('cmd=contact → 200 {} (no customer data leaves); unknown cmd / bad payload → 400 Invalid parameters', async () => {
    db.customers = [{ id: 'c1', tenantId: 't1', businessId: B1, phoneE164: '+77011234567' }]
    expect(await kcell({ cmd: 'contact', phone: CALLER, callid: CALL, crm_token: TOKEN_1 })).toEqual({ statusCode: 200, body: {} })
    expect(await kcell({ cmd: 'rating', callid: CALL, crm_token: TOKEN_1 })).toEqual({ statusCode: 400, body: { error: 'Invalid parameters' } })
    expect((await kcell(history('Missed', { callid: '' }))).statusCode).toBe(400)
    expect((await kcell(['not', 'an', 'object'])).statusCode).toBe(400)
    expect(db.calls).toHaveLength(0)
  })

  it('payload tenant/business hints are ignored: the called number alone routes (two businesses, same caller)', async () => {
    await kcell(history('Missed', { tenantId: 't2', businessId: B2 }))
    CALL = 'C20000000000000000000-2222'
    await kcell(history('Missed', { diversion: NUMBER_2, crm_token: TOKEN_2, tenantId: 't1', businessId: B1 }))
    expect(db.calls.map((c) => [c.tenantId, c.businessId, c.businessPhoneNumberId])).toEqual([['t1', B1, 'n1'], ['t2', B2, 'n2']])
    expect(db.calls.every((c) => c.remotePhoneE164 === '+77011234567')).toBe(true)
    expect(jobs).toHaveLength(2)
    expect(await drainJobs()).toEqual(['SENT', 'SENT']) // each workshop recovers its own caller
    expect(db.deliveries.map((d) => d.tenantId).sort()).toEqual(['t1', 't2'])
  })

  it('a number-less callback (diversion is optional on events) only reaches an ALREADY known call of this business', async () => {
    const { diversion: _d, ...noNumber } = event('ACCEPTED')
    expect(await kcell(noNumber)).toEqual({ statusCode: 200, body: {} })
    expect(db.calls).toHaveLength(0)
    await kcell(event('INCOMING'))
    await kcell(noNumber)
    expect(call()).toMatchObject({ outcome: 'ANSWERED', recoveryState: 'NOT_ELIGIBLE' })
    // …and never another business's call with the same callid
    const { diversion: _d2, ...foreign } = event('COMPLETED', { crm_token: TOKEN_2 })
    await kcell(foreign)
    expect(db.callEvents).toHaveLength(2)
  })
})

// ---------------------------------------------------------------------------
describe('vertical slices', () => {
  it('missed: INCOMING → CANCELLED (no premature recovery) → history Missed → READY → one job → SMS bridge', async () => {
    expect(await kcell(event('INCOMING'))).toEqual({ statusCode: 200, body: {} })
    expect(db.calls).toHaveLength(1)
    expect(call()).toMatchObject({ provider: 'kcell', providerCallId: CALL, tenantId: 't1', businessId: B1, direction: 'INBOUND', remotePhoneE164: '+77011234567', outcome: 'IN_PROGRESS', recoveryState: 'PENDING' })
    tick(20_000)
    await kcell(event('CANCELLED'))
    expect(call()).toMatchObject({ outcome: 'IN_PROGRESS', recoveryState: 'PENDING' }) // CANCELLED ≠ missed
    expect(jobs).toHaveLength(0)

    tick(20_000)
    const detectedAt = new Date()
    await kcell(history('Missed'))
    expect(call()).toMatchObject({
      outcome: 'MISSED', recoveryState: 'READY',
      startedAt: new Date('2026-10-05T04:58:00Z'), endedAt: new Date('2026-10-05T04:58:35Z'), // provider times, not receipt time
      outcomeDetectedAt: detectedAt, firstEventReceivedAt: NOW,
    })
    expect(jobs).toEqual([{ callInteractionId: call()!.id }]) // the existing missed-call-recovery job, id only
    expect(db.callEvents.map((e) => [e.eventType, e.providerStatus])).toEqual([
      ['RINGING', 'event:INCOMING'], ['OBSERVED', 'event:CANCELLED'], ['COMPLETED', 'history:in:Missed'],
    ])

    tick(3000)
    expect(await drainJobs()).toEqual(['SENT'])
    expect(mobizonRequests).toHaveLength(1)
    expect(mobizonRequests[0]!.get('recipient')).toBe('77011234567')
    expect(call()).toMatchObject({ recoveryState: 'SENT', recoveryChannel: 'SMS_BRIDGE', recoveryClaimedAt: expect.any(Date), recoverySentAt: expect.any(Date) })
    // the latency chain is durable: detected → claimed → provider accepted
    expect(call()!.recoverySentAt.getTime() - call()!.outcomeDetectedAt.getTime()).toBe(3000)
  })

  it('group call answered: INCOMING, CANCELLED (#1), ACCEPTED (#2), COMPLETED, history Success → ANSWERED, zero recovery', async () => {
    await kcell(event('INCOMING', { user: 'andy' }))
    await kcell(event('INCOMING', { user: 'bob' }))
    await kcell(event('CANCELLED', { user: 'andy' }))
    await kcell(event('ACCEPTED', { user: 'bob' }))
    await kcell(event('COMPLETED', { user: 'bob' }))
    await kcell(history('Success', { user: 'bob' }))
    expect(db.calls).toHaveLength(1)
    expect(call()).toMatchObject({ outcome: 'ANSWERED', recoveryState: 'NOT_ELIGIBLE', recoveryIneligibleReason: 'ANSWERED' })
    expect(jobs).toHaveLength(0)
    expect(mobizonRequests).toHaveLength(0)
    expect(db.messages).toHaveLength(0)
    expect(db.conversations).toHaveLength(0)
  })

  it('pure missed: INCOMING, CANCELLED, history Missed → MISSED, READY, exactly one job', async () => {
    await kcell(event('INCOMING'))
    await kcell(event('CANCELLED'))
    await kcell(history('Missed'))
    expect(call()).toMatchObject({ outcome: 'MISSED', recoveryState: 'READY' })
    expect(jobs).toHaveLength(1)
  })

  it('inbound Cancel (the caller gave up before an answer) is a missed lead too', async () => {
    await kcell(history('Cancel'))
    expect(call()).toMatchObject({ outcome: 'MISSED', recoveryState: 'READY' })
  })

  it('duplicates ×5 concurrently (event and history) → one call, one logical recovery, one SMS', async () => {
    await Promise.all(Array.from({ length: 5 }, () => kcell(event('INCOMING'))))
    const results = await Promise.all(Array.from({ length: 5 }, () => kcell(history('Missed'))))
    expect(results.every((r) => r.statusCode === 200)).toBe(true)
    expect(db.calls).toHaveLength(1)
    expect(db.callEvents).toHaveLength(2)
    // a duplicate that still finds READY re-publishes with the SAME idempotency key (provider-retry recovery);
    // the queue dedupes it and the engine's atomic claim makes every extra delivery a no-op
    expect(new Set(jobs.map((j) => j.callInteractionId)).size).toBe(1)
    const outcomes = await drainJobs()
    expect(outcomes.filter((o) => o === 'SENT')).toHaveLength(1)
    expect(mobizonRequests).toHaveLength(1)
    expect(db.deliveries).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
describe('out-of-order & late answers', () => {
  it('A: history Missed, then a delayed INCOMING → stays MISSED / READY (no reopen)', async () => {
    await kcell(history('Missed'))
    await kcell(event('INCOMING'))
    expect(call()).toMatchObject({ outcome: 'MISSED', recoveryState: 'READY', startedAt: new Date('2026-10-05T04:58:00Z') })
  })

  it('B: CANCELLED, then ACCEPTED, then history Success → ANSWERED', async () => {
    await kcell(event('CANCELLED'))
    await kcell(event('ACCEPTED', { user: 'bob' }))
    await kcell(history('Success'))
    expect(call()).toMatchObject({ outcome: 'ANSWERED', recoveryState: 'NOT_ELIGIBLE' })
    expect(jobs).toHaveLength(0)
  })

  it('C: ACCEPTED, then a delayed history Missed → stays ANSWERED (credible answer evidence is never downgraded)', async () => {
    await kcell(event('ACCEPTED'))
    await kcell(history('Missed'))
    expect(call()).toMatchObject({ outcome: 'ANSWERED', recoveryState: 'NOT_ELIGIBLE' })
    expect(jobs).toHaveLength(0)
  })

  it('webhook/queue race: Missed → READY + job published → late ACCEPTED before the consumer → no send', async () => {
    await kcell(history('Missed'))
    expect(jobs).toHaveLength(1)
    await kcell(event('ACCEPTED', { user: 'bob' }))
    expect(call()).toMatchObject({ outcome: 'ANSWERED', recoveryState: 'NOT_ELIGIBLE' })
    const [result] = await drainJobs()
    expect(result).not.toBe('SENT')
    expect(mobizonRequests).toHaveLength(0)
  })

  it('answer evidence after the SMS was already sent: outcome corrected, conflict recorded, nothing undone or re-sent', async () => {
    await kcell(history('Missed'))
    expect(await drainJobs()).toEqual(['SENT'])
    tick(10_000)
    await kcell(event('ACCEPTED', { user: 'bob' }))
    expect(call()).toMatchObject({ outcome: 'ANSWERED', recoveryState: 'SENT', outcomeConflictAt: new Date() })
    expect(logs.some((l) => l.includes('call_outcome_conflict'))).toBe(true)
    expect(jobs).toHaveLength(0)
    expect(mobizonRequests).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
describe('never a recovery lead', () => {
  it('outbound calls (OUTGOING + history out Busy / Missed) are recorded, NOT_ELIGIBLE OUTBOUND', async () => {
    await kcell(event('OUTGOING', { direction: 'out' }))
    await kcell(history('Busy', { type: 'out' }))
    expect(call()).toMatchObject({ direction: 'OUTBOUND', outcome: 'MISSED', recoveryState: 'NOT_ELIGIBLE', recoveryIneligibleReason: 'OUTBOUND' })
    CALL = 'OUT-2'
    await kcell(history('Missed', { type: 'out' }))
    expect(call()).toMatchObject({ direction: 'OUTBOUND', recoveryState: 'NOT_ELIGIBLE' })
    expect(jobs).toHaveLength(0)
  })

  it('anonymous / malformed / invalid caller → call kept, NO_CALLER_PHONE, no message', async () => {
    for (const [id, phone] of [['ANON', 'anonymous'], ['BAD', '123'], ['INVALID', '70000000000']] as const) {
      CALL = id
      await kcell(history('Missed', { phone }))
      expect(call()).toMatchObject({ outcome: 'MISSED', remotePhoneE164: null, recoveryState: 'NOT_ELIGIBLE', recoveryIneligibleReason: 'NO_CALLER_PHONE' })
    }
    expect(jobs).toHaveLength(0)
  })

  it('national caller form ("8 701 …") is normalized in the business region', async () => {
    await kcell(history('Missed', { phone: '87011234567' }))
    expect(call()).toMatchObject({ remotePhoneE164: '+77011234567', recoveryState: 'READY' })
  })

  it('customer link: exactly one active match is linked, an ambiguous match is not; nothing is created', async () => {
    db.customers = [{ id: 'c1', tenantId: 't1', businessId: B1, phoneE164: '+77011234567' }]
    await kcell(history('Missed'))
    expect(call()!.customerId).toBe('c1')
    db.customers.push({ id: 'c2', tenantId: 't1', businessId: B1, phoneE164: '+77011234567' })
    CALL = 'SECOND'
    await kcell(history('Missed'))
    expect(call()!.customerId).toBeNull()
    expect(db.customers).toHaveLength(2)
  })
})

// ---------------------------------------------------------------------------
describe('connection & Settings status', () => {
  const ctxFor = (role: 'owner' | 'admin' | 'manager') =>
    makeAuthContext(role, { tenant: makeTenant({ id: 't1' }), business: structuredClone(db.businesses[0]) as any })

  it('owner/admin activate only the server-prepared connection of THEIR business; status is secret-free and masked', async () => {
    db.telephonyConnections = []
    let status = await telephonyStatus(ctxFor('manager'))
    expect(status).toMatchObject({ provider: 'kcell', tokenConfigured: true, connection: null, missedCallEventsEnabled: false, numbers: ['+7******0000'] })
    await expect(connectKcell(ctxFor('manager'))).rejects.toMatchObject({ statusCode: 403 })
    status = await connectKcell(ctxFor('owner'))
    expect(status).toMatchObject({ connection: 'ACTIVE', missedCallEventsEnabled: true, webhookUrl: 'https://app.autoservise.test/api/webhooks/telephony/kcell' })
    expect(JSON.stringify(status)).not.toContain(TOKEN_1)
    expect(JSON.stringify(status)).not.toContain('72500000')
    expect(telephonyView(status)).toMatchObject({ provider: 'Kcell Виртуальная АТС', status: 'подключено', ok: true, canDisconnect: true })
    expect((await kcell(history('Missed'))).statusCode).toBe(200)
    status = await disconnectKcell(ctxFor('admin'))
    expect(status.connection).toBe('DISABLED')
    expect((await kcell(history('Missed', { callid: 'AFTER-OFF' }))).statusCode).toBe(401)

    process.env.KCELL_CRM_TOKENS = `${B2}=${TOKEN_2}`
    await expect(connectKcell(ctxFor('owner'))).rejects.toMatchObject({ code: 'KCELL_NOT_PROVISIONED' }) // no server token for B1
  })

  it('no Kcell configuration → telephony shown as not connected (production: never mock)', async () => {
    delete process.env.KCELL_CRM_TOKENS
    db.telephonyConnections = []
    const status = await telephonyStatus(ctxFor('owner'))
    expect(status).toMatchObject({ provider: 'none', mode: 'off', missedCallEventsEnabled: false })
    expect(telephonyView(status)).toMatchObject({ provider: 'не подключена', ok: false, canConnect: false })
  })
})
