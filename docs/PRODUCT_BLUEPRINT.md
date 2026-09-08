# AI-администратор для автосервисов — Product Blueprint

> Отдельный проект и кодбейс. Не связан с другими продуктами (включая
> «Отпечаток стиля»), не переиспользует их код, Prisma schema, Supabase
> project, компоненты, стили или настройки.

This document describes the whole intended product — not only what is
implemented today. Section 3 (Current Architecture) and Section 5 (Domain
Model) are the only sections that must match the current codebase exactly;
everywhere else, "future" language marks intent, not a completed feature.

## 1. Product Vision

The end goal is an **AI administrator**, not a chatbot bolted onto a CRM.
In its final form it should:

- accept incoming customer inquiries;
- understand customer intent;
- identify an existing customer;
- identify their vehicle;
- take that vehicle's service history into account;
- work from the business's real service catalog;
- work from the business's knowledge base;
- work from the business's own rules;
- answer common questions correctly;
- suggest relevant services;
- check real available time slots;
- offer free slots to the customer;
- create appointments;
- modify appointments;
- cancel appointments;
- create structured customer requests;
- hand off anything it cannot safely resolve to a human;
- keep a durable record of every interaction;
- **never invent information it doesn't actually have.**

The AI is an operational layer that sits *on top of* the business's real
CRM and operational data (Section 6) — it must never become a second,
parallel source of truth. Every fact it states and every action it takes
has to trace back to real rows in this system.

## 2. Core Product Flow

```
Customer
   ↓
Incoming Message / Request
   ↓
CustomerRequest
   ↓
Identify Customer
   ↓
Identify Vehicle
   ↓
Understand Intent
   ↓
Knowledge + Business Rules + Service History
   ↓
AI Decision
   ↓
┌─────────────────────────────┐
│ Answer                      │
│ Offer Service                │
│ Offer Appointment            │
│ Create Appointment           │
│ Update Appointment           │
│ Cancel Appointment           │
│ Ask Clarifying Question      │
│ Escalate to Human            │
└─────────────────────────────┘
   ↓
Conversation / Action Log
```

What each layer is for:

- **Incoming Message / Request** — the raw contact, regardless of channel. `Message`/`Conversation` records now exist to hold this (**implemented today**, Prompt 08), but no channel is actually connected to anything real yet — every Conversation/Message today is created manually by staff through the Settings UI, exactly like a CustomerRequest.
- **CustomerRequest** — the structured, channel-independent record of that inquiry (**implemented today**, manually created/managed by staff, and now optionally linkable to a Conversation). This is the boundary a future AI is meant to operate through instead of touching operational tables directly.
- **Identify Customer / Identify Vehicle** — resolving the request to a real `Customer`/`Vehicle` row in this tenant's data, never a guess. **Partially implemented** (Prompt 09–10): the AI context builder resolves a Customer/Vehicle already linked to the Conversation, and every booking tool re-validates that id against real tenant-scoped data — but the AI still never *searches for or picks among* several possible matches, and it never creates a Customer/Vehicle on its own; that remains future Tool Layer work.
- **Understand Intent** — classifying what the customer actually wants. **Implemented today** (Prompt 09): `POST /api/ai/analyze` classifies every message into one of twelve fixed intents (`PRICE_INQUIRY`, `BOOKING_REQUEST`, `VEHICLE_PROBLEM`, etc.) with a `confidence` score.
- **Knowledge + Business Rules + Service History** — the only allowed sources of business-specific fact (see `AI_BEHAVIOR_CONTRACT.md` §2). **Implemented today** (Prompt 09 for Knowledge/Rules, Prompt 11 for Service History): all three are part of the AI context, sourced with the same priority order the behavior contract specifies — Business Rules first, then Services/Knowledge, then Service History as the authoritative record of what actually happened in the past (never contradicted by a generic Knowledge Base statement).
- **AI Decision** — a structured choice among the actions listed, never free-form unconstrained behavior. **Partially implemented** (Prompt 10, 12): "Offer Appointment" (`check_availability`), "Create Appointment", "Update Appointment" (`reschedule_appointment`), and "Cancel Appointment" exist as real, whitelisted tools behind a server-controlled tool-calling loop, each gated by explicit customer confirmation before it runs. "Escalate to Human" is now real too (Prompt 12) — a persisted `AiEscalation` row a staff member actually sees and acts on, not just a flag — but "Ask Clarifying Question" remains a plain draft-answer behavior, not a dedicated tool.
- **Conversation / Action Log** — `Conversation`/`Message` (the "Conversation" half) are **implemented today** (Prompt 08) as a durable, append-only record of what was said. The "Action Log" half is now **implemented** (Prompt 13): `AiLog` records every `analyze` call's outcome, every genuine tool execution, and every escalation create/reuse/claim/resolve/cancel — a safe, minimal technical audit trail (`/settings/ai-logs`), not a substitute for the full Conversation transcript and never containing chain-of-thought, a raw provider response, or full message content. Analytics/dashboards built on top of this data remain future work (Roadmap 14).

