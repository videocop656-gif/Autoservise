# Missed-Call Recovery — Architecture & Product Readiness Audit

> Prompt 57. Repository state audited: `master` = `origin/master` = `c618533`
> (Prompt 56 complete), clean tree, **1686 / 1686 tests passing**.
> Audit only — no production code, schema, migration or behavior was changed.
> Every "exists" statement below was checked against the actual code and
> `prisma/schema.prisma`, not against older documentation.

---

## 1. Product direction (recorded)

AUTOSERVISE is not "another auto-service CRM". The primary MVP value is:

> **Do not lose a customer because the auto service could not answer the phone fast enough.**
>
> «Мастер может не ответить на звонок. AUTOSERVISE не должен оставить клиента без реакции.»

Customer side (phone-simple, no account, no app, no portal):

```
problem → phone call → nobody answers → missed-call recovery
→ WhatsApp-first message → short useful dialogue (real services/prices/knowledge)
→ hours / address / location → visit / booking / human
```

Business side (structured; already largely built — Prompts 01–56):

```
call/contact → Customer → Vehicle → Conversation → CustomerRequest → Service
→ Appointment → Operations → ServiceRecord → History → Follow-up → Analytics
```

Core rule: **customer simplicity, business structure.** The new phase feeds the
existing lifecycle; it does not replace or duplicate it.

---

## 2. What was inspected

- `prisma/schema.prisma` — all 22 models and 15 enums. Examined in detail:
  Business, BusinessWorkingHours, Service, KnowledgeItem, BusinessRule,
  Customer, Vehicle, Appointment, CustomerRequest, Conversation, Message,
  AiEscalation, AiLog, ChannelConnection, ChannelMessage,
  CustomerChannelIdentity, ChannelDelivery, ServiceFollowUp.
- **Channel layer:**
  - `src/server/channels/types.ts`, `channelAdapterRegistry.ts`,
    `adapters/mockAdapter.ts`, `adapters/telegramAdapter.ts`,
    `telegramWebhookContext.ts`;
  - `api/webhooks/telegram/[connectionId].ts`;
  - `api/channels/[id]/{inbound,activate,deactivate,telegram/setup,messages/[messageId]/send}.ts`.
- **Services:**
  - inbound and outbound messaging: `channelMessageService`,
    `channelCustomerService`, `channelDeliveryService`;
  - conversation intake and qualification: `conversationIntakeService`,
    `conversationRequestService`, `requestQualificationService`;
  - booking: `requestBookingService`, `appointmentService` (capacity, slots);
  - AI and handoff: `aiService`, `escalationService`;
  - dashboard: `analyticsService`.
- **AI:**
  - `contextBuilder.ts` and `promptBuilder.ts` (rules 1–22 plus the
    draft/qualify blocks);
  - `executionMode.ts`, `aiResult.schema.ts`, `safety.ts`;
  - `tools/*` and `providers/{mock,openAi}AiProvider.ts`.
- **Repositories:** `customerRepository.findActiveByLocalPhoneNumber` (raw SQL
  last-10-digits match), `businessRepository.lockForScheduling`.
- **Environment:** `src/server/lib/env.ts` — the only external credentials are
  `OPENAI_API_KEY`, `TELEGRAM_BOT_TOKEN` and `TELEGRAM_WEBHOOK_SECRET`.
- **UI:** `OperationsPage` (request and escalation queue), `DashboardPage`,
  the Conversation, Request and Appointment detail panels, and the mobile
  validation history of Prompts 51–56 (390 px).
- **Docs:** `PRODUCT_BLUEPRINT.md`, `DEVELOPMENT_ROADMAP.md`,
  `AI_BEHAVIOR_CONTRACT.md`, and prompts / final reports 47–56.
- **Search:** no CRMAdapter exists in code (it is mentioned only in Prompt 43
  docs). There is no telephony code of any kind.

---

## 3. Current architecture strengths (reusable as-is)

| Strength | Where | Why it matters for missed-call recovery |
|---|---|---|
| Channel-adapter boundary | `ChannelAdapter { parseIncoming, sendMessage }`, `NormalizedIncomingMessage` / `NormalizedOutboundMessage` | A WhatsApp (or SMS) adapter plugs in without touching Conversation/Message/AI. Tenant is never taken from the payload. |
| Inbound idempotency | `ChannelMessage @@unique([channelConnectionId, externalMessageId])` + `receiveIncoming()` check-first | Provider webhook retries never duplicate a Message. Same pattern applies to call events. |
| Conversation find-or-create per external thread | `Conversation @@unique([channelConnectionId, externalConversationId])` | For WhatsApp the customer's number/WA id is a natural `externalConversationId` → one thread per customer per business number, race-safe. |
| Outbound delivery tracking | `ChannelDelivery` (PENDING/SENDING/SENT/FAILED, attemptCount, compare-and-set `claimForSending`, safe error taxonomy) | Recovery message delivery state and retries already have a home. |
| Per-connection webhook routing + secret check before any DB read | `api/webhooks/telegram/[connectionId].ts` (timing-safe compare) | Same shape works for telephony / WhatsApp webhooks: URL identifies the connection → tenant/business server-side. |
| Safe customer resolution | `resolveCustomerForInbound`: identity first, then *exactly one* active phone match, never auto-create, never merge; identity link best-effort with P2002 handling | Missed-call caller matching can reuse the exact policy. |
| Grounded AI with strict pricing/diagnosis rules | `promptBuilder` rules 4, 6, 17 (range / "from" / no price → say so, never estimate), 16, 19; `safety.ts` | Matches "AI must never invent a price" and "no remote diagnosis" already. |
| AI execution modes | `executionMode.ts`: interactive (4 tools + escalation), draft (read-only `check_availability`), qualify (no tools) | A future "auto-reply" mode can be added as another restricted mode instead of a new AI stack. |
| Structured qualification → request | Prompt 55 (`qualify` mode, server-side ID resolution, stale checks) | Missed-call dialogue → CustomerRequest without new code paths. |
| Authoritative booking | Prompts 50–51–56: capacity under row lock, slot generator, atomic request→appointment conversion | Offering "real free time" and booking is done; must be reused, never re-implemented. |
| Human handoff primitive | `AiEscalation` (one active per conversation, DB-enforced), `OperationsPage` queue | Base for the "ACTION NEEDED" card. |
| Audit trail | `AiLog` with whitelisted metadata | Recovery decisions can be audited the same way. |
| Tenant isolation discipline | `withTenant`, tenant-scoped repos, `tenantIsolation.test.ts` (136 tests) | New entities must follow the same pattern; nothing to weaken. |

