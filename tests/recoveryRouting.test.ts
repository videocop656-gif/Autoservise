import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { randomUUID } from 'node:crypto'
import type { ApiRequest, ApiResponse } from '../src/server/types/http'

// ---------------------------------------------------------------------------
// MCR-6 — Recovery Channel Router & SMS → WhatsApp bridge. The REAL MCR-2
// intake, MCR-4.1 queue consumer, MCR-4 engine (claim, anti-spam, late
// answer, pinning), the router, the routing repositories (consent, WhatsApp
// session window, bridge links), the bridge resolver + public endpoint, the
// delivery core and the mock WhatsApp / SMS adapters run on one in-memory
// Prisma double (transactions serialized = the row locks of the real SQL).
// No real SMS, WhatsApp, telephony or AI.
// ---------------------------------------------------------------------------

type Row = Record<string, any>
const { db, trapHits, hooks, fakePrisma, trap } = vi.hoisted(() => {
  const names = ['tenants', 'businesses', 'conversations', 'messages', 'channelMessages', 'calls', 'consents', 'links', 'deliveries', 'connections', 'numbers', 'turns'] as const
  const db = Object.fromEntries(names.map((t) => [t, [] as Row[]])) as Record<(typeof names)[number], Row[]> & Record<string, Row[]>
  const trapHits: string[] = []
  const hooks = { whatsappDown: false, onConsentLookup: null as null | (() => void), onRoute: null as null | (() => void) }

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
  // Relation filters the code under test uses on messages.
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
  function compoundWhere(where: Row): Row {
    // Prisma compound unique keys: { a_b_c: { a, b, c } } → { a, b, c }
    const out: Row = {}
    for (const [k, v] of Object.entries(where)) {
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
        const found = sort(rows().filter((r) => matches(r, compoundWhere(where ?? {}), table)), orderBy)[0]
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
        if (violates(row)) throw new Error(`Unique constraint failed on ${table}`)
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
            throw new Error(`Unique constraint failed on ${table}`)
          }
          rows().push(row)
          count++
        }
        return { count }
      },
      update: async ({ where, data }: any) => {
        const row = rows().find((r) => matches(r, compoundWhere(where), table))
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
        const row = rows().find((r) => matches(r, compoundWhere(where), table))
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
vi.mock('../src/server/channels/channelAdapterRegistry', async () => {
  const real = await vi.importActual<typeof import('../src/server/channels/channelAdapterRegistry')>('../src/server/channels/channelAdapterRegistry')
  return {
    getChannelAdapter: (type: any) => {
      const adapter = real.getChannelAdapter(type)
      if (type === 'WHATSAPP' && hooks.whatsappDown) return { ...adapter, businessInitiatedCapability: () => ({ eligible: false, reason: 'PROVIDER_UNAVAILABLE' }) }
      return adapter
    },
  }
})
vi.mock('../src/server/repositories/channelConnectionRepository', () => ({
  channelConnectionRepository: {
    findById: async (t: string, b: string, id: string) => structuredClone(db.connections.find((c) => c.tenantId === t && c.businessId === b && c.id === id) ?? null),
    list: async (t: string, b: string) => {
      hooks.onRoute?.()
      return structuredClone(db.connections.filter((c) => c.tenantId === t && c.businessId === b))
    },
    create: async (data: Row) => {
      const row = { id: randomUUID(), createdAt: new Date(), updatedAt: new Date(), ...data }
      db.connections.push(row)
      return structuredClone(row)
    },
    updateById: async (t: string, b: string, id: string, data: Row) => {
      const row = db.connections.find((c) => c.tenantId === t && c.businessId === b && c.id === id)
      if (!row) return null
      Object.assign(row, data)
      return structuredClone(row)
    },
  },
}))
vi.mock('../src/server/repositories/recoveryRoutingRepository', async () => {
  const real = await vi.importActual<typeof import('../src/server/repositories/recoveryRoutingRepository')>('../src/server/repositories/recoveryRoutingRepository')
  return {
    ...real,
    channelConsentRepository: {
      ...real.channelConsentRepository,
      find: async (...args: Parameters<typeof real.channelConsentRepository.find>) => {
        hooks.onConsentLookup?.()
        return real.channelConsentRepository.find(...args)
      },
    },
  }
})
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
vi.mock('../src/server/services/channelCustomerService', () => ({
  resolveCustomerForInbound: async () => ({ customerId: null, newIdentityToLink: null }),
  linkCustomerIdentityBestEffort: async () => undefined,
}))
// Recovery never touches AI or creates CRM records.
vi.mock('../src/server/services/aiService', () => trap('aiService'))
vi.mock('../src/server/ai/aiProviderFactory', () => trap('aiProviderFactory'))
vi.mock('../src/server/repositories/customerRepository', () => ({ customerRepository: trap('customerRepository', { findActiveByPhoneE164: async () => [] }) }))
vi.mock('../src/server/repositories/vehicleRepository', () => ({ vehicleRepository: trap('vehicleRepository') }))
vi.mock('../src/server/repositories/customerRequestRepository', () => ({ customerRequestRepository: trap('customerRequestRepository') }))
vi.mock('../src/server/repositories/appointmentRepository', () => ({ appointmentRepository: trap('appointmentRepository') }))

import { makeAuthContext, makeBusiness, makeTenant } from './helpers/fixtures'
import { ingestCallEvent } from '../src/server/services/callIntakeService'
import { processRecovery } from '../src/server/services/callRecoveryService'
import { setRecoveryJobPublisher, type RecoveryJob } from '../src/server/recovery/recoveryJobs'
import { handleRecoveryJob } from '../src/server/recovery/recoveryJobConsumer'
import { selectRecoveryChannel } from '../src/server/recovery/channelRouter'
import { resolveBridge, hashBridgeToken, publicBridgeBaseUrl } from '../src/server/recovery/bridge'
import { channelConsentRepository } from '../src/server/repositories/recoveryRoutingRepository'
import { estimateSmsSegments } from '../src/server/lib/smsSegments'
import { renderRecoveryTemplate, MISSED_CALL_SMS_BRIDGE_V1 } from '../src/server/recovery/templates'
import { RECOVERY_BRIDGE_PREFILL_TEXT, RECOVERY_BRIDGE_LINK_TTL_HOURS, RECOVERY_STALE_CLAIM_SECONDS, RECOVERY_SMS_MAX_SEGMENTS } from '../src/server/recovery/policy'
import { receiveIncoming } from '../src/server/services/channelMessageService'
import { createChannelConnection, updateChannelConnection } from '../src/server/services/channelConnectionService'
import { toConversationDto } from '../src/server/lib/dto'
import { recoveryReasonText, RECOVERY_ROUTE_LABELS } from '../src/components/conversations/recoveryRoute'
import { recoverySetupView } from '../src/components/channels/recoverySetup'
import bridgeHandler from '../api/bridge/[token]'

// --- fixtures ---------------------------------------------------------------
const NOW = new Date('2026-10-05T05:00:00Z')
const CALLER = '+77011234567'
const THREAD = '77011234567'
const ENTRY_T1 = '+77272500100'
const ENTRY_T2 = '+77172500200'
const scope1 = { tenantId: 't1', businessId: 'b1' }

const tick = (seconds = 1) => vi.setSystemTime(new Date(Date.now() + seconds * 1000))
const callById = (id: string) => db.calls.find((c) => c.id === id)!
const smsMessages = () => db.messages.filter((m) => db.conversations.find((c) => c.id === m.conversationId)?.channel === 'SMS')
const waMessages = () => db.messages.filter((m) => m.direction === 'OUTBOUND' && db.conversations.find((c) => c.id === m.conversationId)?.channel === 'WHATSAPP')
const deliveriesOn = (connectionId: string) => db.deliveries.filter((d) => d.channelConnectionId === connectionId)
const bridgeUrlOf = (text: string) => /https?:\/\/\S+\/r\/[A-Za-z0-9_-]+/.exec(text)?.[0] ?? null
const tokenOf = (url: string) => url.split('/r/')[1]!

const recoveryJobs: RecoveryJob[] = []
let evSeq = 0
async function missedCall(o: { caller?: string; called?: string; providerCallId?: string } = {}) {
  tick()
  const r = await ingestCallEvent({
    provider: 'mock',
    providerEventId: `ev-${++evSeq}`,
    providerCallId: o.providerCallId ?? `pc-${evSeq}`,
    eventType: 'MISSED',
    direction: 'INBOUND',
    callerPhone: o.caller ?? '8 701 123 45 67',
    calledPhone: o.called ?? '+77272500000',
    occurredAt: null,
    wasAnswered: null,
  })
  return r.callInteractionId
}
const recover = (callId: string, deliveryCount = 1) => handleRecoveryJob({ callInteractionId: callId }, { messageId: `q-${callId}-${deliveryCount}`, deliveryCount }).catch((e) => e)

function connection(id: string, type: string, over: Row = {}): Row {
  return { id, tenantId: 't1', businessId: 'b1', type, status: 'ACTIVE', displayName: id, externalAccountId: id, config: null, createdAt: new Date(0), updatedAt: new Date(0), ...over }
}
const WA_ENTRY = { customerEntryPhone: ENTRY_T1 }
const WA_TEMPLATE = { customerEntryPhone: ENTRY_T1, approvedTemplates: 'MISSED_CALL_RECOVERY_V1' }

function req(token: unknown, method = 'GET') {
  const res = { statusCode: 200, headers: {} as Record<string, string>, body: '' as string, json: undefined as unknown }
  const api: any = {
    setHeader: (k: string, v: string) => ((res.headers[k.toLowerCase()] = v), api),
    status: (c: number) => ((res.statusCode = c), api),
    json: (b: unknown) => ((res.json = b), api),
    end: (b?: string) => ((res.body = b ?? ''), api),
  }
  Object.defineProperty(api, 'statusCode', { get: () => res.statusCode, set: (v) => (res.statusCode = v) })
  return { res, run: () => bridgeHandler({ method, headers: {}, query: { token }, body: undefined } as unknown as ApiRequest, api as ApiResponse) }
}

beforeEach(() => {
  evSeq = 0
  trapHits.length = 0
  Object.assign(hooks, { whatsappDown: false, onConsentLookup: null, onRoute: null })
  for (const t of ['conversations', 'messages', 'channelMessages', 'calls', 'consents', 'links', 'deliveries', 'turns']) db[t] = []
  db.tenants = [makeTenant({ id: 't1' }), makeTenant({ id: 't2' })]
  db.businesses = [
    makeBusiness({ id: 'b1', tenantId: 't1', name: 'Автосервис Тест', timezone: 'Asia/Almaty', currency: 'KZT' }),
    makeBusiness({ id: 'b2', tenantId: 't2', name: 'Чужой сервис', timezone: 'Asia/Almaty', currency: 'KZT' }),
  ]
  db.numbers = [
    { id: 'n1', tenantId: 't1', businessId: 'b1', phoneE164: '+77272500000', isActive: true },
    { id: 'n2', tenantId: 't2', businessId: 'b2', phoneE164: '+77172500000', isActive: true },
  ]
  db.connections = [
    connection('wa-1', 'WHATSAPP', { config: { ...WA_ENTRY } }),
    connection('sms-1', 'SMS'),
    connection('tg-1', 'TELEGRAM'),
    connection('wa-2', 'WHATSAPP', { tenantId: 't2', businessId: 'b2', config: { customerEntryPhone: ENTRY_T2 } }),
    connection('sms-2', 'SMS', { tenantId: 't2', businessId: 'b2' }),
  ]
  recoveryJobs.length = 0
  setRecoveryJobPublisher({ kind: 'test', publish: async (job) => (recoveryJobs.push(job), { status: 'PUBLISHED', messageId: 'x' }) })
  process.env.RECOVERY_MOCK_CHANNEL_ENABLED = 'true'
  process.env.APP_URL = 'https://app.autoservise.test'
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})
afterEach(() => {
  vi.useRealTimers()
  setRecoveryJobPublisher(null)
  delete process.env.RECOVERY_MOCK_CHANNEL_ENABLED
  delete process.env.APP_URL
  // No AI, no Customer / Vehicle / CustomerRequest / Appointment write — in every test.
  expect(trapHits).toEqual([])
})

// ---------------------------------------------------------------------------
describe('routing policy — capability, consent, session and template are separate', () => {
  it('A/B/F. a missed call creates no consent; UNKNOWN consent is not permission → SMS bridge', async () => {
    const decision = await selectRecoveryChannel(scope1, CALLER, NOW)
    expect(decision).toMatchObject({ ok: true, route: 'SMS_BRIDGE', reason: 'WHATSAPP_NO_RECORDED_CONSENT' })
    expect(decision.whatsapp).toMatchObject({ technicallyAvailable: true, consent: 'UNKNOWN', sessionOpen: false, approvedRecoveryTemplateAvailable: false, initiationPermitted: false })
    const callId = await missedCall()
    expect(await recover(callId)).toBe('SENT')
    expect(db.consents).toEqual([]) // A: the call did not become consent
  })

  it('C. OPTED_OUT never selects WhatsApp — not even with an open session', async () => {
    await channelConsentRepository.record({ ...scope1, channel: 'WHATSAPP', destinationE164: CALLER, status: 'OPTED_OUT', source: 'CUSTOMER_OPT_OUT_MESSAGE', at: NOW })
    await receiveIncoming(makeAuthContext('owner'), 'wa-1', { externalMessageId: 'w1', externalConversationId: THREAD, text: 'Привет', sentAt: new Date(NOW.getTime() - 60_000) })
    const decision = await selectRecoveryChannel(scope1, CALLER, NOW)
    expect(decision).toMatchObject({ ok: true, route: 'SMS_BRIDGE', reason: 'WHATSAPP_OPTED_OUT' })
  })

  it('D. recorded OPTED_IN + approved template → WhatsApp; OPTED_IN without a template → SMS', async () => {
    await channelConsentRepository.record({ ...scope1, channel: 'WHATSAPP', destinationE164: CALLER, status: 'OPTED_IN', source: 'CUSTOMER_OPT_IN_MESSAGE', at: NOW })
    expect(await selectRecoveryChannel(scope1, CALLER, NOW)).toMatchObject({ route: 'SMS_BRIDGE', reason: 'WHATSAPP_TEMPLATE_UNAVAILABLE' })
    db.connections[0]!.config = { ...WA_TEMPLATE }
    expect(await selectRecoveryChannel(scope1, CALLER, NOW)).toMatchObject({ route: 'WHATSAPP', reason: 'WHATSAPP_TEMPLATE_AVAILABLE' })
  })

  it('the customer-service window opens only on an AUTHORITATIVE inbound WhatsApp message, for 24 h', async () => {
    // a manually logged inbound message is not a session
    db.conversations.push({ id: 'c-manual', tenantId: 't1', businessId: 'b1', channel: 'WHATSAPP', channelConnectionId: 'wa-1', externalConversationId: THREAD, status: 'OPEN' })
    db.messages.push({ id: 'm-manual', tenantId: 't1', businessId: 'b1', conversationId: 'c-manual', direction: 'INBOUND', senderType: 'CUSTOMER', content: 'x', createdAt: new Date(NOW.getTime() - 60_000) })
    expect(await selectRecoveryChannel(scope1, CALLER, NOW)).toMatchObject({ route: 'SMS_BRIDGE', reason: 'WHATSAPP_NO_RECORDED_CONSENT' })
    db.conversations = []
    db.messages = []
    await receiveIncoming(makeAuthContext('owner'), 'wa-1', { externalMessageId: 'w1', externalConversationId: THREAD, text: 'Здравствуйте', sentAt: new Date(NOW.getTime() - 23 * 3_600_000) })
    expect(await selectRecoveryChannel(scope1, CALLER, NOW)).toMatchObject({ route: 'WHATSAPP', reason: 'WHATSAPP_SESSION_OPEN' })
    expect(await selectRecoveryChannel(scope1, CALLER, new Date(NOW.getTime() + 2 * 3_600_000))).toMatchObject({ route: 'SMS_BRIDGE' })
  })

  it('E. WhatsApp provider unavailable + SMS available → SMS bridge (the fallback happens before any send)', async () => {
    hooks.whatsappDown = true
    await channelConsentRepository.record({ ...scope1, channel: 'WHATSAPP', destinationE164: CALLER, status: 'OPTED_IN', source: 'PROVIDER_EVENT', at: NOW })
    db.connections[0]!.config = { ...WA_TEMPLATE }
    expect(await selectRecoveryChannel(scope1, CALLER, NOW)).toMatchObject({ route: 'SMS_BRIDGE', reason: 'WHATSAPP_PROVIDER_UNAVAILABLE' })
  })

  it('G/H. no WhatsApp and no SMS → NO_ELIGIBLE_CHANNEL; Telegram is never a candidate', async () => {
    db.connections = db.connections.filter((c) => c.type === 'TELEGRAM')
    expect(await selectRecoveryChannel(scope1, CALLER, NOW)).toMatchObject({ ok: false, reason: 'WHATSAPP_NOT_CONFIGURED|SMS_NOT_CONFIGURED' })
  })

  it('SMS without a WhatsApp customer entry or without a public URL is not a bridge', async () => {
    db.connections[0]!.config = null
    expect(await selectRecoveryChannel(scope1, CALLER, NOW)).toMatchObject({ ok: false, reason: 'WHATSAPP_NO_RECORDED_CONSENT|SMS_WHATSAPP_ENTRY_NOT_CONFIGURED' })
    db.connections[0]!.config = { ...WA_ENTRY }
    const prev = process.env.NODE_ENV
    process.env.APP_URL = 'http://localhost:5173'
    process.env.NODE_ENV = 'production'
    try {
      expect(publicBridgeBaseUrl()).toBeNull()
    } finally {
      process.env.NODE_ENV = prev
    }
  })
})

// ---------------------------------------------------------------------------
describe('SMS template & segments', () => {
  it('S. Russian text is UCS-2 (70 / 67 per part); GSM-7 boundaries; emoji costs 2', () => {
    expect(estimateSmsSegments('Привет')).toMatchObject({ encoding: 'UCS2', segments: 1 })
    expect(estimateSmsSegments('я'.repeat(70))).toMatchObject({ encoding: 'UCS2', segments: 1 })
    expect(estimateSmsSegments('я'.repeat(71))).toMatchObject({ encoding: 'UCS2', segments: 2 })
    expect(estimateSmsSegments('я'.repeat(135))).toMatchObject({ segments: 3 })
    expect(estimateSmsSegments('a'.repeat(160))).toMatchObject({ encoding: 'GSM7', segments: 1 })
    expect(estimateSmsSegments('a'.repeat(161))).toMatchObject({ encoding: 'GSM7', segments: 2 })
    expect(estimateSmsSegments('€'.repeat(80))).toMatchObject({ encoding: 'GSM7', units: 160, segments: 1 })
    expect(estimateSmsSegments('😀')).toMatchObject({ encoding: 'UCS2', units: 2 })
  })

  it('T. the SMS bridge template is deterministic, has one CTA and stays within the segment budget', () => {
    const url = `https://app.autoservise.test/r/${'A'.repeat(22)}`
    const text = renderRecoveryTemplate(MISSED_CALL_SMS_BRIDGE_V1, { businessName: 'Автосервис Тест', bridgeUrl: url })
    expect(text).toBe(`Вы звонили в «Автосервис Тест», мастер был занят. Продолжим в WhatsApp: ${url}`)
    expect(text.replace(url, '')).not.toMatch(/₸|\d|AUTOSERVISE|диагноз|цен/i) // no price, number, branding, diagnosis
    expect(estimateSmsSegments(text).segments).toBeLessThanOrEqual(RECOVERY_SMS_MAX_SEGMENTS)
    const long = renderRecoveryTemplate(MISSED_CALL_SMS_BRIDGE_V1, { businessName: 'Очень длинное название автосервиса на проспекте', bridgeUrl: url })
    expect(long).toContain('…»')
    expect(estimateSmsSegments(long).segments).toBeLessThanOrEqual(RECOVERY_SMS_MAX_SEGMENTS)
  })
})

// ---------------------------------------------------------------------------
describe('vertical slice #1 — UNKNOWN consent → SMS bridge → WhatsApp entry', () => {
  it('missed call → READY → queue → router (UNKNOWN) → SMS → SENT → bridge → wa.me of THIS business', async () => {
    const callId = await missedCall()
    expect(recoveryJobs).toEqual([{ callInteractionId: callId }])
    expect(await recover(callId)).toBe('SENT')

    // recovery SENT = the (mock) SMS provider accepted the SMS; audit persisted (AC)
    expect(callById(callId)).toMatchObject({ recoveryState: 'SENT', recoveryChannel: 'SMS_BRIDGE', recoveryRouteReason: 'WHATSAPP_NO_RECORDED_CONSENT', recoveryTemplateKey: 'MISSED_CALL_SMS_BRIDGE_V1' })
    expect(smsMessages()).toHaveLength(1)
    expect(deliveriesOn('sms-1')).toEqual([expect.objectContaining({ status: 'SENT' })])
    expect(deliveriesOn('wa-1')).toHaveLength(0) // no business-initiated WhatsApp
    expect(waMessages()).toHaveLength(0)

    // I. the link carries nothing but an opaque token
    const sms = smsMessages()[0]!.content
    const url = bridgeUrlOf(sms)!
    expect(url).toMatch(/^https:\/\/app\.autoservise\.test\/r\/[A-Za-z0-9_-]{22}$/)
    for (const secret of [THREAD, '7011234567', 't1', 'b1', callId, 'sms-1']) expect(url).not.toContain(secret)
    expect(db.links).toEqual([expect.objectContaining({ callInteractionId: callId, tokenHash: hashBridgeToken(tokenOf(url)), openCount: 0 })])
    expect(db.links[0]!.tokenHash).not.toBe(tokenOf(url)) // only the hash is stored

    // open the bridge (public endpoint)
    const messagesBefore = db.messages.length
    const { res, run } = req(tokenOf(url))
    await run()
    expect(res.statusCode).toBe(302)
    const location = new URL(res.headers.location!)
    expect(location.origin + location.pathname).toBe('https://wa.me/77272500100') // P: this business's entry
    expect(location.searchParams.get('text')).toBe(RECOVERY_BRIDGE_PREFILL_TEXT) // R
    expect(res.headers.location).not.toMatch(/ /) // properly encoded
    expect(res.headers['cache-control']).toBe('no-store')
    expect(res.headers['referrer-policy']).toBe('no-referrer')

    // attribution only: no consent (N), no inbound message (O), no AI turn
    expect(db.links[0]).toMatchObject({ openCount: 1, firstOpenedAt: expect.any(Date) })
    expect(db.consents).toEqual([])
    expect(db.messages).toHaveLength(messagesBefore)
    expect(db.messages.filter((m) => m.direction === 'INBOUND')).toHaveLength(0)
    expect(db.turns).toHaveLength(0)
    expect(await selectRecoveryChannel(scope1, CALLER, new Date())).toMatchObject({ route: 'SMS_BRIDGE', reason: 'WHATSAPP_NO_RECORDED_CONSENT' }) // still no session
  })

  it('M. repeated clicks keep redirecting; first-open time stays, the counter grows', async () => {
    const callId = await missedCall()
    await recover(callId)
    const token = tokenOf(bridgeUrlOf(smsMessages()[0]!.content)!)
    expect(await resolveBridge(token)).toMatchObject({ kind: 'REDIRECT' })
    const first = db.links[0]!.firstOpenedAt
    tick(60)
    expect(await resolveBridge(token)).toMatchObject({ kind: 'REDIRECT' })
    expect(db.links[0]).toMatchObject({ openCount: 2, firstOpenedAt: first })
  })

  it('J/K. malformed, unknown, expired or revoked tokens fail the same neutral way', async () => {
    const callId = await missedCall()
    await recover(callId)
    const token = tokenOf(bridgeUrlOf(smsMessages()[0]!.content)!)
    const spy = vi.spyOn(fakePrisma.recoveryBridgeLink, 'findUnique')
    for (const bad of ['', 'short', '../../etc/passwd', 'x'.repeat(200), 12345, null]) expect(await resolveBridge(bad)).toEqual({ kind: 'INVALID' })
    expect(spy).not.toHaveBeenCalled() // malformed → no DB access
    expect(await resolveBridge('A'.repeat(22))).toEqual({ kind: 'INVALID' }) // well-formed, unknown
    vi.setSystemTime(new Date(Date.now() + RECOVERY_BRIDGE_LINK_TTL_HOURS * 3_600_000 + 1000))
    expect(await resolveBridge(token)).toEqual({ kind: 'INVALID' }) // expired
    vi.setSystemTime(NOW)
    db.links[0]!.revokedAt = new Date()
    expect(await resolveBridge(token)).toEqual({ kind: 'INVALID' }) // revoked
    const { res, run } = req('A'.repeat(22))
    await run()
    expect(res.statusCode).toBe(404)
    expect(res.body).toContain('Ссылка недействительна')
    expect(res.body).not.toMatch(/Автосервис Тест|\+7|wa\.me|t1|b1/)
    expect(db.links[0]!.openCount).toBe(0)
  })

  it('L/Q. a token only ever opens ITS business; no entry configured → invalid, never another business’s number', async () => {
    const t2Call = await missedCall({ called: '+77172500000', caller: '8 701 999 88 77' })
    await recover(t2Call)
    const t2Token = tokenOf(bridgeUrlOf(smsMessages()[0]!.content)!)
    expect(await resolveBridge(t2Token)).toEqual({ kind: 'REDIRECT', url: expect.stringMatching(/^https:\/\/wa\.me\/77172500200\?/) })
    db.connections.find((c) => c.id === 'wa-2')!.config = null // tenant 2 removes its entry number
    expect(await resolveBridge(t2Token)).toEqual({ kind: 'INVALID' }) // never falls back to tenant 1's ENTRY_T1
  })

  it('POST to the bridge is refused', async () => {
    const { res, run } = req('A'.repeat(22), 'POST')
    await run()
    expect(res.statusCode).toBe(405)
  })
})

// ---------------------------------------------------------------------------
describe('vertical slices #2 and #3', () => {
  it('#2. WhatsApp genuinely permitted → the existing WhatsApp recovery, NO SMS', async () => {
    db.connections[0]!.config = { ...WA_TEMPLATE }
    await channelConsentRepository.record({ ...scope1, channel: 'WHATSAPP', destinationE164: CALLER, status: 'OPTED_IN', source: 'CUSTOMER_OPT_IN_MESSAGE', at: NOW })
    const callId = await missedCall()
    expect(await recover(callId)).toBe('SENT')
    expect(callById(callId)).toMatchObject({ recoveryChannel: 'WHATSAPP', recoveryRouteReason: 'WHATSAPP_TEMPLATE_AVAILABLE', recoveryTemplateKey: 'MISSED_CALL_RECOVERY_V1' })
    expect(waMessages().map((m) => m.content)).toEqual([expect.stringContaining('Вы только что звонили')])
    expect(deliveriesOn('sms-1')).toHaveLength(0)
    expect(smsMessages()).toHaveLength(0)
    expect(db.links).toHaveLength(0)
  })

  it('#3. nothing available → FAILED NO_ELIGIBLE_CHANNEL with the reason; no conversation, no fake SENT', async () => {
    db.connections = db.connections.filter((c) => c.tenantId !== 't1' || c.type === 'TELEGRAM')
    const callId = await missedCall()
    expect(await recover(callId)).toBeInstanceOf(Error) // FAILED → queue retry (MCR-4.1)
    expect(callById(callId)).toMatchObject({ recoveryState: 'FAILED', recoveryFailureCode: 'NO_ELIGIBLE_CHANNEL', recoveryRouteReason: 'WHATSAPP_NOT_CONFIGURED|SMS_NOT_CONFIGURED', recoverySentAt: null, recoveryChannel: null })
    expect(db.conversations).toHaveLength(0)
    expect(db.messages).toHaveLength(0)
    expect(db.deliveries).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
describe('idempotency, concurrency, anti-spam, late answer', () => {
  it('U. duplicate queue delivery → one SMS', async () => {
    const callId = await missedCall()
    expect(await recover(callId, 1)).toBe('SENT')
    expect(await recover(callId, 2)).toBe('SKIPPED')
    expect(smsMessages()).toHaveLength(1)
    expect(db.deliveries).toHaveLength(1)
    expect(db.links).toHaveLength(1)
  })

  it('V. five concurrent processors → exactly one SMS message / delivery / link', async () => {
    const callId = await missedCall()
    const results = await Promise.all(Array.from({ length: 5 }, () => processRecovery(callId)))
    expect(results.filter((r) => r === 'SENT')).toHaveLength(1)
    expect(smsMessages()).toHaveLength(1)
    expect(db.deliveries).toHaveLength(1)
    expect(db.links).toHaveLength(1)
  })

  it('consent turning OPTED_IN while workers race → still ONE recovery on ONE channel', async () => {
    db.connections[0]!.config = { ...WA_TEMPLATE }
    const callId = await missedCall()
    let flipped = false
    hooks.onConsentLookup = () => {
      if (flipped) return
      flipped = true
      db.consents.push({ id: 'c1', tenantId: 't1', businessId: 'b1', channel: 'WHATSAPP', destinationE164: CALLER, status: 'OPTED_IN', source: 'PROVIDER_EVENT', recordedAt: NOW, revokedAt: null })
    }
    await Promise.all(Array.from({ length: 5 }, () => processRecovery(callId)))
    expect(db.messages.filter((m) => m.direction === 'OUTBOUND')).toHaveLength(1)
    expect(db.deliveries).toHaveLength(1)
    expect(callById(callId).recoveryChannel).toBe('WHATSAPP') // the winner saw the committed consent; the route is pinned
  })

  it('W. anti-spam is channel-independent: call #1 → SMS, consent appears, call #2 two minutes later → SUPPRESSED (not WhatsApp)', async () => {
    db.connections[0]!.config = { ...WA_TEMPLATE }
    const first = await missedCall()
    expect(await recover(first)).toBe('SENT')
    await channelConsentRepository.record({ ...scope1, channel: 'WHATSAPP', destinationE164: CALLER, status: 'OPTED_IN', source: 'CUSTOMER_OPT_IN_MESSAGE', at: new Date() })
    tick(120)
    const second = await missedCall()
    expect(await recover(second)).toBe('SUPPRESSED')
    expect(callById(second)).toMatchObject({ recoveryState: 'SUPPRESSED', recoveryIneligibleReason: 'ANTI_SPAM' })
    expect(waMessages()).toHaveLength(0)
  })

  it('X. late ANSWERED (before or during routing) → no SMS, no WhatsApp', async () => {
    const answered = await missedCall()
    callById(answered).outcome = 'ANSWERED'
    expect(await recover(answered)).toBe('NOT_ELIGIBLE')
    const during = await missedCall({ caller: '8 701 222 33 44' })
    hooks.onRoute = () => {
      hooks.onRoute = null
      callById(during).outcome = 'ANSWERED'
    }
    expect(await recover(during)).toBe('NOT_ELIGIBLE')
    expect(db.messages).toHaveLength(0)
    expect(db.deliveries).toHaveLength(0)
    expect(db.links).toHaveLength(0)
  })

  it('Y/AA. WhatsApp failure after the attempt → retried on WhatsApp with the SAME message; never an SMS', async () => {
    db.connections[0]!.config = { ...WA_TEMPLATE }
    await channelConsentRepository.record({ ...scope1, channel: 'WHATSAPP', destinationE164: '+77010000000', status: 'OPTED_IN', source: 'PROVIDER_EVENT', at: NOW })
    const callId = await missedCall({ caller: '+77010000000' }) // the mock provider rejects …0000
    expect(await recover(callId, 1)).toBeInstanceOf(Error)
    expect(callById(callId)).toMatchObject({ recoveryState: 'FAILED', recoveryChannel: 'WHATSAPP' })
    hooks.whatsappDown = true // even if WhatsApp now looks unavailable, the route stays pinned
    await recover(callId, 2)
    expect(waMessages()).toHaveLength(1)
    expect(deliveriesOn('wa-1')).toEqual([expect.objectContaining({ attemptCount: 2, status: 'FAILED' })])
    expect(smsMessages()).toHaveLength(0)
    expect(deliveriesOn('sms-1')).toHaveLength(0)
  })

  it('Z. DELIVERY_UNCERTAIN (send possibly happened) → never a second-channel send', async () => {
    db.connections[0]!.config = { ...WA_TEMPLATE }
    await channelConsentRepository.record({ ...scope1, channel: 'WHATSAPP', destinationE164: CALLER, status: 'OPTED_IN', source: 'PROVIDER_EVENT', at: NOW })
    const callId = await missedCall()
    expect(await recover(callId)).toBe('SENT')
    // simulate: the provider accepted but the confirmation was lost
    Object.assign(db.deliveries[0]!, { status: 'SENDING' })
    const stale = new Date(Date.now() - (RECOVERY_STALE_CLAIM_SECONDS + 5) * 1000)
    Object.assign(callById(callId), { recoveryState: 'CLAIMED', recoveryClaimedAt: stale, updatedAt: stale })
    await recover(callId, 2)
    expect(callById(callId)).toMatchObject({ recoveryState: 'FAILED', recoveryFailureCode: 'DELIVERY_UNCERTAIN', recoveryChannel: 'WHATSAPP' })
    expect(await recover(callId, 3)).toBe('SKIPPED')
    expect(smsMessages()).toHaveLength(0)
    expect(db.deliveries).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
describe('tenant isolation, configuration, UI wording, MCR-5 boundary', () => {
  it('AB. tenant 1’s consent never permits tenant 2; tenant 2 uses only its own channels', async () => {
    db.connections.find((c) => c.id === 'wa-2')!.config = { customerEntryPhone: ENTRY_T2, approvedTemplates: 'MISSED_CALL_RECOVERY_V1' }
    await channelConsentRepository.record({ ...scope1, channel: 'WHATSAPP', destinationE164: CALLER, status: 'OPTED_IN', source: 'PROVIDER_EVENT', at: NOW })
    const t2Call = await missedCall({ called: '+77172500000' })
    expect(await recover(t2Call)).toBe('SENT')
    expect(callById(t2Call)).toMatchObject({ tenantId: 't2', recoveryChannel: 'SMS_BRIDGE', recoveryRouteReason: 'WHATSAPP_NO_RECORDED_CONSENT' })
    expect(db.deliveries).toEqual([expect.objectContaining({ tenantId: 't2', channelConnectionId: 'sms-2' })])
    expect(db.links).toEqual([expect.objectContaining({ tenantId: 't2', businessId: 'b2' })])
  })

  it('the WhatsApp customer-entry number is validated and stored as E.164 (WhatsApp only)', async () => {
    const ctx = makeAuthContext('owner')
    const updated = await updateChannelConnection(ctx, 'wa-1', { config: { customerEntryPhone: '8 727 250 01 00' } })
    expect(updated.config).toEqual({ customerEntryPhone: '+77272500100' })
    await expect(updateChannelConnection(ctx, 'wa-1', { config: { customerEntryPhone: 'не номер' } })).rejects.toMatchObject({ statusCode: 400 })
    await expect(createChannelConnection(ctx, { type: 'SMS', displayName: 'SMS', externalAccountId: 'sms-x', config: { customerEntryPhone: '+77001112233' } })).rejects.toMatchObject({ statusCode: 400 })
  })

  it('AF. an inbound SMS is refused (two-way SMS is a future stage) — MCR-5 starts only from a supported inbound', async () => {
    await expect(receiveIncoming(makeAuthContext('owner'), 'sms-1', { externalMessageId: 's1', externalConversationId: THREAD, text: 'Привет', sentAt: NOW })).rejects.toMatchObject({ code: 'CHANNEL_INBOUND_UNSUPPORTED' })
    expect(db.messages).toHaveLength(0)
    expect(db.turns).toHaveLength(0)
  })

  it('operators see Russian route labels, never raw codes; the conversation DTO carries the route', async () => {
    expect(RECOVERY_ROUTE_LABELS.SMS_BRIDGE).toBe('SMS со ссылкой на WhatsApp')
    expect(recoveryReasonText('WHATSAPP_NO_RECORDED_CONSENT')).toBe('WhatsApp пока недоступен для первого сообщения — нет согласия клиента')
    expect(recoveryReasonText('WHATSAPP_NOT_CONFIGURED|SMS_NOT_CONFIGURED')).toBe('WhatsApp не подключён; SMS не подключены')
    expect(recoveryReasonText('WHATSAPP_NO_RECORDED_CONSENT')).not.toContain('NO_RECORDED_CONSENT')
    const dto = toConversationDto({
      ...({ id: 'c', customerId: null, customerRequestId: null, channel: 'SMS', status: 'OPEN', subject: null, startedAt: NOW, lastMessageAt: null, closedAt: null, createdAt: NOW, updatedAt: NOW, channelConnectionId: 'sms-1', aiAutomationPausedAt: null, aiAutomationPausedReason: null } as any),
      recoveredCalls: [{ recoveryState: 'SENT', recoveryChannel: 'SMS_BRIDGE', recoveryRouteReason: 'WHATSAPP_NO_RECORDED_CONSENT', recoverySentAt: NOW, bridgeLink: { firstOpenedAt: NOW, openCount: 2 } }],
    })
    expect(dto.recovery).toEqual({ state: 'SENT', channel: 'SMS_BRIDGE', routeReason: 'WHATSAPP_NO_RECORDED_CONSENT', sentAt: NOW, bridgeOpenedAt: NOW, bridgeOpenCount: 2 })
  })

  it('Settings → Channels summary', () => {
    expect(recoverySetupView([])).toMatchObject({ whatsapp: { configured: false, label: 'не подключён' }, sms: { configured: false } })
    expect(recoverySetupView([{ type: 'WHATSAPP', status: 'ACTIVE', config: null }])).toMatchObject({ whatsapp: { configured: false, label: expect.stringContaining('не указан номер') } })
    expect(recoverySetupView([{ type: 'WHATSAPP', status: 'ACTIVE', config: { customerEntryPhone: '+7701' } }, { type: 'SMS', status: 'ACTIVE', config: null }])).toMatchObject({ whatsapp: { configured: true }, sms: { configured: true, label: 'подключены' } })
  })
})
