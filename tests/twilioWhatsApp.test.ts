import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { randomUUID, createHmac } from 'node:crypto'
import type { ApiRequest, ApiResponse } from '../src/server/types/http'

// ---------------------------------------------------------------------------
// MCR-7B1 — production WhatsApp transport (Twilio pilot). The REAL inbound
// pipeline (receiveIncoming + recordInboundMessage + MessageSid idempotency +
// customer link), MCR-5 (turns, AI core with the deterministic mock model,
// validation, finalize), MCR-4/4.1/6 recovery (router, bridge), MCR-7A
// Mobizon, the delivery core (session-window gate) with the REAL
// channelDeliveryRepository / channelConnectionRepository, the Twilio adapter
// and both Twilio webhooks run on an in-memory Prisma double. Twilio and
// Mobizon are in-process fake HTTP transports; every webhook is signed
// exactly as Twilio documents. No test reaches the internet.
// ---------------------------------------------------------------------------

type Row = Record<string, any>
const { db, trapHits, hooks, fakePrisma, trap } = vi.hoisted(() => {
  const names = ['tenants', 'businesses', 'conversations', 'messages', 'channelMessages', 'calls', 'consents', 'links', 'deliveries', 'connections', 'numbers', 'turns', 'webhookEvents', 'escalations', 'aiLogs', 'hours', 'customers', 'identities'] as const
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
        recoveryConversationId: null, recoveryMessageId: null, recoveryChannel: null, recoveryRouteReason: null, updatedAt: new Date(), ...data,
      })
    },
    lockByProviderCall: async (p: string, id: string) => structuredClone(db.calls.find((c) => c.provider === p && c.providerCallId === id) ?? null),
    insertEventIfAbsent: async () => true,
    update: async (id: string, data: Row) => Object.assign(db.calls.find((c) => c.id === id)!, data, { updatedAt: new Date() }),
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
import { ingestCallEvent } from '../src/server/services/callIntakeService'
import { setRecoveryJobPublisher } from '../src/server/recovery/recoveryJobs'
import { handleRecoveryJob } from '../src/server/recovery/recoveryJobConsumer'
import { resolveBridge } from '../src/server/recovery/bridge'
import { channelConsentRepository } from '../src/server/repositories/recoveryRoutingRepository'
import { setMobizonFetchForTests } from '../src/server/channels/smsTransport'
import { setTwilioFetchForTests, whatsappTransportStatus } from '../src/server/channels/whatsappTransport'
import { getChannelAdapter } from '../src/server/channels/channelAdapterRegistry'
import { isWhatsAppSessionOpen } from '../src/server/channels/customerServiceWindow'
import { canAdvanceDeliveryState, mapTwilioStatus } from '../src/server/channels/deliveryStatus'
import { twilioSignature } from '../src/server/channels/adapters/twilio/twilioSignature'
import type { FetchLike } from '../src/server/channels/adapters/mobizon/mobizonClient'
import { setAiReplyJobPublisher, type AiReplyJob } from '../src/server/aiConversation/aiReplyJobs'
import { handleAiReplyJob } from '../src/server/aiConversation/aiReplyJobConsumer'
import { createMessage } from '../src/server/services/messageService'
import { sendMessageViaChannel } from '../src/server/services/channelDeliveryService'
import { activateChannelConnection } from '../src/server/services/channelConnectionService'
import { connectTwilioSender } from '../src/server/services/twilioConnectionService'
import { deliveryLabel } from '../src/components/conversations/deliveryLabel'
import { whatsappTransportView } from '../src/components/channels/recoverySetup'
import inboundRoute from '../api/webhooks/channels/twilio/inbound'
import statusRoute from '../api/webhooks/channels/twilio/status'

// --- constants ---------------------------------------------------------------
const B1 = '0b1b1b1b-1111-4111-8111-111111111111'
const B2 = '0b2b2b2b-2222-4222-8222-222222222222'
const ACCOUNT_SID = `AC${'a'.repeat(32)}`
const AUTH_TOKEN = 'twilio-auth-token-test'
const SENDER_1 = '+77272500100'
const SENDER_2 = '+77172500200'
const CUSTOMER = '+77011234567'
const APP = 'https://app.autoservise.test'
const INBOUND_URL = `${APP}/api/webhooks/channels/twilio/inbound`
const STATUS_URL = `${APP}/api/webhooks/channels/twilio/status`
const NOW = new Date('2026-10-05T05:00:00Z')

