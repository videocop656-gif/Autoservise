import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { ApiRequest, ApiResponse } from '../src/server/types/http'

// ---------------------------------------------------------------------------
// MCR-4 — Missed Call Recovery Engine. The real callRecoveryService,
// callRecoveryRepository, channel router, template, deliverSystemMessage and
// the real mock WhatsApp adapter run on an in-memory Prisma double.
// runInTransaction models the row locks the real code takes (SELECT … FOR
// UPDATE / pg_advisory_xact_lock): transactions run one at a time and a
// throwing one is rolled back. The real SQL is raced on Supabase
// (final-report-mcr-4).
// ---------------------------------------------------------------------------

type Row = Record<string, any>
const { db, trapHits, hooks, fakePrisma, counter, id, trap } = vi.hoisted(() => {
  const db = { calls: [] as Row[], conversations: [] as Row[], messages: [] as Row[], deliveries: [] as Row[], connections: [] as Row[] }
  const trapHits = [] as string[]
  const hooks = { onRoute: null as null | (() => void) }
  // --- tiny Prisma `where` matcher (the subset the engine uses) --------------
  function matchValue(value: any, cond: any): boolean {
    if (cond === null || typeof cond !== 'object' || cond instanceof Date) {
      return cond instanceof Date ? value instanceof Date && value.getTime() === cond.getTime() : value === cond
    }
    if ('not' in cond) return cond.not === null ? value !== null && value !== undefined : value !== cond.not
    if ('in' in cond) return cond.in.includes(value)
    if ('lt' in cond) return value != null && value < cond.lt
    if ('gte' in cond) return value != null && value >= cond.gte
    return false
  }
  function matches(row: Row, where: any): boolean {
    return Object.entries(where ?? {}).every(([key, cond]) => {
      if (key === 'OR') return (cond as any[]).some((w) => matches(row, w))
      if (key === 'NOT') return !matches(row, cond)
      return matchValue(row[key], cond)
    })
  }
  const counter = { seq: 0 }
  const id = (p: string) => `${p}-${++counter.seq}`

  const fakePrisma = {
    advisoryLocks: [] as string[],
    $executeRaw: async (sql: { values: unknown[] }) => {
      fakePrisma.advisoryLocks.push(String(sql.values[0]))
      return 1
    },
    $queryRaw: async (sql: { values: unknown[]; text?: string; strings?: string[] }) => {
      const text = (sql as any).text ?? (sql as any).strings?.join('?') ?? ''
      // Like Prisma: a void-returning function can't be read as rows via $queryRaw.
      if (text.includes('pg_advisory_xact_lock')) throw new Error("Failed to deserialize column of type 'void'")
      const found = db.calls.find((c) => c.id === sql.values[0])
      return found ? [{ id: found.id }] : []
    },
    callInteraction: {
      findMany: async ({ where, take }: any) => db.calls.filter((c) => matches(c, where)).sort((a, b) => a.outcomeDetectedAt - b.outcomeDetectedAt).slice(0, take).map((c) => ({ id: c.id })),
      findUniqueOrThrow: async ({ where }: any) => ({ ...db.calls.find((c) => c.id === where.id)! }),
      count: async ({ where }: any) => db.calls.filter((c) => matches(c, where)).length,
      update: async ({ where, data }: any) => {
        const row = db.calls.find((c) => c.id === where.id)!
        for (const [k, v] of Object.entries(data)) row[k] = v && typeof v === 'object' && 'increment' in (v as any) ? row[k] + (v as any).increment : v
        row.updatedAt = new Date()
        return { ...row }
      },
      updateMany: async ({ where, data }: any) => {
        const rows = db.calls.filter((c) => matches(c, where))
        for (const row of rows) Object.assign(row, data, { updatedAt: new Date() })
        return { count: rows.length }
      },
    },
    conversation: {
      findFirst: async ({ where }: any) => db.conversations.find((c) => matches(c, where)) ?? null,
      findFirstOrThrow: async ({ where }: any) => db.conversations.find((c) => matches(c, where))!,
      createMany: async ({ data }: any) => {
        for (const d of data) {
          if (!db.conversations.some((c) => c.channelConnectionId === d.channelConnectionId && c.externalConversationId === d.externalConversationId)) {
            db.conversations.push({ id: id('conv'), ...d })
          }
        }
        return { count: 1 }
      },
      update: async ({ where, data }: any) => Object.assign(db.conversations.find((c) => c.id === where.id)!, data),
    },
    message: {
      create: async ({ data }: any) => {
        const row = { id: id('msg'), createdAt: new Date(), ...data }
        db.messages.push(row)
        return row
      },
    },
  }

  const trap = (name: string) => new Proxy({}, { get: (_t, prop) => () => { trapHits.push(`${name}.${String(prop)}`); throw new Error(`${name} must not be used`) } })
  return { db, trapHits, hooks, fakePrisma, counter, id, trap }
})