## 3. Current Architecture

Verified directly against `package.json`, `prisma/schema.prisma`, and the
`api/`/`src/` trees at the time of writing (Prompt 13 complete).

- **AI provider**: OpenAI (official `openai` npm SDK), accessed exclusively server-side through a provider-abstraction interface (`AiProvider`) — `src/server/ai/`. Falls back automatically to a deterministic, no-network mock provider when `OPENAI_API_KEY` isn't configured (true in this environment), so the AI Core stays fully exercisable without a real key.
- **AI Tool Layer** (`src/server/ai/tools/`): the only path from the AI provider to booking data. Four whitelisted tools, each Zod-validated, each re-authorized against `AuthContext` (never model-supplied ids) and an `AiToolAllowedEntities` allow-list (the conversation's own known customer/vehicle/appointments), each calling the existing `appointmentService.ts` — never Prisma directly. A tool result is always `{success:true, tool, data}` or `{success:false, tool, errorCode, message, retryable?, attempted}` — `attempted` (Prompt 13) distinguishes a genuine execution failure from a gate rejection (confirmation missing, invalid input, forbidden entity) that never reached `appointmentService.ts` at all.
- **AI Customer Support** (Prompt 11): read-only, no new tool — `contextBuilder.ts` additionally loads the known vehicle's recent Service History, and the safety layer (`safety.ts`) gained two more deterministic checks (`applyDefinitiveDiagnosisCheck`, `applyFabricatedEscalationCheck`) alongside Prompt 09's fabricated-action check.
- **Human Escalation** (Prompt 12): `src/server/services/escalationService.ts` + `escalationRepository.ts` — the only path from `aiService.ts` to the new `AiEscalation` table, called only when a fully-validated, non-safety-rejected `needsHuman: true` result exists. Idempotency is a real Postgres unique constraint (`AiEscalation.activeConversationId` + `@@unique([tenantId, businessId, activeConversationId])`), not just an application-level check. AI creates or reuses; only staff (`/api/escalations/:id/claim|resolve|cancel`) can change its state afterward.
- **AI Logs / Audit** (Prompt 13): `src/server/services/aiLogService.ts` + `aiLogRepository.ts` — a safe, minimal technical audit trail (`AiLog`) written from three call sites (`aiService.ts`'s analyze loop and tool-calling loop, `escalationService.ts`'s create/reuse/claim/resolve/cancel), never from a client request and never with direct AI/Prisma access. `aiLogService.ts` sanitizes every field before it's persisted — a fixed metadata key whitelist, truncated `reason`, no raw provider response, no chain-of-thought, no full prompt or transcript — and writes are fire-and-forget: a logging failure is caught and reported, never allowed to roll back or mask the real business action it describes.

- **Frontend**: React **18.3.1** (not 19), TypeScript, Vite, Tailwind CSS **v3.4.13** (not v4). No `shadcn/ui` CLI/package is installed — the UI components under `src/components/ui/` are hand-rolled in the shadcn visual style, built on `@radix-ui/react-label`, `@radix-ui/react-slot`, `class-variance-authority`, and `tailwind-merge`. `lucide-react` for icons, `react-router-dom` v6 for routing.
- **Backend**: Node.js + TypeScript, plain REST endpoints under `/api/**` written as Vercel-compatible serverless functions (`(req, res) => ...`). In local dev, a Vite plugin (`vite.config.ts`) serves the same handler files on the same port — no separate backend process.
- **Database**: PostgreSQL, hosted on Supabase, used purely as a managed Postgres provider — **Supabase Auth is not used**.
- **ORM**: Prisma (`prisma/schema.prisma`), one additive migration per implemented stage (see `prisma/migrations/`).
- **Validation**: Zod, throughout the route → validation → service → repository layering (see `src/server/`).
- **Auth**: fully custom — email + Argon2id password hashing, cryptographically random session tokens (HMAC-SHA256-hashed before storage), server-side `Session` table, HttpOnly/SameSite cookies. No Supabase Auth, no Clerk/Auth0, no JWT-in-localStorage.
- **Multi-tenant**: every domain table carries `tenantId` + `businessId`; see Section 4.

**Discrepancy note**: earlier planning language for this project referred to "React 19" and "Tailwind v4" / "shadcn/ui" as the target stack. The repository, as actually built across Prompts 01–12, uses React 18.3.1 and Tailwind v3 with hand-rolled shadcn-style components instead. This document records the actual, current stack; upgrading is not scheduled on the roadmap and would be its own deliberate step if ever undertaken.

## 4. Multi-Tenancy

```
Tenant
  ↓
Business
  ↓
Users
  ↓
Business Data
```

- One `Tenant` = one auto-service company. Every `User` belongs to exactly one tenant. Every tenant currently has exactly one `Business`.
- Every business-data table carries both `tenantId` and `businessId`.
- **Isolation is enforced server-side only**, never by frontend filtering. `tenantId`/`businessId` always come from the authenticated session (`requireAuth`) — never trusted from client-supplied fields. The reusable `withTenant()` helper (`src/server/lib/tenantScope.ts`) is the one way tenant-scoped `where` clauses get built, and all mutations use scoped `updateMany` (never a bare `findUnique`/`update` by id alone).
- A resource belonging to another tenant is indistinguishable from one that doesn't exist: cross-tenant `GET`/`PATCH` return a plain `404 NOT_FOUND`, never a "belongs to another tenant" message.
- **As of Prompt 09–10**, this is no longer purely a future requirement: the AI context builder resolves tenant/business from the same authenticated session every other endpoint uses, every lookup inside it (including every AI booking tool) goes through the existing tenant-scoped repositories/services, and both `POST /api/ai/analyze` and all four booking tools return a plain `404`/`NOT_FOUND` for a foreign-tenant Conversation/Customer/Vehicle/Service/Appointment — verified by dedicated cross-tenant tests and a live check against the real database, including an attempt to book using a real, same-tenant entity that simply isn't the one this conversation actually knows about (rejected as `FORBIDDEN`, not silently honored).

## 5. Domain Model

**Implemented in the current schema** (`prisma/schema.prisma`, confirmed by direct inspection):

- `Tenant`, `User`, `Business`, `Session`
- `BusinessWorkingHours`
- `Service`
- `KnowledgeItem`
- `BusinessRule`
- `Customer`
- `Vehicle`
- `Lead`
- `Appointment`
- `ServiceRecord`
- `CustomerRequest`
- `CustomerRequestStatusHistory`
- `Conversation`
- `Message`
- `AiEscalation`
- `AiLog`

`CustomerRequest`/`CustomerRequestStatusHistory` were completed in Prompt 07,
and `Conversation`/`Message` in Prompt 08 (see `DEVELOPMENT_ROADMAP.md`) —
none of these four are a future/planned domain any more; all exist in the
schema and API today.

**Prompt 09 (AI Core) added zero new Prisma models, deliberately.** The
`src/server/ai/` module (intent classification, structured result, context
builder, provider abstraction) is plain TypeScript/Zod code with nothing
persisted — it reads the eight models above (via their existing
repositories) and returns a result without writing to any table.

**Prompt 10 (AI Booking) also added zero new Prisma models and zero new
migrations.** The new AI Tool Layer (`src/server/ai/tools/`) only ever
calls the existing `appointmentService.ts`, which now also exposes a
`checkAvailability()` function built entirely from `BusinessWorkingHours`
and the existing per-vehicle conflict query — no new schedule/availability
model, no idempotency table. The one new server-side helper is
`businessLocalToUtc()` (`src/server/lib/timezone.ts`), the DST-safe inverse
of the existing `toBusinessLocalDateTime()` — plain code, not schema.

**Prompt 11 (AI Customer Support) also added zero new Prisma models and
zero new migrations.** `contextBuilder.ts` now additionally reads
`ServiceRecord` (via the existing `serviceRecordRepository.list()`,
unchanged) to populate `serviceHistory` — no new history table, no
duplication of `ServiceRecord` data anywhere.

**Prompt 12 (Human Escalation) is the first AI-related stage to add a real
Prisma model.** `AiEscalation` (migration `20260908155027_ai_escalation_foundation`)
persists the AI Core's `needsHuman: true` signal as a real, tenant-scoped
row: `status` (`AiEscalationStatus`: `OPEN`/`IN_PROGRESS`/`RESOLVED`/`CANCELLED`),
`priority` (`AiEscalationPriority`: `LOW`/`NORMAL`/`HIGH`/`URGENT` — only
`NORMAL` is ever assigned today), `reason`/`summary` (server-derived,
bounded strings — never raw model or client text), `conversationId`
(required), `customerId`/`assignedUserId` (optional), and
`activeConversationId` — a nullable mirror of `conversationId` that exists
purely to carry a `@@unique([tenantId, businessId, activeConversationId])`
constraint, giving Postgres a real "at most one active escalation per
conversation" guarantee without a partial/filtered index (which Prisma's
schema DSL cannot express directly).