// --- fake Twilio + Mobizon ------------------------------------------------------
interface Captured {
  url: string
  headers: Record<string, string>
  body: URLSearchParams
}
const twilio = {
  requests: [] as Captured[],
  seq: 0,
  respond: null as null | ((req: Captured) => { status: number; body: string } | Error),
}
const sid = () => `SM${(++twilio.seq).toString(16).padStart(32, '0')}`
const twilioFetch: FetchLike = async (url, init) => {
  const req = { url, headers: init.headers, body: new URLSearchParams(init.body) }
  twilio.requests.push(req)
  const out = twilio.respond ? twilio.respond(req) : { status: 201, body: JSON.stringify({ sid: sid(), status: 'queued' }) }
  if (out instanceof Error) throw out
  return { status: out.status, text: async () => out.body }
}
const mobizonRequests: URLSearchParams[] = []
const mobizonFetch: FetchLike = async (url, init) => {
  mobizonRequests.push(new URLSearchParams(init.body))
  return { status: 200, text: async () => JSON.stringify({ code: 0, data: { campaignId: 1, messageId: 9000 + mobizonRequests.length, status: 2 }, message: '' }) }
}

// --- signed webhooks ---------------------------------------------------------------
let msgSeq = 0
function inboundParams(over: Record<string, string> = {}): Record<string, string> {
  return { MessageSid: `SM${(1000 + ++msgSeq).toString(16).padStart(32, '0')}`, AccountSid: ACCOUNT_SID, From: `whatsapp:${CUSTOMER}`, To: `whatsapp:${SENDER_1}`, Body: 'Сколько стоит замена масла?', NumMedia: '0', ProfileName: 'Иван', WaId: CUSTOMER.slice(1), ...over }
}
async function post(route: typeof inboundRoute, url: string, params: Record<string, string>, opts: { signature?: string | null; token?: string; signUrl?: string } = {}) {
  const signature = opts.signature === undefined ? twilioSignature(opts.signUrl ?? url, params, opts.token ?? AUTH_TOKEN) : opts.signature
  const res = { statusCode: 0, body: '' as string, headers: {} as Record<string, string> }
  const api: any = { setHeader: (k: string, v: string) => ((res.headers[k.toLowerCase()] = v), api), end: (b?: string) => ((res.body = b ?? ''), api) }
  Object.defineProperty(api, 'statusCode', { get: () => res.statusCode, set: (v) => (res.statusCode = v) })
  const headers: Record<string, string> = signature === null ? {} : { 'x-twilio-signature': signature }
  await route({ method: 'POST', url: new URL(url).pathname, headers, query: {}, body: params } as unknown as ApiRequest, api as ApiResponse)
  return res
}
const inbound = (params: Record<string, string>, opts?: Parameters<typeof post>[3]) => post(inboundRoute, INBOUND_URL, params, opts)
const statusCb = (params: Record<string, string>, opts?: Parameters<typeof post>[3]) => post(statusRoute, STATUS_URL, { AccountSid: ACCOUNT_SID, ...params }, opts)

// --- helpers -------------------------------------------------------------------------
const aiJobs: AiReplyJob[] = []
const deliverAi = (n = 1) => handleAiReplyJob(aiJobs[aiJobs.length - 1], { messageId: `q-${n}`, deliveryCount: n }).catch((e) => e)
const twilioSends = () => twilio.requests.filter((r) => r.url.endsWith('/Messages.json'))
const inboundMessages = () => db.messages.filter((m) => m.direction === 'INBOUND')
const aiMessages = () => db.messages.filter((m) => m.senderType === 'AI')
const waDelivery = () => db.deliveries.find((d) => d.provider === 'twilio')!
const tick = (ms: number) => vi.setSystemTime(new Date(Date.now() + ms))
let evSeq = 0
async function missedCall() {
  tick(1000)
  const r = await ingestCallEvent({ provider: 'mock', providerEventId: `ev-${++evSeq}`, providerCallId: `pc-${evSeq}`, eventType: 'MISSED', direction: 'INBOUND', callerPhone: '8 701 123 45 67', calledPhone: '+77272500000', occurredAt: null, wasAnswered: null })
  return r.callInteractionId
}
const recover = (callId: string) => handleRecoveryJob({ callInteractionId: callId }, { messageId: `r-${callId}`, deliveryCount: 1 }).catch((e) => e)
const connection = (id: string, over: Row): Row => ({ id, type: 'WHATSAPP', status: 'ACTIVE', displayName: id, externalAccountId: id, config: null, provider: null, senderE164: null, routingKey: null, createdAt: new Date(0), updatedAt: new Date(0), ...over })

const ENV = {
  APP_URL: APP,
  TWILIO_ACCOUNT_SID: ACCOUNT_SID,
  TWILIO_AUTH_TOKEN: AUTH_TOKEN,
  TWILIO_WHATSAPP_SENDERS: `${SENDER_1}=${B1},${SENDER_2}=${B2}`,
  SMS_PROVIDER: 'mobizon',
  MOBIZON_API_KEY: 'mobizon-key',
}
const logs: string[] = []

