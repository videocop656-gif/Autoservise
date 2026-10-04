import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { ApiRequest, ApiResponse } from '../src/server/types/http'

// ---------------------------------------------------------------------------
// MCR-4.1 — durable recovery trigger. The real intake service, mock
// telephony webhook, recovery job publisher/consumer, MCR-4 recovery engine
// (callRecoveryService + callRecoveryRepository), channel router, template,
// deliverSystemMessage and mock WhatsApp adapter run on the same in-memory
// Prisma double as tests/callRecovery.test.ts (transactions serialized =
// the row locks of the real SQL). Vercel Queues itself is replaced by a test
// publisher that records jobs; deliveries are replayed into the real
// consumer function (handleRecoveryJob) — once, twice, concurrently, late.
// This is a LOCAL integration test, not a test against Vercel infrastructure.
// ---------------------------------------------------------------------------

type Row = Record<string, any>
const { db, trapHits, hooks, fakePrisma, counter, id, trap } = vi.hoisted(() => {
  const db = { calls: [] as Row[], events: [] as Row[], conversations: [] as Row[], messages: [] as Row[], deliveries: [] as Row[], connections: [] as Row[] }
  const trapHits = [] as string[]
  const hooks = { onRoute: null as null | (() => void) }
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
    $executeRaw: async () => 1,
    $queryRaw: async (sql: { values: unknown[] }) => {
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
// --- MCR-2 intake persistence, writing into the same calls table ------------
vi.mock('../src/server/repositories/businessPhoneNumberRepository', () => ({
  isActiveNumberConflict: () => false,
  businessPhoneNumberRepository: {
    findActiveByPhoneE164ForRouting: async (e164: string) =>
      ({ '+77272500000': { id: 'n1', tenantId: 't1', businessId: 'b1', isActive: true }, '+77172500000': { id: 'n2', tenantId: 't2', businessId: 'b2', isActive: true } })[e164] ?? null,
  },
}))
vi.mock('../src/server/repositories/callInteractionRepository', () => ({
  callInteractionRepository: {
    insertIfAbsent: async (data: Row) => {
      if (db.calls.some((c) => c.provider === data.provider && c.providerCallId === data.providerCallId)) return
      db.calls.push({
        id: randomUUID(),
        outcome: 'IN_PROGRESS',
        startedAt: null,
        answeredAt: null,
        endedAt: null,
        outcomeDetectedAt: null,
        recoveryIneligibleReason: null,
        recoveryClaimedAt: null,
        recoverySentAt: null,
        recoveryAttemptCount: 0,
        recoveryFailureCode: null,
        recoveryTemplateKey: null,
        recoveryConversationId: null,
        recoveryMessageId: null,
        updatedAt: new Date(),
        ...data,
      })
    },
    lockByProviderCall: async (p: string, pid: string) => {
      const row = db.calls.find((c) => c.provider === p && c.providerCallId === pid)
      return row ? { ...row } : null
    },
    insertEventIfAbsent: async (data: Row) => {
      if (db.events.some((e) => e.provider === data.provider && e.providerEventId === data.providerEventId)) return false
      db.events.push({ ...data })
      return true
    },
    update: async (cid: string, data: Row) => {
      const row = db.calls.find((c) => c.id === cid)!
      Object.assign(row, data, { updatedAt: new Date() })
      return { ...row }
    },
  },
}))
// --- MCR-4 engine collaborators (same doubles as callRecovery.test.ts) -------
vi.mock('../src/server/repositories/channelConnectionRepository', () => ({
  channelConnectionRepository: {
    list: async (t: string, b: string) => {
      hooks.onRoute?.()
      return db.connections.filter((c) => c.tenantId === t && c.businessId === b)
    },
    findById: async (t: string, b: string, cid: string) => db.connections.find((c) => c.tenantId === t && c.businessId === b && c.id === cid) ?? null,
  },
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
  businessRepository: {
    findFirstByTenant: async (t: string) => ({ id: t === 't1' ? 'b1' : 'b2', tenantId: t, name: t === 't1' ? 'Автосервис Тест' : 'Чужой', phoneRegion: 'KZ' }),
  },
}))
// Intake may only LOOK UP a customer by phone; anything else is a trap.
vi.mock('../src/server/repositories/customerRepository', () => ({
  customerRepository: new Proxy(
    { findActiveByPhoneE164: async () => [] },
    {
      get: (target, prop) =>
        prop in target ? (target as any)[prop] : () => { trapHits.push(`customerRepository.${String(prop)}`); throw new Error('customerRepository must not be used') },
    }
  ),
}))
// Nothing here may ever be touched by the trigger or the engine.
vi.mock('../src/server/services/aiService', () => trap('aiService'))
vi.mock('../src/server/ai/aiProviderFactory', () => trap('aiProviderFactory'))
vi.mock('../src/server/repositories/vehicleRepository', () => ({ vehicleRepository: trap('vehicleRepository') }))
vi.mock('../src/server/repositories/customerRequestRepository', () => ({ customerRequestRepository: trap('customerRequestRepository') }))
vi.mock('../src/server/repositories/appointmentRepository', () => ({ appointmentRepository: trap('appointmentRepository') }))

import { ingestCallEvent } from '../src/server/services/callIntakeService'
import type { NormalizedCallEvent } from '../src/server/telephony/types'
import telephonyWebhook from '../api/webhooks/telephony/mock'
import processorHandler from '../api/internal/recovery/process'
import queueConsumerRoute from '../api/queues/missed-call-recovery'
import {
  RECOVERY_QUEUE_TOPIC,
  RECOVERY_JOB_MAX_DELIVERIES,
  RECOVERY_JOB_RETRY_AFTER_SECONDS,
  createVercelRecoveryJobPublisher,
  getRecoveryJobPublisher,
  recoveryJobIdempotencyKey,
  setRecoveryJobPublisher,
  type RecoveryJob,
} from '../src/server/recovery/recoveryJobs'
import { handleRecoveryJob, recoveryJobRetry, RecoveryJobRetryError } from '../src/server/recovery/recoveryJobConsumer'
import { RECOVERY_STALE_CLAIM_SECONDS } from '../src/server/recovery/policy'

const BUSINESS = '+77272500000'
const CALLER = '+77011234567'
const NOW = new Date('2026-10-05T09:00:00Z')

// --- the test "queue": records publishes, replays them into the consumer ----
const queue = {
  jobs: [] as { job: RecoveryJob; idempotencyKey: string }[],
  fail: false,
  seq: 0,
}
setRecoveryJobPublisher(null)
const testPublisher = {
  kind: 'test' as const,
  async publish(job: RecoveryJob) {
    if (queue.fail) throw new Error('queue unavailable')
    queue.jobs.push({ job, idempotencyKey: recoveryJobIdempotencyKey(job.callInteractionId) })
    return { status: 'PUBLISHED' as const, messageId: `qmsg-${++queue.seq}` }
  },
}
const deliver = (message: unknown, deliveryCount = 1) => handleRecoveryJob(message, { messageId: `qmsg-${++queue.seq}`, deliveryCount })

let evSeq = 0
function event(o: Partial<NormalizedCallEvent> = {}): NormalizedCallEvent {
  return {
    provider: 'mock',
    providerEventId: `ev-${++evSeq}`,
    providerCallId: 'pc-1',
    eventType: 'MISSED',
    direction: 'INBOUND',
    callerPhone: '8 701 123 45 67',
    calledPhone: BUSINESS,
    occurredAt: null,
    wasAnswered: null,
    ...o,
  }
}
const callOf = (providerCallId = 'pc-1') => db.calls.find((c) => c.providerCallId === providerCallId)!
const outbound = () => db.messages.filter((m) => m.direction === 'OUTBOUND')
const sentDeliveries = () => db.deliveries.filter((d) => d.status === 'SENT')

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

beforeEach(() => {
  counter.seq = 0
  evSeq = 0
  trapHits.length = 0
  hooks.onRoute = null
  Object.assign(db, { calls: [], events: [], conversations: [], messages: [], deliveries: [] })
  db.connections = [
    { id: 'wa-1', tenantId: 't1', businessId: 'b1', type: 'WHATSAPP', status: 'ACTIVE' },
    { id: 'wa-foreign', tenantId: 't2', businessId: 'b2', type: 'WHATSAPP', status: 'ACTIVE' },
  ]
  queue.jobs = []
  queue.fail = false
  setRecoveryJobPublisher(testPublisher)
  process.env.RECOVERY_MOCK_CHANNEL_ENABLED = 'true'
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})
afterEach(() => {
  vi.useRealTimers()
  setRecoveryJobPublisher(null)
  delete process.env.RECOVERY_MOCK_CHANNEL_ENABLED
  // Q/R/S/T: no AI, no Customer/Vehicle write, no CustomerRequest, no Appointment — in every test.
  expect(trapHits).toEqual([])
})

// ---------------------------------------------------------------------------
describe('publish point — only a committed READY call enqueues work', () => {
  it('A. MISSED inbound call → READY → exactly one job { callInteractionId } with the deterministic key', async () => {
    const result = await ingestCallEvent(event())
    expect(result).toMatchObject({ status: 'accepted', recoveryState: 'READY', recoveryJob: 'PUBLISHED' })
    expect(queue.jobs).toEqual([{ job: { callInteractionId: callOf().id }, idempotencyKey: `missed-call-recovery:${callOf().id}` }])
    // the payload is the id only: no phone, name, tenant, business or text
    expect(Object.keys(queue.jobs[0]!.job)).toEqual(['callInteractionId'])
    // publishing is not recovery: the call is still READY, nothing sent
    expect(callOf().recoveryState).toBe('READY')
    expect(outbound()).toHaveLength(0)
  })

  it('B. ANSWERED call → no job', async () => {
    const r = await ingestCallEvent(event({ eventType: 'ANSWERED' }))
    expect(r.recoveryJob).toBe('NOT_REQUIRED')
    expect(queue.jobs).toHaveLength(0)
  })

  it.each([
    ['anonymous caller', { callerPhone: 'anonymous' }],
    ['outbound call', { direction: 'OUTBOUND' as const, callerPhone: BUSINESS, calledPhone: '87011234567' }],
  ])('C. NOT_ELIGIBLE (%s) → no job', async (_label, o) => {
    const r = await ingestCallEvent(event(o))
    expect(r.recoveryState).toBe('NOT_ELIGIBLE')
    expect(r.recoveryJob).toBe('NOT_REQUIRED')
    expect(queue.jobs).toHaveLength(0)
  })

  it('PENDING (still ringing) → no job', async () => {
    const r = await ingestCallEvent(event({ eventType: 'RINGING' }))
    expect(r.recoveryState).toBe('PENDING')
    expect(queue.jobs).toHaveLength(0)
  })

  it('D/E. duplicate telephony event → same deterministic key re-published; delivering both → ONE customer message', async () => {
    const ev = event()
    await ingestCallEvent(ev)
    const dup = await ingestCallEvent(ev)
    expect(dup).toMatchObject({ status: 'duplicate', recoveryJob: 'PUBLISHED' })
    expect(queue.jobs).toHaveLength(2)
    expect(new Set(queue.jobs.map((j) => j.idempotencyKey)).size).toBe(1) // Vercel drops the repeat publish
    // even if the dedupe did not drop it, the engine does:
    const results = [await deliver(queue.jobs[0]!.job), await deliver(queue.jobs[1]!.job)]
    expect(results).toEqual(['SENT', 'SKIPPED'])
    expect(outbound()).toHaveLength(1)
    expect(sentDeliveries()).toHaveLength(1)
  })

  it('no job once the engine owns the call (a later duplicate event after SENT publishes nothing)', async () => {
    const ev = event()
    await ingestCallEvent(ev)
    await deliver(queue.jobs[0]!.job)
    queue.jobs = []
    expect((await ingestCallEvent(ev)).recoveryJob).toBe('NOT_REQUIRED')
    expect(queue.jobs).toHaveLength(0)
  })

  it('E. the Vercel publisher sends topic + id-only payload + deterministic idempotency key + bounded retention', async () => {
    const send = vi.fn(async () => ({ messageId: 'vq-1' }))
    const publisher = createVercelRecoveryJobPublisher({ send } as any)
    const cid = randomUUID()
    expect(await publisher.publish({ callInteractionId: cid })).toEqual({ status: 'PUBLISHED', messageId: 'vq-1' })
    await publisher.publish({ callInteractionId: cid })
    expect(send).toHaveBeenCalledTimes(2)
    for (const call of send.mock.calls as unknown as unknown[][]) {
      expect(call).toEqual(['missed-call-recovery', { callInteractionId: cid }, { idempotencyKey: `missed-call-recovery:${cid}`, retentionSeconds: 3600 }])
    }
  })

  it('outside a Vercel deployment nothing is published (READY stays for the processor); on Vercel the Queues publisher is used', () => {
    setRecoveryJobPublisher(null)
    delete process.env.VERCEL_DEPLOYMENT_ID
    expect(getRecoveryJobPublisher().kind).toBe('disabled')
    process.env.VERCEL_DEPLOYMENT_ID = 'dpl_test'
    process.env.VERCEL_REGION = 'fra1'
    try {
      expect(getRecoveryJobPublisher().kind).toBe('vercel-queue')
    } finally {
      delete process.env.VERCEL_DEPLOYMENT_ID
      delete process.env.VERCEL_REGION
    }
  })
})

// ---------------------------------------------------------------------------
describe('at-least-once delivery — the engine, not the queue, prevents duplicates', () => {
  it('F. the same job delivered twice → one message, one send', async () => {
    await ingestCallEvent(event())
    const job = queue.jobs[0]!.job
    expect(await deliver(job)).toBe('SENT')
    expect(await deliver(job, 2)).toBe('SKIPPED')
    expect(outbound()).toHaveLength(1)
    expect(sentDeliveries()).toHaveLength(1)
    expect(callOf()).toMatchObject({ recoveryState: 'SENT', recoveryAttemptCount: 1 })
  })

  it('G. five concurrent deliveries of the same job → exactly one customer message', async () => {
    await ingestCallEvent(event())
    const job = queue.jobs[0]!.job
    const results = await Promise.all(Array.from({ length: 5 }, () => deliver(job)))
    expect(results.filter((r) => r === 'SENT')).toHaveLength(1)
    expect(results.filter((r) => r === 'SKIPPED')).toHaveLength(4)
    expect(outbound()).toHaveLength(1)
    expect(db.deliveries).toHaveLength(1)
  })

  it('a queue job racing the reconciliation processor → still one message', async () => {
    process.env.RECOVERY_PROCESSOR_SECRET = 'test-processor-secret'
    try {
      await ingestCallEvent(event())
      const { res, api } = makeRes()
      const [fromQueue] = await Promise.all([
        deliver(queue.jobs[0]!.job),
        processorHandler({ method: 'POST', headers: { authorization: 'Bearer test-processor-secret' }, body: {}, query: {} } as unknown as ApiRequest, api),
      ])
      expect([fromQueue === 'SENT', res.body.sent === 1].filter(Boolean)).toHaveLength(1) // exactly one of them recovered it
      expect(outbound()).toHaveLength(1)
      expect(sentDeliveries()).toHaveLength(1)
    } finally {
      delete process.env.RECOVERY_PROCESSOR_SECRET
    }
  })
})

// ---------------------------------------------------------------------------
describe('database state is authoritative', () => {
  it('H. late ANSWERED after the job was published → consumer sends nothing', async () => {
    await ingestCallEvent(event())
    const job = queue.jobs[0]!.job
    const late = await ingestCallEvent(event({ eventType: 'ANSWERED' }))
    expect(late).toMatchObject({ recoveryState: 'NOT_ELIGIBLE', recoveryJob: 'NOT_REQUIRED' })
    expect(await deliver(job)).toBe('SKIPPED')
    expect(db.conversations).toHaveLength(0)
    expect(outbound()).toHaveLength(0)
    expect(db.deliveries).toHaveLength(0)
  })

  it('H. ANSWERED committed while the consumer is routing → re-checked under the lock: NOT_ELIGIBLE, no send', async () => {
    await ingestCallEvent(event())
    hooks.onRoute = () => {
      callOf().outcome = 'ANSWERED'
    }
    expect(await deliver(queue.jobs[0]!.job)).toBe('NOT_ELIGIBLE')
    expect(outbound()).toHaveLength(0)
    expect(db.deliveries).toHaveLength(0)
  })

  it('I. three missed calls inside the anti-spam window → three jobs, one recovery, two SUPPRESSED', async () => {
    for (const pc of ['pc-a', 'pc-b', 'pc-c']) {
      await ingestCallEvent(event({ providerCallId: pc }))
      vi.setSystemTime(new Date(Date.now() + 60_000))
    }
    expect(queue.jobs).toHaveLength(3)
    const results = []
    for (const { job } of queue.jobs) results.push(await deliver(job))
    expect(results).toEqual(['SENT', 'SUPPRESSED', 'SUPPRESSED'])
    expect(callOf('pc-b')).toMatchObject({ recoveryState: 'SUPPRESSED', recoveryIneligibleReason: 'ANTI_SPAM' })
    expect(outbound()).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
describe('DB ↔ queue gap — publish failure never loses the call', () => {
  it('J. publish fails after READY commits → call stays READY, result PUBLISH_FAILED, nothing marked sent/claimed', async () => {
    queue.fail = true
    const r = await ingestCallEvent(event())
    expect(r).toMatchObject({ status: 'accepted', recoveryState: 'READY', recoveryJob: 'PUBLISH_FAILED' })
    expect(callOf()).toMatchObject({ recoveryState: 'READY', recoveryAttemptCount: 0, recoveryClaimedAt: null })
  })

  it('J. the webhook answers 500 so the provider retries; the retried (duplicate) event re-publishes the job', async () => {
    process.env.TELEPHONY_MOCK_WEBHOOK_SECRET = 'tel-secret'
    try {
      const body = { eventId: 'w-1', callId: 'pc-w', event: 'call.missed', from: '87011234567', to: BUSINESS }
      const post = async () => {
        const { res, api } = makeRes()
        await telephonyWebhook({ method: 'POST', headers: { 'x-mock-telephony-secret': 'tel-secret' }, body, query: {} } as unknown as ApiRequest, api)
        return res
      }
      queue.fail = true
      expect((await post()).statusCode).toBe(500)
      expect(callOf('pc-w').recoveryState).toBe('READY') // recorded durably
      queue.fail = false
      const retry = await post()
      expect(retry).toMatchObject({ statusCode: 200, body: { ok: true, status: 'duplicate' } })
      expect(queue.jobs).toHaveLength(1)
      expect(await deliver(queue.jobs[0]!.job)).toBe('SENT')
    } finally {
      delete process.env.TELEPHONY_MOCK_WEBHOOK_SECRET
    }
  })

  it('K. the reconciliation processor later recovers the READY call whose publish failed', async () => {
    queue.fail = true
    await ingestCallEvent(event())
    process.env.RECOVERY_PROCESSOR_SECRET = 'test-processor-secret'
    try {
      const { res, api } = makeRes()
      await processorHandler({ method: 'POST', headers: { authorization: 'Bearer test-processor-secret' }, body: {}, query: {} } as unknown as ApiRequest, api)
      expect(res.body).toMatchObject({ ok: true, processed: 1, sent: 1 })
      expect(callOf().recoveryState).toBe('SENT')
      expect(outbound()).toHaveLength(1)
    } finally {
      delete process.env.RECOVERY_PROCESSOR_SECRET
    }
  })
})

// ---------------------------------------------------------------------------
describe('consumer failure & redelivery', () => {
  it('L. crash after the claim but before any send → redelivery after the retry delay re-claims and sends once', async () => {
    await ingestCallEvent(event())
    const job = queue.jobs[0]!.job
    hooks.onRoute = () => {
      hooks.onRoute = null
      throw new Error('function crashed')
    }
    const err = await deliver(job).catch((e) => e)
    expect(err).toBeInstanceOf(Error) // → queue redelivers
    expect(callOf().recoveryState).toBe('CLAIMED') // durable, recoverable
    expect(outbound()).toHaveLength(0)
    expect(recoveryJobRetry(err, { messageId: 'm', deliveryCount: 1 })).toEqual({ afterSeconds: RECOVERY_JOB_RETRY_AFTER_SECONDS })
    expect(RECOVERY_JOB_RETRY_AFTER_SECONDS).toBeGreaterThan(RECOVERY_STALE_CLAIM_SECONDS)

    vi.setSystemTime(new Date(NOW.getTime() + RECOVERY_JOB_RETRY_AFTER_SECONDS * 1000))
    expect(await deliver(job, 2)).toBe('SENT')
    expect(outbound()).toHaveLength(1)
    expect(sentDeliveries()).toHaveLength(1)
  })

  it('M. provider accepted, then the callback failed before ack → redelivery sends nothing', async () => {
    await ingestCallEvent(event())
    const job = queue.jobs[0]!.job
    expect(await deliver(job)).toBe('SENT') // imagine the ack is lost here
    expect(await deliver(job, 2)).toBe('SKIPPED')
    expect(outbound()).toHaveLength(1)
    expect(db.deliveries).toEqual([expect.objectContaining({ status: 'SENT', attemptCount: 1 })])
  })

  it('M. crash after the provider call but before markSent (delivery SENDING) → DELIVERY_UNCERTAIN, never resent by any redelivery', async () => {
    await ingestCallEvent(event())
    const job = queue.jobs[0]!.job
    const c = callOf()
    db.conversations.push({ id: 'conv-x', tenantId: 't1', businessId: 'b1', channelConnectionId: 'wa-1', externalConversationId: '77011234567', channel: 'WHATSAPP' })
    db.messages.push({ id: 'msg-x', tenantId: 't1', businessId: 'b1', conversationId: 'conv-x', direction: 'OUTBOUND', senderType: 'SYSTEM', content: 'x' })
    db.deliveries.push({ id: 'dlv-x', tenantId: 't1', businessId: 'b1', channelConnectionId: 'wa-1', messageId: 'msg-x', status: 'SENDING', attemptCount: 1 })
    const stale = new Date(NOW.getTime() - (RECOVERY_STALE_CLAIM_SECONDS + 5) * 1000)
    Object.assign(c, { recoveryState: 'CLAIMED', recoveryMessageId: 'msg-x', recoveryAttemptCount: 1, recoveryClaimedAt: stale, updatedAt: stale })

    const err = await deliver(job, 2).catch((e) => e)
    expect(err).toBeInstanceOf(RecoveryJobRetryError)
    expect(callOf()).toMatchObject({ recoveryState: 'FAILED', recoveryFailureCode: 'DELIVERY_UNCERTAIN' })
    expect(await deliver(job, 3)).toBe('SKIPPED') // non-retryable → acknowledged
    expect(db.messages).toHaveLength(1)
    expect(db.deliveries).toEqual([expect.objectContaining({ status: 'SENDING', attemptCount: 1 })]) // provider never called again
  })

  it('a retryable FAILED attempt is redelivered; MCR-4 caps the attempts (same message), then the job is acknowledged', async () => {
    await ingestCallEvent(event({ callerPhone: '+77010000000' })) // mock provider rejects …0000
    const job = queue.jobs[0]!.job
    for (let n = 1; n <= 3; n++) await expect(deliver(job, n)).rejects.toBeInstanceOf(RecoveryJobRetryError)
    expect(await deliver(job, 4)).toBe('SKIPPED')
    expect(callOf()).toMatchObject({ recoveryState: 'FAILED', recoveryAttemptCount: 3 })
    expect(outbound()).toHaveLength(1)
  })

  it('the retry hook gives up after the delivery cap (the DB row stays for reconciliation)', () => {
    expect(recoveryJobRetry(new RecoveryJobRetryError(), { messageId: 'm', deliveryCount: RECOVERY_JOB_MAX_DELIVERIES })).toEqual({ acknowledge: true })
    expect(recoveryJobRetry(new RecoveryJobRetryError(), { messageId: 'm', deliveryCount: 2 })).toEqual({ afterSeconds: RECOVERY_JOB_RETRY_AFTER_SECONDS })
  })
})

// ---------------------------------------------------------------------------
describe('payload validation & tenant safety', () => {
  it.each([
    ['missing id', {}],
    ['not a uuid', { callInteractionId: "x' OR 1=1 --" }],
    ['null', null],
    ['garbage text', 'not json'],
    ['P. tenant/business supplied by the payload', { callInteractionId: randomUUID(), tenantId: 't2', businessId: 'b2' }],
  ])('N/P. %s → INVALID_PAYLOAD, acknowledged, no database access', async (_label, payload) => {
    const query = vi.spyOn(fakePrisma, '$queryRaw')
    expect(await deliver(payload)).toBe('INVALID_PAYLOAD')
    expect(query).not.toHaveBeenCalled()
    expect(outbound()).toHaveLength(0)
  })

  it('O. a well-formed id that does not exist → SKIPPED, nothing written', async () => {
    expect(await deliver({ callInteractionId: randomUUID() })).toBe('SKIPPED')
    expect(db.calls).toHaveLength(0)
    expect(db.conversations).toHaveLength(0)
  })

  it('P. ownership comes from the database row: a tenant-2 call recovers only inside tenant 2', async () => {
    await ingestCallEvent(event({ providerCallId: 'pc-t2', calledPhone: '+77172500000' }))
    expect(await deliver(queue.jobs[0]!.job)).toBe('SENT')
    expect(db.conversations[0]).toMatchObject({ tenantId: 't2', businessId: 'b2', channelConnectionId: 'wa-foreign' })
    expect(outbound()[0]).toMatchObject({ tenantId: 't2', businessId: 'b2' })
  })

  it('payload delivered as JSON text or bytes is decoded and validated the same way', async () => {
    await ingestCallEvent(event())
    const raw = JSON.stringify(queue.jobs[0]!.job)
    expect(await deliver(Buffer.from(raw))).toBe('SENT')
    expect(await deliver(raw)).toBe('SKIPPED')
  })
})

// ---------------------------------------------------------------------------
describe('vertical slice & webhook critical path', () => {
  it('V. mock telephony MISSED → READY → job → consumer → MCR-4 → Conversation + SYSTEM message + ChannelDelivery SENT', async () => {
    process.env.TELEPHONY_MOCK_WEBHOOK_SECRET = 'tel-secret'
    try {
      const { res, api } = makeRes()
      await telephonyWebhook(
        { method: 'POST', headers: { 'x-mock-telephony-secret': 'tel-secret' }, body: { eventId: 'w-1', callId: 'pc-v', event: 'call.missed', from: '87011234567', to: BUSINESS }, query: {} } as unknown as ApiRequest,
        api
      )
      expect(res).toMatchObject({ statusCode: 200, body: { ok: true, status: 'accepted' } })
      // 18: the webhook answered with the job queued and NOTHING sent — the send is off its critical path.
      expect(callOf('pc-v').recoveryState).toBe('READY')
      expect(db.messages).toHaveLength(0)
      expect(db.deliveries).toHaveLength(0)

      expect(await deliver(queue.jobs[0]!.job)).toBe('SENT')
      const c = callOf('pc-v')
      expect(c).toMatchObject({ recoveryState: 'SENT', recoveryTemplateKey: 'MISSED_CALL_RECOVERY_V1', remotePhoneE164: CALLER })
      expect(db.conversations).toEqual([expect.objectContaining({ id: c.recoveryConversationId, channel: 'WHATSAPP', customerId: null })])
      expect(outbound()).toEqual([expect.objectContaining({ id: c.recoveryMessageId, senderType: 'SYSTEM' })])
      expect(sentDeliveries()).toHaveLength(1)
    } finally {
      delete process.env.TELEPHONY_MOCK_WEBHOOK_SECRET
    }
  })

  it('U. the internal processor still works on its own (no queue involved)', async () => {
    setRecoveryJobPublisher(null) // local: disabled publisher
    const r = await ingestCallEvent(event())
    expect(r.recoveryJob).toBe('DISABLED')
    process.env.RECOVERY_PROCESSOR_SECRET = 'test-processor-secret'
    try {
      const unauthorized = makeRes()
      await processorHandler({ method: 'POST', headers: {}, body: {}, query: {} } as unknown as ApiRequest, unauthorized.api)
      expect(unauthorized.res.statusCode).toBe(401)
      const { res, api } = makeRes()
      await processorHandler({ method: 'POST', headers: { authorization: 'Bearer test-processor-secret' }, body: { callId: callOf().id }, query: {} } as unknown as ApiRequest, api)
      expect(res.body).toEqual({ ok: true, outcome: 'SENT' })
    } finally {
      delete process.env.RECOVERY_PROCESSOR_SECRET
    }
  })
})

// ---------------------------------------------------------------------------
describe('consumer route & Vercel configuration', () => {
  it('outside a Vercel deployment the consumer route is a 404 (the local API emulation exposes every api/ file)', async () => {
    delete process.env.VERCEL_DEPLOYMENT_ID
    await ingestCallEvent(event())
    const { res, api } = makeRes()
    await queueConsumerRoute({ method: 'POST', headers: {}, body: queue.jobs[0]!.job, query: {} } as unknown as ApiRequest, api)
    expect(res.statusCode).toBe(404)
    expect(outbound()).toHaveLength(0)
  })

  it('vercel.json wires exactly this route to the topic, with the retry delay / delivery cap the code assumes', () => {
    const config = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../vercel.json'), 'utf-8'))
    const fns = Object.keys(config.functions)
    expect(fns).toEqual(['api/queues/missed-call-recovery.ts'])
    expect(fs.existsSync(path.resolve(__dirname, '..', fns[0]!))).toBe(true)
    expect(config.functions[fns[0]!].experimentalTriggers).toEqual([
      { type: 'queue/v2beta', topic: RECOVERY_QUEUE_TOPIC, retryAfterSeconds: RECOVERY_JOB_RETRY_AFTER_SECONDS, maxDeliveries: RECOVERY_JOB_MAX_DELIVERIES },
    ])
  })
})