vi.mock('../src/server/db/prisma', () => ({ prisma: fakePrisma }))

let chain: Promise<unknown> = Promise.resolve()
vi.mock('../src/server/db/transaction', () => ({
  runInTransaction: (fn: (tx: unknown) => Promise<unknown>) => {
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
}))
vi.mock('../src/server/repositories/channelConnectionRepository', () => ({
  channelConnectionRepository: {
    list: async (t: string, b: string) => {
      hooks.onRoute?.()
      return db.connections.filter((c) => c.tenantId === t && c.businessId === b)
    },
    findById: async (t: string, b: string, cid: string) => db.connections.find((c) => c.tenantId === t && c.businessId === b && c.id === cid) ?? null,
  },
}))
// MCR-6 — these MCR-4 tests exercise the PERMITTED WhatsApp path: the caller
// has recorded WhatsApp consent and the connection an approved recovery
// template (routing itself is covered in tests/recoveryRouting.test.ts).
vi.mock('../src/server/repositories/recoveryRoutingRepository', () => ({
  channelConsentRepository: { find: async (_t: string, _b: string, channel: string) => (channel === 'WHATSAPP' ? { status: 'OPTED_IN' } : null) },
  customerServiceWindowRepository: { latestInboundAt: async () => null },
  bridgeLinkRepository: { create: async () => undefined },
}))
vi.mock('../src/server/repositories/messageRepository', () => ({
  messageRepository: { findById: async (t: string, b: string, mid: string) => db.messages.find((m) => m.tenantId === t && m.businessId === b && m.id === mid) ?? null },
}))
vi.mock('../src/server/repositories/conversationRepository', () => ({
  conversationRepository: { findById: async (t: string, b: string, cid: string) => db.conversations.find((c) => c.tenantId === t && c.businessId === b && c.id === cid) ?? null },
}))
vi.mock('../src/server/repositories/channelDeliveryRepository', () => ({
  channelDeliveryRepository: {
    claimForSending: async (t: string, b: string, conn: string, mid: string) => {
      await new Promise((r) => setTimeout(r, 1))
      let row = db.deliveries.find((d) => d.channelConnectionId === conn && d.messageId === mid)
      if (!row) {
        row = { id: id('dlv'), tenantId: t, businessId: b, channelConnectionId: conn, messageId: mid, status: 'PENDING', attemptCount: 0, deliveredAt: null }
        db.deliveries.push(row)
      }
      if (row.status === 'SENT') return { outcome: 'ALREADY_SENT', delivery: { ...row } }
      if (row.status === 'SENDING') return { outcome: 'IN_PROGRESS', delivery: { ...row } }
      Object.assign(row, { status: 'SENDING', attemptCount: row.attemptCount + 1 })
      return { outcome: 'CLAIMED', delivery: { ...row } }
    },
    markSent: async (did: string, ext: string | null) => Object.assign(db.deliveries.find((d) => d.id === did)!, { status: 'SENT', externalMessageId: ext, deliveredAt: new Date() }),
    markFailed: async (did: string, code: string, msg: string) => Object.assign(db.deliveries.find((d) => d.id === did)!, { status: 'FAILED', errorCode: code, errorMessage: msg }),
  },
}))
vi.mock('../src/server/repositories/businessRepository', () => ({
  businessRepository: { findFirstByTenant: async (t: string) => ({ id: t === 't1' ? 'b1' : 'b2', name: t === 't1' ? 'Автосервис Тест' : 'Чужой' }) },
}))
// Nothing here may ever be touched by recovery.
vi.mock('../src/server/services/aiService', () => trap('aiService'))
vi.mock('../src/server/repositories/customerRepository', () => ({ customerRepository: trap('customerRepository') }))
vi.mock('../src/server/repositories/vehicleRepository', () => ({ vehicleRepository: trap('vehicleRepository') }))
vi.mock('../src/server/repositories/customerRequestRepository', () => ({ customerRequestRepository: trap('customerRequestRepository') }))
vi.mock('../src/server/repositories/appointmentRepository', () => ({ appointmentRepository: trap('appointmentRepository') }))

import { processRecovery, processPendingRecoveries } from '../src/server/services/callRecoveryService'
import { renderRecoveryTemplate, MISSED_CALL_RECOVERY_V1 } from '../src/server/recovery/templates'
import { RECOVERY_ANTI_SPAM_WINDOW_MINUTES, RECOVERY_MAX_ATTEMPTS, recoveryThreadKey } from '../src/server/recovery/policy'
import { selectRecoveryChannel } from '../src/server/recovery/channelRouter'
import processorHandler from '../api/internal/recovery/process'

const CALLER = '+77011234567'
const NOW = new Date('2026-10-05T09:00:00Z')
const at = (minutesFromNow: number) => new Date(NOW.getTime() + minutesFromNow * 60_000)

function seedCall(over: Row = {}): Row {
  const row: Row = {
    id: id('call'),
    tenantId: 't1',
    businessId: 'b1',
    direction: 'INBOUND',
    outcome: 'MISSED',
    remotePhoneE164: CALLER,
    customerId: null,
    outcomeDetectedAt: at(-1),
    firstEventReceivedAt: at(-2),
    recoveryState: 'READY',
    recoveryIneligibleReason: null,
    recoveryClaimedAt: null,
    recoverySentAt: null,
    recoveryAttemptCount: 0,
    recoveryFailureCode: null,
    recoveryTemplateKey: null,
    recoveryConversationId: null,
    recoveryMessageId: null,
    updatedAt: at(-1),
    ...over,
  }
  db.calls.push(row)
  return row
}
const call = (cid: string) => db.calls.find((c) => c.id === cid)!
const outbound = () => db.messages.filter((m) => m.direction === 'OUTBOUND')
const sentDeliveries = () => db.deliveries.filter((d) => d.status === 'SENT')

beforeEach(() => {
  counter.seq = 0
  trapHits.length = 0
  hooks.onRoute = null
  db.calls = []
  db.conversations = []
  db.messages = []
  db.deliveries = []
  db.connections = [
    { id: 'wa-1', tenantId: 't1', businessId: 'b1', type: 'WHATSAPP', status: 'ACTIVE', config: { approvedTemplates: 'MISSED_CALL_RECOVERY_V1' }, createdAt: new Date(0) },
    { id: 'tg-1', tenantId: 't1', businessId: 'b1', type: 'TELEGRAM', status: 'ACTIVE' },
    { id: 'wa-foreign', tenantId: 't2', businessId: 'b2', type: 'WHATSAPP', status: 'ACTIVE', config: { approvedTemplates: 'MISSED_CALL_RECOVERY_V1' }, createdAt: new Date(0) },
  ]
  process.env.RECOVERY_MOCK_CHANNEL_ENABLED = 'true'
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})
afterEach(() => {
  vi.useRealTimers()
  delete process.env.RECOVERY_MOCK_CHANNEL_ENABLED
  expect(trapHits).toEqual([]) // S/T/U/V: no AI, no request, no appointment, no customer/vehicle write — in every test
})

// ---------------------------------------------------------------------------
describe('happy path — one missed call, one deterministic message', () => {
  it('READY → CLAIMED → Conversation + SYSTEM message → ChannelDelivery SENT → recovery SENT', async () => {
    const c = seedCall({ customerId: 'cust-1' })
    expect(await processRecovery(c.id, NOW)).toBe('SENT')

    const saved = call(c.id)
    expect(saved).toMatchObject({ recoveryState: 'SENT', recoveryAttemptCount: 1, recoveryTemplateKey: MISSED_CALL_RECOVERY_V1, recoveryFailureCode: null })
    expect(saved.recoveryClaimedAt).toEqual(NOW)
    expect(saved.recoverySentAt).toEqual(NOW)

    expect(db.conversations).toHaveLength(1)
    const conv = db.conversations[0]!
    expect(conv).toMatchObject({ tenantId: 't1', businessId: 'b1', channelConnectionId: 'wa-1', channel: 'WHATSAPP', externalConversationId: recoveryThreadKey(CALLER), customerId: 'cust-1' })
    expect(saved.recoveryConversationId).toBe(conv.id)

    expect(outbound()).toHaveLength(1)
    const msg = outbound()[0]!
    expect(msg).toMatchObject({ senderType: 'SYSTEM', direction: 'OUTBOUND', conversationId: conv.id, content: renderRecoveryTemplate(MISSED_CALL_RECOVERY_V1, { businessName: 'Автосервис Тест' }) })
    expect(saved.recoveryMessageId).toBe(msg.id)

    expect(db.deliveries).toHaveLength(1)
    expect(db.deliveries[0]).toMatchObject({ status: 'SENT', channelConnectionId: 'wa-1', messageId: msg.id, externalMessageId: `mock-out-${db.deliveries[0]!.id}` })
  })

  it('unknown caller: phone-based conversation, customerId null, no customer created', async () => {
    const c = seedCall()
    expect(await processRecovery(c.id, NOW)).toBe('SENT')
    expect(db.conversations[0]!.customerId).toBeNull()
  })

  it('reuses an existing conversation of the same number on the recovery channel', async () => {
    db.conversations.push({ id: 'conv-existing', tenantId: 't1', businessId: 'b1', channelConnectionId: 'wa-1', externalConversationId: recoveryThreadKey(CALLER), channel: 'WHATSAPP', customerId: null })
    const c = seedCall()
    await processRecovery(c.id, NOW)
    expect(db.conversations).toHaveLength(1)
    expect(call(c.id).recoveryConversationId).toBe('conv-existing')
  })
})

// ---------------------------------------------------------------------------
describe('state machine / claiming', () => {
  it.each([
    ['PENDING'],
    ['NOT_ELIGIBLE'],
    ['SENT'],
    ['SUPPRESSED'],
  ])('%s is never claimed', async (recoveryState) => {
    const c = seedCall({ recoveryState })
    expect(await processRecovery(c.id, NOW)).toBe('SKIPPED')
    expect(outbound()).toHaveLength(0)
  })

  it('duplicate invocation: second run is a no-op — one message, one send', async () => {
    const c = seedCall()
    expect(await processRecovery(c.id, NOW)).toBe('SENT')
    expect(await processRecovery(c.id, NOW)).toBe('SKIPPED')
    expect(outbound()).toHaveLength(1)
    expect(sentDeliveries()).toHaveLength(1)
  })

  it('5 concurrent processors on one call: one claim, one message, one send', async () => {
    const c = seedCall()
    const results = await Promise.all(Array.from({ length: 5 }, () => processRecovery(c.id, NOW)))
    expect(results.filter((r) => r === 'SENT')).toHaveLength(1)
    expect(results.filter((r) => r === 'SKIPPED')).toHaveLength(4)
    expect(outbound()).toHaveLength(1)
    expect(db.deliveries).toHaveLength(1)
  })

  it('a stale CLAIMED (crashed processor) is re-claimed; a fresh one is not', async () => {
    const fresh = seedCall({ recoveryState: 'CLAIMED', recoveryClaimedAt: at(-1), updatedAt: at(-1) })
    expect(await processRecovery(fresh.id, NOW)).toBe('SKIPPED')
    const stale = seedCall({ remotePhoneE164: '+77019998877', recoveryState: 'CLAIMED', recoveryClaimedAt: at(-5), updatedAt: at(-5) })
    expect(await processRecovery(stale.id, NOW)).toBe('SENT')
    expect(call(stale.id).recoveryClaimedAt).toEqual(at(-5)) // first-claim latency milestone kept
  })
})

// ---------------------------------------------------------------------------
describe('late answer', () => {
  it('ANSWERED before the claim → NOT_ELIGIBLE, nothing created or sent', async () => {
    const c = seedCall({ outcome: 'ANSWERED' })
    expect(await processRecovery(c.id, NOW)).toBe('NOT_ELIGIBLE')
    expect(call(c.id)).toMatchObject({ recoveryState: 'NOT_ELIGIBLE', recoveryIneligibleReason: 'ANSWERED' })
    expect(db.conversations).toHaveLength(0)
    expect(outbound()).toHaveLength(0)
  })

  it('ANSWERED arriving after the claim (during routing) → re-checked under the lock: NOT_ELIGIBLE, no message, no send', async () => {
    const c = seedCall()
    hooks.onRoute = () => {
      call(c.id).outcome = 'ANSWERED' // the late webhook committed meanwhile
    }
    expect(await processRecovery(c.id, NOW)).toBe('NOT_ELIGIBLE')
    expect(call(c.id).recoveryState).toBe('NOT_ELIGIBLE')
    expect(outbound()).toHaveLength(0)
    expect(db.deliveries).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
describe('anti-spam', () => {
  it(`three missed calls in 2 minutes → all kept, only the first is recovered, later ones SUPPRESSED (${RECOVERY_ANTI_SPAM_WINDOW_MINUTES} min window)`, async () => {
    const a = seedCall({ outcomeDetectedAt: at(-3) })
    const b = seedCall({ outcomeDetectedAt: at(-2) })
    const c = seedCall({ outcomeDetectedAt: at(-1) })
    const summary = await processPendingRecoveries({ now: NOW })
    expect(summary).toMatchObject({ processed: 3, sent: 1, suppressed: 2 })
    expect(call(a.id).recoveryState).toBe('SENT')
    for (const later of [b, c]) expect(call(later.id)).toMatchObject({ recoveryState: 'SUPPRESSED', recoveryIneligibleReason: 'ANTI_SPAM' })
    expect(db.calls).toHaveLength(3)
    expect(outbound()).toHaveLength(1)
  })

  it('the anti-spam decision is serialized per tenant + business + caller (advisory lock via $executeRaw)', async () => {
    fakePrisma.advisoryLocks.length = 0
    const c = seedCall()
    await processRecovery(c.id, NOW)
    expect(fakePrisma.advisoryLocks).toEqual([`t1:b1:${CALLER}`])
  })

  it('boundary: detected exactly at the window edge is suppressed; one millisecond later is recovered', async () => {
    seedCall({ remotePhoneE164: CALLER, recoveryState: 'SENT', recoverySentAt: at(-30), outcomeDetectedAt: at(-31) })
    const edge = seedCall({ outcomeDetectedAt: new Date(at(-30).getTime() + RECOVERY_ANTI_SPAM_WINDOW_MINUTES * 60_000) })
    expect(await processRecovery(edge.id, NOW)).toBe('SUPPRESSED')
    const after = seedCall({ outcomeDetectedAt: new Date(at(-30).getTime() + RECOVERY_ANTI_SPAM_WINDOW_MINUTES * 60_000 + 1) })
    expect(await processRecovery(after.id, NOW)).toBe('SENT')
  })

  it('a FAILED earlier recovery never suppresses a later genuine call', async () => {
    seedCall({ recoveryState: 'FAILED', recoveryFailureCode: 'NO_ELIGIBLE_CHANNEL', recoveryAttemptCount: 3, recoveryClaimedAt: at(-2), outcomeDetectedAt: at(-2) })
    const later = seedCall({ outcomeDetectedAt: at(-1) })
    expect(await processRecovery(later.id, NOW)).toBe('SENT')
  })

  it('another caller or another business is never suppressed', async () => {
    seedCall({ recoveryState: 'SENT', recoverySentAt: at(-1) })
    const otherCaller = seedCall({ remotePhoneE164: '+77019998877' })
    expect(await processRecovery(otherCaller.id, NOW)).toBe('SENT')
  })

  it('too late to say "вы только что звонили" → SUPPRESSED TOO_LATE', async () => {
    const old = seedCall({ outcomeDetectedAt: at(-31) })
    expect(await processRecovery(old.id, NOW)).toBe('SUPPRESSED')
    expect(call(old.id).recoveryIneligibleReason).toBe('TOO_LATE')
  })
})

// ---------------------------------------------------------------------------
describe('channel routing & capability', () => {
  it('only a WhatsApp connection can recover; Telegram is never used even when it is the only channel', async () => {
    db.connections = db.connections.filter((c) => c.type === 'TELEGRAM')
    const c = seedCall()
    expect(await processRecovery(c.id, NOW)).toBe('FAILED')
    expect(call(c.id)).toMatchObject({ recoveryState: 'FAILED', recoveryFailureCode: 'NO_ELIGIBLE_CHANNEL' })
    expect(db.conversations).toHaveLength(0)
    expect(outbound()).toHaveLength(0)
  })

  it('router explains why each channel was blocked (MCR-6 decision shape)', async () => {
    delete process.env.RECOVERY_MOCK_CHANNEL_ENABLED
    expect(await selectRecoveryChannel({ tenantId: 't1', businessId: 'b1' }, CALLER)).toMatchObject({ ok: false, reason: 'WHATSAPP_PROVIDER_UNAVAILABLE|SMS_NOT_CONFIGURED' })
    db.connections = []
    expect(await selectRecoveryChannel({ tenantId: 't1', businessId: 'b1' }, CALLER)).toMatchObject({ ok: false, reason: 'WHATSAPP_NOT_CONFIGURED|SMS_NOT_CONFIGURED' })
  })

  it('mock channel disabled (no flag) → no eligible channel: FAILED, nothing sent, never a fake SENT', async () => {
    delete process.env.RECOVERY_MOCK_CHANNEL_ENABLED
    const c = seedCall()
    expect(await processRecovery(c.id, NOW)).toBe('FAILED')
    expect(call(c.id).recoverySentAt).toBeNull()
    expect(db.deliveries).toHaveLength(0)
  })

  it('production never treats the mock as a recovery channel', async () => {
    const prev = process.env.NODE_ENV
    process.env.NODE_ENV = 'production'
    try {
      const r = await selectRecoveryChannel({ tenantId: 't1', businessId: 'b1' }, CALLER)
      expect(r.ok).toBe(false)
    } finally {
      process.env.NODE_ENV = prev
    }
  })

  it("an inactive WhatsApp connection or another tenant's connection is never used", async () => {
    db.connections = [
      { id: 'wa-1', tenantId: 't1', businessId: 'b1', type: 'WHATSAPP', status: 'INACTIVE', config: { approvedTemplates: 'MISSED_CALL_RECOVERY_V1' }, createdAt: new Date(0) },
      { id: 'wa-foreign', tenantId: 't2', businessId: 'b2', type: 'WHATSAPP', status: 'ACTIVE', config: { approvedTemplates: 'MISSED_CALL_RECOVERY_V1' }, createdAt: new Date(0) },
    ]
    const c = seedCall()
    expect(await processRecovery(c.id, NOW)).toBe('FAILED')
    expect(db.deliveries).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
describe('failure & retry', () => {
  it('provider failure → FAILED, retried on later passes with the SAME message (no duplicate), stops at the attempt cap', async () => {
    const c = seedCall({ remotePhoneE164: '+77010000000' }) // mock provider rejects …0000
    expect(await processRecovery(c.id, NOW)).toBe('FAILED')
    expect(call(c.id)).toMatchObject({ recoveryState: 'FAILED', recoveryFailureCode: 'CHANNEL_PROVIDER_ERROR', recoveryAttemptCount: 1 })
    const firstMessage = call(c.id).recoveryMessageId

    await processRecovery(c.id, NOW)
    await processRecovery(c.id, NOW)
    expect(call(c.id).recoveryAttemptCount).toBe(RECOVERY_MAX_ATTEMPTS)
    expect(await processRecovery(c.id, NOW)).toBe('SKIPPED') // cap reached
    expect(outbound()).toHaveLength(1)
    expect(call(c.id).recoveryMessageId).toBe(firstMessage)
    expect(db.deliveries).toHaveLength(1)
    expect(db.deliveries[0]).toMatchObject({ status: 'FAILED', attemptCount: RECOVERY_MAX_ATTEMPTS })
  })

  it('a retry after the miss has gone stale is not attempted', async () => {
    const c = seedCall({ recoveryState: 'FAILED', recoveryFailureCode: 'CHANNEL_PROVIDER_ERROR', recoveryAttemptCount: 1, outcomeDetectedAt: at(-31) })
    expect(await processRecovery(c.id, NOW)).toBe('SKIPPED')
  })

  it('an uncertain previous send (delivery stuck SENDING) → FAILED DELIVERY_UNCERTAIN, never resent, never retried', async () => {
    const c = seedCall()
    hooks.onRoute = () => {
      hooks.onRoute = null
    }
    await processRecovery(c.id, NOW) // SENT normally; now simulate a crashed attempt on a second call
    const c2 = seedCall({ remotePhoneE164: '+77017776655' })
    // pre-create its message + a SENDING delivery as if a processor died mid-send
    const msg = { id: 'msg-crashed', tenantId: 't1', businessId: 'b1', conversationId: db.conversations[0]!.id, direction: 'OUTBOUND', senderType: 'SYSTEM', content: 'x' }
    db.messages.push(msg)
    db.conversations[0]!.channelConnectionId = 'wa-1'
    Object.assign(call(c2.id), { recoveryState: 'CLAIMED', recoveryMessageId: 'msg-crashed', recoveryClaimedAt: at(-5), updatedAt: at(-5) })
    db.deliveries.push({ id: 'dlv-crashed', tenantId: 't1', businessId: 'b1', channelConnectionId: 'wa-1', messageId: 'msg-crashed', status: 'SENDING', attemptCount: 1 })
    expect(await processRecovery(c2.id, NOW)).toBe('FAILED')
    expect(call(c2.id)).toMatchObject({ recoveryState: 'FAILED', recoveryFailureCode: 'DELIVERY_UNCERTAIN' })
    expect(await processRecovery(c2.id, NOW)).toBe('SKIPPED')
  })
})

// ---------------------------------------------------------------------------
describe('template', () => {
  it('deterministic Russian text with the business name; no price, diagnosis, availability or customer name', () => {
    const text = renderRecoveryTemplate(MISSED_CALL_RECOVERY_V1, { businessName: 'Автосервис Тест' })
    expect(text).toBe('Здравствуйте! Вы только что звонили в автосервис «Автосервис Тест». Мастер сейчас занят и не смог ответить. Подскажите, пожалуйста, с каким вопросом обращаетесь?')
    expect(text).not.toMatch(/\d|₸|₽|AUTOSERVISE/)
    expect(renderRecoveryTemplate(MISSED_CALL_RECOVERY_V1, { businessName: null })).toContain('Вы только что звонили в автосервис.')
  })
})

// ---------------------------------------------------------------------------
describe('tenant isolation', () => {
  it("a call of tenant 2 uses only tenant 2's connection and creates its conversation/message in tenant 2", async () => {
    const c = seedCall({ tenantId: 't2', businessId: 'b2' })
    expect(await processRecovery(c.id, NOW)).toBe('SENT')
    expect(db.conversations[0]).toMatchObject({ tenantId: 't2', businessId: 'b2', channelConnectionId: 'wa-foreign' })
    expect(outbound()[0]).toMatchObject({ tenantId: 't2', businessId: 'b2' })
    expect(db.deliveries[0]).toMatchObject({ tenantId: 't2', channelConnectionId: 'wa-foreign' })
  })

  it("anti-spam never looks across tenants (tenant 1's recovery doesn't suppress tenant 2)", async () => {
    seedCall({ recoveryState: 'SENT', recoverySentAt: at(-1) })
    const t2 = seedCall({ tenantId: 't2', businessId: 'b2' })
    expect(await processRecovery(t2.id, NOW)).toBe('SENT')
  })
})

// ---------------------------------------------------------------------------
function makeRes() {
  const res = { statusCode: 0, body: undefined as any }
  const api = {
    status(code: number) {
      res.statusCode = code
      return api
    },
    json(payload: unknown) {
      res.body = payload
      return api
    },
    setHeader() {
      return api
    },
  }
  return { res, api: api as unknown as ApiResponse }
}
async function post(body: unknown, auth?: string) {
  const { res, api } = makeRes()
  await processorHandler({ method: 'POST', headers: auth ? { authorization: auth } : {}, body, query: {} } as unknown as ApiRequest, api)
  return res
}

describe('processor trigger endpoint', () => {
  beforeEach(() => {
    process.env.RECOVERY_PROCESSOR_SECRET = 'test-processor-secret'
  })
  afterEach(() => {
    delete process.env.RECOVERY_PROCESSOR_SECRET
  })

  it('401 without / with a wrong secret, and when no secret is configured — nothing processed', async () => {
    seedCall()
    expect((await post({})).statusCode).toBe(401)
    expect((await post({}, 'Bearer nope')).statusCode).toBe(401)
    delete process.env.RECOVERY_PROCESSOR_SECRET
    expect((await post({}, 'Bearer test-processor-secret')).statusCode).toBe(401)
    expect(outbound()).toHaveLength(0)
  })

  it('a pass returns counts only (no tenant, call, customer or phone data); unknown fields → 400', async () => {
    seedCall()
    const r = await post({}, 'Bearer test-processor-secret')
    expect(r.statusCode).toBe(200)
    expect(r.body).toEqual({ ok: true, processed: 1, sent: 1, failed: 0, suppressed: 0, notEligible: 0, skipped: 0 })
    expect((await post({ tenantId: 't1' }, 'Bearer test-processor-secret')).statusCode).toBe(400)
  })
})
