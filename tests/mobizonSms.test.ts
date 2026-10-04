import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { randomUUID, createHash } from 'node:crypto'
import type { ApiRequest, ApiResponse } from '../src/server/types/http'

// ---------------------------------------------------------------------------
// MCR-7A — production SMS transport (Mobizon Kazakhstan). The REAL intake,
// MCR-4.1 consumer, MCR-4 engine, MCR-6 router + bridge, the delivery core
// with the REAL channelDeliveryRepository, the Mobizon adapter / client and
// the delivery-report webhook run on an in-memory Prisma double. Mobizon is
// an in-process fake HTTP transport (setMobizonFetchForTests) built from the
// official API docs — no test ever reaches the internet or sends a paid SMS.
// ---------------------------------------------------------------------------

type Row = Record<string, any>
const { db, trapHits, hooks, fakePrisma, trap } = vi.hoisted(() => {
  const names = ['tenants', 'businesses', 'conversations', 'messages', 'channelMessages', 'calls', 'consents', 'links', 'deliveries', 'connections', 'numbers', 'turns', 'webhookEvents'] as const
  const db = Object.fromEntries(names.map((t) => [t, [] as Row[]])) as Record<(typeof names)[number], Row[]> & Record<string, Row[]>
  const trapHits: string[] = []
  const hooks = { uniqueError: (msg: string): Error => new Error(msg) }

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
      const [k, dir] = orderBy ? (Object.entries(orderBy)[0] as [string, string]) : ['', 'asc']
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
        apply(row, data)
        return clone(row)
      },
      updateMany: async ({ where, data }: any) => {
        const list = rows().filter((r) => matches(r, where, table))
        for (const row of list) apply(row, data)
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
      const table = text.includes('call_interactions') ? 'calls' : text.includes('"conversations"') ? 'conversations' : null
      const found = table ? (db[table] as Row[]).find((r) => r.id === sql.values[0]) : null
      return found ? [{ id: found.id }] : []
    },
    $executeRaw: async () => 1,
    tenant: model('tenants'),
    callInteraction: model('calls'),
    conversation: model('conversations', () => ({ status: 'OPEN', customerId: null, customerRequestId: null, aiAutomationPausedAt: null, lastMessageAt: null }), [['channelConnectionId', 'externalConversationId']]),
    message: model('messages'),
    channelMessage: model('channelMessages', () => ({}), [['channelConnectionId', 'externalMessageId']]),
    channelConsent: model('consents', () => ({ revokedAt: null }), [['tenantId', 'businessId', 'channel', 'destinationE164']]),
    recoveryBridgeLink: model('links', () => ({ revokedAt: null, firstOpenedAt: null, lastOpenedAt: null, openCount: 0 }), [['tokenHash'], ['callInteractionId']]),
    channelDelivery: model(
      'deliveries',
      () => ({ status: 'PENDING', attemptCount: 0, lastAttemptAt: null, deliveredAt: null, failedAt: null, errorCode: null, errorMessage: null, externalMessageId: null, provider: null, providerDeliveryState: null, providerStatus: null, providerStatusAt: null, providerSegments: null }),
      [['channelConnectionId', 'messageId']]
    ),
    providerWebhookEvent: model('webhookEvents', () => ({ channelDeliveryId: null }), [['provider', 'eventId']]),
    aiConversationTurn: model('turns'),
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
vi.mock('../src/server/repositories/channelConnectionRepository', () => ({
  channelConnectionRepository: {
    findById: async (t: string, b: string, id: string) => structuredClone(db.connections.find((c) => c.tenantId === t && c.businessId === b && c.id === id) ?? null),
    list: async (t: string, b: string) => structuredClone(db.connections.filter((c) => c.tenantId === t && c.businessId === b)),
  },
}))
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
vi.mock('../src/server/services/aiService', () => trap('aiService'))
vi.mock('../src/server/ai/aiProviderFactory', () => trap('aiProviderFactory'))
vi.mock('../src/server/repositories/customerRepository', () => ({ customerRepository: trap('customerRepository', { findActiveByPhoneE164: async () => [] }) }))
vi.mock('../src/server/repositories/vehicleRepository', () => ({ vehicleRepository: trap('vehicleRepository') }))
vi.mock('../src/server/repositories/customerRequestRepository', () => ({ customerRequestRepository: trap('customerRequestRepository') }))
vi.mock('../src/server/repositories/appointmentRepository', () => ({ appointmentRepository: trap('appointmentRepository') }))

import { Prisma } from '@prisma/client'
import { makeBusiness, makeTenant } from './helpers/fixtures'
import { ingestCallEvent } from '../src/server/services/callIntakeService'
import { setRecoveryJobPublisher } from '../src/server/recovery/recoveryJobs'
import { handleRecoveryJob } from '../src/server/recovery/recoveryJobConsumer'
import { selectRecoveryChannel } from '../src/server/recovery/channelRouter'
import { resolveBridge } from '../src/server/recovery/bridge'
import { setMobizonFetchForTests, smsTransportStatus } from '../src/server/channels/smsTransport'
import { getChannelAdapter } from '../src/server/channels/channelAdapterRegistry'
import { callMobizon, type FetchLike } from '../src/server/channels/adapters/mobizon/mobizonClient'
import { createMobizonSmsAdapter } from '../src/server/channels/adapters/mobizon/mobizonSmsAdapter'
import { mobizonSignature } from '../src/server/channels/adapters/mobizon/mobizonWebhook'
import { canAdvanceDeliveryState, mapMobizonStatus } from '../src/server/channels/deliveryStatus'
import { estimateSmsSegments } from '../src/server/lib/smsSegments'
import { renderRecoveryTemplate, smsBridgeCandidates, MISSED_CALL_SMS_BRIDGE_V1 } from '../src/server/recovery/templates'
import { RECOVERY_SMS_MAX_SEGMENTS } from '../src/server/recovery/policy'
import { smsTransportView } from '../src/components/channels/recoverySetup'
import { deliveryLabel } from '../src/components/conversations/deliveryLabel'
import webhookHandler from '../api/webhooks/channels/mobizon'

// --- the fake Mobizon (shapes from the official API docs) --------------------
const API_KEY = 'test-key-123'
const SECRET = 'whsec-test'
interface Captured {
  url: string
  method: string
  headers: Record<string, string>
  body: URLSearchParams
}
const mobizon = {
  requests: [] as Captured[],
  nextMessageId: 169275418,
  send: null as null | ((req: Captured) => { status: number; body: string } | Error),
  statusOf: new Map<string, { status: string; segNum: number }>(),
  statusFails: false,
}
const ok = (data: unknown) => ({ status: 200, body: JSON.stringify({ code: 0, data, message: '' }) })
const fakeFetch: FetchLike = async (url, init) => {
  const req = { url, method: init.method, headers: init.headers, body: new URLSearchParams(init.body) }
  mobizon.requests.push(req)
  if (url.includes('/service/Message/GetSMSStatus')) {
    if (mobizon.statusFails) throw Object.assign(new Error('fetch failed'), { cause: { code: 'ECONNRESET' } })
    const id = req.body.get('ids')!
    const st = mobizon.statusOf.get(id)
    const r = ok(st ? [{ id: Number(id), status: st.status, segNum: st.segNum, startSendTs: '2026-10-05 05:00:01', statusUpdateTs: '2026-10-05 05:00:09' }] : [])
    return { status: r.status, text: async () => r.body }
  }
  const out = mobizon.send ? mobizon.send(req) : ok({ campaignId: 245455096, messageId: mobizon.nextMessageId++, status: 2 })
  if (out instanceof Error) throw out
  return { status: out.status, text: async () => out.body }
}
const sendRequests = () => mobizon.requests.filter((r) => r.url.includes('SendSmsMessage'))

function webhookEvent(over: { eventId?: number; attempt?: number; eventCreateTs?: string; messageId?: number | string; status?: string; to?: string; segNum?: number; eventType?: string } = {}, secret = SECRET) {
  const event: Row = {
    eventId: over.eventId ?? 26,
    eventType: over.eventType ?? 'sms-delivery-report',
    eventCreateTs: over.eventCreateTs ?? '2026-10-05 05:00:10',
    webhookId: 1,
    attempt: over.attempt ?? 1,
    data: { campaignId: 245455096, messageId: over.messageId ?? 169275418, segNum: over.segNum ?? 2, statusUpdateTs: '2026-10-05 05:00:09', status: over.status ?? 'DELIVRD', to: over.to ?? '77011234567' },
  }
  event.sign = createHash('sha1').update(`${event.eventId}|${event.attempt}|${event.eventCreateTs}|${secret}`).digest('hex')
  return event
}
async function postWebhook(body: unknown, method = 'POST') {
  const res = { statusCode: 0, json: undefined as any }
  const api: any = { status: (c: number) => ((res.statusCode = c), api), json: (b: unknown) => ((res.json = b), api) }
  await webhookHandler({ method, headers: {}, query: {}, body } as unknown as ApiRequest, api as ApiResponse)
  return res
}

// --- fixtures ---------------------------------------------------------------
const NOW = new Date('2026-10-05T05:00:00Z')
const CALLER_DIGITS = '77011234567'
const connection = (id: string, type: string, over: Row = {}): Row => ({ id, tenantId: 't1', businessId: 'b1', type, status: 'ACTIVE', displayName: id, externalAccountId: id, config: null, createdAt: new Date(0), updatedAt: new Date(0), ...over })
let evSeq = 0
async function missedCall(o: { caller?: string; called?: string } = {}) {
  vi.setSystemTime(new Date(Date.now() + 1000))
  const r = await ingestCallEvent({ provider: 'mock', providerEventId: `ev-${++evSeq}`, providerCallId: `pc-${evSeq}`, eventType: 'MISSED', direction: 'INBOUND', callerPhone: o.caller ?? '8 701 123 45 67', calledPhone: o.called ?? '+77272500000', occurredAt: null, wasAnswered: null })
  return r.callInteractionId
}
const recover = (callId: string, n = 1) => handleRecoveryJob({ callInteractionId: callId }, { messageId: `q-${callId}-${n}`, deliveryCount: n }).catch((e) => e)
const smsDelivery = () => db.deliveries.find((d) => d.channelConnectionId === 'sms-1')!

const ENV = { SMS_PROVIDER: 'mobizon', MOBIZON_API_KEY: API_KEY, MOBIZON_SENDER: 'AUTOSERVISE', MOBIZON_WEBHOOK_SECRET: SECRET, APP_URL: 'https://app.autoservise.test', RECOVERY_MOCK_CHANNEL_ENABLED: 'true' }
const logs: string[] = []

beforeEach(() => {
  evSeq = 0
  trapHits.length = 0
  hooks.uniqueError = (msg: string) => new Prisma.PrismaClientKnownRequestError(msg, { code: 'P2002', clientVersion: 'test' })
  for (const t of ['conversations', 'messages', 'channelMessages', 'calls', 'consents', 'links', 'deliveries', 'turns', 'webhookEvents']) db[t] = []
  db.tenants = [makeTenant({ id: 't1' }), makeTenant({ id: 't2' })]
  db.businesses = [makeBusiness({ id: 'b1', tenantId: 't1', name: 'Автосервис Тест' }), makeBusiness({ id: 'b2', tenantId: 't2', name: 'Чужой сервис' })]
  db.numbers = [
    { id: 'n1', tenantId: 't1', businessId: 'b1', phoneE164: '+77272500000', isActive: true },
    { id: 'n2', tenantId: 't2', businessId: 'b2', phoneE164: '+77172500000', isActive: true },
  ]
  db.connections = [
    connection('wa-1', 'WHATSAPP', { config: { customerEntryPhone: '+77272500100' } }),
    connection('sms-1', 'SMS'),
    connection('wa-2', 'WHATSAPP', { tenantId: 't2', businessId: 'b2', config: { customerEntryPhone: '+77172500200' } }),
    connection('sms-2', 'SMS', { tenantId: 't2', businessId: 'b2' }),
  ]
  Object.assign(mobizon, { requests: [], nextMessageId: 169275418, send: null, statusFails: false })
  mobizon.statusOf = new Map()
  setMobizonFetchForTests(fakeFetch)
  setRecoveryJobPublisher({ kind: 'test', publish: async () => ({ status: 'PUBLISHED', messageId: 'x' }) })
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
  expect(trapHits).toEqual([]) // no AI, no Customer / Vehicle / Request / Appointment — in every test
  // never the key, the full number, a bridge token or the SMS body in any log line
  for (const line of logs) {
    expect(line).not.toContain(API_KEY)
    expect(line).not.toContain(CALLER_DIGITS)
    expect(line).not.toMatch(/\/r\/[A-Za-z0-9_-]{22}/)
    expect(line).not.toContain('Вы звонили')
  }
})

// ---------------------------------------------------------------------------
describe('outbound request & response contract (official API shape)', () => {
  it('SendSmsMessage: POST https://api.mobizon.kz/service/Message/SendSmsMessage, apiKey in the query, form body', async () => {
    const adapter = getChannelAdapter('SMS')
    expect(adapter.provider).toBe('mobizon')
    const result = await adapter.sendMessage({ channelType: 'SMS', externalConversationId: CALLER_DIGITS, content: 'Тест', idempotencyKey: 'dlv-1' })
    expect(result).toEqual({ success: true, externalMessageId: '169275418' })
    const [req] = sendRequests()
    expect(req!.method).toBe('POST')
    expect(req!.url).toBe(`https://api.mobizon.kz/service/Message/SendSmsMessage?output=json&api=v1&apiKey=${API_KEY}`)
    expect(req!.headers['Content-Type']).toBe('application/x-www-form-urlencoded; charset=utf-8')
    expect(Object.fromEntries(req!.body)).toEqual({ recipient: CALLER_DIGITS, text: 'Тест', from: 'AUTOSERVISE', 'params[shortenLinks]': '0' })
  })

  it.each([
    ['code 1 (validation) → SMS_REJECTED, not retryable', ok(null) && { status: 200, body: '{"code":1,"data":{"recipient":"bad"},"message":"Неверный номер"}' }, { success: false, errorCode: 'SMS_REJECTED', retryable: false }],
    ['code 8 (login) → PROVIDER_AUTH_ERROR', { status: 200, body: '{"code":8,"data":null,"message":"x"}' }, { success: false, errorCode: 'PROVIDER_AUTH_ERROR', retryable: false }],
    ['code 30 (rate limit) → retryable', { status: 200, body: '{"code":30,"data":null,"message":"x"}' }, { success: false, errorCode: 'PROVIDER_RATE_LIMITED', retryable: true }],
    ['code 999 (service error) → transient', { status: 200, body: '{"code":999,"data":null,"message":"x"}' }, { success: false, errorCode: 'PROVIDER_TRANSIENT_ERROR', retryable: true }],
    ['HTTP 429 → rate limited', { status: 429, body: 'Too many' }, { success: false, errorCode: 'PROVIDER_RATE_LIMITED', retryable: true }],
    ['HTTP 502 without an API answer → UNCERTAIN', { status: 502, body: '<html>' }, { success: false, uncertain: true, errorCode: 'DELIVERY_UNCERTAIN' }],
    ['malformed 200 → UNCERTAIN', { status: 200, body: 'not json' }, { success: false, uncertain: true }],
    ['code 0 without messageId → UNCERTAIN', ok({ campaignId: 1 }), { success: false, uncertain: true }],
    ['code 100 (background) → UNCERTAIN', { status: 200, body: '{"code":100,"data":null,"message":""}' }, { success: false, uncertain: true }],
  ])('%s', async (_label, response, expected) => {
    mobizon.send = () => response as { status: number; body: string }
    const result = await getChannelAdapter('SMS').sendMessage({ channelType: 'SMS', externalConversationId: CALLER_DIGITS, content: 'x', idempotencyKey: 'd' })
    expect(result).toMatchObject(expected)
  })

  it('connection never established → transient (nothing sent); reset / abort mid-flight → UNCERTAIN', async () => {
    mobizon.send = () => Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } })
    expect(await getChannelAdapter('SMS').sendMessage({ channelType: 'SMS', externalConversationId: CALLER_DIGITS, content: 'x' })).toMatchObject({ success: false, retryable: true, errorCode: 'PROVIDER_TRANSIENT_ERROR' })
    mobizon.send = () => Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } })
    expect(await getChannelAdapter('SMS').sendMessage({ channelType: 'SMS', externalConversationId: CALLER_DIGITS, content: 'x' })).toMatchObject({ success: false, uncertain: true })
  })

  it('explicit timeout: a hanging request is aborted and reported as UNCERTAIN (TIMEOUT)', async () => {
    // (production uses MOBIZON_SEND_TIMEOUT_MS = 8 s; the mechanism is the same with 20 ms)
    const hanging: FetchLike = (_url, init) => new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))))
    expect(await callMobizon({ apiKey: API_KEY, baseUrl: 'https://api.mobizon.kz' }, hanging, 'Message/SendSmsMessage', {}, 20)).toEqual({ kind: 'UNKNOWN', reason: 'TIMEOUT' })
  })

  it('never sends to an invalid / missing destination', async () => {
    for (const bad of ['', 'anonymous', '+0123', '12']) {
      expect(await getChannelAdapter('SMS').sendMessage({ channelType: 'SMS', externalConversationId: bad, content: 'x' })).toMatchObject({ success: false, errorCode: 'INVALID_DESTINATION' })
    }
    expect(sendRequests()).toHaveLength(0)
  })

  it('GetSMSStatus is parsed from the documented shape', async () => {
    mobizon.statusOf.set('5', { status: 'DELIVRD', segNum: 2 })
    const adapter = createMobizonSmsAdapter({ apiKey: API_KEY, baseUrl: 'https://api.mobizon.kz' }, { fetchImpl: fakeFetch })
    expect(await adapter.fetchStatus('5')).toEqual({ ok: true, status: 'DELIVRD', segNum: 2 })
    expect(await adapter.fetchStatus('6')).toEqual({ ok: false, reason: 'NOT_FOUND' })
    expect(await adapter.fetchStatus('x')).toEqual({ ok: false, reason: 'BAD_ID' })
  })
})