beforeEach(() => {
  msgSeq = 0
  evSeq = 0
  trapHits.length = 0
  hooks.generateCalls = 0
  hooks.uniqueError = (msg: string) => new Prisma.PrismaClientKnownRequestError(msg, { code: 'P2002', clientVersion: 'test' })
  for (const t of ['conversations', 'messages', 'channelMessages', 'calls', 'consents', 'links', 'deliveries', 'turns', 'webhookEvents', 'escalations', 'aiLogs', 'customers', 'identities']) db[t] = []
  db.tenants = [makeTenant({ id: 't1' }), makeTenant({ id: 't2' })]
  db.businesses = [
    makeBusiness({ id: B1, tenantId: 't1', name: 'Автосервис Тест', timezone: 'Asia/Almaty', currency: 'KZT', aiAutoReplyEnabled: true }),
    makeBusiness({ id: B2, tenantId: 't2', name: 'Чужой сервис', timezone: 'Asia/Almaty', currency: 'KZT', aiAutoReplyEnabled: true }),
  ]
  db.hours = []
  db.numbers = [{ id: 'n1', tenantId: 't1', businessId: B1, phoneE164: '+77272500000', isActive: true }]
  db.connections = [
    connection('wa-1', { tenantId: 't1', businessId: B1, provider: 'twilio', senderE164: SENDER_1, routingKey: `WHATSAPP:twilio:${SENDER_1}` }),
    connection('sms-1', { tenantId: 't1', businessId: B1, type: 'SMS' }),
    connection('wa-2', { tenantId: 't2', businessId: B2, provider: 'twilio', senderE164: SENDER_2, routingKey: `WHATSAPP:twilio:${SENDER_2}` }),
  ]
  Object.assign(twilio, { requests: [], seq: 0, respond: null })
  mobizonRequests.length = 0
  aiJobs.length = 0
  setTwilioFetchForTests(twilioFetch)
  setMobizonFetchForTests(mobizonFetch)
  setAiReplyJobPublisher({ kind: 'test', publish: async (job) => (aiJobs.push(job), { status: 'PUBLISHED', messageId: 'x' }) })
  setRecoveryJobPublisher({ kind: 'test', publish: async () => ({ status: 'PUBLISHED', messageId: 'x' }) })
  Object.assign(process.env, ENV)
  logs.length = 0
  for (const level of ['log', 'warn', 'error'] as const) vi.spyOn(console, level).mockImplementation((...args: unknown[]) => void logs.push(args.map(String).join(' ')))
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})
afterEach(() => {
  vi.useRealTimers()
  setTwilioFetchForTests(null)
  setMobizonFetchForTests(null)
  setAiReplyJobPublisher(null)
  setRecoveryJobPublisher(null)
  for (const key of [...Object.keys(ENV), 'TWILIO_TEMPLATE_MISSED_CALL_RECOVERY_V1']) delete process.env[key]
  expect(trapHits).toEqual([]) // no Customer / Vehicle / Request / Appointment writes — in every test
  for (const line of logs) {
    expect(line).not.toContain(AUTH_TOKEN)
    expect(line).not.toContain('77011234567')
    expect(line).not.toContain('Сколько стоит')
  }
})

