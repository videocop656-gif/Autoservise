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
- **Identify Customer / Identify Vehicle** — resolving the request to a real `Customer`/`Vehicle` row in this tenant's data, never a guess. **Partially implemented** (Prompt 09): the AI context builder resolves a Customer/Vehicle already linked to the Conversation, but it never searches for or picks *among* several possible matches — that remains future Tool Layer work.
- **Understand Intent** — classifying what the customer actually wants. **Implemented today** (Prompt 09): `POST /api/ai/analyze` classifies every message into one of twelve fixed intents (`PRICE_INQUIRY`, `BOOKING_REQUEST`, `VEHICLE_PROBLEM`, etc.) with a `confidence` score, but only classifies — it never acts on the intent.
- **Knowledge + Business Rules + Service History** — the only allowed sources of business-specific fact (see `AI_BEHAVIOR_CONTRACT.md` §2). Knowledge and Business Rules are **implemented today** as part of the AI context; Service History is deliberately not included yet (see Section 11).
- **AI Decision** — a structured choice among the actions listed, never free-form unconstrained behavior. **Implemented today** as a *classification+draft* decision (intent, entities, draft answer, needsHuman) — the "which real action to take" half of this box remains future Tool Layer work (Roadmap 10+).
- **Conversation / Action Log** — `Conversation`/`Message` (the "Conversation" half) are **implemented today** (Prompt 08) as a durable, append-only record of what was said; the "Action Log" half (a record of what an AI *decided and did*) remains future work — Roadmap 13.

## 3. Current Architecture

Verified directly against `package.json`, `prisma/schema.prisma`, and the
`api/`/`src/` trees at the time of writing (Prompt 09 complete).

- **AI provider**: OpenAI (official `openai` npm SDK), accessed exclusively server-side through a provider-abstraction interface (`AiProvider`) — `src/server/ai/`. Falls back automatically to a deterministic, no-network mock provider when `OPENAI_API_KEY` isn't configured (true in this environment), so the AI Core stays fully exercisable without a real key.

- **Frontend**: React **18.3.1** (not 19), TypeScript, Vite, Tailwind CSS **v3.4.13** (not v4). No `shadcn/ui` CLI/package is installed — the UI components under `src/components/ui/` are hand-rolled in the shadcn visual style, built on `@radix-ui/react-label`, `@radix-ui/react-slot`, `class-variance-authority`, and `tailwind-merge`. `lucide-react` for icons, `react-router-dom` v6 for routing.
- **Backend**: Node.js + TypeScript, plain REST endpoints under `/api/**` written as Vercel-compatible serverless functions (`(req, res) => ...`). In local dev, a Vite plugin (`vite.config.ts`) serves the same handler files on the same port — no separate backend process.
- **Database**: PostgreSQL, hosted on Supabase, used purely as a managed Postgres provider — **Supabase Auth is not used**.
- **ORM**: Prisma (`prisma/schema.prisma`), one additive migration per implemented stage (see `prisma/migrations/`).
- **Validation**: Zod, throughout the route → validation → service → repository layering (see `src/server/`).
- **Auth**: fully custom — email + Argon2id password hashing, cryptographically random session tokens (HMAC-SHA256-hashed before storage), server-side `Session` table, HttpOnly/SameSite cookies. No Supabase Auth, no Clerk/Auth0, no JWT-in-localStorage.
- **Multi-tenant**: every domain table carries `tenantId` + `businessId`; see Section 4.

**Discrepancy note**: earlier planning language for this project referred to "React 19" and "Tailwind v4" / "shadcn/ui" as the target stack. The repository, as actually built across Prompts 01–09, uses React 18.3.1 and Tailwind v3 with hand-rolled shadcn-style components instead. This document records the actual, current stack; upgrading is not scheduled on the roadmap and would be its own deliberate step if ever undertaken.

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
- **As of Prompt 09**, this is no longer purely a future requirement: the AI context builder resolves tenant/business from the same authenticated session every other endpoint uses, every lookup inside it goes through the existing tenant-scoped repositories, and `POST /api/ai/analyze` returns a plain `404` for a Conversation belonging to another tenant — verified by a dedicated cross-tenant test and a live check against the real database.

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

`CustomerRequest`/`CustomerRequestStatusHistory` were completed in Prompt 07,
and `Conversation`/`Message` in Prompt 08 (see `DEVELOPMENT_ROADMAP.md`) —
none of these four are a future/planned domain any more; all exist in the
schema and API today.

**Prompt 09 (AI Core) added zero new Prisma models, deliberately.** The
`src/server/ai/` module (intent classification, structured result, context
builder, provider abstraction) is plain TypeScript/Zod code with nothing
persisted — it reads the eight models above (via their existing
repositories) and returns a result without writing to any table.