---

## 4. Critical gaps (summary)

1. **No telephony at all.** There is no call model, no telephony adapter, no
   call webhook, and no business phone-number registry. `ConversationChannel.PHONE`
   and `CustomerRequestSource.PHONE` are labels only.
2. **WhatsApp is mock-only.** `getChannelAdapter('WHATSAPP')` returns the mock
   adapter. Also missing:
   - no template messages;
   - no conversation-window / opt-in state;
   - no delivery-receipt (DELIVERED/READ) statuses;
   - no inbound status webhook.
3. **Credentials are global, not per tenant.** `TELEGRAM_BOT_TOKEN` and
   `TELEGRAM_WEBHOOK_SECRET` are deployment-wide environment variables, so
   there is one bot for every tenant. `ChannelConnection.config` is explicitly
   non-secret. A business-specific WhatsApp number (or telephony account) has
   nowhere to store credentials.
4. **The phone number is not first-class.**
   - `Customer.phone` is free text (5–50 characters) with no canonical form,
     no index and no uniqueness.
   - Matching uses `right(regexp_replace(phone,'\D'),10)`. That works for
     +7 (KZ/RU share the 10-digit national format) but is wrong in general.
   - `CustomerChannelIdentity` is keyed by `(channelConnectionId, externalCustomerId)`,
     so a phone number is not an identity across channels (call → WhatsApp → SMS).
5. **No system actor for automation.**
   - Webhook contexts are synthesized as a fake `owner` user
     (`id: 'telegram-webhook'`), which is not a real `User` row.
   - Today this works because the inbound path writes no user foreign keys.
   - An automated recovery that creates records, history or AI logs needs an
     explicit system-actor model (most audit FKs are already nullable).
6. **No background execution.** Every step runs synchronously inside the HTTP
   request (documented as deliberate in Prompts 16–18). There is no queue, no
   worker, no retry scheduler and no post-response execution. This directly
   limits the speed and reliability of the first 30–60 seconds.
7. **AI never runs automatically.** AI runs only from authenticated operator
   actions: `/api/ai/analyze`, the AI draft and «Разобрать обращение».
   No webhook triggers AI. The useful recovery dialogue therefore needs a new,
   explicitly gated auto-reply mode with its own safety envelope.
8. **Pricing semantics are thin.** `Service` has `priceFrom` and `priceTo`
   (Decimal) and `currency`. It has no:
   - fixed-vs-from-vs-range flag;
   - pricing note or condition;
   - "final price after inspection" flag;
   - vehicle-class dependency.
9. **Location data is thin.**
   - `Business` has a free-text `address`, plus `phone` and `website`.
   - There are no coordinates, no map link and no directions text.
   - The schema has no location-message capability; adapters send text only.
10. **Handoff is not actionable on a phone.** `AiEscalation` has a reason and
    summary, but:
    - no structured "what the AI already told the customer" (quoted prices,
      promised next step);
    - no owner notification (push, Telegram-to-owner, SMS);
    - priority is always NORMAL.
11. **The dashboard measures the old product.** It counts conversations,
    messages, AI outcomes, escalations and appointments. It has no missed-call,
    recovery, latency or conversion metrics.

---

## 5. The first 30–60 seconds — step-by-step readiness