**Prompt 13 (AI Logs / Audit) added the second AI-related Prisma model.**
`AiLog` (migration `20260908174017_ai_logs_audit_foundation`) records a
safe, minimal audit trail: `operation` (`AiLogOperation`: `AI_ANALYZE`,
`AI_TOOL_EXECUTION`, `AI_ESCALATION_CREATE`/`REUSE`/`CLAIM`/`RESOLVE`/
`CANCEL`), `outcome` (`AiLogOutcome`: `SUCCESS`/`ESCALATED`/`REUSED`/
`FAILED`/`REJECTED`/`NO_ACTION`), optional `intent`/`confidence`/
`needsHuman` (mirroring the validated `AiResult` for `AI_ANALYZE` rows
only), a bounded `reason` (server-derived, never raw model/client text,
same convention as `AiEscalation.reason`), optional `toolName`/
`toolSuccess`, a whitelisted-shape `metadata` JSON column, and optional
FKs to `Conversation`/`Message`/`AiEscalation`/`User` (the last only for
the three staff-action operations). Deliberately **not** a substitute for
`Conversation`/`Message` (the real transcript) — this table never holds
chain-of-thought, a raw provider response, a full prompt, or full message
content.

**Planned, not yet in the schema** (no such Prisma model exists today):

- Any Dashboard/Analytics-specific aggregate or metrics table (Prompt 14) — `AiLog` itself is a plain audit trail, not a pre-aggregated analytics store.