**Planned, not yet in the schema** (no such Prisma models exist today):

- `AI Action` (or similarly-named decision/tool-call record)
- `AI Log`
- `Escalation`

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
| **AI Operations** | AI Core test tool (`/settings/ai`: select a Conversation, type a test message, Analyze, see intent/confidence/entities/draft/needsHuman) | Implemented (`/settings/ai`) — a testing tool for the AI Core, not an operations dashboard. AI Escalations and AI Conversation/Logs remain **Future** — no escalation or logging entities exist yet |

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

**Read — implemented today (Prompt 09)**: business profile, active services, active knowledge, active business rules, and — only when already known via the Conversation — customer and vehicle summary fields. **Not yet included**: working hours, appointments, and service history are not part of the AI Core context builder yet (service history in particular was deliberately deferred — see `DEVELOPMENT_ROADMAP.md` Prompt 09 — since deciding *when* it's actually needed requires the tool-calling mechanism below).

**Classify/Draft — implemented today (Prompt 09)**: `POST /api/ai/analyze` classifies a message into one of twelve fixed intents, extracts a small set of structured entities (never fabricated — unknown values are `null`), produces a safe draft answer, and returns a `confidence`/`needsHuman`/`reason` triple. This is read-only analysis, returned to staff as a draft — it is never sent to a customer automatically and never triggers any action.

**Perform — future** (`DEVELOPMENT_ROADMAP.md` Prompt 10+, the Tool Layer): create CustomerRequest, find customer, find vehicle, check availability, create appointment, update appointment, cancel appointment, create escalation. None of this exists yet — Prompt 09's `analyze` endpoint identifies a `BOOKING_REQUEST` (etc.) as a classification only; it never calls the Appointment service, never checks real availability, and never creates anything.

**Ask — future**: today's draft answer can *state* that more information is needed, but there is no multi-turn clarification loop, no follow-up-question tool, and no automatic re-prompting yet — that belongs to the AI Core the same way "Perform" does, layered on top of Prompt 09's single-shot analyze call.

## 12. AI Forbidden Actions

The AI must never: invent services; invent prices; change prices; change
business rules; change working hours; change services without explicit
authorization; create records that don't correspond to real entities;
promise parts availability without confirmed data; state a vehicle
diagnosis as fact; guarantee a repair outcome; book outside working
hours; bypass appointment-conflict rules; delete service history; delete
customers; access another tenant's data; talk to the database directly;
run arbitrary SQL; bypass permission checks.

**As of Prompt 09**, this is no longer purely a future contract for several
of these items — `POST /api/ai/analyze` is read-only end to end (it holds
no write path to any of these tables at all, not even a permission-gated
one), context is built exclusively from the requesting tenant/business's
own rows via the same tenant-scoped repositories every other endpoint
uses, and a server-side safety check rejects any draft answer that claims
an action (booking, cancellation) was actually taken. The remaining items
(price/rule/working-hours changes, service creation, appointment actions)
have no code path to violate yet simply because no such code path exists
at all — enforcement will remain necessary once Prompt 10+ introduces one.
Full rationale in `AI_BEHAVIOR_CONTRACT.md`.

## 13. Human Escalation (Future)

The AI must hand off to a human when: it cannot answer reliably; the
question needs a manager's judgment call; the customer is in conflict;
a non-standard price is requested; an individualized commercial decision
is needed; there's doubt about safety; the customer asks for something
outside the business's stated rules; or the AI cannot safely determine
the next step.

**As of Prompt 09**, the `needsHuman`/`reason` fields on every `analyze`
response are the first real implementation of this signal — confidence
below 0.50 forces it server-side regardless of what the model claims, and
a detected prompt-injection attempt or fabricated-action claim forces it
too. What's still entirely future: an actual escalation entity, a queue,
assignment to a specific manager, and any UI for it (Roadmap 12).

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
replaced. The `Escalate to human` half of this principle is implemented
as the `needsHuman`/`reason` fields on `analyze`'s response; there is no
escalation queue or UI for a human to actually receive that signal yet
(Roadmap 12).

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
per Customer. **`AI Core` is now implemented too** (Prompt 09) — one step
further along the chain than before — but only as classification and
draft-answer generation; **`Tools` (and everything `Tools` would connect
to under `CRM / Operations`) remains entirely future**, and so does the
**Channels** end of the chain (Website, Telegram, WhatsApp, Phone —
`Manual`, entered by staff exactly as done today, is the only "channel"
actually wired to anything). No channel integration, function calling, or
tool-calling of any kind exists in this repository.

## Documentation Source of Truth

This document describes the intended product architecture.

For already implemented functionality: the current repository code and
database schema are the source of truth.

For future functionality: this document and `DEVELOPMENT_ROADMAP.md`
define the intended direction.