// ---------------------------------------------------------------------------
describe('transport selection — explicit, fail closed', () => {
  it('SMS_PROVIDER=mobizon without a key → unavailable (never the mock); router does not offer SMS', async () => {
    delete process.env.MOBIZON_API_KEY
    expect(getChannelAdapter('SMS').businessInitiatedCapability!('+77011234567')).toEqual({ eligible: false, reason: 'PROVIDER_UNAVAILABLE' })
    expect(await selectRecoveryChannel({ tenantId: 't1', businessId: 'b1' }, '+77011234567', NOW)).toMatchObject({ ok: false, reason: 'WHATSAPP_NO_RECORDED_CONSENT|SMS_PROVIDER_UNAVAILABLE' })
    expect(smsTransportStatus()).toMatchObject({ provider: 'mobizon', mode: 'production', configured: false })
  })

  it('a non-official API base URL is refused (no SSRF)', () => {
    for (const bad of ['http://api.mobizon.kz', 'https://evil.example', 'https://api.mobizon.kz.evil.com', 'https://api.mobizon.kz:8443', 'https://api-mobizon.kz']) {
      process.env.MOBIZON_API_BASE_URL = bad
      expect(getChannelAdapter('SMS').provider).toBe('none')
    }
    process.env.MOBIZON_API_BASE_URL = 'https://api.mobizon.kz'
    expect(getChannelAdapter('SMS').provider).toBe('mobizon')
    delete process.env.MOBIZON_API_BASE_URL
  })

  it('production never uses the mock: SMS_PROVIDER=mock or unset → unavailable', () => {
    const prev = process.env.NODE_ENV
    process.env.NODE_ENV = 'production'
    try {
      process.env.SMS_PROVIDER = 'mock'
      expect(getChannelAdapter('SMS').provider).toBe('none')
      delete process.env.SMS_PROVIDER
      expect(getChannelAdapter('SMS').provider).toBe('none')
    } finally {
      process.env.NODE_ENV = prev
    }
    process.env.SMS_PROVIDER = 'mock'
    expect(getChannelAdapter('SMS').provider).toBe('mock') // dev/test only
  })

  it('Settings status never contains a secret and never claims a workshop-branded sender', () => {
    const status = smsTransportStatus()
    expect(JSON.stringify(status)).not.toContain(API_KEY)
    expect(JSON.stringify(status)).not.toContain(SECRET)
    expect(status).toEqual({ provider: 'mobizon', mode: 'production', configured: true, sender: 'AUTOSERVISE', senderScope: 'SHARED_ACCOUNT', webhookConfigured: true })
    const view = smsTransportView(status)
    expect(view).toMatchObject({ provider: 'Mobizon', mode: 'рабочий', status: 'настроен' })
    expect(view.sender).toContain('общий отправитель AUTOSERVISE, не собственное имя вашего автосервиса')
  })
})