| # | Step | State | Evidence / reusable part |
|---|---|---|---|
| 1 | Inbound phone call begins | NEEDS EXTERNAL PROVIDER / RESEARCH | No telephony integration. |
| 2 | Business does not answer | NEEDS EXTERNAL PROVIDER / RESEARCH | Depends on provider (ring timeout, forwarding, virtual number). |
| 3 | Provider determines missed/unanswered | NEEDS EXTERNAL PROVIDER / RESEARCH | Event semantics differ per provider (ringing/answered/completed/no-answer/busy). |
| 4 | Webhook reaches AUTOSERVISE | MISSING (pattern READY) | Telegram webhook shape (per-connection URL, secret-first, safe 404/401, 200-vs-500 retry policy) is the template. |
| 5 | Tenant/business identified | PARTIAL | Per-connection URL → `ChannelConnection` → tenant/business works today. `ChannelType` lacks a telephony type; no business-number registry. |
| 6 | Caller number normalized | PARTIAL | `localSubscriberNumber()` (last 10 digits). No E.164 canonicalization, no country context. |
| 7 | Existing customer / identity searched | PARTIAL | `resolveCustomerForInbound` policy reusable. Phone match is a full scan with regex (no index). No cross-channel phone identity. |
| 8 | Customer/lead context created or linked safely | PARTIAL | No auto-create by design. An unknown caller must remain an *unlinked contact* (Conversation with `customerId = null` is already supported). |
| 9 | Recovery event deduplicated | MISSING | No call-event entity. ChannelMessage-style unique key is the pattern. |
| 10 | Best outbound channel determined | MISSING | No channel router; adapters are selected by connection type only. |
| 11 | WhatsApp eligibility checked | NEEDS EXTERNAL PROVIDER / RESEARCH | Template / opt-in / window rules unknown until verified. |
| 12 | First message / template selected | MISSING | No template model. Must be deterministic (see §11). |
| 13 | Outbound message sent | PARTIAL | `sendMessageViaChannel` + `ChannelDelivery` + adapter `sendMessage` exist. WhatsApp adapter is mock. Sending today requires an existing Conversation and a STAFF Message. |
| 14 | Delivery state recorded | PARTIAL | SENT/FAILED only. No DELIVERED/READ, no status-webhook ingestion. |
| 15 | Conversation created or reused | READY (for channel threads) | `@@unique([channelConnectionId, externalConversationId])` find-or-create. The call → conversation link is MISSING. |
| 16 | Customer replies | PARTIAL | Inbound pipeline ready. A real WhatsApp inbound adapter is missing. |
| 17 | AI begins qualification | PARTIAL | AI core, qualify mode and drafts exist; **no automatic trigger**; no auto-send. |
| 18 | Human handoff available | PARTIAL | AiEscalation + Operations queue. Missing: owner notification, structured "already told" context. |

**Verdict:** the *middle and end* of the journey (conversation → qualification →
request → availability → booking → handoff queue) are built. The *beginning*
(call event, phone identity, channel routing, WhatsApp, automatic first
contact) is entirely missing, and that beginning *is* the product.

---

## 6. WhatsApp-first implications

- **Architecture:** WhatsApp fits the existing adapter boundary.
  - The WhatsApp phone-number id goes in `ChannelConnection.externalAccountId`.
  - The customer WA id / phone goes in `externalConversationId` and
    `externalCustomerId`.
  - Inbound messages use `receiveIncoming()`; outbound uses `ChannelDelivery`.
- **Not supported by the current model (to be designed after research):**
  - **Business-initiated first message.** The current send path assumes an
    existing Conversation with the customer's external id. After a missed
    call, no WhatsApp thread exists yet, so the conversation must be opened by
    *us*, addressed by phone number. The rules for this (template-only? opt-in
    required? category?) must be verified.
  - **Templates.** These need a pre-approved template identifier, language
    and parameters (business name), plus a fallback text. Free text alone is
    insufficient if business-initiated messages must use templates.
  - **Conversation window / session state.** We must know whether free-form
    replies are allowed at a given moment. This is a per-thread timestamp
    (last inbound customer message) that the system must track.
  - **Delivery receipts.** These need statuses beyond SENT and an inbound
    status-webhook path into `ChannelDelivery`.
  - **Opt-out / STOP handling** and a "do not contact" flag per phone per business.
- **Fallback:** when WhatsApp is unavailable (no account, template rejected,
  number not on WhatsApp, delivery failed), a router must pick SMS, another
  configured channel, or a human task ("call back").
  - It must never silently drop the recovery.
  - Feasibility is a research item.
- **Telegram:** stays an optional secondary adapter. It must not drive
  identity design: Telegram user ids are not phone numbers.

---

## 7. Telephony requirements (what AUTOSERVISE needs, provider-independent)

- An event per call with the following data, all verified by a provider
  signature or secret before any DB read:
  - a stable provider call id;
  - the caller number (when caller ID is available);
  - the called business number;
  - timestamps;
  - a final disposition: answered / no-answer / busy / failed / voicemail.
- Delivery within seconds of the unanswered outcome. Latency is a research
  item per provider.
- Tolerance for retries, duplicates and out-of-order "ringing → completed"
  events. The final disposition must be decided by a state machine, not by
  the order events arrive in.
- Routing to tenant/business by connection-specific webhook URL (preferred,
  mirrors Telegram). A global called-number lookup is the alternative; it
  would need a *globally* unique business-number registry, because
  `ChannelConnection`'s unique key is tenant-scoped.
- Hidden or withheld caller IDs: there is no recovery possible; record the
  event as such.
- No voice AI, STT/TTS or call routing logic in the MVP. The simpler
  hypothesis (missed call → immediate text recovery) fits the current
  architecture *once a call-event intake exists*.

---

## 8. Identity architecture (recommended, not implemented)

```
Phone (canonical E.164, per business)
   ├─ Customer            (0..1 active match; ambiguity ⇒ unlinked, never merged)
   ├─ CallInteraction(s)  (telephony events for this number at this business)
   ├─ Channel identities  (WhatsApp id, Telegram id, …) via CustomerChannelIdentity
   └─ Conversation(s)     (one per channel thread) → CustomerRequest → Appointment
```

- **Canonical phone.** Store a normalized E.164 form alongside the
  human-entered `Customer.phone`, with an index on
  `(tenantId, businessId, phoneE164)`.
  - Normalization needs a country context: a per-business default region;
    KZ and RU both use +7.
  - Backfill existing rows. Keep the free-text field for display.
- **Uniqueness.** Not unique by DB constraint: legacy and inactive duplicates
  exist, and family members may share a phone. Keep the *exactly-one-active-match*
  rule; on ambiguity, link nothing and surface it to staff.
- **Contact point.** A general `ContactPoint` (phone/email/WA id per
  customer) is *not* needed for the first slice:
  - phone E.164 on Customer plus `CustomerChannelIdentity` cover
    phone ↔ customer ↔ WA id;
  - revisit only when a customer needs several phones.