// ---------------------------------------------------------------------------
describe('configuration & outbound request (official Messages API)', () => {
  it('exact request: POST …/Accounts/{AccountSid}/Messages.json, Basic auth, whatsapp: addresses, StatusCallback', async () => {
    const adapter = getChannelAdapter('WHATSAPP', db.connections[0] as any)
    expect(adapter.provider).toBe('twilio')
    const result = await adapter.sendMessage({ channelType: 'WHATSAPP', externalConversationId: '77011234567', content: 'Здравствуйте!', idempotencyKey: 'd1' })
    expect(result).toEqual({ success: true, externalMessageId: expect.stringMatching(/^SM[0-9a-f]{32}$/) })
    const [req] = twilioSends()
    expect(req!.url).toBe(`https://api.twilio.com/2010-04-01/Accounts/${ACCOUNT_SID}/Messages.json`)
    expect(req!.headers.Authorization).toBe(`Basic ${Buffer.from(`${ACCOUNT_SID}:${AUTH_TOKEN}`).toString('base64')}`)
    expect(Object.fromEntries(req!.body)).toEqual({ To: 'whatsapp:+77011234567', From: `whatsapp:${SENDER_1}`, Body: 'Здравствуйте!', StatusCallback: STATUS_URL })
  })

  it('template path: ContentSid + ContentVariables, never Body; missing template → TEMPLATE_UNAVAILABLE without any request', async () => {
    const adapter = getChannelAdapter('WHATSAPP', db.connections[0] as any)
    const tmpl = { key: 'MISSED_CALL_RECOVERY_V1', variables: { '1': 'Автосервис Тест' } }
    expect(await adapter.sendMessage({ channelType: 'WHATSAPP', externalConversationId: '77011234567', content: 'x', template: tmpl })).toMatchObject({ success: false, errorCode: 'TEMPLATE_UNAVAILABLE' })
    expect(twilioSends()).toHaveLength(0)
    process.env.TWILIO_TEMPLATE_MISSED_CALL_RECOVERY_V1 = `HX${'b'.repeat(32)}`
    await getChannelAdapter('WHATSAPP', db.connections[0] as any).sendMessage({ channelType: 'WHATSAPP', externalConversationId: '77011234567', content: 'x', template: tmpl })
    const params = Object.fromEntries(twilioSends()[0]!.body)
    expect(params).toMatchObject({ ContentSid: `HX${'b'.repeat(32)}`, ContentVariables: '{"1":"Автосервис Тест"}' })
    expect(params.Body).toBeUndefined()
  })

  it.each([
    ['201 + sid → ACCEPTED', { status: 201, body: JSON.stringify({ sid: `SM${'1'.repeat(32)}` }) }, { success: true }],
    ['63016 outside window', { status: 400, body: '{"code":63016,"message":"x","status":400}' }, { success: false, errorCode: 'WHATSAPP_SESSION_CLOSED', retryable: false }],
    ['21211 invalid To', { status: 400, body: '{"code":21211,"message":"x","status":400}' }, { success: false, errorCode: 'INVALID_DESTINATION', retryable: false }],
    ['429 rate limit (safe to retry per docs)', { status: 429, body: '{"code":20429}' }, { success: false, errorCode: 'PROVIDER_RATE_LIMITED', retryable: true }],
    ['401 credentials', { status: 401, body: '{"code":20003}' }, { success: false, errorCode: 'PROVIDER_AUTH_ERROR' }],
    ['500 → UNCERTAIN', { status: 500, body: 'oops' }, { success: false, uncertain: true, errorCode: 'DELIVERY_UNCERTAIN' }],
    ['201 without sid → UNCERTAIN', { status: 201, body: '{}' }, { success: false, uncertain: true }],
  ])('%s', async (_label, response, expected) => {
    twilio.respond = () => response
    expect(await getChannelAdapter('WHATSAPP', db.connections[0] as any).sendMessage({ channelType: 'WHATSAPP', externalConversationId: '77011234567', content: 'x' })).toMatchObject(expected)
  })

  it('missing credentials → Twilio connection unavailable (never mock); production without a provider → unavailable', () => {
    delete process.env.TWILIO_AUTH_TOKEN
    expect(getChannelAdapter('WHATSAPP', db.connections[0] as any).provider).toBe('none')
    const prev = process.env.NODE_ENV
    process.env.NODE_ENV = 'production'
    try {
      expect(getChannelAdapter('WHATSAPP', connection('wa-x', {}) as any).provider).toBe('none')
    } finally {
      process.env.NODE_ENV = prev
    }
    expect(getChannelAdapter('WHATSAPP', connection('wa-x', {}) as any).provider).toBe('mock') // dev/test only
  })

  it('Settings status: masked sender, no token, template flag', () => {
    const status = whatsappTransportStatus(B1)
    expect(JSON.stringify(status)).not.toContain(AUTH_TOKEN)
    expect(status).toMatchObject({ provider: 'twilio', mode: 'production', credentialsConfigured: true, recoveryTemplateConfigured: false, webhooksConfigured: true })
    expect(status.assignedSender).toMatch(/^\+7\*+0100$/)
    expect(whatsappTransportView(status)).toMatchObject({ provider: 'Twilio', status: 'подключён', template: expect.stringContaining('первое сообщение уходит SMS') })
  })
})