## 6. CRM Structure

```
Customer
   ├── Vehicles
   │      └── Service History
   │
   ├── Leads
   │
   ├── Customer Requests
   │
   └── Appointments
```

```
Vehicle
   ├── Appointments
   └── Service Records
```

```
Service
   ├── Appointments
   ├── Service Records
   └── Customer Requests
```

All of the above relations exist in the schema today with `Restrict`
(never `Cascade`) foreign keys from history-bearing tables back to
Customer/Vehicle/Service/Appointment — deactivating or changing one of
those never deletes or silently corrupts dependent records.

## 7. Business Configuration

Implemented today, under `Business` + its related config tables:

- Business profile: name, description, phone, email, address.
- `timezone` — a validated IANA identifier (`Europe/Moscow`, etc.).
- `currency` — a whitelisted currency code, used to default money fields on Services/Appointments/ServiceRecords at creation.
- `BusinessWorkingHours` — a 7-day schedule (`isOpen`, `openTime`, `closeTime` as local `"HH:mm"` strings).
- `Service` catalog.
- `KnowledgeItem`s (categorized FAQ/policy/etc. content).
- `BusinessRule`s (categorized, prioritized operational rules).

**`Business.timezone` is the single source of truth for all
operationally-relevant local time** — appointment working-hours
validation, `CustomerRequest.requestedDate` normalization, and any future
scheduling logic. The browser's timezone, the server's own clock timezone,
and any request-supplied timezone are never used for this. This principle
must extend unchanged into the future AI layer's own scheduling logic.

