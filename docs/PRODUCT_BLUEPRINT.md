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

- **Incoming Message / Request** — the raw contact, regardless of channel (future: website, Telegram, WhatsApp, phone, or entered manually by staff today).
- **CustomerRequest** — the structured, channel-independent record of that inquiry (**implemented today**, manually created/managed by staff; not yet fed by an incoming-message layer). This is the boundary a future AI is meant to operate through instead of touching operational tables directly.
- **Identify Customer / Identify Vehicle** — resolving the request to a real `Customer`/`Vehicle` row in this tenant's data, never a guess.
- **Understand Intent** — classifying what the customer actually wants (question, booking, change, cancellation, complaint) — future AI Core work (Roadmap 09).
- **Knowledge + Business Rules + Service History** — the only allowed sources of business-specific fact (see `AI_BEHAVIOR_CONTRACT.md` §2).
- **AI Decision** — a structured choice among the actions listed, never free-form unconstrained behavior.
- **Conversation / Action Log** — a durable, auditable record of what happened and why (future — Roadmap 08 and 13).

## 3. Current Architecture

Verified directly against `package.json`, `prisma/schema.prisma`, and the
`api/`/`src/` trees at the time of writing (Prompt 07 complete).

- **Frontend**: React **18.3.1** (not 19), TypeScript, Vite, Tailwind CSS **v3.4.13** (not v4). No `shadcn/ui` CLI/package is installed — the UI components under `src/components/ui/` are hand-rolled in the shadcn visual style, built on `@radix-ui/react-label`, `@radix-ui/react-slot`, `class-variance-authority`, and `tailwind-merge`. `lucide-react` for icons, `react-router-dom` v6 for routing.
- **Backend**: Node.js + TypeScript, plain REST endpoints under `/api/**` written as Vercel-compatible serverless functions (`(req, res) => ...`). In local dev, a Vite plugin (`vite.config.ts`) serves the same handler files on the same port — no separate backend process.
- **Database**: PostgreSQL, hosted on Supabase, used purely as a managed Postgres provider — **Supabase Auth is not used**.
- **ORM**: Prisma (`prisma/schema.prisma`), one additive migration per implemented stage (see `prisma/migrations/`).
- **Validation**: Zod, throughout the route → validation → service → repository layering (see `src/server/`).
- **Auth**: fully custom — email + Argon2id password hashing, cryptographically random session tokens (HMAC-SHA256-hashed before storage), server-side `Session` table, HttpOnly/SameSite cookies. No Supabase Auth, no Clerk/Auth0, no JWT-in-localStorage.
- **Multi-tenant**: every domain table carries `tenantId` + `businessId`; see Section 4.

**Discrepancy note**: earlier planning language for this project referred to "React 19" and "Tailwind v4" / "shadcn/ui" as the target stack. The repository, as actually built across Prompts 01–07, uses React 18.3.1 and Tailwind v3 with hand-rolled shadcn-style components instead. This document records the actual, current stack; upgrading is not scheduled on the roadmap and would be its own deliberate step if ever undertaken.

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
- This same rule extends to the AI layer once it exists: a future AI must resolve tenant/business from the authenticated session/context exactly like every other part of this system, and must never be able to read or act across tenants (see `AI_BEHAVIOR_CONTRACT.md` §3).

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

`CustomerRequest`/`CustomerRequestStatusHistory` were completed in Prompt 07
(see `DEVELOPMENT_ROADMAP.md`) — they are **not** a future/planned domain,
they exist in the schema and API today.

**Planned, not yet in the schema** (no such Prisma models exist today):

- `Conversation`
- `Message`
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
| **Conversations** | Conversations list, Conversation detail | **Future** — no channel/message layer exists yet |
| **CRM** | Customers, Customer profile (detail is the edit form; no separate profile page), Vehicles, Vehicle profile (same) | Implemented (`/settings/customers`, `/settings/vehicles`) |
| **Operations** | Appointments, Appointment detail, Service History, Service Record detail | Implemented (`/settings/appointments`, `/settings/service-history`) |
| **Configuration** | Services, Knowledge Base, Business Rules, Business Settings, Working Hours | Implemented (`/settings/services`, `/settings/knowledge`, `/settings/rules`, `/settings/business`, `/settings/hours`) |
| **Users / Team** | Team management, invitations | **Future** — roles exist (`owner`/`admin`/`manager`, set at registration/via DB only), but there is no team/invitation UI or API today |
| **AI Operations** | AI Escalations, AI Conversation/Logs | **Future** — no AI, escalation, or logging entities exist yet |

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

## 11. AI Capabilities (Future)

None of this is implemented yet — see `DEVELOPMENT_ROADMAP.md` Prompts 09–10.

**Read**: customer, vehicle, service history, services, knowledge, business rules, working hours, appointments, customer requests.

**Perform**: create CustomerRequest, find customer, find vehicle, check availability, create appointment, update appointment, cancel appointment, create escalation.

**Ask**: clarifying questions, missing vehicle information, preferred date/time, required service details.

## 12. AI Forbidden Actions (Future Contract)

The AI must never: invent services; invent prices; change prices; change
business rules; change working hours; change services without explicit
authorization; create records that don't correspond to real entities;
promise parts availability without confirmed data; state a vehicle
diagnosis as fact; guarantee a repair outcome; book outside working
hours; bypass appointment-conflict rules; delete service history; delete
customers; access another tenant's data; talk to the database directly;
run arbitrary SQL; bypass permission checks.

This list is normative for the future AI layer and is expanded with full
rationale in `AI_BEHAVIOR_CONTRACT.md`.

## 13. Human Escalation (Future)

The AI must hand off to a human when: it cannot answer reliably; the
question needs a manager's judgment call; the customer is in conflict;
a non-standard price is requested; an individualized commercial decision
is needed; there's doubt about safety; the customer asks for something
outside the business's stated rules; or the AI cannot safely determine
the next step.

No escalation entity, queue, or UI exists yet (Roadmap 12).

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

## 15. Product Evolution (Future)

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

Planned future channels: Website, Telegram, WhatsApp, Phone, Manual
(manual entry, as done today, remains a permanent "channel"). None of
these are implemented now — no channel/message/conversation code exists
in this repository.

## Documentation Source of Truth

This document describes the intended product architecture.

For already implemented functionality: the current repository code and
database schema are the source of truth.

For future functionality: this document and `DEVELOPMENT_ROADMAP.md`
define the intended direction.