// ---------------------------------------------------------------------------
describe('inbound webhook — authenticity & routing', () => {
  it('valid signature → one inbound Message in the business of the receiving sender; AI job published', async () => {
    const res = await inbound(inboundParams())
    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('<Response></Response>')
    expect(inboundMessages()).toEqual([expect.objectContaining({ tenantId: 't1', businessId: B1, senderType: 'CUSTOMER', content: 'Сколько стоит замена масла?' })])
    expect(db.conversations[0]).toMatchObject({ channel: 'WHATSAPP', channelConnectionId: 'wa-1', externalConversationId: '77011234567' })
    expect(aiJobs).toHaveLength(1)
    expect(Object.keys(aiJobs[0]!)).toEqual(['messageId']) // no PII in the job
    expect(hooks.generateCalls).toBe(0) // the webhook never runs the AI
  })

  it.each([
    ['wrong Auth Token', { token: 'other-token' }],
    ['missing signature', { signature: null }],
    ['wrong URL signed', { signUrl: 'https://evil.example/api/webhooks/channels/twilio/inbound' }],
  ])('%s → 403, nothing written', async (_label, opts) => {
    expect((await inbound(inboundParams(), opts as any)).statusCode).toBe(403)
    expect(db.messages).toHaveLength(0)
    expect(aiJobs).toHaveLength(0)
  })

  it('a param modified after signing → 403', async () => {
    const params = inboundParams()
    const signature = twilioSignature(INBOUND_URL, params, AUTH_TOKEN)
    expect((await inbound({ ...params, To: `whatsapp:${SENDER_2}` }, { signature })).statusCode).toBe(403)
    expect(db.messages).toHaveLength(0)
  })

  it('no Auth Token configured → 503, never accepted; a foreign AccountSid → 403', async () => {
    expect((await inbound(inboundParams({ AccountSid: `AC${'f'.repeat(32)}` }))).statusCode).toBe(403)
    delete process.env.TWILIO_AUTH_TOKEN
    expect((await inbound(inboundParams())).statusCode).toBe(503)
    expect(db.messages).toHaveLength(0)
  })

  it('unknown receiving sender → 200, no Business guessed, nothing written', async () => {
    const res = await inbound(inboundParams({ To: 'whatsapp:+77779990000' }))
    expect(res.statusCode).toBe(200)
    expect(db.messages).toHaveLength(0)
    expect(db.conversations).toHaveLength(0)
  })

  it('cross-tenant spoof: routing follows ONLY the trusted To sender; payload hints are ignored', async () => {
    await inbound(inboundParams({ To: `whatsapp:${SENDER_2}`, tenantId: 't1', businessId: B1, conversationId: randomUUID() }))
    expect(inboundMessages()).toEqual([expect.objectContaining({ tenantId: 't2', businessId: B2 })])
  })

  it('duplicate MessageSid ×5 concurrently → one Message, one turn, ONE AI reply', async () => {
    const params = inboundParams()
    const results = await Promise.all(Array.from({ length: 5 }, () => inbound(params)))
    expect(results.every((r) => r.statusCode === 200)).toBe(true)
    expect(inboundMessages()).toHaveLength(1)
    expect(db.turns).toHaveLength(1)
    for (let n = 1; n <= 5; n++) await deliverAi(n)
    expect(aiMessages()).toHaveLength(1)
    expect(twilioSends()).toHaveLength(1)
  })

  it('a MessageSid already recorded on another connection is never re-routed', async () => {
    const params = inboundParams()
    await inbound(params)
    db.connections.push(connection('wa-3', { tenantId: 't1', businessId: B1, provider: 'twilio', senderE164: '+77272500999', routingKey: 'WHATSAPP:twilio:+77272500999' }))
    expect((await inbound({ ...params, To: 'whatsapp:+77272500999' })).statusCode).toBe(200)
    expect(inboundMessages()).toHaveLength(1)
  })

  it('customer link: exactly one match linked; ambiguous stays unlinked; unknown → null; never created', async () => {
    db.customers = [{ id: 'c-1', tenantId: 't1', businessId: B1, phoneE164: CUSTOMER }]
    await inbound(inboundParams())
    expect(db.conversations[0]!.customerId).toBe('c-1')
    db.conversations = []
    db.customers.push({ id: 'c-2', tenantId: 't1', businessId: B1, phoneE164: '+77019998877' }, { id: 'c-3', tenantId: 't1', businessId: B1, phoneE164: '+77019998877' })
    await inbound(inboundParams({ From: 'whatsapp:+77019998877' }))
    expect(db.conversations.find((c) => c.externalConversationId === '77019998877')!.customerId).toBeNull()
    await inbound(inboundParams({ From: 'whatsapp:+77015550000' }))
    expect(db.conversations.find((c) => c.externalConversationId === '77015550000')!.customerId).toBeNull()
  })

  it('media without text → stored with a placeholder, no AI turn, operator handoff (escalation + pause); location the same', async () => {
    await inbound(inboundParams({ Body: '', NumMedia: '1', MediaContentType0: 'image/jpeg', MediaUrl0: 'https://api.twilio.com/media/x' }))
    expect(inboundMessages()[0]!.content).toBe('[Вложение: image/jpeg]')
    expect(db.turns).toHaveLength(0)
    expect(db.escalations).toEqual([expect.objectContaining({ status: 'OPEN' })])
    expect(db.conversations[0]).toMatchObject({ aiAutomationPausedReason: 'UNSUPPORTED_MESSAGE' })
    await inbound(inboundParams({ Body: '', From: 'whatsapp:+77015550000', Latitude: '43.2', Longitude: '76.9' }))
    expect(inboundMessages()[1]!.content).toBe('[Клиент отправил геолокацию]')
    expect(db.turns).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
describe('customer-service window & outbound safety', () => {
  const scope = { tenantId: 't1', businessId: B1 }

  it('opens on a genuine inbound: open at T0+23:59, closed at exactly T0+24h', async () => {
    expect(await isWhatsAppSessionOpen(scope, CUSTOMER, new Date())).toBe(false)
    await inbound(inboundParams())
    const t0 = Date.now()
    expect(await isWhatsAppSessionOpen(scope, CUSTOMER, new Date(t0 + (23 * 60 + 59) * 60_000))).toBe(true)
    expect(await isWhatsAppSessionOpen(scope, CUSTOMER, new Date(t0 + 24 * 3_600_000 - 1))).toBe(true)
    expect(await isWhatsAppSessionOpen(scope, CUSTOMER, new Date(t0 + 24 * 3_600_000))).toBe(false)
  })

  it('a missed call, the SMS and the bridge click never open it; no consent is created', async () => {
    const callId = await missedCall()
    expect(await recover(callId)).toBe('SENT')
    const token = /\/r\/([A-Za-z0-9_-]{22})/.exec(mobizonRequests[0]!.get('text')!)![1]!
    expect(await resolveBridge(token)).toMatchObject({ kind: 'REDIRECT', url: expect.stringMatching(/^https:\/\/wa\.me\/77272500100\?/) }) // the Twilio sender is the entry
    expect(await isWhatsAppSessionOpen(scope, CUSTOMER, new Date())).toBe(false)
    expect(db.consents).toHaveLength(0)
    expect(inboundMessages()).toHaveLength(0)
    expect(aiJobs).toHaveLength(0)
  })

  it('staff reply inside the window → through the same Twilio adapter, and AI pauses (HUMAN_TAKEOVER)', async () => {
    await inbound(inboundParams())
    const ctx = makeAuthContext('owner', { tenant: makeTenant({ id: 't1' }), business: structuredClone(db.businesses[0]) as any })
    const staff = await createMessage(ctx, db.conversations[0]!.id, { direction: 'OUTBOUND', senderType: 'STAFF', content: 'Здравствуйте, это администратор.' })
    const dto = await sendMessageViaChannel(ctx, 'wa-1', staff.id)
    expect(dto).toMatchObject({ status: 'SENT', provider: 'twilio' })
    expect(Object.fromEntries(twilioSends()[0]!.body)).toMatchObject({ Body: 'Здравствуйте, это администратор.', From: `whatsapp:${SENDER_1}` })
    expect(db.conversations[0]!.aiAutomationPausedReason).toBe('HUMAN_TAKEOVER')
  })

  it('free-form outside the window fails closed — no Twilio request (staff and AI)', async () => {
    await inbound(inboundParams())
    tick(25 * 3_600_000)
    const ctx = makeAuthContext('owner', { tenant: makeTenant({ id: 't1' }), business: structuredClone(db.businesses[0]) as any })
    const staff = await createMessage(ctx, db.conversations[0]!.id, { direction: 'OUTBOUND', senderType: 'STAFF', content: 'Вы ещё здесь?' })
    await expect(sendMessageViaChannel(ctx, 'wa-1', staff.id)).rejects.toMatchObject({ code: 'WHATSAPP_SESSION_CLOSED' })
    expect(twilioSends()).toHaveLength(0)
  })

  it('a lost Twilio response → DELIVERY_UNCERTAIN: no duplicate, no regeneration, no SMS', async () => {
    await inbound(inboundParams())
    twilio.respond = () => Object.assign(new Error('aborted'), { name: 'AbortError' })
    await deliverAi(1)
    expect(db.turns[0]).toMatchObject({ state: 'FAILED', reasonCode: 'DELIVERY_UNCERTAIN' })
    expect(waDelivery()).toMatchObject({ status: 'SENDING', errorCode: 'DELIVERY_UNCERTAIN' })
    twilio.respond = null
    expect(await deliverAi(2)).toBe('SKIPPED')
    expect(twilioSends()).toHaveLength(1)
    expect(hooks.generateCalls).toBe(1)
    expect(mobizonRequests).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
describe('status callbacks', () => {
  async function aiReplySent() {
    await inbound(inboundParams())
    expect(await deliverAi()).toBe('REPLIED')
    return waDelivery().externalMessageId as string
  }

  it('delivered → read; out of order and failures after delivery never regress; duplicates idempotent', async () => {
    const messageSid = await aiReplySent()
    expect((await statusCb({ MessageSid: messageSid, MessageStatus: 'delivered' })).statusCode).toBe(200)
    expect(waDelivery().providerDeliveryState).toBe('DELIVERED')
    expect(deliveryLabel(waDelivery() as any).label).toBe('Доставлено')
    await statusCb({ MessageSid: messageSid, MessageStatus: 'sent' }) // late, weaker
    await statusCb({ MessageSid: messageSid, MessageStatus: 'undelivered', ErrorCode: '30008' }) // late failure
    expect(waDelivery().providerDeliveryState).toBe('DELIVERED')
    await statusCb({ MessageSid: messageSid, MessageStatus: 'read', EventType: 'READ' })
    expect(waDelivery().providerDeliveryState).toBe('READ')
    await statusCb({ MessageSid: messageSid, MessageStatus: 'delivered' }) // duplicate after read
    expect(waDelivery().providerDeliveryState).toBe('READ')
    const before = db.webhookEvents.length
    await statusCb({ MessageSid: messageSid, MessageStatus: 'read', EventType: 'READ' })
    expect(db.webhookEvents.length).toBe(before) // idempotent
  })

  it('unknown sid → 200 and nothing changed; unknown status observable but never "delivered"; bad signature → 403', async () => {
    const messageSid = await aiReplySent()
    expect((await statusCb({ MessageSid: `SM${'9'.repeat(32)}`, MessageStatus: 'delivered' })).statusCode).toBe(200)
    await statusCb({ MessageSid: messageSid, MessageStatus: 'brand_new' })
    expect(waDelivery()).toMatchObject({ providerStatus: 'brand_new', providerDeliveryState: null })
    expect((await statusCb({ MessageSid: messageSid, MessageStatus: 'delivered' }, { token: 'x' })).statusCode).toBe(403)
    expect(waDelivery().providerDeliveryState).toBeNull()
  })

  it('status mapping and transition rules', () => {
    expect(['queued', 'sending', 'sent', 'delivered', 'read', 'undelivered', 'failed', 'received'].map((s) => mapTwilioStatus(s))).toEqual(['ACCEPTED', 'ACCEPTED', 'ACCEPTED', 'DELIVERED', 'READ', 'UNDELIVERED', 'UNDELIVERED', null])
    expect(mapTwilioStatus('delivered', 'READ')).toBe('READ')
    expect(canAdvanceDeliveryState('DELIVERED', 'READ')).toBe(true)
    expect(canAdvanceDeliveryState('READ', 'DELIVERED')).toBe(false)
    expect(canAdvanceDeliveryState('DELIVERED', 'UNDELIVERED')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
describe('recovery routing with real WhatsApp (MCR-6 regression)', () => {
  it('UNKNOWN consent → SMS bridge (Mobizon), never a WhatsApp initiation', async () => {
    const callId = await missedCall()
    expect(await recover(callId)).toBe('SENT')
    expect(db.calls[0]).toMatchObject({ recoveryChannel: 'SMS_BRIDGE', recoveryRouteReason: 'WHATSAPP_NO_RECORDED_CONSENT' })
    expect(mobizonRequests).toHaveLength(1)
    expect(twilioSends()).toHaveLength(0)
  })

  it('OPTED_IN without a configured template → SMS; with the approved template → Twilio template send, no SMS', async () => {
    await channelConsentRepository.record({ tenantId: 't1', businessId: B1, channel: 'WHATSAPP', destinationE164: CUSTOMER, status: 'OPTED_IN', source: 'PROVIDER_EVENT', at: NOW })
    const first = await missedCall()
    await recover(first)
    expect(db.calls[0]).toMatchObject({ recoveryChannel: 'SMS_BRIDGE', recoveryRouteReason: 'WHATSAPP_TEMPLATE_UNAVAILABLE' })
    process.env.TWILIO_TEMPLATE_MISSED_CALL_RECOVERY_V1 = `HX${'c'.repeat(32)}`
    tick(20 * 60_000) // past the anti-spam window
    const second = await missedCall()
    expect(await recover(second)).toBe('SENT')
    expect(db.calls[1]).toMatchObject({ recoveryChannel: 'WHATSAPP', recoveryRouteReason: 'WHATSAPP_TEMPLATE_AVAILABLE' })
    const params = Object.fromEntries(twilioSends()[0]!.body)
    expect(params).toMatchObject({ ContentSid: `HX${'c'.repeat(32)}`, ContentVariables: '{"1":"Автосервис Тест"}', To: 'whatsapp:+77011234567' })
    expect(params.Body).toBeUndefined()
    expect(mobizonRequests).toHaveLength(1) // only the first call's SMS
  })
})

// ---------------------------------------------------------------------------
describe('controlled sender connection', () => {
  it('the server assigns the sender of THIS business; nobody can attach another business’s live sender', async () => {
    db.connections = [connection('wa-new', { tenantId: 't1', businessId: B1, status: 'INACTIVE' })]
    const owner = makeAuthContext('owner', { tenant: makeTenant({ id: 't1' }), business: structuredClone(db.businesses[0]) as any })
    const connected = await connectTwilioSender(owner, 'wa-new')
    expect(connected).toMatchObject({ provider: 'twilio', senderE164: SENDER_1, routingKey: null }) // inactive → not routing yet
    const active = await activateChannelConnection(owner, 'wa-new')
    expect(active!.routingKey).toBe(`WHATSAPP:twilio:${SENDER_1}`)
    // a second connection with the same sender can never become a second route
    db.connections.push(connection('wa-dup', { tenantId: 't1', businessId: B1, status: 'INACTIVE', provider: 'twilio', senderE164: SENDER_1 }))
    await expect(activateChannelConnection(owner, 'wa-dup')).rejects.toMatchObject({ code: 'SENDER_ALREADY_CONNECTED' })
    await expect(connectTwilioSender(makeAuthContext('manager', { tenant: makeTenant({ id: 't1' }), business: structuredClone(db.businesses[0]) as any }), 'wa-new')).rejects.toMatchObject({ statusCode: 403 })
  })
})

// ---------------------------------------------------------------------------
describe('production-like vertical slice', () => {
  it('missed call → SMS → bridge → genuine Twilio inbound → MCR-5 → Twilio reply → delivered', async () => {
    // 1. missed call → UNKNOWN → Mobizon SMS bridge
    const callId = await missedCall()
    expect(await recover(callId)).toBe('SENT')
    const token = /\/r\/([A-Za-z0-9_-]{22})/.exec(mobizonRequests[0]!.get('text')!)![1]!
    expect(await resolveBridge(token)).toMatchObject({ kind: 'REDIRECT' })
    expect(aiJobs).toHaveLength(0) // a click is not an inbound

    // 2. the customer actually sends the prefilled message in WhatsApp
    tick(60_000)
    const res = await inbound(inboundParams({ Body: 'Здравствуйте! Я только что звонил в автосервис.' }))
    expect(res.statusCode).toBe(200)
    expect(inboundMessages()).toEqual([expect.objectContaining({ tenantId: 't1', businessId: B1, content: 'Здравствуйте! Я только что звонил в автосервис.' })])
    expect(await isWhatsAppSessionOpen({ tenantId: 't1', businessId: B1 }, CUSTOMER, new Date())).toBe(true)
    expect(db.links[0]).toMatchObject({ whatsappInboundAt: expect.any(Date), openCount: 1 }) // attributed to the one recent bridge
    expect(aiJobs).toHaveLength(1)

    // 3. MCR-5 → grounded reply through Twilio
    expect(await deliverAi()).toBe('REPLIED')
    expect(aiMessages()).toHaveLength(1)
    const [send] = twilioSends()
    expect(Object.fromEntries(send!.body)).toMatchObject({ To: 'whatsapp:+77011234567', From: `whatsapp:${SENDER_1}`, Body: aiMessages()[0]!.content, StatusCallback: STATUS_URL })
    expect(waDelivery()).toMatchObject({ status: 'SENT', provider: 'twilio', externalMessageId: expect.stringMatching(/^SM/) })

    // 4. delivered callback
    await statusCb({ MessageSid: waDelivery().externalMessageId, MessageStatus: 'delivered' })
    expect(deliveryLabel(waDelivery() as any)).toEqual({ label: 'Доставлено', variant: 'success' })

    // invariants
    expect(db.consents).toHaveLength(0) // neither the call nor the click is consent
    expect(inboundMessages()).toHaveLength(1)
    expect(hooks.generateCalls).toBe(1)
  })

  it('bridge attribution is never a guess: two open links for the same caller → nothing attributed', async () => {
    const a = await missedCall()
    await recover(a)
    tick(20 * 60_000)
    const b = await missedCall()
    await recover(b)
    expect(db.links).toHaveLength(2)
    await inbound(inboundParams())
    expect(db.links.every((l) => l.whatsappInboundAt === null)).toBe(true)
    expect(inboundMessages()).toHaveLength(1) // the inbound itself is never blocked
  })
})