## 8. Main Screens

| Group | Screens | Status |
|---|---|---|
| **Authentication** | Login, Register | Implemented |
| **Dashboard** | Dashboard (summary) | Implemented |
| **Customer Requests** | Customer Requests list, Customer Request detail (embedded in the edit form, incl. status history) | Implemented (`/settings/customer-requests`) |
| **Conversations** | Conversations list, Conversation detail (messages, send-message form, Close/Reopen) | Implemented (`/settings/conversations`) — no channel is actually connected to anything real yet |
| **CRM** | Customers, Customer profile (detail is the edit form; no separate profile page), Vehicles, Vehicle profile (same) | Implemented (`/settings/customers`, `/settings/vehicles`) |
| **Operations** | Appointments, Appointment detail, Service History, Service Record detail | Implemented (`/settings/appointments`, `/settings/service-history`) |
| **Configuration** | Services, Knowledge Base, Business Rules, Business Settings, Working Hours | Implemented (`/settings/services`, `/settings/knowledge`, `/settings/rules`, `/settings/business`, `/settings/hours`) |
| **Users / Team** | Team management, invitations | **Future** — roles exist (`owner`/`admin`/`manager`, set at registration/via DB only), but there is no team/invitation UI or API today |
| **AI Operations** | AI Core + Booking Tools test tool (`/settings/ai`: select a Conversation, type a test message, Analyze, see intent/confidence/entities/draft/needsHuman, and — since Prompt 10 — any real tool executions: availability slots, or the resulting appointment's id/status/start/end) | Implemented (`/settings/ai`) — a testing tool, not an operations dashboard; tool execution is real (a clearly-labeled warning banner says so), but sending a message to the customer stays disabled |
| **AI Escalations** | Escalations list (status/priority/unassigned filters), detail (customer/conversation/assigned-staff summary, AI's reason/summary, Claim/Resolve/Cancel) | Implemented (`/settings/escalations`, Prompt 12) — an internal staff workflow tool, not a customer-facing feature; no external notification of any kind |
| **AI Logs** | AI Logs list (operation/outcome/date-range filters), detail (intent/confidence/needsHuman/tool/reason, conversation/escalation links, actor, safe whitelisted metadata) | Implemented (`/settings/ai-logs`, Prompt 13) — a technical audit trail, not a dashboard/analytics screen (no charts, no aggregates — that's Roadmap 14); raw prompts/provider responses/chain-of-thought are never shown because they are never persisted |

Every "Implemented" screen above lives under `/settings/...` and is gated
by `ProtectedRoute` + session auth; "detail" views in this codebase are
currently the same page's inline edit form (with, for CustomerRequest, an
embedded read-only status-history panel) rather than a separate route —
this document doesn't imply a dedicated detail route exists where the
actual UI uses an inline panel instead.

## 9. Customer Lifecycle (New Customer)

```
New Customer
    ↓
Customer
    ↓
Vehicle
    ↓
Customer Request
    ↓
Appointment
    ↓
Service
    ↓
Service Record
    ↓
Future Requests
```

Every step of this chain has a real, implemented model today
(`Customer` → `Vehicle` → `CustomerRequest` → `Appointment` → `Service` →
`ServiceRecord`); only the *automatic* progression between steps (an AI
or channel driving a customer through this chain on its own) is future
work.

## 10. Existing Customer Lifecycle

```
Incoming Request
      ↓
Find Customer
      ↓
Find Vehicle
      ↓
Read Service History
      ↓
Understand Request
      ↓
Check Knowledge / Rules
      ↓
Answer or Book
```

Today, every step of this flow is performed by a human staff member
through the Settings UI (search customers/vehicles, read Service History,
consult Knowledge Base/Business Rules, then create a Lead/Appointment by
hand). The future goal is for an AI to perform this same flow through the
tool set defined in `AI_BEHAVIOR_CONTRACT.md` §11 — it does not change what
the flow *is*, only who/what executes it.

## 11. AI Capabilities

**Read — implemented today (Prompt 09–11)**: business profile, active services, active knowledge, active business rules, and — only when already known via the Conversation — customer/vehicle summary fields, a small bounded list of that vehicle's own upcoming appointments (Prompt 10), and now that same vehicle's recent Service History (Prompt 11: latest 10 non-archived `ServiceRecord`s, newest-first). **Not yet included**: working hours are still not part of the raw context handed to the model (they're read internally by `check_availability` only).

**Classify/Draft — implemented today (Prompt 09), grounded (Prompt 11)**: `POST /api/ai/analyze` classifies a message into one of twelve fixed intents, extracts a small set of structured entities (never fabricated — unknown values are `null`), and returns a `confidence`/`needsHuman`/`reason` triple. As of Prompt 11, the draft answer for a non-booking question is actually grounded in real data rather than a generic deflection: a price question states the exact stored price or admits none exists; a warranty question cites the matching Business Rule or Knowledge Item or admits it can't be confirmed; a service-history question cites the real record or admits there isn't one; a vehicle-symptom question acknowledges the symptom and cites relevant history as fact without concluding a diagnosis from it. This is read-only analysis, returned to staff as a draft — it is never sent to a customer automatically.

**Perform — partially implemented (Prompt 10, 12)**: `check_availability`, `create_appointment`, `reschedule_appointment`, and `cancel_appointment` exist today as real, whitelisted tools (`src/server/ai/tools/`) behind a server-controlled tool-calling loop (max 3 tool calls per `analyze` request) — each one calls the existing Appointment Service, never Prisma directly, and the three mutating tools each require an explicit customer confirmation phrase in the *current* message before they run at all. "Create escalation" is now real too (Prompt 12) — but not as a tool: `analyzeMessage()` itself calls `escalationService.createOrReuseActiveEscalation()` directly whenever the already-validated result has `needsHuman: true`, since a human handoff is a consequence of the *result*, not an action the model requests. **Still future**: create CustomerRequest, find/search among several possible customer or vehicle matches, automatic Customer/Vehicle creation — none of this exists yet.

**Ask — future**: today's draft answer can *state* that more information is needed, but there is no multi-turn clarification loop, no follow-up-question tool, and no automatic re-prompting yet — that belongs to the AI Core the same way the rest of "Perform" does, layered on top of the single-shot `analyze` call.

**Escalate — implemented today (Prompt 12)**: a `needsHuman: true` result (from the model's own judgment or the confidence policy) now creates or reuses a real, persisted `AiEscalation` row, idempotently, per Conversation — not just a flag on the response. The AI can never resolve, cancel, claim, assign, or re-prioritize an escalation after creating it; only authenticated staff can, through `/api/escalations/:id/claim|resolve|cancel`. A safety-layer *rejection* (a caught fabricated claim) deliberately does not itself create an escalation — see `DEVELOPMENT_ROADMAP.md` Prompt 12 for the exact eligibility rule.

## 12. AI Forbidden Actions

The AI must never: invent services; invent prices; change prices; change
business rules; change working hours; change services without explicit
authorization; create records that don't correspond to real entities;
promise parts availability without confirmed data; state a vehicle
diagnosis as fact; guarantee a repair outcome; book outside working
hours; bypass appointment-conflict rules; delete service history; delete
customers; access another tenant's data; talk to the database directly;
run arbitrary SQL; bypass permission checks.

**As of Prompt 10**, the AI *does* now hold a real write path — to
`Appointment` only, and exclusively through the four whitelisted booking
tools — so several of these items are enforced by real code for the first
time rather than being true by the absence of any path at all: booking
outside working hours is rejected by `check_availability`'s own working-hours
lookup and by `createAppointment`'s existing validation; bypassing the
appointment-conflict rule is rejected by a real-time conflict re-check on
every `create_appointment`/`reschedule_appointment` call; accessing another
tenant's data, talking to the database directly, and running arbitrary SQL
have no path to violate because every tool call routes through the
existing tenant-scoped Appointment Service, never Prisma directly; deleting
a customer or service history remains impossible (no such tool exists);
cancellation is always `status: CANCELLED`, never a `DELETE`. Prompt 09's
read-only guarantees (no invented services/prices, no fabricated-action
claims) remain unchanged and now additionally cover tool results — a tool
failure is reported honestly (`errorCode`/`message`), never smoothed over
into a false success claim. The remaining items (price/rule/working-hours
*changes*, service creation) still have no code path to violate — no tool
exists for any of them.

**As of Prompt 11**, "state a vehicle diagnosis as fact" and "delete
service history" both have real code behind them too, in the read-only
direction: Service History is now part of the AI context specifically so
the AI can cite it as fact, but a new deterministic safety check
(`applyDefinitiveDiagnosisCheck`) catches and replaces a draft that
crosses from citing history into asserting a confirmed current diagnosis;
Service History itself is never written to by `analyze` (verified against
the real database — row timestamps unchanged before/after). A second new
check (`applyFabricatedEscalationCheck`) extends the existing
fabricated-action protection to escalation claims specifically ("I've
notified a manager") — meaningful now that Prompt 11 gives the AI many
more reasons to want to say that. Full rationale in
`AI_BEHAVIOR_CONTRACT.md`.

**As of Prompt 12**, "access another tenant's data" additionally covers the
new `AiEscalation` table specifically: every escalation query is scoped by
`tenantId` + `businessId` exactly like every other domain table, verified
by both unit tests and a live cross-tenant check against the real database
(view/claim/resolve/cancel all return `404` for a foreign-tenant
escalation). The AI still cannot resolve, cancel, claim, assign, or
re-prioritize an escalation after creating it — only `escalationService.ts`'s
staff-facing functions can change its state, and each independently
re-checks the caller's role via `requireRole()`, the same defense-in-depth
convention `appointmentService.ts` already established.

## 13. Human Escalation

The AI must hand off to a human when: it cannot answer reliably; the
question needs a manager's judgment call; the customer is in conflict;
a non-standard price is requested; an individualized commercial decision
is needed; there's doubt about safety; the customer asks for something
outside the business's stated rules; or the AI cannot safely determine
the next step.

**As of Prompt 09**, the `needsHuman`/`reason` fields on every `analyze`
response were the first real implementation of this signal — confidence
below 0.50 forces it server-side regardless of what the model claims, and
a detected prompt-injection attempt or fabricated-action claim forces it
too. **Prompt 11** added more triggers for the same honest signal — an
unanswerable customer-support question, a vehicle-symptom report, an
ungrounded warranty question.

**As of Prompt 12, "hand off to a human" is a real, persisted, tenant-
isolated workflow, not just a signal.** A `needsHuman: true` result now
creates (or reuses, idempotently, per Conversation) a real `AiEscalation`
row that an owner/admin/manager actually sees on `/settings/escalations`,
can claim (atomically — a second staff member cannot steal a claimed
escalation), and can resolve or cancel. The AI still cannot claim a human
was actually notified until that row genuinely exists (`applyFabricatedEscalationCheck`,
Prompt 11, is unchanged and still catches a premature claim), and it can
never change the escalation's state after creating it — see
`DEVELOPMENT_ROADMAP.md` Prompt 12 for the full status machine and
idempotency mechanism. **As of Prompt 13**, every escalation create/reuse
and every staff claim/resolve/cancel additionally writes a safe `AiLog`
audit record (`/settings/ai-logs`) — a technical trail of *that this
happened*, never a replacement for the `AiEscalation` row itself or for
the Conversation transcript. **Still future**: assignment to a *specific*
manager beyond self-claiming (explicit reassignment — Roadmap 12 scoped
this out deliberately as unnecessary for a first working version), and any
external notification of a human (email/Telegram/push — Roadmap 16).

## 14. Anti-Hallucination Principle

**If the system doesn't know, it doesn't make it up.**

The AI may only use: CRM data, services, the knowledge base, business
rules, service history, appointments, and its explicitly allowed tools.
When information is missing, the only two allowed outcomes are:

```
Ask clarification
OR
Escalate to human
```

This is the single most important constraint on the entire future AI
layer and is the organizing principle behind `AI_BEHAVIOR_CONTRACT.md`.

**As of Prompt 09**, this principle has real code behind it for the first
time: extracted entities are `null` whenever unknown rather than a guess
(enforced by `aiResultSchema`'s normalization), confidence below 0.50
always forces `needsHuman = true` server-side, and a fabricated
"appointment confirmed"-style claim in a draft answer is caught and
replaced. **Prompt 11** extends "it doesn't make it up" to Service
History specifically: a price/service/warranty/history question with no
real grounding gets an honest "I don't have enough information," never an
estimate, and a vehicle-symptom question gets an acknowledgment plus a
recommendation to get an in-person inspection — real history is cited as
fact, but is never allowed to become the basis for a fabricated current
diagnosis. **As of Prompt 12**, the `Escalate to human` half of this
principle is no longer just a response field with no receiving end — a
real `AiEscalation` row exists and a human genuinely sees and acts on it
at `/settings/escalations`.

## 15. Product Evolution

```
Channels
   ↓
Messages
   ↓
Conversations
   ↓
Customer Requests
   ↓
AI Core
   ↓
Tools
   ↓
CRM / Operations
```

The `Messages`/`Conversations`/`Customer Requests` middle of this chain is
**implemented today** (Prompts 07–08) — a Conversation and its Messages can
optionally link to a CustomerRequest, and multiple Conversations can exist
per Customer. **`AI Core` is implemented** (Prompt 09) as classification and
grounded draft-answer generation — Prompt 11 additionally lets it *read*
`CRM / Operations` data directly for grounding (Service History), without
going through `Tools` at all, since this stage is read-only by design —
and **`Tools` is separately, partially implemented** (Prompt 10) — four
whitelisted, confirmation-gated tools connect the AI to real `Appointment`
*writes* under `CRM / Operations`. **Prompt 12 adds a new branch off `AI Core`
that this diagram doesn't show yet**: `needsHuman: true` → `EscalationService`
→ a real `AiEscalation` row a human staff member acts on — not a `Tools`
call (the AI doesn't request it), and not `CRM / Operations` in the
Customer/Vehicle/Appointment sense either, but a genuine new persisted
outcome alongside them. **Prompt 13 adds a thin audit layer alongside
every branch of this diagram, not a new branch of its own**: `AI Core`'s
analyze calls, `Tools`' actual executions, and `EscalationService`'s
create/reuse/claim/resolve/cancel each write a safe `AiLog` row —
observability, not a new capability. Everything else `Tools` would
eventually connect to (CustomerRequest creation, customer/vehicle search)
remains future, and so does the **Channels** end of the chain (Website,
Telegram, WhatsApp, Phone — `Manual`, entered by staff exactly as done
today, is the only "channel" actually wired to anything). No channel
integration or external notification of any kind exists in this
repository.

## Documentation Source of Truth

This document describes the intended product architecture.

For already implemented functionality: the current repository code and
database schema are the source of truth.

For future functionality: this document and `DEVELOPMENT_ROADMAP.md`
define the intended direction.