// ---------------------------------------------------------------------------
describe('mocked-production vertical slice', () => {
  it('missed call → router → SMS_BRIDGE → Mobizon accepts → id stored → SENT → DELIVRD report → DELIVERED → bridge → wa.me', async () => {
    const callId = await missedCall()
    expect(await recover(callId)).toBe('SENT')
    expect(sendRequests()).toHaveLength(1) // one SMS
    const [req] = sendRequests()
    expect(req!.body.get('recipient')).toBe(CALLER_DIGITS) // canonical E.164 digits
    const text = req!.body.get('text')!
    expect(text).toMatch(/^Вы звонили в «Автосервис Тест», мастер был занят\. Продолжим в WhatsApp: https:\/\/app\.autoservise\.test\/r\/[A-Za-z0-9_-]{22}$/)

    expect(smsDelivery()).toMatchObject({ status: 'SENT', provider: 'mobizon', externalMessageId: '169275418', providerDeliveryState: null })
    expect(db.calls[0]).toMatchObject({ recoveryState: 'SENT', recoveryChannel: 'SMS_BRIDGE' }) // SENT = accepted
    expect(db.deliveries.filter((d) => d.channelConnectionId === 'wa-1')).toHaveLength(0) // no WhatsApp initiation
    expect(deliveryLabel({ ...(smsDelivery() as any), providerDeliveryState: null })).toEqual({ label: 'Принято оператором', variant: 'success' })

    mobizon.statusOf.set('169275418', { status: 'DELIVRD', segNum: 2 })
    const res = await postWebhook(webhookEvent())
    expect(res).toEqual({ statusCode: 200, json: { ok: true } })
    expect(smsDelivery()).toMatchObject({ providerDeliveryState: 'DELIVERED', providerStatus: 'DELIVRD', providerSegments: 2 })
    expect(smsDelivery().providerSegments).toBe(estimateSmsSegments(text).segments) // provider vs our estimate
    expect(deliveryLabel(smsDelivery() as any)).toEqual({ label: 'Доставлено', variant: 'success' })

    const token = text.split('/r/')[1]!
    expect(await resolveBridge(token)).toEqual({ kind: 'REDIRECT', url: expect.stringMatching(/^https:\/\/wa\.me\/77272500100\?text=/) })
    expect(db.messages.filter((m) => m.direction === 'INBOUND')).toHaveLength(0) // no fake inbound
    expect(db.turns).toHaveLength(0) // no AI
    expect(db.consents).toHaveLength(0)
    expect(db.calls[0]!.recoveryState).toBe('SENT') // the report changed delivery only
  })

  it('failure slice: Mobizon rejects before acceptance → FAILED (not retryable), no SENT, no WhatsApp fallback, no bridge', async () => {
    mobizon.send = () => ({ status: 200, body: '{"code":1,"data":null,"message":"Неверный номер"}' })
    const callId = await missedCall()
    expect(await recover(callId)).toBeInstanceOf(Error)
    expect(db.calls[0]).toMatchObject({ recoveryState: 'FAILED', recoveryFailureCode: 'SMS_REJECTED', recoverySentAt: null, recoveryChannel: 'SMS_BRIDGE' })
    expect(smsDelivery()).toMatchObject({ status: 'FAILED', errorCode: 'SMS_REJECTED' })
    expect(await recover(callId, 2)).toBe('SKIPPED') // never retried
    expect(sendRequests()).toHaveLength(1)
    expect(db.deliveries.filter((d) => d.channelConnectionId === 'wa-1')).toHaveLength(0)
    expect(db.links[0]!.openCount).toBe(0)
  })

  it('transient failure → the SAME SMS is retried by the existing rules, then accepted', async () => {
    let first = true
    mobizon.send = () => (first ? ((first = false), { status: 200, body: '{"code":30,"data":null,"message":""}' }) : ok({ campaignId: 1, messageId: 777, status: 2 }))
    const callId = await missedCall()
    expect(await recover(callId, 1)).toBeInstanceOf(Error)
    expect(db.calls[0]).toMatchObject({ recoveryState: 'FAILED', recoveryFailureCode: 'PROVIDER_RATE_LIMITED' })
    expect(await recover(callId, 2)).toBe('SENT')
    const [a, b] = sendRequests()
    expect(a!.body.get('text')).toBe(b!.body.get('text')) // same message, same link
    expect(smsDelivery()).toMatchObject({ status: 'SENT', attemptCount: 2, externalMessageId: '777' })
  })

  it('uncertain slice: the request may have reached Mobizon (timeout) → DELIVERY_UNCERTAIN, never resent, no WhatsApp', async () => {
    mobizon.send = () => Object.assign(new Error('aborted'), { name: 'AbortError' })
    const callId = await missedCall()
    await recover(callId, 1)
    expect(smsDelivery()).toMatchObject({ status: 'SENDING', errorCode: 'DELIVERY_UNCERTAIN', provider: 'mobizon' })
    expect(db.calls[0]).toMatchObject({ recoveryState: 'FAILED', recoveryFailureCode: 'DELIVERY_UNCERTAIN' })
    expect(deliveryLabel(smsDelivery() as any)).toEqual({ label: 'Отправка не подтверждена', variant: 'warning' })
    expect(await recover(callId, 2)).toBe('SKIPPED')
    expect(await recover(callId, 3)).toBe('SKIPPED')
    expect(sendRequests()).toHaveLength(1) // exactly one attempt reached the provider
    expect(db.deliveries.filter((d) => d.channelConnectionId === 'wa-1')).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
describe('delivery webhook security & idempotency', () => {
  async function sentSms() {
    const callId = await missedCall()
    await recover(callId)
    return smsDelivery()
  }

  it('invalid / missing / tampered signature → rejected before ANY write', async () => {
    await sentSms()
    mobizon.statusOf.set('169275418', { status: 'DELIVRD', segNum: 2 })
    const before = structuredClone(smsDelivery())
    expect((await postWebhook(webhookEvent({}, 'wrong-secret'))).statusCode).toBe(403)
    const { sign: _s, ...unsigned } = webhookEvent()
    expect((await postWebhook(unsigned)).statusCode).toBe(400)
    const tampered = { ...webhookEvent(), eventCreateTs: '2026-10-05 05:00:11' } // signed fields changed
    expect((await postWebhook(tampered)).statusCode).toBe(403)
    expect((await postWebhook('{not json')).statusCode).toBe(400)
    expect(db.webhookEvents).toHaveLength(0)
    expect(smsDelivery()).toEqual(before)
    expect(mobizon.requests.filter((r) => r.url.includes('GetSMSStatus'))).toHaveLength(0)
  })

  it('no secret configured → nothing is ever accepted (503)', async () => {
    delete process.env.MOBIZON_WEBHOOK_SECRET
    expect((await postWebhook(webhookEvent())).statusCode).toBe(503)
    expect(db.webhookEvents).toHaveLength(0)
  })

  it('the unsigned `data` is never trusted: the status comes from GetSMSStatus', async () => {
    await sentSms()
    mobizon.statusOf.set('169275418', { status: 'UNDELIV', segNum: 2 })
    await postWebhook(webhookEvent({ status: 'DELIVRD' })) // payload claims delivered
    expect(smsDelivery()).toMatchObject({ providerDeliveryState: 'UNDELIVERED', providerStatus: 'UNDELIV' })
    expect(deliveryLabel(smsDelivery() as any)).toEqual({ label: 'Не доставлено', variant: 'destructive' })
  })

  it('duplicate / retried event (same eventId, new attempt) → one transition, no second lookup', async () => {
    await sentSms()
    mobizon.statusOf.set('169275418', { status: 'DELIVRD', segNum: 2 })
    expect((await postWebhook(webhookEvent({ attempt: 1 }))).statusCode).toBe(200)
    const lookups = mobizon.requests.length
    expect((await postWebhook(webhookEvent({ attempt: 2 }))).statusCode).toBe(200)
    expect((await postWebhook(webhookEvent({ attempt: 1 }))).statusCode).toBe(200)
    expect(db.webhookEvents).toHaveLength(1)
    expect(mobizon.requests.length).toBe(lookups)
    expect(db.messages).toHaveLength(1) // only the SMS itself — no domain event / message from reports
  })

  it('out of order: DELIVERED never regresses to ACCEPTED or another final', async () => {
    await sentSms()
    mobizon.statusOf.set('169275418', { status: 'DELIVRD', segNum: 2 })
    await postWebhook(webhookEvent({ eventId: 30 }))
    mobizon.statusOf.set('169275418', { status: 'ACCEPTD', segNum: 2 })
    await postWebhook(webhookEvent({ eventId: 31 }))
    mobizon.statusOf.set('169275418', { status: 'UNDELIV', segNum: 2 })
    await postWebhook(webhookEvent({ eventId: 32 }))
    expect(smsDelivery()).toMatchObject({ providerDeliveryState: 'DELIVERED', providerStatus: 'DELIVRD' })
    expect(db.webhookEvents.map((e) => e.outcome)).toEqual(['APPLIED', 'NO_CHANGE', 'NO_CHANGE'])
  })

  it('in-transit → partial → final advances; an unknown future status is observable but never "delivered"', async () => {
    await sentSms()
    mobizon.statusOf.set('169275418', { status: 'ACCEPTD', segNum: 2 })
    await postWebhook(webhookEvent({ eventId: 40 }))
    expect(smsDelivery().providerDeliveryState).toBe('ACCEPTED')
    mobizon.statusOf.set('169275418', { status: 'BRANDNEW', segNum: 2 })
    expect((await postWebhook(webhookEvent({ eventId: 41 }))).statusCode).toBe(200)
    expect(smsDelivery()).toMatchObject({ providerDeliveryState: 'ACCEPTED', providerStatus: 'BRANDNEW' })
    mobizon.statusOf.set('169275418', { status: 'PDLIVRD', segNum: 2 })
    await postWebhook(webhookEvent({ eventId: 42 }))
    mobizon.statusOf.set('169275418', { status: 'DELIVRD', segNum: 2 })
    await postWebhook(webhookEvent({ eventId: 43 }))
    expect(smsDelivery().providerDeliveryState).toBe('DELIVERED')
  })

  it('unknown message id → 200, nothing changed, nothing revealed', async () => {
    await sentSms()
    const res = await postWebhook(webhookEvent({ messageId: 999999 }))
    expect(res).toEqual({ statusCode: 200, json: { ok: true } })
    expect(db.webhookEvents).toEqual([expect.objectContaining({ outcome: 'UNKNOWN_MESSAGE', channelDeliveryId: null })])
    expect(smsDelivery().providerDeliveryState).toBeNull()
  })

  it('cross-tenant spoof: payload tenant / business ignored; a report must match the number we sent to', async () => {
    await sentSms() // tenant 1, message 169275418
    const t2Call = await missedCall({ called: '+77172500000', caller: '8 701 999 88 77' })
    await recover(t2Call) // tenant 2, message 169275419
    mobizon.statusOf.set('169275419', { status: 'DELIVRD', segNum: 2 })
    const spoof = { ...webhookEvent({ eventId: 50, messageId: 169275419, to: CALLER_DIGITS }), tenantId: 't1', businessId: 'b1' }
    expect((await postWebhook(spoof)).statusCode).toBe(200)
    expect(db.webhookEvents.at(-1)).toMatchObject({ outcome: 'DESTINATION_MISMATCH' })
    expect(db.deliveries.every((d) => d.providerDeliveryState === null)).toBe(true)
    await postWebhook(webhookEvent({ eventId: 51, messageId: 169275419, to: '77019998877' }))
    expect(db.deliveries.find((d) => d.channelConnectionId === 'sms-2')).toMatchObject({ tenantId: 't2', providerDeliveryState: 'DELIVERED' })
    expect(smsDelivery().providerDeliveryState).toBeNull() // tenant 1 untouched
  })

  it('status lookup unavailable → 503 and no event row, so Mobizon retries the same eventId and it applies later', async () => {
    await sentSms()
    mobizon.statusFails = true
    expect((await postWebhook(webhookEvent({ eventId: 60 }))).statusCode).toBe(503)
    expect(db.webhookEvents).toHaveLength(0)
    mobizon.statusFails = false
    mobizon.statusOf.set('169275418', { status: 'DELIVRD', segNum: 2 })
    expect((await postWebhook(webhookEvent({ eventId: 60, attempt: 2 }))).statusCode).toBe(200)
    expect(smsDelivery().providerDeliveryState).toBe('DELIVERED')
  })

  it('other event types are acknowledged and ignored; GET is refused', async () => {
    expect((await postWebhook(webhookEvent({ eventId: 70, eventType: 'something-else' }))).statusCode).toBe(200)
    expect(db.webhookEvents[0]).toMatchObject({ outcome: 'IGNORED_EVENT_TYPE' })
    expect((await postWebhook({}, 'GET')).statusCode).toBe(405)
  })

  it('the signature is exactly SHA1(eventId|attempt|eventCreateTs|secret) (documented example shape)', () => {
    expect(mobizonSignature({ eventId: '26', attempt: '1', eventCreateTs: '2026-01-15 11:42:28' }, 'secret123')).toBe(createHash('sha1').update('26|1|2026-01-15 11:42:28|secret123').digest('hex'))
  })
})

// ---------------------------------------------------------------------------
describe('status mapping & SMS template measurement', () => {
  it('official Mobizon statuses map centrally; unknown → null', () => {
    expect(['NEW', 'ENQUEUD', 'ACCEPTD', 'PDLIVRD', 'DELIVRD', 'UNDELIV', 'REJECTD', 'EXPIRED', 'DELETED', 'WHAT'].map(mapMobizonStatus)).toEqual([
      'ACCEPTED', 'ACCEPTED', 'ACCEPTED', 'PARTIALLY_DELIVERED', 'DELIVERED', 'UNDELIVERED', 'REJECTED', 'EXPIRED', 'UNDELIVERED', null,
    ])
    expect(canAdvanceDeliveryState('DELIVERED', 'ACCEPTED')).toBe(false)
    expect(canAdvanceDeliveryState('DELIVERED', 'UNDELIVERED')).toBe(false)
    expect(canAdvanceDeliveryState('ACCEPTED', 'PARTIALLY_DELIVERED')).toBe(true)
    expect(canAdvanceDeliveryState('PARTIALLY_DELIVERED', 'ACCEPTED')).toBe(false)
  })

  it('measured: with a ~30-char APP_URL every named variant is 2 UCS-2 segments → the richest text is kept', () => {
    const url = `https://app.autoservise.test/r/${'A'.repeat(22)}`
    const text = renderRecoveryTemplate(MISSED_CALL_SMS_BRIDGE_V1, { businessName: 'Автосервис Тест', bridgeUrl: url })
    expect(estimateSmsSegments(text)).toMatchObject({ encoding: 'UCS2', units: 125, segments: 2 })
    expect(text).toContain('мастер был занят')
    expect(smsBridgeCandidates('Автосервис Тест', url).map((t) => estimateSmsSegments(t).segments)).toEqual([2, 2, 2])
  })

  it('a short first-party link domain buys ONE segment only without a name; a name is never dropped', () => {
    const shortUrl = `https://as.kz/r/${'A'.repeat(22)}`
    expect(estimateSmsSegments(renderRecoveryTemplate(MISSED_CALL_SMS_BRIDGE_V1, { businessName: null, bridgeUrl: shortUrl }))).toMatchObject({ segments: 1, units: 64 })
    const named = renderRecoveryTemplate(MISSED_CALL_SMS_BRIDGE_V1, { businessName: 'Автосервис Тест', bridgeUrl: shortUrl })
    expect(named).toContain('«Автосервис Тест»')
  })

  it.each([
    ['short', 'СТО'],
    ['long Cyrillic', 'Автотехцентр «Кузовной ремонт и покраска на Северном кольце»'],
    ['long Latin', 'Premium Auto Body & Paint Service Center Almaty'],
  ])('%s business name stays within the segment budget (the real name is untouched)', (_label, name) => {
    const url = `https://app.autoservise.test/r/${'A'.repeat(22)}`
    const text = renderRecoveryTemplate(MISSED_CALL_SMS_BRIDGE_V1, { businessName: name, bridgeUrl: url })
    expect(estimateSmsSegments(text).segments).toBeLessThanOrEqual(RECOVERY_SMS_MAX_SEGMENTS)
    expect(text.endsWith(url)).toBe(true) // the 128-bit token link is never shortened
  })

  it('RECOVERY_LINK_BASE_URL (first-party short origin) is used for new links', async () => {
    process.env.RECOVERY_LINK_BASE_URL = 'https://as.kz'
    try {
      const callId = await missedCall()
      await recover(callId)
      expect(sendRequests()[0]!.body.get('text')).toMatch(/https:\/\/as\.kz\/r\/[A-Za-z0-9_-]{22}$/)
    } finally {
      delete process.env.RECOVERY_LINK_BASE_URL
    }
  })
})