- **Unknown callers.** Do not create a Customer automatically. The recovery
  conversation lives with `customerId = null` plus the caller phone on the
  call record. The operator links or creates the customer (Prompt 54 intake),
  or a later, explicitly approved policy does.
- **Tenant isolation.**
  - The same phone number at two businesses is two unrelated contexts;
    lookups are always scoped first.
  - A called-number → business mapping must be server-side and verified,
    never taken from the payload.
- **Privacy.**
  - Phone numbers are PII.
  - Never log raw numbers in `logger` / `AiLog` metadata; mask them, e.g.
    `+7 *** ***-12-34`.
  - Retention for call records is a research/policy item.

---

## 9. Call event / idempotency model (conceptual)

**Recommendation:** one durable entity per *call*, not per raw webhook. A
working name is **`CallInteraction`**: it is the business-meaningful unit
("a customer tried to reach us"). The recovery lifecycle lives on the same
row, or on a 1:1 child if it grows.

Likely fields:

- **Scope and connection:** tenantId, businessId, telephony connection id.
- **Provider identity:** providerCallId, unique per connection — the
  idempotency key.
- **Numbers:**
  - callerPhoneRaw and callerPhoneE164 (nullable when hidden);
  - calledNumberE164.
- **Call timing and outcome:**
  - startedAt, answeredAt?, endedAt;
  - disposition: ANSWERED / NO_ANSWER / BUSY / FAILED / UNKNOWN;
  - isMissed (derived).
- **Links:** customerId?, conversationId?
- **Recovery state:** NOT_NEEDED / PENDING / SENT / FAILED / SKIPPED, with a
  reason (hidden number, opted out, duplicate within window, outside policy).
- **Recovery delivery:** recoveryChannel, recoveryMessageId → existing
  Message / ChannelDelivery.
- **Latency timestamps:** see §10.
- **Retry bookkeeping:** attemptCount, lastError (safe code).

Idempotency layers:

1. **Provider event.** Unique on (connection, providerCallId); state
   transitions are monotonic (an earlier event never overwrites a final
   disposition).
2. **Recovery.** At most one recovery message per call, enforced by a
   compare-and-set transition PENDING → SENDING, the same technique as
   `ChannelDelivery.claimForSending`.
3. **Anti-spam.** At most one recovery per caller per business within a
   configurable window (e.g. the same person calling 3 times in 2 minutes
   gets one message). This is a query on the call table, not a new mechanism.

Raw webhook payloads should **not** be stored verbatim (PII and size). Keep
only the normalized fields, the same principle as `ChannelMessage`.

---

## 10. Speed / latency

Proposed metrics are timestamps on the call / recovery record, from which
durations are derived. No new metrics store is needed:

| Timestamp | Meaning |
|---|---|
| `endedAt` / `missedDetectedAt` | provider says unanswered (provider time) |
| `receivedAt` | webhook accepted by AUTOSERVISE |
| `recoveryQueuedAt` | decision made, message persisted |
| `recoverySentAt` | provider accepted the send (= `ChannelDelivery.deliveredAt` today, which actually means "sent") |
| `recoveryDeliveredAt` | delivery receipt (needs status webhooks) |
| `customerRepliedAt` | first INBOUND message in the linked conversation after recovery (derivable from Message) |
| `humanHandoffAt` | escalation created (derivable from AiEscalation.createdAt) |
| `bookedAt` | linked request converted / appointment created (derivable) |

Headline metric: **missed → recovery sent (p50/p90)**, then **missed → customer reply**.

Bottlenecks:

1. Provider webhook delay (research).
2. Serverless cold start.
3. Remote DB round-trips; Supabase is remote, and the existing transactions
   already use 10–20 s timeouts.
4. WhatsApp API latency.
5. AI latency, typically seconds.
6. Synchronous work in the webhook request.

**Recommendation:**

- **The first recovery message is deterministic and template-based, with no
  AI before it.** Example: «Здравствуйте! Вы только что звонили в
  «{business}». Мастер сейчас занят и не смог ответить. Подскажите,
  пожалуйста, чем можем помочь?»
- AI enters only after the customer replies.
- In the webhook: verify, persist the call idempotently, decide, then send.
  - If the platform cannot run work after responding, the send happens
    inside the webhook with a strict timeout, and a FAILED delivery stays
    retryable.
  - Whether a queue or post-response execution is available on the
    deployment platform is a research item. Do not build a worker blindly.

---

## 11. AI conversation behavior — readiness

**Already aligned:**

- never invent a price (rules 6 and 17: range / from / "no price in the
  base → say so, offer the administrator");
- no confirmed diagnosis (rules 4 and 16);
- `needsHuman` → escalation;
- no false claims of having contacted a manager (rule 19);
- the customer message is untrusted (rule 13);
- the business context includes services with prices, knowledge, rules,
  hours, address and phone (`contextBuilder`).

**Missing for the target behavior:**

- **Automatic reply mode.** A gated mode (per business, off by default) in
  which an inbound customer message produces an AI answer that is *sent*.
  - It must be restricted: no write tools; `check_availability` only.
  - It must respect the same safety layer.
  - It must stop on `needsHuman`, low confidence or a price / diagnosis /
    dispute topic.
  - This is the single biggest behavioral change, and needs its own prompt
    and explicit approval.
- **Conversation style for recovery.**
  - Short; ask only the missing items (vehicle make/model/year, which work).
  - Useful information first.
  - Not a questionnaire, not sales.
  - This is prompt work in a new mode block, testable with the mock provider.
- **"From" price phrasing plus "final price after inspection".** This needs a
  per-service structured flag (§12) so the AI does not have to guess when
  inspection is required.
- **Vehicle-dependent pricing** (e.g. painting a BMW X5 versus a hatchback).
  It is not modeled, so the AI must say the price depends on the car and is
  confirmed on inspection, and hand off. That is correct behavior with the
  current data.
- **Location / "send me the address".** The AI can only state the text
  address; there is no map link or coordinates (§13).
- **Handoff summary.** The AI result has `answer`, `reason` and `entities`,
  but nothing persisted records "what the customer was already told". Since
  messages are persisted, the summary can be *derived*. Design it in the
  handoff prompt.

---

## 12. Services & pricing readiness

| Need | Today | Gap |
|---|---|---|
| Fixed price | `priceFrom == priceTo` (convention, not explicit) | No explicit type; AI infers from equality |
| "From" price | `priceFrom` only | OK (rule 17 handles it) |
| Min/max range | `priceFrom` + `priceTo` | OK |
| Duration | `durationMinutes` (required) | OK |
| Pricing note / conditions | — | MISSING (e.g. "за деталь", "зависит от класса авто") |
| Inspection required | — | MISSING (boolean "final price after inspection") |
| Active/inactive | `isActive` | OK |
| Currency | `Service.currency` + `Business.currency` | OK (per-service currency exists) |
| Vehicle-class pricing | — | MISSING (P2 — explain + handoff instead) |

**Responsibilities:**

- **Structured `Service`** is the only source of offerability, price,
  duration and inspection-required. The AI may quote only these.
- **`KnowledgeItem`** holds free-form explanations: what the service
  includes, preparation, warranty text, payment methods.
- Never put prices in Knowledge. Duplicated prices drift, and the AI could
  then quote a stale one.

Minimal future schema delta (needs approval in its own prompt): `Service.priceNote`
(short text) and `Service.requiresInspection` (boolean). Optionally a
`priceType` enum (FIXED / FROM / RANGE / ON_REQUEST) instead of inferring.

---

## 13. Business knowledge readiness

| Question | Modeled? | Where / gap |
|---|---|---|
| What services / price / duration | Yes | `Service` (+ gaps §12) |
| What cars do you work with / restrictions | Free text only | `BusinessRule` (SERVICE) or `KnowledgeItem` |
| Open today / hours | Yes | `BusinessWorkingHours` + `currentDateTime` in AI context. No holiday / exception dates (gap, P1). |
| Address | Text only | `Business.address` |
| Location / map / coordinates | **No** | MISSING: map URL, lat/lng, directions/landmark text, sending a location pin (channel capability: research) |
| Phone / contact | Yes | `Business.phone`, `email`, `website` |
| Payment methods | Free text | `KnowledgeCategory.PAYMENT` / `BusinessRuleCategory.PAYMENT` |
| Warranty | Free text | `KnowledgeCategory.WARRANTY` / rule category |
| Inspection first? | Partly | Not per service (§12); free-text rules only |
| Free time today/tomorrow | Yes | Prompt 51 slots, `check_availability` tool |
| FAQ | Yes | `KnowledgeCategory.FAQ` |

The business setup UI (Settings) already edits services, knowledge, rules,
hours and business profile. Location fields and the per-service pricing flags
are the P0/P1 additions.

---

## 14. Customer → Request → Appointment reuse

The missed-call conversation must feed, not fork, the existing lifecycle:

- **Recovery conversation:** a normal `Conversation` (channel WHATSAPP or
  SMS) with `externalConversationId` = customer number / WA id.
- **Customer / vehicle:** Prompt 54 intake (link existing or create, with the
  operator in the loop).
- **Request:** Prompt 55 qualification. Its source label needs a value for
  "missed call", e.g. `CustomerRequestSource.PHONE` today, or a new
  MISSED_CALL value if analytics need it (schema decision later).
- **Free time and booking:** Prompt 51 slots and the Prompt 56 atomic
  booking confirmation.
- **Handoff and follow-up:** existing AiEscalation / Operations; follow-ups
  unchanged.

Nothing in the booking path needs to change. Autonomous AI booking stays out of
scope; the customer agreeing to a time becomes an operator confirmation (or a
future, separately approved tool policy).

---

## 15. Human handoff

Desired card (owner, on a phone):

```
Иван · +7 *** ***-12-34 · пропущенный звонок 14:32
BMW X5, 2020 — покраска капота и крыши
AI уже сообщил: услуга есть; капот от X, крыша от Y; итог после осмотра
Клиент: хочет завтра после 15:00
НУЖНО: подтвердить осмотр / ответить по цене
```

| Element | Exists? |
|---|---|
| Handoff record, one active per conversation | Yes (`AiEscalation`) |
| Reason / summary | Yes (server-derived reason, safe summary) |
| Link to customer / vehicle / request / preferred time | Via Conversation → CustomerRequest (Prompts 49 / 55) |
| Missed-call origin + time | **No** (needs CallInteraction link) |
| "What the AI already told" (quoted prices, promises) | **No** structured field; derivable from messages |
| Explicit action needed (category) | **No** (reason is free text; priority always NORMAL) |
| Owner notification outside the web app | **No** (no push / notification mechanism at all) |
| Triggers: price unknown, unclear service, inspection, diagnosis request, dispute, unusual vehicle, low confidence, explicit "человек" | Partly: `needsHuman` + `confidence`. No explicit trigger taxonomy. |

---

## 16. Business-side mobile UX

- Prompts 51–56 validated their screens at 390 px with no overflow:
  Conversation Detail, Request Detail, booking, slot grid.
- The Operations queue exists, but it is a request/escalation list and is not
  organized around "missed calls".

Highest-value mobile surfaces for this direction:

1. **"Пропущенные и восстановленные"** — today's missed calls with recovery
   state (sent / replied / needs human / booked).
2. **"Нужен ответ человека"** — handoff cards (§15).
3. Conversation with customer, vehicle, requested work, quoted price and
   preferred time at the top.
4. Today's visits.
5. Follow-ups.

There is no owner notification, so the owner must open the app to learn
anything. A notification channel to the owner (Telegram-to-owner, push, SMS)
is a research and design item (P1).

---

## 17. Metrics / dashboard

**Current dashboard:** conversations by channel/status, messages in/out, AI
outcomes and intents, tool success, escalations, appointments, requests by
status.

**Future metrics:**

- **Funnel:**
  - missed calls (hidden-number ones counted separately);
  - recovery attempted → sent → delivered;
  - customer replied → active dialogue;
  - handed to human;
  - booked from missed call;
  - visit completed (via Appointment COMPLETED / ServiceRecord).
- **Speed:** median and p90 for missed → recovery sent, and for missed →
  first reply.
- **Headline:** «Сколько клиентов AUTOSERVISE помог не потерять» = missed
  calls that reached an active dialogue **and** a booking or visit, plus
  those handed to a human who replied.
- **Rates:** missed → conversation and conversation → appointment.

Everything derives from CallInteraction plus existing
Conversation / Message / Escalation / Request / Appointment rows; no separate
counters are needed.

---

## 18. Security / privacy / tenant isolation

- **Inbound webhooks (telephony, WhatsApp, delivery statuses):**
  - verify the provider signature or secret *before* any DB read, as the
    Telegram webhook already does with a timing-safe compare;
  - use per-connection URLs;
  - return generic 401 / 404 responses.
- **Replay.** Provider-event idempotency (unique keys) plus a timestamp
  tolerance where the provider signs timestamps (research).
- **Credentials.** Per-connection secrets require a secure credential store
  (encrypted at rest; never in `ChannelConnection.config`, which is
  non-secret by contract). Today's global env tokens are not multi-tenant.
- **Tenant routing.** Never trust payload tenant fields. Called-number routing
  must map to exactly one business. A number moved between tenants needs an
  explicit re-assignment flow.
- **Cross-tenant phone collisions** are expected and harmless when every
  lookup is scoped.
- **PII:**
  - mask phone numbers in logs and AiLog;
  - message content stays in `Message` only;
  - define call-record retention;
  - keep opt-out / do-not-contact per phone per business.
- **Automation actor.** Replace the fake-owner webhook context with an
  explicit system actor (no real User FK; audit rows show "system") before
  automation writes records.
- **Auto-reply abuse.** Set rate limits per caller and per business, cap AI
  calls per conversation, and keep the existing prompt-injection rules.

---

## 19. External research checklist (must be verified before implementation)

**A. WhatsApp Business Platform**

- [ ] Can a business initiate a message to a number that just called but
      never messaged us? Under which category (utility / marketing /
      service), and is a pre-approved template mandatory?
- [ ] Opt-in / consent requirements for messaging a caller; whether the call
      itself counts; documentation needed.
- [ ] Customer-service window rules: when free-form messages are allowed, and
      how templates re-open conversations.
- [ ] Template approval process, timing, language (ru / kk), parameters,
      rejection risks for "you just called us" wording.
- [ ] Phone-number eligibility. Can the business's existing landline/mobile
      number be used? Virtual numbers? Number already on the consumer
      WhatsApp app?
- [ ] Access model: Cloud API directly vs. a Business Solution Provider; one
      platform account with many business numbers (multi-tenant) vs. one
      account per business.
- [ ] Webhooks: inbound messages, delivery / read statuses, signature scheme,
      retry semantics.
- [ ] Location messages (sending a pin) and interactive buttons.
- [ ] Availability and pricing in **Kazakhstan**; implications for RF and
      other CIS markets (sanctions / payment / availability).
- [ ] Rate limits and messaging tiers for new numbers.

**B. Telephony**

- [ ] Providers serving Kazakhstan / target market with **missed / unanswered
      call webhooks** (or call-event APIs) and real-time delivery.
- [ ] Caller ID availability and format; hidden-number behavior.
- [ ] Webhook latency (seconds from hang-up / no-answer to event), retries,
      signature / auth scheme, event ordering.
- [ ] Integration models:
      - virtual number published by the business;
      - call forwarding (busy / no-answer) from the existing number;
      - number porting;
      - PBX integration;
      - effect on the business's existing phone habits.
- [ ] Ring-timeout control: how quickly "missed" can be declared.
- [ ] Pricing, contracts, legal / compliance (call-data processing, recording
      disabled by default, personal data law of KZ / RF).

**C. Fallback**

- [ ] SMS: sender-ID registration, delivery to KZ / RF numbers, cost, latency,
      whether a first "you just called" SMS is permitted and effective.
- [ ] Routing policy when WhatsApp is unavailable or fails: SMS, then a staff
      "call back" task. Never silent.
- [ ] Owner-notification channel options (push / Telegram-to-owner / SMS).

**D. Platform**

- [ ] Post-response / background execution or a queue on the deployment
      platform (affects first-message latency and retries).

No provider is chosen in this audit: the repository contains no configured
telephony, WhatsApp or SMS provider.

---

## 20. Gap matrix

| Capability | Current state | Existing component | Gap | Priority | Recommended next step |
|---|---|---|---|---|---|
| Missed call detection | MISSING | — | Provider event semantics, disposition state machine | P0 | Research B, then telephony intake prompt (mock adapter first) |
| Telephony webhook | MISSING | Telegram webhook pattern | Endpoint, signature, per-connection routing | P0 | Call-event intake prompt |
| Caller phone normalization | PARTIAL | `localSubscriberNumber` (last 10 digits) | E.164 + business region, indexed column, backfill | P0 | **First implementation prompt** |
| Identity resolution | PARTIAL | `resolveCustomerForInbound`, `CustomerChannelIdentity` | Phone-based resolution across channels; indexed lookup | P0 | Same as above |
| Customer creation/link | READY (operator) | Prompt 54 intake | Unknown caller stays unlinked; no auto-create | P0 (reuse) | Reuse as-is |
| WhatsApp outbound | PARTIAL (mock) | Adapter boundary, `ChannelDelivery` | Real adapter, templates, business-initiated send, credentials | P0 | Research A, then WhatsApp adapter prompt |
| Channel routing | MISSING | Adapter registry by type | Router: preferred → fallback → human task | P0 | Recovery orchestration prompt |
| First recovery message | MISSING | Message + ChannelDelivery | Deterministic template, per-business text, anti-spam window | P0 | Recovery orchestration prompt |
| Conversation creation | READY | Unique (connection, externalConversationId) | Call ↔ conversation link | P0 | Recovery orchestration prompt |
| AI qualification | PARTIAL | AI core, qualify mode (P55) | Automatic trigger; auto-reply mode; style | P0 | Gated auto-reply prompt |
| Service lookup | READY | `Service`, AI context | — | P0 (reuse) | — |
| Base pricing | PARTIAL | `priceFrom` / `priceTo`, rule 17 | `priceNote`, `requiresInspection` (opt. `priceType`) | P0 | Pricing + location prompt |
| Business knowledge | READY (free text) | Knowledge, Rules, Hours | Holiday exceptions | P1 | Later |
| Address/location | PARTIAL | `Business.address` | Map URL, coordinates, directions; location message | P0 (text+link), P1 (pin) | Pricing + location prompt |
| Availability | READY | P50 / P51 | — | P0 (reuse) | — |
| Booking | READY (operator) | P56 | Customer-agreed time → operator confirm | P0 (reuse) | — |
| Human handoff | PARTIAL | AiEscalation | Missed-call origin, "already told", action type | P0 | Handoff prompt |
| Operations | PARTIAL | `OperationsPage` | Missed-call / recovery queue | P1 | Owner mobile prompt |
| Mobile owner UX | PARTIAL | 390 px-validated screens | Missed-call list, handoff cards, notifications | P1 | Owner mobile + notification prompt |
| Analytics | MISSING (for this value) | `analyticsService` | Funnel + latency metrics | P1 | Metrics prompt |
| Idempotency | PARTIAL | ChannelMessage / ChannelDelivery patterns | Call-event and one-recovery-per-call guarantees | P0 | Call-event intake prompt |
| Webhook security | PARTIAL | Telegram secret-first check | Per-provider signatures, replay window, per-connection secrets | P0 | Each provider prompt |
| Credential storage | MISSING | global env only | Encrypted per-connection credentials | P0 (before real WhatsApp) | Credentials prompt |
| System actor | MISSING | fake-owner webhook ctx | Explicit system actor for automated writes | P0 | Call-event intake prompt |
| Background execution | MISSING | synchronous only | Post-response send / retry | P1 | Research D, then decide |
| Owner notification | MISSING | — | Alert on handoff / missed call | P1 | Research C, then prompt |
| SMS fallback | MISSING | adapter boundary | SMS adapter + policy | P1 | After research C |

---

## 21. Recommended implementation sequence

The new phase has its own numbering (MCR = Missed-Call Recovery). It runs
mock-provider-first so that the vertical slice is provable before any vendor
contract; real adapters plug in behind the same boundaries once research
concludes.

**R0 — External research.** Not code; runs in parallel, owned by the product owner.

| Field | Content |
|---|---|
| Goal | Answer §19 A–D with evidence |
| Why | Template / opt-in / latency facts decide MCR-4, MCR-7 and MCR-8 |
| Scope | Written findings in `docs/research/` |
| Reuses | — |
| Schema | none |
| External | yes |
| Tests | n/a |
| STOP | Findings documented and reviewed |

**MCR-1 — Phone identity foundation.** ← **FIRST IMPLEMENTATION PROMPT**

| Field | Content |
|---|---|
| Goal | Make the phone number a first-class, canonical, indexed identity per business |
| Why | Every later step starts from a caller number; today matching is a regex full scan on free text |
| Scope | Pure `normalizePhone(raw, defaultRegion)` → E.164 or null (KZ/RU +7 first, no external library unless justified); a per-business default region (derived or configured); a canonical phone column on Customer with an index; idempotent backfill; resolver `findCustomersByPhone` replacing the last-10 heuristic behind the same exactly-one-match policy; phone masking helper for logs. No telephony, no WhatsApp. |
| Reuses | `resolveCustomerForInbound`, Prompt 54 duplicate checks, `customerRepository` |
| Schema | **Yes, small:** one nullable column + index (+ possibly business region). Must STOP for approval with the exact delta. |
| External | none |
| Tests | Normalization table (+7 / 8 / spaces / brackets / short / foreign); backfill idempotency; resolver exactly-one / ambiguous / none; tenant isolation; Prompt 54 duplicate and Telegram inbound regressions |
| STOP | Phone resolution uses the canonical column everywhere it is used today; all tests green; no behavior change for operators except more accurate matching |

**MCR-2 — Call-event intake (mock telephony).**

| Field | Content |
|---|---|
| Goal | Durable, idempotent `CallInteraction` from a provider-agnostic telephony adapter, with an explicit system actor |
| Scope | `TELEPHONY` connection type (or a separate registry, decided in the prompt); signed per-connection webhook; mock adapter; disposition state machine; out-of-order / duplicate handling; caller resolved via MCR-1; PII masking; no outbound yet |
| Reuses | Webhook pattern, ChannelConnection, idempotency patterns |
| Schema | **Yes** (new model + enum) — approval required |
| External | none (mock) |
| Tests | Retries, out-of-order, hidden number, tenant routing, signature failures, system actor |
| STOP | Missed calls appear as records (and in a minimal list), nothing sent |

**MCR-3 — Pricing & location data.**

| Field | Content |
|---|---|
| Goal | Make "Сколько стоит?" and "Где вы?" answerable safely |
| Scope | `Service.priceNote`, `Service.requiresInspection` (optional `priceType`); business map URL / coordinates / directions; Settings UI; AI context + prompt rules (from-price + "final after inspection"); no channel work |
| Schema | **Yes**, small — approval |
| Tests | AI context/rule tests, validation, UI helpers |
| STOP | AI answers price and location questions from structured data only |

Independent of MCR-2 — it can run before or after.

**MCR-4 — Recovery orchestration (mock WhatsApp).**

| Field | Content |
|---|---|
| Goal | Missed call → deterministic first message within seconds |
| Scope | Channel router (preferred WhatsApp → fallback → staff task); business-initiated conversation creation addressed by phone; per-business recovery text / template reference; one recovery per call (compare-and-set); anti-spam window; latency timestamps; delivery via existing `ChannelDelivery`; opt-out flag |
| Reuses | Conversation find-or-create, Message, ChannelDelivery, adapters |
| Schema | Likely small (recovery fields, opt-out) — approval |
| External | none (mock); real behavior depends on R0 |
| Tests | Idempotency, races (two webhooks), router fallbacks, latency stamps, no AI in the first message |
| STOP | End-to-end with mocks — missed call → message recorded as SENT |

**MCR-5 — Gated auto-reply AI mode.**

| Field | Content |
|---|---|
| Goal | Customer reply → useful, safe AI answer sent automatically, per-business opt-in |
| Scope | New execution mode (read-only tools); stop / handoff triggers taxonomy (price unknown, inspection, diagnosis, dispute, explicit human, low confidence); rate limits; style block (short, ask only missing items); every answer logged; kill switch |
| Reuses | AI core, safety, context, escalation, P55 qualification |
| Schema | Maybe a business setting flag — approval |
| Tests | Mock-provider scenario suite (BMW X5 painting, unknown price, location, hours, "дайте человека"), safety regressions |
| STOP | Auto-replies only in tenants that enabled it; human takeover always possible |

Requires explicit product approval (it is the first autonomous AI step).

**MCR-6 — Actionable handoff + owner mobile.**

- Handoff card: missed-call origin, quoted prices derived from the AI's sent
  messages, action type.
- "Пропущенные и восстановленные" and "Нужен ответ" mobile views.
- Owner notification after research C.

**MCR-7 — Real WhatsApp adapter.** Built after R0. It covers:

- the credential store;
- templates;
- status webhooks;
- signature verification;
- per-tenant numbers.

**MCR-8 — Real telephony adapter.** After R0 (provider chosen).

**MCR-9 — Recovery metrics dashboard.** Funnel, latency and headline metric.

**MCR-10 — SMS fallback adapter.** After research C.

The shortest real vertical slice with mocks is **MCR-1 → MCR-2 → MCR-4 →
MCR-5**, with MCR-3 slotted wherever convenient. Real providers swap in at
MCR-7 / MCR-8 without changing the slice.

---

## 22. First implementation prompt after this audit

**MCR-1 — Phone Identity Foundation** (see §21).

It is provider-independent and small, and every other step depends on it.
It fixes a real current weakness: free-text phones matched by regex full scan.
It does not wait on any external research.

---

## Implementation status

- **MCR-1 — Phone Identity Foundation: implemented**
  (`docs/final-reports/final-report-mcr-1.md`). It deviates from the
  sketch in §8 / §21 as the MCR-1 prompt required:
  - normalization uses `libphonenumber-js` (not a custom +7 parser);
  - the default region is `Business.phoneRegion` (ISO code, default `KZ`),
    not a constant;
  - the backfill is an explicit idempotent application script, not SQL.

  Customer phones are canonical E.164 in `Customer.phoneE164` (indexed, not
  unique), and the last-10-digits heuristic is gone.
- **MCR-2 — Missed Call Intake Foundation: implemented** (`docs/final-reports/final-report-mcr-2.md`).
  It covers:
  - `BusinessPhoneNumber`: called-number routing, at most one ACTIVE owner of a number across tenants;
  - a provider-neutral `TelephonyAdapter` with a mock provider and a secured mock webhook;
  - `CallInteraction`, one per call, with a monotonic outcome state machine;
  - `CallEvent` as the provider-event idempotency ledger;
  - customer linking via MCR-1;
  - `recoveryState` (PENDING / NOT_ELIGIBLE / READY) and latency timestamps.

  Nothing is sent to anyone. The design follows §9, with one refinement: routing is by called number (not per-connection URL).
- MCR-3 and later are not implemented.
