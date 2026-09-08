# Автосервис — AI-администратор (Foundation)

SaaS-приложение для автосервисов. This covers **Prompt 01 (Foundation)** —
auth, multi-tenant, DB — **Prompt 02 (Business Profile + Service Catalog)**,
**Prompt 03 (Knowledge Base + Business Rules)**, **Prompt 04 (Customers,
Vehicles & Leads)**, **Prompt 05 (Appointments & Booking Foundation)**, and
**Prompt 06 (Service History Foundation)**: what was actually done to which
vehicle, when, at what mileage, and for how much — **Prompt 07
(Customer Request Foundation)**: a structured record of a customer's
inquiry, captured before any Appointment exists — **Prompt 08
(Conversations + Messages Foundation)**: the communication plumbing between
a future channel layer and a `CustomerRequest`, with no channel connected
to anything real yet — **Prompt 09 (AI Core Foundation)**: a read-only
AI layer that classifies a message's intent and drafts a safe answer — and
**Prompt 10 (AI Booking)**: a real, whitelisted Tool Layer
(`check_availability`/`create_appointment`/`reschedule_appointment`/
`cancel_appointment`) that lets the AI check real availability and
create/reschedule/cancel a real `Appointment` — always through the
existing Appointment Service, always gated by explicit customer
confirmation — **Prompt 11 (AI Customer Support)**: the AI now answers
real customer questions (services, prices, warranty, policies, and —
newly — a vehicle's own Service History) grounded strictly in real
business data, never inventing a fact, a price, or a diagnosis — and
**Prompt 12 (Human Escalation Foundation)**: the AI's `needsHuman: true`
signal now creates or reuses a real, tenant-isolated `AiEscalation` row
that staff actually see and act on at `/settings/escalations` — claim,
resolve, cancel — with the AI itself never able to change that state —
and **Prompt 13 (AI Logs / Audit Foundation)**: a new `AiLog` table records
a safe, minimal technical audit trail — every `analyze` outcome, every
genuinely-executed tool call, every escalation create/reuse/claim/resolve/
cancel — readable at `/settings/ai-logs`; it never stores chain-of-thought,
a raw provider response, a full prompt, or full message content.
Still no live communication channels (Telegram/WhatsApp/website chat/
phone), no external notification of a human, no analytics/dashboard, no
full CRM pipeline, no external calendar sync, and no final design.

> Отдельный проект и кодбейс. Не связан с другими продуктами, не переиспользует
> их код, Supabase project, стили или настройки.

## Architecture

```
React + Vite + TypeScript (frontend)
        │  fetch, same-origin
        ▼
REST API — /api/**  (Vercel-compatible serverless functions)
        │
        ▼
Prisma ORM
        │
        ▼
PostgreSQL  (managed by Supabase)
```

- **Frontend**: React, TypeScript, Vite, Tailwind CSS, shadcn/ui-style components, lucide-react, react-router-dom.
- **Backend**: Node.js + TypeScript, plain REST endpoints under `/api`, written as Vercel serverless functions (`(req, res) => ...`). In dev, a small Vite plugin (`vite.config.ts`) serves these same handler files on the same port as the frontend, so `npm run dev` is the only command you need — no separate backend process, no CORS.
- **Database**: Supabase is used purely as a managed PostgreSQL provider. **Supabase Auth is not used** — authentication is custom (see below).
- **ORM**: Prisma (`prisma/schema.prisma`).
- **Validation**: Zod.
- **Auth**: email + password, Argon2id hashing, server-side sessions, HttpOnly cookies. No JWTs, no tokens in localStorage.

## Requirements

- Node.js 20+
- A Supabase account (free tier is enough)

## Supabase setup

1. Create a **new** Supabase project dedicated to this app (do not reuse another project).
2. In the Supabase dashboard: **Project Settings → Database → Connection string**.
3. Copy the **Transaction pooler** connection string (port `6543`) → this is your `DATABASE_URL`.
4. Copy the **Session/direct** connection string (port `5432`) → this is your `DIRECT_URL`.
5. Paste both into your local `.env` (see below).
6. Run the Prisma migration (see [Prisma](#prisma) below).
7. Start the app.

Never commit real connection strings.

## Environment

Copy the example file and fill in real values:

```bash
cp .env.example .env
```

Variables:

| Variable         | Description                                                       |
|------------------|---------------------------------------------------------------------|
| `DATABASE_URL`   | Pooled Postgres connection string (used by the running app)         |
| `DIRECT_URL`     | Direct Postgres connection string (used by Prisma for migrations)   |
| `SESSION_SECRET` | Long random secret used to hash session tokens. Generate with: `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"` |
| `NODE_ENV`       | `development` locally, `production` when deployed                   |
| `APP_URL`        | Public URL of the app (used for cookie/security decisions)          |
| `OPENAI_API_KEY` | Optional. If unset, AI Core automatically uses a deterministic mock provider instead of calling OpenAI — see [AI Core](#ai-core) |
| `OPENAI_MODEL`   | Optional, defaults to `gpt-4o-mini`. Only read when `OPENAI_API_KEY` is set |

## Install

```bash
npm install
```

(`postinstall` runs `prisma generate` automatically.)

## Prisma

```bash
# Apply the schema to your Supabase database and create the first migration
npm run prisma:migrate

# Regenerate the Prisma client after any schema change
npm run prisma:generate

# Optional: inspect data with Prisma Studio
npm run prisma:studio
```

## Development

```bash
npm run dev
```

Opens the app at `http://localhost:5173`. Frontend and `/api/*` endpoints are served from the same Vite dev server.

Optional demo data (development only, refuses to run when `NODE_ENV=production`):

```bash
npm run seed
```

This creates a demo tenant with a **development-only** login:
`owner@example.com` / `DevOnlyPassword123!`

## Build

```bash
npm run typecheck   # TypeScript strict check, no emit
npm test            # Vitest — unit tests for critical security logic
npm run build       # typecheck + production frontend build (dist/)
```

Deployed on Vercel, the files under `/api` are automatically picked up as
serverless functions; no extra configuration is required.

## Authentication

- Passwords are hashed with **Argon2id** (`src/server/auth/password.ts`), OWASP-recommended parameters. Never logged, never stored in plain text.
- On register/login, the server generates a cryptographically random session token (`crypto.randomBytes`), sends it to the browser only via an **HttpOnly, SameSite=Lax** cookie (`Secure` in production), and stores only an HMAC-SHA256 hash of it (keyed by `SESSION_SECRET`) in the `sessions` table. The raw token never touches the database.
- Every authenticated request re-derives `user`/`tenant`/`role` server-side from the session cookie (`requireAuth`, `src/server/middleware/requireAuth.ts`) — these are **never** trusted from client input.
- Sessions last 30 days; `lastUsedAt` is refreshed on each authenticated request.
- Login returns the same generic `INVALID_CREDENTIALS` error whether the email doesn't exist or the password is wrong (including similar timing), to avoid user enumeration.
- Endpoints: `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`.
- Basic in-memory rate limiting on `/api/auth/register` and `/api/auth/login` (per warm serverless instance — not distributed; documented limitation, see `src/server/middleware/rateLimit.ts`). Swap in Redis/Upstash later without changing call sites if stronger guarantees are needed.
- The auth module is structured so `POST /api/auth/forgot-password` / `reset-password` can be added later without restructuring (no email provider wired up yet).
- `requireAuth()` also resolves the current session's **Business** (one per tenant at this stage) alongside `user`/`tenant`, so every handler gets `{ user, tenant, business }` from the session in one call — see `src/server/types/auth.ts`.

## Business Profile

`Business` (created together with the Tenant at registration) now carries operational data an AI receptionist will eventually need:

- `name`, `description`, `phone`, `email`, `address` — as in the foundation stage.
- `timezone` — **required**, must be a real IANA identifier (`Europe/Moscow`, `Asia/Almaty`, …), validated server-side via `Intl.DateTimeFormat` (`src/server/lib/timezone.ts`). Free-form strings like `"GMT+5"` are rejected.
- `website` — optional, validated as a URL.
- `currency` — required, ISO 4217-style code from a whitelist (`RUB`, `KZT`, `USD`, `EUR`; extend `src/server/domain/currency.ts` to add more). Defaults to `RUB` for both new and pre-existing rows.

`GET /api/business` returns the current tenant's profile; `PATCH /api/business` updates it (partial update, at least one field required). The business is always the one resolved from the session — no `businessId` is ever accepted from the client.

## Working Hours

Each Business has exactly 7 `BusinessWorkingHours` rows (one per `DayOfWeek`), created automatically at registration with sane defaults (Mon–Fri 09:00–18:00, Sat 10:00–15:00, Sun closed) and replaceable via the API.

- Times are stored and returned as local wall-clock `"HH:mm"` strings (e.g. `"09:00"`) — not `Date`/UTC values. They're interpreted using `Business.timezone`.
- A closed day (`isOpen: false`) must have `openTime`/`closeTime` both `null`; an open day requires both, with `closeTime` strictly after `openTime`. Overnight shifts (e.g. 22:00 → 02:00) are not supported yet.
- `GET /api/business/hours` returns all 7 days. `PUT /api/business/hours` replaces the full week atomically (transaction-safe upsert per day) — the payload must contain exactly the 7 days, each exactly once.

## Services

`Service` is a tenant- and business-owned catalog entry: `name`, `description`, `priceFrom`/`priceTo`, `currency`, `durationMinutes`, `isActive`.

- **Money uses Prisma `Decimal`**, never `Float` — see `Service.priceFrom`/`priceTo` (`@db.Decimal(10, 2)`). The API serializes them as fixed-point strings (`"1500.00"`) or `null`, never as floating-point numbers (`src/server/lib/dto.ts`).
- `currency` defaults to the Business's current currency **at creation time** and is stored independently on the Service — a later change to `Business.currency` never silently rewrites existing services' prices.
- Deactivating a service (`DELETE /api/services/:id`) never deletes the row; it sets `isActive = false` and is idempotent (deactivating an already-inactive service still returns success). This preserves history for the future AI layer and any reporting.
- This shape is deliberately AI-consumption-ready (name/description/price range/currency/duration/active) without implementing any AI yet.

## Knowledge Base

`KnowledgeItem` stores information a future AI administrator will use to answer customer questions — "What documents do I need?", "Is there a warranty?", "How do I prepare my car for diagnostics?", "What payment methods do you accept?". It is **not** operational logic — see Business Rules below for that.

Fields: `title`, `content`, `category`, `isActive`. Category is a fixed enum:

- `FAQ`, `SERVICE_INFO`, `POLICY`, `WARRANTY`, `PAYMENT`, `PREPARATION`, `GENERAL`

New items are always created active; `DELETE /api/knowledge/:id` soft-deletes (`isActive = false`, idempotent) rather than removing the row — the future AI layer and any audit trail need the history. `GET /api/knowledge` defaults to active items only and supports `?activeOnly=false` and `?category=FAQ` filters (an unrecognized category is a `400 VALIDATION_ERROR`, not silently ignored).

## Business Rules

`BusinessRule` stores *operational* rules — not "what do we know", but "how must we act": *"the car isn't released until payment is complete"*, *"walk-ins are only accepted if there's a free slot"*, *"diagnostics require the customer's consent first"*.

Fields: `name`, `description`, `category`, `priority`, `isActive`. Category is a fixed enum:

- `APPOINTMENT`, `SERVICE`, `PAYMENT`, `WARRANTY`, `CUSTOMER`, `OPERATIONS`, `GENERAL`

**Priority**: an integer 0–100 (default 50). **Lower number = higher priority — 0 is the highest priority, 100 is the lowest.** `GET /api/rules` always returns rules sorted by `priority ASC, createdAt ASC`, so the most important rules are always first — this ordering is what a future AI layer would read top-to-bottom. Same soft-delete/filter behavior as Knowledge Base (`isActive`, `?activeOnly=false`, `?category=PAYMENT`).

## Customers

`Customer` is a person the auto service has dealt with (or might): `firstName` (required), `lastName`, `phone` (required), `email`, `notes`, `isActive`.

- `phone` has no country-specific parsing/normalization at this stage — stored trimmed, as entered.
- `email` is normalized to lowercase. **Duplicate protection, not deduplication**: creating or updating a customer to an email that already belongs to another *active* customer in the same Business is rejected (`409 CUSTOMER_EMAIL_EXISTS`) rather than silently creating a second record — but there is no fuzzy matching, merging, or name-based dedup system.
- `GET /api/customers` is paginated (`page`, `pageSize`, default 1/20, max pageSize 100) and supports `search=` (case-insensitive substring match over firstName/lastName/phone/email) and `includeInactive=true`. Response shape: `{ items, page, pageSize, total, totalPages }`.
- `GET /api/customers/:id?includeVehicles=true` optionally attaches the customer's active vehicles (`{ customer, vehicles }`) — never on by default, so a plain fetch stays a single-row lookup.
- Soft-delete only (`DELETE` → `isActive = false`, idempotent).

## Vehicles

`Vehicle` belongs to exactly one `Customer` (`Customer 1 — N Vehicle`): `make`/`model` (required), `year` (1886–2100), `licensePlate` and `vin` (normalized uppercase), `mileage` (kilometers, 0–2,000,000), `notes`, `isActive`.

- `customerId` is required at creation and **re-verified server-side** against the current tenant+business — a client can never attach a vehicle to a customer it can't already see. It cannot be changed afterward (re-assigning a vehicle to a different customer isn't supported; create a new vehicle instead).
- `GET /api/vehicles` supports the same pagination as Customers, plus `customerId=` and `search=` (make/model/licensePlate/vin) and `includeInactive=true`.
- Soft-delete only, same as Customers.

## Leads

`Lead` is an inquiry: a customer (or prospect) asked something or expressed interest — "how much for an oil change?", "do you have a slot Tuesday?", "I'd like to book a repair." It optionally references the `Vehicle` and `Service` the inquiry is about.

> A Lead represents an inquiry or sales opportunity.
> An Appointment represents a confirmed scheduled time.
> See [Appointments](#appointments) below for the latter.

A Lead's `status` moving to `QUALIFIED` or even `WON` does **not** mean a time slot exists anywhere — an `Appointment` (see below) is a separate record, so the two are never conflated.

- Fields: `customerId` (required), `vehicleId` / `serviceId` (optional), `subject` (required), `description`, `notes`, `status` (`NEW` default), `source` (`MANUAL` default).
- `status`: `NEW → IN_PROGRESS → QUALIFIED → WON | LOST` (enum `LeadStatus`; a Lead is never hard-deleted — closing one out means setting `status: "LOST"`, so there is no `DELETE /api/leads/:id`).
- `source`: `MANUAL | WEBSITE | PHONE | OTHER` (enum `LeadSource`) — channel integrations (Telegram/WhatsApp/etc.) will extend this enum later, not before.
- All three relations are re-verified server-side on both create and update: `customerId`/`serviceId` must belong to the current tenant+business (404 otherwise), and if `vehicleId` is set, that vehicle must belong to the *specified* `customerId` — a vehicle from a different customer in the *same* tenant is a `400 VALIDATION_ERROR`, not a 404 (it exists, it's just the wrong customer).
- `GET /api/leads` is paginated, always sorted `createdAt DESC`, and supports `status=`, `source=`, `customerId=`, `vehicleId=`, `serviceId=`, and `search=` (subject/description) filters.

## Appointments

`Appointment` is a **confirmed, scheduled booking** — the thing a `Lead` (above) doesn't represent. A Customer, Vehicle, and Service are all *required* (unlike Lead, where Vehicle/Service are optional): an Appointment always means a specific car, coming in for a specific service, at a specific time.

- Fields: `customerId`, `vehicleId`, `serviceId` (all required), `startAt`/`endAt` (stored as UTC `DateTime`), `status` (`SCHEDULED` default), `notes`.
- **No Appointment-level timezone.** `startAt`/`endAt` are plain UTC instants; the *only* source of truth for "what local time is this" is `Business.timezone`, read fresh on every check — never a timezone from the request, the browser, or the server's own clock.
- **Working hours**: reuses the exact `BusinessWorkingHours` data from Prompt 02 (`GET`/`PUT /api/business/hours`) — no second schedule was created. Before accepting an interval, the server converts both `startAt` and `endAt` into the Business's local wall-clock time via `Intl.DateTimeFormat` (DST-aware; see `src/server/lib/timezone.ts`'s `toBusinessLocalDateTime`), then checks: (1) both ends fall on the *same* local calendar day — crossing local midnight is always rejected, even when the UTC interval looks fine; (2) that local day is `isOpen`; (3) `localStart >= openTime` and `localEnd <= closeTime` (both boundaries inclusive — starting exactly at opening or ending exactly at closing is valid).
- **Duration**: 15 minutes minimum, 24 hours maximum; `endAt` must be strictly after `startAt`.
- **Conflict detection**: overlapping Appointments for the same `vehicleId` are rejected with `409 APPOINTMENT_CONFLICT` (plus a `conflictingAppointmentId` in `error.details`). Overlap is the standard interval rule (`existing.startAt < new.endAt AND existing.endAt > new.startAt`), so back-to-back bookings (`10:00–11:00` then `11:00–12:00`) never conflict. Only `SCHEDULED`/`CONFIRMED`/`IN_PROGRESS` block a slot — `CANCELLED`/`COMPLETED`/`NO_SHOW` free it up immediately. Updating an Appointment excludes itself from this check.
- **Ownership & active state**: `customerId`/`vehicleId`/`serviceId` are re-verified server-side against the current tenant+business on every create/update (404 if foreign-tenant); the vehicle must belong to the given customer (400 if not, same as Leads); and all three must currently be `isActive` for a *new* booking or when a reference is *changed* (400 if not) — but an update that doesn't touch these fields (e.g. a pure status change) never re-checks them, so closing out an Appointment whose Customer/Vehicle/Service was later deactivated always still works.
- **Status**: `SCHEDULED → CONFIRMED → IN_PROGRESS → COMPLETED`, with `CANCELLED`/`NO_SHOW` reachable from any non-terminal status. `COMPLETED`/`CANCELLED`/`NO_SHOW` are terminal and never reopen (any transition out of them is `400`). Only `SCHEDULED` is a valid status at creation — an Appointment can't be born already confirmed/in-progress/completed/cancelled/no-show. There is no `DELETE /api/appointments/:id`; cancel via `PATCH { status: "CANCELLED" }`.
- Historical Appointments are never touched when a Customer/Vehicle/Service is later deactivated — no cascade, no auto status change.
- `GET /api/appointments` is paginated, always sorted `startAt ASC`, and supports `status=`, `customerId=`, `vehicleId=`, `serviceId=`, `dateFrom=`/`dateTo=` (filtering `startAt`, half-open `[dateFrom, dateTo)`), and `includeCancelled=true` (default `false` — an explicit `status=` filter always overrides this).
- **Manager can create and update Appointments** — this is the one entity so far where manager isn't read-only, because booking/rescheduling/status changes are day-to-day operational work, not a Settings change. Manager still can't bypass tenant isolation or touch anything DELETE-shaped (there isn't one).

## Service History

`ServiceRecord` is the operational record of work actually performed on a vehicle — what a `Lead`/`Appointment` lead up to, but recorded as a historical fact rather than a plan. Customer, Vehicle, and Service are all required, same as Appointment; `appointmentId` is optional, covering two cases:

- **Linked to an Appointment** — the record documents work that grew out of a specific booking; its customer/vehicle/service must match that Appointment's exactly (`400` on any mismatch, `404` if the Appointment is foreign-tenant).
- **Historical, unlinked** — for backfilling a shop's service history from before this app was in use. `appointmentId` is simply omitted.

Fields: `performedAt` (UTC, ISO 8601 in/out, displayed in `Business.timezone` — same convention as Appointment, no separate timezone stored), `mileage` (optional, km, 0–2,000,000), `totalPrice` (`Decimal(12,2)`, required) + `currency` (defaults from `Business.currency` at creation, snapshotted independently — same pattern as Service), `workDescription` (required, 1–10,000 chars), `partsDescription`/`recommendations` (optional, ≤10,000 chars), `notes` (optional, ≤5,000 chars), `isArchived`.

- **Ownership & active state**: identical rule to Appointment — customer/vehicle/service re-verified server-side (404 if foreign-tenant, 400 if the vehicle belongs to a different customer or any of the three is inactive) for a *new* record or when a reference is *changed*; a plain edit that doesn't touch these fields is never blocked by a later deactivation, so history stays editable forever.
- **Mileage must never decrease** across a vehicle's non-archived records: creating or updating a record to a mileage lower than that vehicle's current highest non-archived mileage is `400`. Records with `mileage: null`, and every *archived* record, are excluded from that comparison — and a record never conflicts with its own prior value when being updated. The check re-applies on **restore** (`isArchived: false`) but not on **archive** (`isArchived: true`) — archiving a record never needs to satisfy a mileage ordering it's about to stop participating in.
- **No hard delete, ever.** `DELETE /api/service-history/:id` is `405`. Hiding a record uses `isArchived` exclusively — no separate status, no `deletedAt`/`archivedAt`. A brand-new record is always created with `isArchived: false`; the create endpoint doesn't accept the field at all. Archive and restore are both just `PATCH { isArchived: true|false }` — archiving/restoring never touches any other field, and an archived record stays fully readable by id (`GET /api/service-history/:id`), just hidden from the default list.
- **Deactivating a Customer/Vehicle/Service, or changing/cancelling an Appointment, never archives or otherwise modifies existing ServiceRecords** — same "history survives" principle as Lead and Appointment.
- `GET /api/service-history` is paginated, sorted `performedAt DESC, createdAt DESC`, hides archived records by default (`includeArchived=true` to include them), and supports `customerId=`, `vehicleId=`, `serviceId=`, `dateFrom=`/`dateTo=` (filtering `performedAt`, half-open `[dateFrom, dateTo)`) — `?vehicleId=...` is this app's vehicle service-history view, linked from a "History" button on each row of `/settings/vehicles`.
- **Manager can create, update, archive, and restore** — same operational exception as Appointment.

## Customer Requests

`CustomerRequest` is a structured customer inquiry — "stuck on my BMW X5, can I come in tomorrow after 15:00?" — captured *before* any Appointment exists, so a future AI administrator (not built yet) will have a safe, well-defined business entity to work through instead of touching Customer/Vehicle/Appointment/ServiceRecord rows directly. Only Customer is required; Vehicle, Service, and Appointment are all optional and independently verified.

- Fields: `customerId` (required), `vehicleId`/`serviceId`/`appointmentId` (all optional), `source` (`PHONE`/`WEBSITE`/`MANUAL`/`OTHER`, defaults `MANUAL`), `status` (see below), `subject` (required, 2–200 chars), `description` (optional, ≤10,000 chars), `requestedDate` (optional), `requestedTimeFrom`/`requestedTimeTo` (optional, `"HH:mm"`), `notes` (optional, ≤5,000 chars).
- **`requestedDate` is a wanted local *day*, never a specific instant** — it is deliberately *not* `Appointment.startAt`. The API accepts an ISO 8601 datetime, but the server immediately normalizes it to the Business-local calendar date it falls on (via the same `toBusinessLocalDateTime` used for Appointments) and stores that date as UTC midnight — the original time-of-day submitted never survives. `requestedTimeFrom`/`requestedTimeTo` are plain `"HH:mm"` wall-clock strings, same convention as `BusinessWorkingHours`, not UTC values; if both are given, `requestedTimeFrom` must be strictly before `requestedTimeTo` (`400` otherwise) — giving only one of the two is fine.
- **Ownership**: `customerId`/`vehicleId`/`serviceId`/`appointmentId` are all re-verified server-side against the current tenant+business (404 if foreign-tenant); a given Vehicle must belong to the given Customer (400 if not); a given Appointment's customer must match exactly, and its vehicle/service must match too *if* the request itself specifies them (400 on any mismatch). **Unlike Appointment/ServiceRecord, a CustomerRequest's Vehicle is not required to be active** — it's just an inquiry, which can legitimately be about a vehicle no longer in daily use; Service, like everywhere else, must be active whenever it's part of what's being set or changed (400 if not).
- **A new CustomerRequest requires an active Customer** (400 otherwise) — same rule, and same create-only scope, as Lead: updating an existing request (even re-pointing it at a different Customer) never re-requires that customer to be active, so staff can always keep managing a request that's already open.
- **Historical editing**: deactivating a Customer/Service, or changing an Appointment, never touches existing CustomerRequests — no cascade, no auto status change. A plain field edit never re-checks ownership/active state; only a PATCH that actually changes a relation does.
- **Status**: `NEW → IN_PROGRESS ⇄ WAITING_CUSTOMER`, `IN_PROGRESS → QUALIFIED → CONVERTED`, and `CLOSED`/`CANCELLED` reachable from `NEW`/`IN_PROGRESS`/`WAITING_CUSTOMER`/`QUALIFIED`. `CONVERTED`, `CLOSED`, and `CANCELLED` are terminal — no transition out of any of them is ever allowed (`400`). Re-submitting the current status is a no-op (allowed, no history entry). A request can only become `CONVERTED` if it has a linked `appointmentId` (400 otherwise), and a `CONVERTED` request can never have its `appointmentId` cleared, even by a PATCH that isn't otherwise touching status. `POST` always creates `status: NEW` regardless of whether an `appointmentId` was supplied at creation — connecting the appointment and moving the status forward are always two separate, explicit actions; there are no hidden automatic transitions.
- **Status history**: every status change (including the initial `null → NEW` at creation) is recorded in `CustomerRequestStatusHistory` — `fromStatus`, `toStatus`, `changedByUserId`, `createdAt` — written atomically with the status-changing update (an interactive Prisma transaction; if the update matches zero rows, e.g. a foreign-tenant id, no history row is written either). The history is read-only — there is no API to edit or delete it — and is only included on `GET /api/customer-requests/:id` (oldest first), never on the list endpoint.
- **No hard delete, ever.** `DELETE /api/customer-requests/:id` is `405`; closing one out means `PATCH { status: "CLOSED" }` or `{ status: "CANCELLED" }`.
- `GET /api/customer-requests` is paginated, sorted `createdAt DESC`, and supports `status=`, `source=`, `customerId=`, `vehicleId=`, `serviceId=`, `appointmentId=`, and `search=` (matches `subject`/`description`, case-insensitive).
- **Manager has full read/write/status-change access** — same operational exception as Appointment/Service History.

## Conversations

`Conversation` + `Message` are the communication foundation between a future channel layer and `CustomerRequest` — plumbing, not a live integration. `channel` (`MANUAL`/`WEBSITE`/`TELEGRAM`/`WHATSAPP`/`PHONE`/`OTHER`) is only a label for where a conversation came from; **no external channel integration exists in this codebase** — creating a Conversation with `channel: "TELEGRAM"` does not talk to Telegram.

- Fields: `customerId`/`customerRequestId` (both optional — the very first message can arrive before anyone is identified, e.g. "how much is an oil change?"), `channel` (required), `status` (`OPEN`/`CLOSED`, defaults `OPEN`), `subject` (optional, ≤200 chars), `startedAt` (defaults to the creation instant), `lastMessageAt` (null until the first message), `closedAt`.
- **Customer consistency**: if both `customerId` and `customerRequestId` are set, `CustomerRequest.customerId` must equal the Conversation's own `customerId` (`400` otherwise) — a Conversation can never point at inconsistent halves of the same relationship. Both are re-verified server-side against the current tenant+business (404 if foreign-tenant) whenever either is set or changed; a plain field edit that doesn't touch them is never blocked by this.
- **Multiple conversations per customer are normal** — there is no "one conversation per customer" rule; a customer can have any number of open or closed conversations at once (a booking question, a warranty question, a new complaint, all separately).
- **Lifecycle is deliberately just two states**, no history kept for them (that's `CustomerRequestStatusHistory`'s job, not this): `OPEN → CLOSED` sets `closedAt` to the given value or `now()` if omitted; `CLOSED → OPEN` always forces `closedAt` back to `null`, regardless of what's sent; re-submitting the same status is a no-op; `closedAt` can also be patched independently of `status`.
- `Message` is **append-only**: `direction` (`INBOUND`/`OUTBOUND`), `senderType` (`CUSTOMER`/`STAFF`/`SYSTEM` — deliberately no `AI` value at this stage), `content` (required, 1–10,000 chars, trimmed). There is no `PATCH`/`DELETE` for an individual message — `POST /api/conversations/:id/messages` is the only mutation, and once created a message's content can never change.
- **A closed Conversation rejects new messages** with `409 CONVERSATION_CLOSED` — it must be reopened (`PATCH { status: "OPEN" }`) first. This is deliberate: a closed conversation can't be silently continued.
- **`lastMessageAt` is always consistent with the actual last message**: creating a Message and updating the parent Conversation's `lastMessageAt` happen inside one interactive Prisma transaction (`messageRepository.createAndTouchConversation`), so the two can never drift apart under concurrent writes.
- `GET /api/conversations` is paginated, sorted `lastMessageAt DESC` (nulls last) then `createdAt DESC`, and supports `status=`, `channel=`, `customerId=`, `customerRequestId=`, and `search=` (matches `subject`, case-insensitive). `GET /api/conversations/:id` additionally returns `customer`/`customerRequest` summaries and the full `messages` array (oldest first) — messages are not paginated at this stage, a deliberate simplification since there is no live channel feeding volume into them yet.
- **No hard delete, ever.** `DELETE /api/conversations/:id` is `405`; close one out via `PATCH { status: "CLOSED" }`.
- **Manager has full read/write access, including sending messages** — same operational exception as Appointment/Service History/Customer Requests.
- This stage adds no AI, LLM, embeddings, or external channel integration of any kind — see `docs/AI_BEHAVIOR_CONTRACT.md` for what a future AI layer built on top of this will and will not be allowed to do.

## AI Core

`POST /api/ai/analyze` classifies a message in the context of an existing `Conversation` and returns a structured draft — **it performs no actions of any kind**: no Message is created, no Appointment/Customer/Vehicle/ServiceRecord/KnowledgeItem/BusinessRule is ever touched, and no external channel is called. See `docs/AI_BEHAVIOR_CONTRACT.md` for the full behavior contract this stage starts enforcing in code.

- **Provider abstraction**: `AiProvider` (`src/server/ai/provider.ts`) with two implementations — `OpenAiProvider` (official `openai` SDK, Chat Completions with Structured Outputs) and `MockAiProvider` (deterministic, keyword-based, zero network access, zero configuration). `aiProviderFactory.ts` picks `OpenAiProvider` when `OPENAI_API_KEY` is set and falls back to `MockAiProvider` otherwise — no route or service code anywhere ever imports the OpenAI SDK, model name, or API key directly.
- **Intent**: one of twelve fixed values (`GENERAL_QUESTION`, `SERVICE_INQUIRY`, `PRICE_INQUIRY`, `AVAILABILITY_INQUIRY`, `BOOKING_REQUEST`, `RESCHEDULE_REQUEST`, `CANCELLATION_REQUEST`, `VEHICLE_PROBLEM`, `SERVICE_HISTORY_INQUIRY`, `WARRANTY_INQUIRY`, `CUSTOMER_INFORMATION`, `UNKNOWN`) — a classification only; nothing acts on it.
- **Context**: business profile, active Services, active Knowledge, active Business Rules, and — only if already known via the Conversation's `customerId`/linked `CustomerRequest.vehicleId` — a Customer/Vehicle summary. Never included: `tenantId`/`businessId`/internal ids, Customer notes, session data, secrets, or another tenant's data. Service history is deliberately not included yet — see `docs/DEVELOPMENT_ROADMAP.md` Prompt 09.
- **Message history**: the conversation's last 20 messages, chronological, bounded — never the entire history.
- **Structured output + Zod gate**: the model is constrained via OpenAI's `json_schema` Structured Outputs, then independently re-validated server-side against `aiResultSchema` regardless of what the API claims. A result that fails validation degrades to a safe `{ intent: "UNKNOWN", needsHuman: true }` fallback rather than throwing.
- **Safety layer**: `confidence < 0.50` always forces `needsHuman = true` server-side, overriding the model's own claim; a regex-based check catches and replaces any draft that falsely asserts a real action was taken ("I've booked you...", "Ваша запись подтверждена") with a safe fallback answer, also forcing `needsHuman = true`.
- **Prompt injection**: the user's message is the only untrusted value in the whole request — system instructions, business context, and conversation history are always passed as separate fields, never concatenated into one prompt string, and the system prompt explicitly tells the model to treat the user's text as data, not instructions.
- **Errors**: `404` (foreign-tenant/unknown Conversation), `409 CONVERSATION_CLOSED` (same code Conversations/Messages already use), `502 AI_PROVIDER_UNAVAILABLE` / `500 AI_CONFIGURATION_ERROR` for genuine provider/config failures — never a raw OpenAI SDK error, stack trace, or internal prompt.
- **Manager has full read access** — same operational exception as Appointment/Conversation/Customer Requests.
- Settings UI: `/settings/ai` — select a Conversation, type a test message, Analyze, see intent/confidence/entities/draft answer/needsHuman/reason. Explicitly labeled "Draft only — message was not sent." No chat UI, no send button, no auto-send.
- **Zero new database models.** Reuses `Conversation`, `Message`, `Business`, `Service`, `KnowledgeItem`, `BusinessRule`, `Customer`, `Vehicle`, `CustomerRequest` through their existing repositories; everything under `src/server/ai/` is plain TypeScript/Zod with nothing persisted.

## AI Booking

`POST /api/ai/analyze` can now go beyond a draft: when the model decides a real action is needed, it requests one of exactly four whitelisted tools, and the server — never the model — decides whether that tool actually runs. See `docs/AI_BEHAVIOR_CONTRACT.md` §§6, 11–13 for the full contract.

- **Tools, not direct DB access**: `check_availability`, `create_appointment`, `reschedule_appointment`, `cancel_appointment` (`src/server/ai/tools/`). No dynamic registration, no other tool name, no eval/SQL/shell — an unrecognized name is rejected by the registry before anything runs. Every tool calls the existing, unmodified `appointmentService.ts` (plus a new `checkAvailability()` added to it) — never Prisma directly.
- **Zero new database models, zero new migrations.** Availability reuses `BusinessWorkingHours` (Prompt 02) and the existing per-vehicle conflict check (Prompt 05). The only new server-side code is `businessLocalToUtc()` (`src/server/lib/timezone.ts`), the DST-safe inverse of the existing `toBusinessLocalDateTime()`.
- **Two-phase booking, enforced in code**: `create_appointment`, `reschedule_appointment`, and `cancel_appointment` all refuse to run unless the customer's *current* message is an explicit, unambiguous confirmation (`isExplicitConfirmation()`, `src/server/ai/confirmation.ts`) — a model deciding to call the tool is never itself sufficient. The AI can never claim an appointment was booked/moved/cancelled before the tool actually returns success.
- **Concurrency**: `create_appointment`/`reschedule_appointment` always re-check conflict against the real, current database state — a `check_availability` result from earlier in the same request (or an older one) is never assumed still valid.
- **Anti-injection entity allow-list**: the three mutating tools additionally reject a `customerId`/`vehicleId`/`appointmentId` that isn't the one this conversation's own context already knows about (`AiToolAllowedEntities`, derived server-side, never from model output) — even a real, same-tenant id is rejected as `FORBIDDEN` if it isn't this conversation's own.
- **Server-controlled tool-calling loop**: bounded at 3 tool calls per `analyze` request; exceeding it degrades to a controlled `needsHuman: true` result, never an infinite loop.
- **Tool results** are always `{success:true, tool, data}` or `{success:false, tool, errorCode, message, retryable?}` — never a raw Prisma object, never `tenantId`/`businessId`. Error codes: `INVALID_INPUT`, `NOT_FOUND`, `FORBIDDEN`, `SERVICE_INACTIVE`, `CUSTOMER_INACTIVE`, `VEHICLE_INACTIVE`, `OUTSIDE_WORKING_HOURS`, `NO_AVAILABILITY`, `APPOINTMENT_CONFLICT`, `APPOINTMENT_NOT_CANCELLABLE`, `APPOINTMENT_NOT_RESCHEDULABLE`, `CONFIRMATION_REQUIRED`, `TENANT_SCOPE_ERROR`.
- **`analyze`'s contract is unchanged** — same `{conversationId, message}` request; an additive, optional `toolExecutions` field appears only when a tool actually ran. `analyze` still never auto-creates a Message, even after a successful booking.
- Settings UI: `/settings/ai` shows a visible "tool execution is real" warning and, per analyze call, each tool's name/outcome — availability slots, or the resulting appointment's id/status/start/end. Sending a message to the customer remains disabled.
- **Not implemented**: a persistent idempotency guard beyond the real-time conflict re-check (deliberately — inventing a table just for this was explicitly out of scope); automatic Customer/Vehicle creation; searching among several possible customer/vehicle matches; any tool beyond the four booking ones above.

## AI Customer Support

`POST /api/ai/analyze` now answers real customer questions — services, prices, warranty, policies, and a vehicle's own Service History — grounded strictly in real business data. **No new tool, no mutation**: this stage is entirely read-only, same as Prompt 09. See `docs/AI_BEHAVIOR_CONTRACT.md` §§2, 6, 8, 13 for the full contract.

- **Service History enters the AI context for the first time**: `contextBuilder.ts` now includes the known vehicle's most recent 10 non-archived `ServiceRecord`s (newest-first) — reusing `serviceRecordRepository.list()` unchanged, gated by the same "only when a vehicle is already known" rule as `upcomingAppointments`. **Zero new database models, zero new migrations.**
- **History is fact, never diagnosis**: the AI can state exactly what was done and when ("15 августа заменили масло при пробеге 82 400 км"), but a new deterministic safety check (`applyDefinitiveDiagnosisCheck`, `src/server/ai/safety.ts`) catches and replaces any draft that crosses from citing history into asserting a confirmed current diagnosis ("значит, колодки снова нужно менять").
- **Grounded, not generic**: a price question states the exact stored price or admits none is on file (never an estimate); a warranty question cites the matching Business Rule or Knowledge Item, in that priority order, or admits it can't confirm the specific case; a general question is matched against Business Rules first (lower `priority` number wins on a conflict) then the Knowledge Base; anything nothing real supports gets an honest "I don't have enough information," never a guess.
- **Fabricated-escalation protection**: a second new safety check (`applyFabricatedEscalationCheck`) catches a draft that falsely claims a human/manager was already contacted — at this stage no escalation mechanism existed yet (that arrived in Prompt 12, below), so `needsHuman: true` stayed only a signal, never a claimed action; the check remains just as strict today even though a real mechanism now exists, since the model still never has confirmation at the moment it drafts an answer.
- **Tenant/customer isolation is structural**: Service History is resolved exclusively through the current Conversation's own tenant-scoped customer/vehicle chain — there is no code path for another tenant's or another same-tenant customer's history to ever be loaded.
- **`analyze`'s contract is unchanged** and it remains fully read-only — no `Message`/`Conversation`/`ServiceRecord`/`Customer`/`Vehicle`/`KnowledgeItem`/`BusinessRule` write of any kind, verified against the real database.
- Settings UI: `/settings/ai`'s description now mentions Service History grounding; the existing intent/confidence/entities/answer/needsHuman/reason display covers everything this stage needed to demonstrate.
- **Not implemented**: Human Escalation (see below — Prompt 12), AI Logs/audit (see below — Prompt 13), external channels, automatic Customer/Vehicle/Service creation, any new AI tool, RAG/embeddings/vector DB.

## Human Escalation

`needsHuman: true` now turns into a real, persisted, tenant-isolated handoff — not just a response field. See `docs/AI_BEHAVIOR_CONTRACT.md` §10 and `docs/DEVELOPMENT_ROADMAP.md` Prompt 12 for the full contract.

- **`AiEscalation`** (`prisma/schema.prisma`, migration `20260908155027_ai_escalation_foundation`) — the first AI-related Prisma model since Prompt 09, added deliberately because a real human-handoff *state* needs one. Fields: `status` (`OPEN`/`IN_PROGRESS`/`RESOLVED`/`CANCELLED`), `priority` (`LOW`/`NORMAL`/`HIGH`/`URGENT` — only `NORMAL` is ever assigned today, deliberately, since no safe elevation signal exists yet), server-derived `reason`/`summary` (bounded, never raw model or client text), `conversationId`/`customerId`/`assignedUserId`.
- **Idempotency is a real database constraint**: `activeConversationId` mirrors `conversationId` only while a row is `OPEN`/`IN_PROGRESS`, forced to `null` on resolve/cancel, backed by `@@unique([tenantId, businessId, activeConversationId])` — Postgres genuinely enforces "at most one active escalation per conversation" (Prisma's schema DSL can't express a partial/filtered index directly, so this nullable-column technique is the fully-declarative equivalent). `escalationService.createOrReuseActiveEscalation()` reads the active row first, and recovers from a real concurrent-insert race (a P2002 unique-constraint violation) by re-reading rather than failing or duplicating.
- **AI integration is one precisely-gated point** in `aiService.ts`: an escalation is created/reused only when the final result passed real structural + safety validation (a malformed provider result or an exceeded tool-call limit never reaches this gate) and is not itself a caught safety-layer rejection (a fabricated booking/diagnosis/escalation claim — already fully contained, not itself new evidence a human is needed) and `needsHuman === true`. Provider/configuration failures never reach this point — they throw before any `AiResult` exists.
- **Status machine**: `OPEN → IN_PROGRESS` (claim) `→ RESOLVED`; `OPEN`/`IN_PROGRESS → CANCELLED`; both terminal states have no way out (no reopening — a fresh escalation is created instead when genuinely needed again). Same-status requests are a no-op, matching `appointmentService.ts`'s existing convention. `resolvedAt` is set only by resolution (server time); cancellation deliberately never sets it.
- **Claim is atomic**: a scoped `updateMany` whose `WHERE` clause is itself the concurrency guard — two staff members can never both successfully claim the same escalation; the loser gets a real `409 ESCALATION_ALREADY_ASSIGNED`, while the same user re-claiming their own escalation is idempotent.
- **Permissions**: owner/admin/manager all get identical list/view/claim/resolve/cancel access — the same operational exception already established for Appointment/Conversation/AI Core. No explicit reassignment beyond self-claiming (deliberately out of scope for this stage).
- **API**: `GET /api/escalations` (paginated, filterable by status/priority/assignedUserId/unassignedOnly/customerId/conversationId), `GET /api/escalations/:id`, `POST /api/escalations/:id/claim`, `POST /api/escalations/:id/resolve`, `POST /api/escalations/:id/cancel`. **Deliberately no plain `POST /api/escalations`** — the only way one is ever created is `aiService.ts → escalationService.createOrReuseActiveEscalation()` — **and no generic `PATCH`** — every state change has exactly one, explicit endpoint.
- **`analyze`'s contract is unchanged**; an additive, optional `escalation?: {id, status}` field appears only when a real row was created or reused. A genuine creation failure returns a controlled `500 ESCALATION_CREATION_FAILED`, never a silent `needsHuman: true` with no escalation reference.
- Settings UI: `/settings/escalations` — list with status/priority/unassigned filters, a detail panel (customer/conversation/assigned-staff summary, the AI's reason/summary, Claim/Resolve/Cancel), linked from `/settings/ai` whenever an analyze call creates or reuses one.
- **Not implemented**: Telegram/WhatsApp/email/SMS/any external notification of a human, explicit reassignment beyond self-claiming, analytics, realtime/websockets.

## AI Logs / Audit

A safe, minimal technical audit trail — not a transcript, not a dashboard. See `docs/AI_BEHAVIOR_CONTRACT.md` §14 and `docs/DEVELOPMENT_ROADMAP.md` Prompt 13 for the full contract.

- **`AiLog`** (`prisma/schema.prisma`, migration `20260908174017_ai_logs_audit_foundation`) — the second AI-related Prisma model, recording `operation` (`AI_ANALYZE`, `AI_TOOL_EXECUTION`, `AI_ESCALATION_CREATE`/`REUSE`/`CLAIM`/`RESOLVE`/`CANCEL`) and `outcome` (`SUCCESS`/`ESCALATED`/`REUSED`/`FAILED`/`REJECTED`/`NO_ACTION`), plus optional `intent`/`confidence`/`needsHuman` (for `AI_ANALYZE` rows), a bounded server-derived `reason`, optional `toolName`/`toolSuccess`, a whitelisted-shape `metadata` JSON column, and optional FKs to `Conversation`/`Message`/`AiEscalation`/`User` (the last only for the three staff-action operations). **Never** stores chain-of-thought, hidden reasoning, a raw provider response, a full prompt, full `Message`/transcript content, raw tool arguments, a raw Prisma object, or any secret/credential.
- **Data minimization is enforced in code**: `aiLogService.ts` is the sole gatekeeper — `sanitizeMetadata()` accepts only a fixed key whitelist (`provider`, `toolCallCount`, `errorCode`, `statusCode`, `confirmationRequired`, `retryable`), drops any other key and every object/array value, and truncates surviving strings to 200 characters; `sanitizeReason()` truncates to 500 characters. There is no path for the AI or a client to write a log row directly.
- **The audit reflects real events, never the model's intentions**: a new `attempted` field on a failed `ToolResult` (`src/server/ai/types.ts`) distinguishes a genuine execution attempt (the real `appointmentService.ts` function ran and threw) from a gate rejection (confirmation missing, invalid input, forbidden entity) that never reached it — `AI_TOOL_EXECUTION` is logged only for the former. Escalation create vs. reuse is never conflated: `escalationService.createOrReuseActiveEscalation()` is the one place that genuinely knows which happened, and logs accordingly; a genuine creation failure logs nothing at all rather than an inaccurate record.
- **`AI_ANALYZE` logging happens only after full validation**: an outcome (`SUCCESS`/`ESCALATED`/`REJECTED`/`FAILED`) is computed once structural (`aiResultSchema.safeParse`) and safety (`applySafetyLayer`) validation have both completed — a provider/configuration failure never produces a false `SUCCESS`, but does write a durable `FAILED` record before rethrowing.
- **Atomicity**: the Booking Service and Escalation Service were never rewritten for logging. The real business action always happens and is durable first; `aiLogService.ts`'s `writeLog()` wraps every write in try/catch and never rethrows — a logging failure is reported (`logger.error('ai_log_write_failed', ...)`) but never rolls back or masks the action it describes.
- **API**: `GET /api/ai-logs` (paginated, filterable by `operation`/`outcome`/`conversationId`/`escalationId`/`dateFrom`/`dateTo`, newest first), `GET /api/ai-logs/:id`. **Deliberately no `POST /api/ai-logs`** — every row is server-written; `tenantId`/`businessId`/`actorUserId`/`outcome`/`provider`/`toolSuccess`/`confidence`/`needsHuman`/`createdAt` can never be client-supplied. A foreign-tenant or foreign-business log id returns a plain `404`.
- Settings UI: `/settings/ai-logs` — a filterable, paginated list (operation, outcome, date range) plus a safe detail panel (intent/confidence/needsHuman/tool/reason, conversation/escalation links, actor, whitelisted metadata). Explicitly not a dashboard — no charts, no aggregates.
- **Not implemented**: any Dashboard/Analytics UI built on top of this data (Prompt 14), external notifications, realtime/websockets, RAG/embeddings, any new AI tool, customer/vehicle auto-creation, Team Management.

## Roles

| Action                                 | owner | admin | manager |
|------------------------------------------|:---:|:---:|:---:|
| Read Business profile                     | ✅ | ✅ | ✅ |
| Update Business profile                   | ✅ | ✅ | ❌ |
| Read working hours                        | ✅ | ✅ | ✅ |
| Replace working hours                     | ✅ | ✅ | ❌ |
| List/read services (active or all)        | ✅ | ✅ | ✅ |
| Create / update / deactivate a service    | ✅ | ✅ | ❌ |
| List/read knowledge items (active or all) | ✅ | ✅ | ✅ |
| Create / update / deactivate knowledge    | ✅ | ✅ | ❌ |
| List/read business rules (active or all)  | ✅ | ✅ | ✅ |
| Create / update / deactivate a rule       | ✅ | ✅ | ❌ |
| List/read customers (search, pagination)  | ✅ | ✅ | ✅ |
| Create / update / deactivate a customer   | ✅ | ✅ | ❌ |
| List/read vehicles                        | ✅ | ✅ | ✅ |
| Create / update / deactivate a vehicle    | ✅ | ✅ | ❌ |
| List/read leads                           | ✅ | ✅ | ✅ |
| Create / update a lead (incl. status)     | ✅ | ✅ | ❌ |
| List/read appointments                    | ✅ | ✅ | ✅ |
| Create / update an appointment (incl. status) | ✅ | ✅ | ✅ |
| List/read service history (active or archived) | ✅ | ✅ | ✅ |
| Create / update / archive / restore a service record | ✅ | ✅ | ✅ |
| List/read customer requests                    | ✅ | ✅ | ✅ |
| Create / update a customer request (incl. status) | ✅ | ✅ | ✅ |
| List/read conversations                        | ✅ | ✅ | ✅ |
| Create / update a conversation (incl. status)  | ✅ | ✅ | ✅ |
| Send a message                                 | ✅ | ✅ | ✅ |
| Analyze a message with AI Core                 | ✅ | ✅ | ✅ |
| List/read escalations                          | ✅ | ✅ | ✅ |
| Claim / resolve / cancel an escalation         | ✅ | ✅ | ✅ |
| List/read AI logs                              | ✅ | ✅ | ✅ |

Enforced server-side via `requireRole()` inside each service-layer function (`businessService.ts`, `workingHoursService.ts`, `serviceCatalogService.ts`, `knowledgeService.ts`, `businessRuleService.ts`, `customerService.ts`, `vehicleService.ts`, `leadService.ts`, `appointmentService.ts`, `serviceRecordService.ts`, `customerRequestService.ts`, `conversationService.ts`, `messageService.ts`, `aiService.ts`, `escalationService.ts`, `aiLogService.ts`) — the frontend also hides unavailable actions for `manager` where relevant, but that's UX only, not the security boundary. Lead `status` is treated as business state, not a cosmetic field — manager cannot change it. Appointment, Service History, Customer Requests, Conversations, AI Core, Escalations, and AI Logs are the deliberate exceptions: manager has full read/write (or, for AI Logs, read) access there (see [Appointments](#appointments), [Service History](#service-history), [Customer Requests](#customer-requests), [Conversations](#conversations), [AI Core](#ai-core), [Human Escalation](#human-escalation), and [AI Logs / Audit](#ai-logs--audit)), because that work is day-to-day operations, not a Settings change — but manager still can never see or touch another tenant's data.

## Multi-tenancy

- One **Tenant** = one auto service company. Every user belongs to exactly one tenant; all business data is tied to a `tenantId`.
- Tenant isolation is enforced **server-side only** — never via frontend filtering. `tenantId`/`businessId` always come from the authenticated session (`requireAuth`), never from client-supplied fields — a client can send a `Service` **id** to identify a resource, but the server always re-checks `tenantId` and `businessId` against the session before acting on it.
- The reusable `withTenant()` helper (`src/server/lib/tenantScope.ts`) is meant to be the one way tenant-owned queries build their `where` clause, so future endpoints don't accidentally forget the filter — see `businessRepository.update` and `serviceRepository` for the pattern (scoped `updateMany`/`findFirst`, never a bare `findUnique({ where: { id } })`).
- A service, knowledge item, business rule, customer, vehicle, lead, or appointment belonging to another tenant is indistinguishable from one that doesn't exist: `GET/PATCH` (and `DELETE`, where it exists) on any of their `:id` endpoints return a generic `404 NOT_FOUND` rather than a "belongs to another tenant" message.
- `knowledgeRepository`, `businessRuleRepository`, `customerRepository`, `vehicleRepository`, `leadRepository`, and `appointmentRepository` all follow the exact same scoped `updateMany`/`findFirst` pattern as `serviceRepository` — see `tests/tenantIsolation.test.ts` for cross-tenant read/update/deactivate tests covering all of them, including the conflict-detection query itself.
- Relations that span models (Vehicle→Customer, Lead→Customer/Vehicle/Service, Appointment→Customer/Vehicle/Service) are re-verified server-side wherever they're set, never trusted from the client — see [Vehicles](#vehicles), [Leads](#leads), and [Appointments](#appointments).
- Role-based checks (`owner`, `admin`, `manager`) via `requireRole()` (`src/server/middleware/requireRole.ts`).

## Money

Prices are `Prisma.Decimal` end to end — never `number`/`Float` — to avoid floating-point rounding errors on currency values. `src/server/lib/dto.ts` converts each `Decimal` to a fixed-point string (`.toFixed(2)`) or `null` before it ever reaches JSON; the frontend treats prices as display strings, not numbers, except when re-submitting a form (where the input is parsed back to a plain number for validation — see `service.schemas.ts`'s `priceSchema`).

## Timezone

`Business.timezone` must be a real IANA identifier. Validation (`src/server/lib/timezone.ts`) relies on `Intl.DateTimeFormat(undefined, { timeZone })` throwing for anything invalid — this uses the ICU timezone database bundled with Node.js (Node 20+ ships full ICU by default), so no extra package or hand-maintained timezone list is needed. Working-hours times are plain `"HH:mm"` local wall-clock strings, interpreted using this timezone — they are not stored as UTC or `Date` values.

The same file's `toBusinessLocalDateTime(date, timeZone)` extends this to real UTC instants (used for Appointment validation): it formats a `Date` through `Intl.DateTimeFormat` with the Business's `timeZone` to get the correct local date/weekday/time, DST-aware, for any real IANA zone — deliberately not manual UTC-offset arithmetic, which silently breaks across a DST transition. The frontend has a parallel client-side utility (`src/lib/businessTime.ts`) for the same reason: the Appointments form takes separate Date/Start time/End time inputs specifically so no native `<input type="datetime-local">` can silently apply the *browser's* timezone instead of the Business's.

## Optional field & soft-delete semantics

These rules are enforced consistently across Customer, Vehicle, and Lead (and, where applicable, everywhere else optional fields exist):

- **Create, field omitted** → stored as `null`.
- **Create, field is `""` or whitespace-only** → trimmed and stored as `null` (never an empty string).
- **Update (`PATCH`), field omitted** → left unchanged. Every validation schema's Zod output simply omits a key that wasn't in the request, and Prisma's `update`/`updateMany` skip any key absent from the `data` object — the two facts together are what make "omitted = unchanged" work without special-casing it per field.
- **Update, field is explicit `null`** → clears the optional field to `null`.
- **Update, field is `""` or whitespace-only** → same as explicit `null` (trimmed first).
- **Required fields** (`Customer.firstName`/`phone`, `Vehicle.make`/`model`, `Lead.customerId`/`subject`, …) reject `null` and `""` outright — there's no way to "clear" a required field through these endpoints.
- **Soft-delete is idempotent everywhere it exists** (`Customer`, `Vehicle`, and every earlier soft-deletable model): `DELETE` sets `isActive = false` via an `updateMany` whose `where` clause never filters on the *current* `isActive` value, so deactivating an already-inactive row still matches and returns success rather than a spurious 404.
- **Deactivating a Customer never cascades.** It only ever touches the `customers` row — existing `Vehicle`s and `Lead`s referencing that customer are left completely untouched (not deactivated, not deleted, status unchanged) and remain fully readable, since neither `Vehicle` nor `Lead` has any `isActive`-of-its-customer dependency built in.
- **The one exception**: `POST /api/leads` (creating a *new* Lead) is rejected with `400 VALIDATION_ERROR` if `customerId` points to an inactive Customer — you can't open a new inquiry against a customer record that's been deactivated. This check is deliberately create-only: updating an *existing* Lead (e.g. setting `status: "LOST"` to close it out) still works normally even if its Customer has since been deactivated, so staff can always finish handling what's already open.
- **Appointment generalizes this further**, since it references three entities instead of one: creating a new Appointment, or updating one to reference a *different* Customer/Vehicle/Service, requires all of them to be currently active (400 otherwise). But an update that only changes `status` or `notes` — not touching the Customer/Vehicle/Service references at all — never re-checks their active state, so an Appointment can always still be closed out (`COMPLETED`/`CANCELLED`/`NO_SHOW`) even after everything it refers to has since been deactivated. Deactivating a Customer/Vehicle/Service never touches its historical Appointments — no cascade, no auto status change, same principle as Leads above.

## API

All endpoints require the session cookie (`requireAuth`) unless noted. Errors follow the single contract from Prompt 01 — `{ error: { code, message, details? } }` with codes `VALIDATION_ERROR` / `UNAUTHORIZED` / `FORBIDDEN` / `NOT_FOUND` / others as documented — never a stack trace or DB error.

| Method | Path                     | Roles allowed          | Notes |
|--------|--------------------------|-------------------------|-------|
| GET    | `/api/auth/me`           | any authenticated       | from Prompt 01 |
| GET    | `/api/business`          | owner, admin, manager   | current tenant's Business |
| PATCH  | `/api/business`          | owner, admin            | partial update, ≥1 field |
| GET    | `/api/business/hours`    | owner, admin, manager   | all 7 days |
| PUT    | `/api/business/hours`    | owner, admin            | full-week replace, exactly 7 days |
| GET    | `/api/services`          | any authenticated       | `?activeOnly=false` to include inactive (default `true`) |
| GET    | `/api/services/:id`      | any authenticated       | 404 if unknown or another tenant's |
| POST   | `/api/services`          | owner, admin            | `currency` optional, defaults from Business |
| PATCH  | `/api/services/:id`      | owner, admin            | partial update, ≥1 field |
| DELETE | `/api/services/:id`      | owner, admin            | soft delete (`isActive = false`), idempotent |
| GET    | `/api/knowledge`         | any authenticated       | `?activeOnly=false`, `?category=FAQ` |
| GET    | `/api/knowledge/:id`     | any authenticated       | 404 if unknown or another tenant's |
| POST   | `/api/knowledge`         | owner, admin            | `category` optional, defaults `GENERAL` |
| PATCH  | `/api/knowledge/:id`     | owner, admin            | partial update, ≥1 field |
| DELETE | `/api/knowledge/:id`     | owner, admin            | soft delete (`isActive = false`), idempotent |
| GET    | `/api/rules`             | any authenticated       | sorted `priority ASC, createdAt ASC`; `?activeOnly=false`, `?category=PAYMENT` |
| GET    | `/api/rules/:id`         | any authenticated       | 404 if unknown or another tenant's |
| POST   | `/api/rules`             | owner, admin            | `category`/`priority` optional, default `GENERAL`/`50` |
| PATCH  | `/api/rules/:id`         | owner, admin            | partial update, ≥1 field |
| DELETE | `/api/rules/:id`         | owner, admin            | soft delete (`isActive = false`), idempotent |
| GET    | `/api/customers`         | any authenticated       | paginated; `?search=`, `?includeInactive=true` |
| GET    | `/api/customers/:id`     | any authenticated       | 404 if unknown/foreign-tenant; `?includeVehicles=true` |
| POST   | `/api/customers`         | owner, admin            | 409 `CUSTOMER_EMAIL_EXISTS` on active-email duplicate |
| PATCH  | `/api/customers/:id`     | owner, admin            | partial update, ≥1 field; same 409 check on email change |
| DELETE | `/api/customers/:id`     | owner, admin            | soft delete, idempotent, never cascades to Vehicles/Leads |
| GET    | `/api/vehicles`          | any authenticated       | paginated; `?customerId=`, `?search=`, `?includeInactive=true` |
| GET    | `/api/vehicles/:id`      | any authenticated       | 404 if unknown or another tenant's |
| POST   | `/api/vehicles`          | owner, admin            | `customerId` ownership re-checked server-side (404 if foreign) |
| PATCH  | `/api/vehicles/:id`      | owner, admin            | partial update, ≥1 field; `customerId` not changeable |
| DELETE | `/api/vehicles/:id`      | owner, admin            | soft delete (`isActive = false`), idempotent |
| GET    | `/api/leads`             | any authenticated       | paginated, sorted `createdAt DESC`; `?status=`, `?source=`, `?customerId=`, `?vehicleId=`, `?serviceId=`, `?search=` |
| GET    | `/api/leads/:id`         | any authenticated       | 404 if unknown or another tenant's |
| POST   | `/api/leads`             | owner, admin            | `customerId`/`vehicleId`/`serviceId` all re-verified server-side; 400 if vehicle belongs to a different customer or the customer is inactive |
| PATCH  | `/api/leads/:id`         | owner, admin            | partial update, ≥1 field, incl. `status`; no DELETE — use `status: "LOST"` |
| GET    | `/api/appointments`      | any authenticated       | paginated, sorted `startAt ASC`; `?status=`, `?customerId=`, `?vehicleId=`, `?serviceId=`, `?dateFrom=`, `?dateTo=`, `?includeCancelled=true` |
| GET    | `/api/appointments/:id`  | any authenticated       | 404 if unknown or another tenant's |
| POST   | `/api/appointments`      | owner, admin, **manager** | `status` optional, only `SCHEDULED` accepted; working-hours + conflict + ownership/active checks all apply |
| PATCH  | `/api/appointments/:id`  | owner, admin, **manager** | partial update, ≥1 field, incl. `status` (transition-checked); no DELETE — use `status: "CANCELLED"` |
| GET    | `/api/service-history`     | any authenticated       | paginated, sorted `performedAt DESC, createdAt DESC`; `?customerId=`, `?vehicleId=`, `?serviceId=`, `?dateFrom=`, `?dateTo=`, `?includeArchived=true` |
| GET    | `/api/service-history/:id` | any authenticated       | 404 if unknown or another tenant's; archived records included |
| POST   | `/api/service-history`     | owner, admin, **manager** | `appointmentId` optional but must match customer/vehicle/service if given; mileage must not decrease |
| PATCH  | `/api/service-history/:id` | owner, admin, **manager** | partial update, ≥1 field; archive/restore via `{ isArchived }`; no DELETE — always `405` |
| GET    | `/api/customer-requests`     | any authenticated       | paginated, sorted `createdAt DESC`; `?status=`, `?source=`, `?customerId=`, `?vehicleId=`, `?serviceId=`, `?appointmentId=`, `?search=` |
| GET    | `/api/customer-requests/:id` | any authenticated       | 404 if unknown or another tenant's; includes `statusHistory` (oldest first) |
| POST   | `/api/customer-requests`     | owner, admin, **manager** | always creates `status: NEW`; `vehicleId`/`serviceId`/`appointmentId` all optional but cross-checked if given |
| PATCH  | `/api/customer-requests/:id` | owner, admin, **manager** | partial update, ≥1 field, incl. `status` (transition-checked); no DELETE — always `405` |
| GET    | `/api/conversations`               | any authenticated       | paginated, sorted `lastMessageAt DESC` (nulls last), `createdAt DESC`; `?status=`, `?channel=`, `?customerId=`, `?customerRequestId=`, `?search=` |
| GET    | `/api/conversations/:id`           | any authenticated       | 404 if unknown or another tenant's; includes `customer`/`customerRequest` summaries and the full `messages` array |
| POST   | `/api/conversations`               | owner, admin, **manager** | always creates `status: OPEN`; `customerId`/`customerRequestId` optional but cross-checked for consistency if both given |
| PATCH  | `/api/conversations/:id`           | owner, admin, **manager** | partial update, ≥1 field, incl. `status`; no DELETE — always `405` |
| POST   | `/api/conversations/:id/messages`  | owner, admin, **manager** | append-only; `409 CONVERSATION_CLOSED` if the conversation isn't `OPEN`; no PATCH/DELETE for a message ever |
| POST   | `/api/ai/analyze`                  | owner, admin, **manager** | `{ conversationId, message }`; read-only, creates nothing; `409 CONVERSATION_CLOSED` if the conversation isn't `OPEN`; `502`/`500` for provider/config failures; an additive, optional `escalation?: {id, status}` appears when `needsHuman` triggers a real handoff |
| GET    | `/api/escalations`                 | owner, admin, **manager** | paginated, sorted `priority DESC, createdAt DESC`; `?status=`, `?priority=`, `?assignedUserId=`, `?unassignedOnly=true`, `?customerId=`, `?conversationId=` |
| GET    | `/api/escalations/:id`             | owner, admin, **manager** | 404 if unknown or another tenant's; includes `customer`/`assignedUser`/`conversation` summaries |
| POST   | `/api/escalations/:id/claim`       | owner, admin, **manager** | atomic; `409 ESCALATION_ALREADY_ASSIGNED` if claimed by someone else; idempotent for the same user; `400 ESCALATION_NOT_ACTIVE` if already terminal |
| POST   | `/api/escalations/:id/resolve`     | owner, admin, **manager** | sets `status: RESOLVED`, `resolvedAt` (server time); idempotent if already `RESOLVED`; `400 ESCALATION_INVALID_STATUS` if `CANCELLED` |
| POST   | `/api/escalations/:id/cancel`      | owner, admin, **manager** | sets `status: CANCELLED`, never `resolvedAt`; idempotent if already `CANCELLED`; `400 ESCALATION_INVALID_STATUS` if `RESOLVED` |
| GET    | `/api/ai-logs`                     | owner, admin, **manager** | paginated, sorted `createdAt DESC, id DESC`; `?operation=`, `?outcome=`, `?conversationId=`, `?escalationId=`, `?dateFrom=`, `?dateTo=` |
| GET    | `/api/ai-logs/:id`                 | owner, admin, **manager** | 404 if unknown or another tenant's/business's; safe detail DTO incl. actor summary and whitelisted metadata |

No `POST /api/escalations` and no `PATCH /api/escalations/:id` exist — an escalation is only ever created by `aiService.ts`, and every state change has exactly one explicit action endpoint above. Likewise, no `POST /api/ai-logs` exists at all — every `AiLog` row is written server-side by `aiLogService.ts`, never by a client request.

## Security

- Argon2id password hashing, no custom crypto.
- Server-side sessions; only a hashed, HMAC-keyed token is persisted.
- HttpOnly / Secure (prod) / SameSite=Lax cookies; nothing auth-related in localStorage/sessionStorage.
- Zod validation on every input, including business profile, working hours, service, knowledge base, business rule, customer, vehicle, lead, and appointment payloads.
- Customer PII (phone, email, notes) and Lead/Appointment notes and descriptions are never written to logs — `src/server/lib/logger.ts`'s redaction list covers them the same way it covers secrets; only route/status/generic error codes are logged for these operations. `AppointmentDto`/`ApiError.details` never carry PII either — a conflict response's `conflictingAppointmentId` is just an id.
- Tenant isolation and role checks enforced server-side — see [Multi-tenancy](#multi-tenancy) and [Roles](#roles).
- Basic rate limiting on auth endpoints.
- Centralized error handling (`src/server/lib/errors.ts`) — no stack traces, SQL errors, env vars, or file paths ever reach the client.
- Structured logging (`src/server/lib/logger.ts`) with a redaction list covering passwords, hashes, tokens and secrets. Business/service operations only log route/status/generic error codes, never full request bodies.
- No secrets committed (`.env` is gitignored; `.env.example` has no real values).

## Current scope

**Prompt 01 — Foundation**
- Project scaffold: Vite + React + TS frontend, REST API backend, Prisma, Supabase Postgres.
- Multi-tenant data model: `Tenant`, `User`, `Business`, `Session`.
- Custom auth: register / login / logout / me, Argon2id, server-side sessions, HttpOnly cookies.
- Tenant isolation and role-authorization primitives.
- Zod validation, centralized error handling, basic rate limiting, structured logging.
- Minimal `/login`, `/register`, `/dashboard` pages with protected routing.

**Prompt 02 — Business Profile + Service Catalog**
- Business profile fields: `website`, `currency` (+ IANA `timezone` validation).
- `BusinessWorkingHours` model, 7-day schedule, created by default at registration, replaceable via API.
- `Service` catalog model: money as `Decimal`, currency snapshot, soft-delete via `isActive`.
- `businessService` / `workingHoursService` / `serviceCatalogService` layers: role authorization + tenant-scoped data access, reused by thin `/api` handlers.
- Settings UI: `/settings/business`, `/settings/hours`, `/settings/services`, plus a shared `Nav` and a dashboard summary (active service count, working-hours summary).
- Unit tests for password hashing, tokens, validation schemas, `requireAuth`, `requireRole`, tenant isolation (business/service/hours), and the register/login/logout/business/hours/service service logic — 113 tests total.

**Prompt 03 — Knowledge Base + Business Rules**
- `KnowledgeItem` model: title/content/category/isActive, tenant+business owned, soft-delete.
- `BusinessRule` model: name/description/category/priority/isActive, tenant+business owned, soft-delete, sorted by priority.
- `knowledgeService` / `businessRuleService` layers mirroring the Prompt 02 pattern exactly (role checks, tenant-scoped repository calls, DTO mapping).
- Settings UI: `/settings/knowledge`, `/settings/rules`, with status (active/inactive/all) and category filters, added to `Nav`.
- No AI, embeddings, or vector search — this is a structured data foundation only.
- 65 new unit tests (178 total): schema validation, service-layer role checks, and explicit cross-tenant read/update/deactivate isolation tests for both models.

**Prompt 04 — Customers, Vehicles & Leads**
- `Customer` model: firstName/lastName/phone/email/notes/isActive, tenant+business owned; active-email duplicate protection (not fuzzy dedup).
- `Vehicle` model: belongs to exactly one Customer (server-verified ownership), make/model/year/licensePlate/vin (normalized uppercase)/mileage/notes/isActive.
- `Lead` model: an inquiry, not a booking — `customerId` (required) + optional `vehicleId`/`serviceId`, all cross-checked server-side (right tenant, and the vehicle must belong to the given customer); `status` (`NEW→IN_PROGRESS→QUALIFIED→WON|LOST`) and `source` (`MANUAL|WEBSITE|PHONE|OTHER`) enums; no DELETE endpoint — closing one out means `PATCH { status: "LOST" }`.
- Pagination (`page`/`pageSize`, capped at 100) and search added to Customer/Vehicle/Lead list endpoints — the first paginated endpoints in the API (`src/server/lib/pagination.ts`).
- Explicit, tested optional-field semantics across Customer/Vehicle/Lead: omitted stays unchanged on update, `null`/blank clears an optional field, required fields can't be cleared — see [Optional field & soft-delete semantics](#optional-field--soft-delete-semantics).
- Deactivating a Customer never cascades to its Vehicles/Leads; creating a *new* Lead against an inactive Customer is rejected (`400`), but updating an existing one still works.
- `customerService` / `vehicleService` / `leadService` layers mirroring the established pattern; new repositories `customerRepository`/`vehicleRepository`/`leadRepository`.
- Settings UI: `/settings/customers`, `/settings/vehicles`, `/settings/leads` — search, filters, pagination controls, quick inline status change for leads.
- 121 new unit tests (299 total): schema validation (incl. the optional-field edge cases above), service-layer role/ownership checks, and cross-tenant + cross-customer isolation tests.

**Prompt 05 — Appointments & Booking Foundation**
- `Appointment` model: customerId/vehicleId/serviceId (all required, unlike Lead), startAt/endAt (UTC), status, notes — reuses Prompt 02's `BusinessWorkingHours`/`Business.timezone` as the sole schedule source, no second schedule created.
- Timezone-aware working-hours validation (`toBusinessLocalDateTime`, DST-correct via `Intl.DateTimeFormat`) rejects appointments outside opening hours, on closed days, or crossing local midnight — evaluated in the *Business's* timezone only, never UTC hours or a request/browser timezone.
- Vehicle-scoped conflict detection (standard interval overlap, `409 APPOINTMENT_CONFLICT` + `conflictingAppointmentId`), ignoring `CANCELLED`/`COMPLETED`/`NO_SHOW` and excluding the appointment being updated from its own conflict check.
- `AppointmentStatus` transition rules: only `SCHEDULED` at creation; terminal statuses (`COMPLETED`/`CANCELLED`/`NO_SHOW`) never reopen; no `DELETE` endpoint — cancel via `PATCH { status: "CANCELLED" }`.
- Manager can create/update appointments (the one entity where manager isn't read-only — operational booking work, not a Settings change).
- `appointmentService`/`appointmentRepository` follow the established pattern; `ApiError` gained an optional `details` field (used for `conflictingAppointmentId`) without changing the existing error contract.
- Settings UI: `/settings/appointments` — separate Date/Start time/End time inputs (deliberately not a native `datetime-local`, so the Business's timezone is used, never the browser's), customer→vehicle cascading select, inline quick status change.
- 83 new unit tests (382 total), incl. explicit DST-conversion tests (`America/New_York`, winter vs. summer) and every listed valid/invalid status transition.

**Prompt 06 — Service History Foundation**
- `ServiceRecord` model: customerId/vehicleId/serviceId (required) + optional appointmentId, performedAt (UTC), mileage, totalPrice (`Decimal(12,2)`) + currency, workDescription/partsDescription/recommendations/notes, isArchived — no separate status field, presence of the record itself is the fact of service having been performed.
- Non-decreasing mileage per vehicle across non-archived records, checked on create, update, and restore (never on archive); archived records and `null` mileage never participate; a record never conflicts with its own prior value.
- Appointment consistency: a linked Appointment's customer/vehicle/service must match the ServiceRecord's exactly (400 on mismatch, 404 if foreign-tenant); omitting `appointmentId` documents pre-app historical work instead.
- No hard delete ever — `DELETE /api/service-history/:id` is `405`; archive/restore are both `PATCH { isArchived }`, changing nothing else; an archived record stays readable by id, only hidden from the default list.
- Ownership/active-state re-checked only for relations actually being changed (same principle as Appointment), so a plain edit — or an archive/restore — is never blocked by a Customer/Vehicle/Service that was deactivated afterward.
- `serviceRecordService`/`serviceRecordRepository` follow the established pattern; Prisma FKs use `Restrict` (not `Cascade`) on Customer/Vehicle/Service/Appointment, matching Lead/Appointment's own treatment of the same entities, so history is never auto-deleted.
- Settings UI: `/settings/service-history` — Customer→Vehicle cascading select, active-services-only select, an Appointment select filtered to ones actually matching the chosen Customer/Vehicle/Service, archive/restore controls; a "History" button on each `/settings/vehicles` row deep-links here with `?vehicleId=`.
- Manager can create, update, archive, and restore — same operational exception as Appointment.
- 65 new unit tests (447 total): schema validation, service-layer ownership/active-state/appointment-consistency/mileage checks (incl. archive-skips-validation and restore-re-validates), and cross-tenant isolation extending `tests/tenantIsolation.test.ts` (incl. the max-mileage query's exact shape).

**Prompt 07 — Customer Request Foundation**
- `CustomerRequest` model: customerId (required) + optional vehicleId/serviceId/appointmentId, source, status, subject, description, requestedDate, requestedTimeFrom/requestedTimeTo, notes — a structured inquiry, captured before any Appointment exists, so a future AI administrator has a safe business entity to work through instead of touching operational data directly.
- `CustomerRequestStatusHistory` model: a full, read-only audit trail (`fromStatus`/`toStatus`/`changedByUserId`/`createdAt`) written atomically with every status change via an interactive Prisma transaction — new to this codebase (the project's one prior `$transaction` use, `workingHoursRepository.replaceAll`, uses the simpler array form, which can't express "only write the history row if the guarded update actually matched a row").
- `requestedDate` is a wanted local *day*, never a specific instant: accepted as ISO 8601, normalized server-side to the Business-local calendar date via `toBusinessLocalDateTime`, and stored as UTC midnight of that date — never treated as `Appointment.startAt`.
- Explicit status transition allow-list (`NEW → IN_PROGRESS ⇄ WAITING_CUSTOMER → QUALIFIED → CONVERTED`, plus `CLOSED`/`CANCELLED` from any non-terminal status); `CONVERTED`/`CLOSED`/`CANCELLED` are terminal; `CONVERTED` requires a linked `appointmentId` and can never lose it afterward.
- Ownership/active-state re-checked only for relations actually being changed (same principle as Appointment/ServiceRecord); unlike them, a CustomerRequest's Vehicle is deliberately **not** required to be active — only Customer (create-only, mirroring Lead) and Service are.
- No hard delete ever — `DELETE /api/customer-requests/:id` is `405`; closing one out means `PATCH { status: "CLOSED" }`/`{ status: "CANCELLED" }`.
- `customerRequestService`/`customerRequestRepository` follow the established pattern; Prisma FKs use `Restrict` (not `Cascade`) on Customer/Vehicle/Service/Appointment and `SetNull` on the history's `changedByUserId`, matching the project's established conventions.
- Settings UI: `/settings/customer-requests` — search, status/source filters, pagination, Customer→Vehicle cascading select, active-services-only select, an Appointment select on the edit form, and a read-only status-history trail shown alongside the edit form.
- Manager has full read/write/status-change access — same operational exception as Appointment/Service History.
- No AI, messaging channels, or CRM pipeline added — this is a structured data foundation only, exactly as scoped.
- 91 new unit tests (538 total): schema validation, service-layer ownership/active-state/appointment-consistency/time-range/status-transition/status-history-path checks, and cross-tenant isolation extending `tests/tenantIsolation.test.ts` (incl. proving a foreign-tenant status-changing update never commits a history row).

**Prompt 08 — Conversations + Messages Foundation**
- `Conversation` model: `customerId`/`customerRequestId` (both optional — a conversation can start before anyone is identified), `channel` (label only, no live integration), `status` (`OPEN`/`CLOSED`), `subject`, `startedAt`, `lastMessageAt`, `closedAt`.
- `Message` model: append-only, `direction`/`senderType`/`content` (1–10,000 chars); no `AI` sender type at this stage; no `PATCH`/`DELETE` for a message, ever.
- Customer/CustomerRequest consistency enforced when both are set (`400` on mismatch); ownership re-verified server-side (404 if foreign-tenant) only for relations actually being set/changed.
- Two-state lifecycle (`OPEN`/`CLOSED`, no history kept for it — that's `CustomerRequestStatusHistory`'s job): closing sets `closedAt` (given value or `now()`); reopening always clears it; a closed conversation rejects new messages with `409 CONVERSATION_CLOSED` until reopened.
- `lastMessageAt` is kept atomically consistent with the actual last message via an interactive Prisma transaction (`messageRepository.createAndTouchConversation`) — the same pattern introduced in Prompt 07 for CustomerRequest's status history, reused here for a different atomicity need.
- **Local dev API router extended** (`vite.config.ts`): `resolveApiFile()` now walks a route path segment by segment, matching literal or bracket (`[id]`) directories at any depth, not just a single trailing dynamic file — needed to support the nested `POST /api/conversations/:id/messages` route exactly as Vercel itself would resolve `api/conversations/[id]/messages.ts` in production. Fully backward compatible with every existing single-segment dynamic route.
- `conversationService`/`conversationRepository` and `messageService`/`messageRepository` follow the established pattern; Prisma FKs use `Restrict` on the optional Customer/CustomerRequest relations (same principle as CustomerRequest's own optional relations) but `Cascade` on Message → Conversation — the first "owned child" relation in this schema pointing at a *domain* entity rather than a Business/Tenant, since a Message only exists as part of its Conversation.
- Settings UI: `/settings/conversations` — list with search/status/channel filters and pagination, a create form, and a detail panel (messages in chronological order, a message-send form, and a Close/Reopen button) — a functional operational UI, not a chatbot: no AI button, no "generate reply."
- Manager has full read/write access, including sending messages — same operational exception as Appointment/Service History/Customer Requests.
- No AI, LLM, embeddings, vector database, external channel integration (Telegram/WhatsApp/website chat/phone/webhooks), or CRM pipeline added — channel values are labels only, exactly as scoped.
- 65 new unit tests (603 total): schema validation, service-layer relation/consistency/lifecycle checks, and cross-tenant isolation extending `tests/tenantIsolation.test.ts` (incl. proving a message create against a foreign-tenant conversation never touches that tenant's `lastMessageAt`).

**Prompt 09 — AI Core Foundation**
- `POST /api/ai/analyze`: reads a `Conversation` + test message, classifies intent (12 fixed values), extracts entities (never fabricated — unknown values are `null`), drafts a safe answer, and returns `confidence`/`needsHuman`/`reason`. Performs no action of any kind — never creates a Message, never touches any other table.
- `AiProvider` abstraction (`src/server/ai/provider.ts`): `OpenAiProvider` (official `openai` SDK, Structured Outputs) and `MockAiProvider` (deterministic, keyword-based, zero network access). `aiProviderFactory.ts` picks `OpenAiProvider` when `OPENAI_API_KEY` is configured, otherwise `MockAiProvider` — this environment has no real key, so every test and the real Supabase smoke test both ran against the mock.
- Context builder assembles only business profile + active Services/Knowledge/Rules + (if already known via the Conversation) a Customer/Vehicle summary — no `tenantId`/`businessId`/internal ids/Customer notes/secrets ever leave it; service history is deliberately not included yet.
- Structured output is independently re-validated server-side (`aiResultSchema`, Zod) regardless of what the provider claims; a result that fails validation degrades to a safe `needsHuman: true` fallback rather than throwing.
- Safety layer: confidence `< 0.50` always forces `needsHuman = true` server-side; a regex check catches and replaces any draft that falsely claims a real action was taken.
- System instructions, business context, conversation history (last 20 messages), and the current user message are always passed to the provider as four separate fields — the user's message is the only untrusted value, never merged into system instructions.
- **Local dev API router unaffected** — `POST /api/ai/analyze` is a flat file (`api/ai/analyze.ts`), no new routing capability needed.
- Manager granted the same operational read access as Appointment/Conversation/Customer Requests.
- Settings UI: `/settings/ai` — select a Conversation, type a test message, Analyze, see the structured result, explicitly labeled "Draft only — message was not sent." No chat UI, no send button.
- **Zero new database models** — reuses eight existing tables through their existing repositories; `src/server/ai/` persists nothing.
- One new dependency: `openai` (official SDK), server-side only — verified absent from the built frontend bundle.
- No AI actions, function calling, tools, external channels, RAG, embeddings, vector database, AI logs, or escalation database — exactly as scoped.
- 75 new unit tests (678 total): AI result/request schema validation, mock provider behavior (incl. prompt-injection resistance), safety layer, context builder (active-only filtering, no-secrets-leak assertions), provider configuration/factory selection, full service-layer orchestration, and a dedicated cross-tenant test proving `analyzeMessage` returns 404 for a foreign-tenant Conversation.

**Prompt 10 — AI Booking**
- A real Tool Layer (`src/server/ai/tools/`): exactly four whitelisted tools — `check_availability`, `create_appointment`, `reschedule_appointment`, `cancel_appointment` — no dynamic registration, no other tool name, no eval/SQL. Every tool calls the existing `appointmentService.ts` (never Prisma directly); a new `checkAvailability()` was added to it, reusing `BusinessWorkingHours` and the existing per-vehicle conflict check — no new schedule/availability model.
- Two-phase booking enforced in code, not just prompted: `isExplicitConfirmation()` (`src/server/ai/confirmation.ts`) gates all three mutating tools against the customer's *current* message before any business logic runs; the AI can never claim success before the tool actually returns it.
- `AiToolAllowedEntities`: a server-derived (never model-supplied) allow-list of the customer/vehicle/appointments this conversation actually knows about — closes a real prompt-injection gap found while writing this stage's own tests, where a same-tenant but unrelated entity id would otherwise have been silently honored.
- `create_appointment`/`reschedule_appointment` always re-check conflict against the real, current database state — a stale `check_availability` result is never trusted.
- Server-controlled tool-calling loop in `analyzeMessage` (`aiService.ts`), bounded at 3 tool calls per request; exceeding it degrades to `needsHuman: true`, never an infinite loop.
- `businessLocalToUtc()` added to `src/server/lib/timezone.ts` — the DST-safe inverse of Prompt 05's `toBusinessLocalDateTime()`, needed to turn a candidate local slot time back into a real UTC instant.
- `POST /api/ai/analyze`'s request contract is unchanged; an additive, optional `toolExecutions` field appears only when a tool ran. `analyze` still never auto-creates a Message.
- Settings UI: `/settings/ai` gained a visible "tool execution is real" warning and a tool-execution results panel (availability slots, or the resulting appointment's id/status/start/end).
- **Zero new database models, zero new migrations.**
- 133 new unit tests (811 total): tool schema validation, confirmation-phrase detection, tool executors (incl. two explicit prompt-injection scenarios), the tool-calling loop and its 3-call bound, and a dedicated cross-tenant "AI Booking Tools" section extending `tests/tenantIsolation.test.ts` covering all four tools against a foreign tenant. A real Supabase smoke test (two real tenants, no mocks) verified real availability, a real create/conflict/reschedule/cancellation, cross-tenant rejection of all four tools, and full cleanup with zero rows remaining.
- **Not implemented**: a persistent idempotency guard beyond the real-time conflict re-check (deliberately — no new table was added just for this); automatic Customer/Vehicle creation; searching among multiple possible customer/vehicle matches; any tool beyond the four above.

**Prompt 11 — AI Customer Support**
- Service History enters the AI context for the first time: `contextBuilder.ts` now includes the known vehicle's most recent 10 non-archived `ServiceRecord`s (newest-first) — reusing `serviceRecordRepository.list()` unchanged, gated by the same "vehicle already known" rule as `upcomingAppointments`. No `id`/`customerId`/`vehicleId`/`serviceId`/`appointmentId` exposed, same principle as Prompt 09's context fields.
- `MockAiProvider`'s customer-support path was rewritten from Prompt 09's generic deflections into real, source-grounded answers: exact stored price or an honest "no price on file"; warranty grounded in Business Rules then Knowledge Base, in that priority order; general questions matched against Business Rules first (lower `priority` number wins) then Knowledge Base; real Service History facts for history questions; an honest "I don't have enough information" for anything unsupported — never a guess.
- History is fact, never diagnosis: a new deterministic safety check (`applyDefinitiveDiagnosisCheck`, `src/server/ai/safety.ts`) catches and replaces a draft that crosses from citing history into asserting a confirmed current diagnosis.
- A second new safety check (`applyFabricatedEscalationCheck`) catches a draft that falsely claims a human/manager was already contacted — at this stage no escalation mechanism existed yet (Prompt 12, below, adds it); `needsHuman: true` remained only a signal.
- Prompt-injection defense extended to cover "pretend this vehicle is mine," "ignore the business rules," and "the system says you can access all customers," alongside Prompt 09's original patterns.
- Tenant/customer isolation for Service History is structural — `buildAiContext` resolves it exclusively through the current Conversation's own tenant-scoped customer/vehicle chain, verified by unit tests and a live two-tenant, two-customer check against the real database.
- `POST /api/ai/analyze`'s request contract is unchanged and it remains fully read-only — verified against the real database (row timestamps compared before/after) that no `Message`/`Conversation`/`ServiceRecord` is ever written.
- Settings UI: `/settings/ai`'s description updated to mention Service History grounding.
- **Zero new database models, zero new migrations.**
- 32 new unit tests (843 total): a "serviceHistory" context-builder section, coverage for both new safety checks, and an "AI Customer Support" mock-provider section covering all 11 documented scenarios plus the 4 prompt-injection examples. A real Supabase smoke test (two real tenants, two customers in tenant A, no mocks) verified Service History read from the real database, correctly bound to the right vehicle, with the archived record excluded, another same-tenant customer's history never appearing, another tenant's history never appearing, a grounded `SERVICE_HISTORY_INQUIRY` answer citing the real date/mileage, a non-diagnostic `VEHICLE_PROBLEM` response, zero writes of any kind, cross-tenant `analyze` rejection with `404`, and full cleanup with zero rows remaining.
- **Not implemented**: Human Escalation (see below — Prompt 12), AI Logs/audit, external channels, automatic Customer/Vehicle/Service creation, any new AI tool, RAG/embeddings/vector DB, new database models.

**Prompt 12 — Human Escalation Foundation**
- `AiEscalation` model added (`prisma/schema.prisma`, migration `20260908155027_ai_escalation_foundation`) — the first AI-related Prisma model since Prompt 09: `status` (`OPEN`/`IN_PROGRESS`/`RESOLVED`/`CANCELLED`), `priority` (`LOW`/`NORMAL`/`HIGH`/`URGENT`, only `NORMAL` ever assigned today), server-derived `reason`/`summary`, `conversationId`/`customerId`/`assignedUserId`, and `activeConversationId` — a nullable mirror of `conversationId` existing solely to carry a `@@unique([tenantId, businessId, activeConversationId])` constraint.
- Idempotency is a real Postgres unique constraint, not just an application-level check: Postgres treats every `NULL` as distinct, so any number of resolved/cancelled rows can coexist per conversation but never two simultaneously-active ones. `escalationService.createOrReuseActiveEscalation()` reads the active row as a fast path, and recovers from a genuine concurrent-insert race (a real `Prisma.PrismaClientKnownRequestError` with code `P2002`) by re-reading rather than duplicating or failing.
- `aiService.ts`'s `analyzeMessage()` gates escalation creation on one precise rule: the final result passed real structural validation (a malformed provider result or an exceeded tool-call limit never reaches this gate) and is not itself a caught safety-layer rejection (identified by its `AI_SAFETY_REJECTION` reason prefix) and `needsHuman === true`. Provider/configuration failures never reach this point at all.
- Status machine: `OPEN → IN_PROGRESS` (claim) `→ RESOLVED`; `OPEN`/`IN_PROGRESS → CANCELLED`; both terminal, no reopening (a fresh escalation is created instead when genuinely needed again — matches Step 19's own re-analysis rule). Same-status requests are a no-op, matching `appointmentService.ts`'s existing convention. `resolvedAt` is set only by resolution; cancellation deliberately never sets it.
- Claim is atomic via a scoped `updateMany` whose `WHERE` clause is itself the concurrency guard — a second staff member can never steal an already-claimed escalation (`409 ESCALATION_ALREADY_ASSIGNED`); the same user re-claiming their own is idempotent.
- Owner/admin/manager all get identical list/view/claim/resolve/cancel access — the same operational exception already established for Appointment/Conversation/AI Core. No explicit reassignment beyond self-claiming (deliberately out of scope for this stage).
- API: `GET /api/escalations`, `GET /api/escalations/:id`, `POST /api/escalations/:id/claim|resolve|cancel` — deliberately no plain `POST /api/escalations` (the only creation path is `aiService.ts → escalationService.ts`) and no generic `PATCH`.
- `POST /api/ai/analyze`'s contract is unchanged; an additive, optional `escalation?: {id, status}` field appears only when a real row was created or reused. A genuine creation failure returns a controlled `500 ESCALATION_CREATION_FAILED`, never a silent false-success.
- Settings UI: `/settings/escalations` — list with filters, detail panel with Claim/Resolve/Cancel, linked from `/settings/ai`.
- 57 new unit tests (900 total): `tests/escalationService.test.ts` is new (35 — idempotency incl. the real P2002-recovery path, the full status machine, atomic claim/conflict, permissions); `tests/aiService.test.ts` gained a "Human Escalation integration" section plus escalation assertions on existing tests (+13); `tests/tenantIsolation.test.ts` gained an "AI Escalation" section (+9 — repository-level scoping and service-level cross-tenant 404s).
- A real Supabase smoke test (two tenants, a second staff user, no mocks, 34 checks) verified: `needsHuman=false` creates nothing; `needsHuman=true` creates a real, correctly-linked row; repeated analysis reuses it; claim is atomic and unstealable; resolve sets `resolvedAt`; a fresh `needsHuman=true` after resolution — and again after cancellation — each creates a genuinely new escalation; provider/configuration failures create nothing; cross-tenant access is rejected with `404`; zero unintended writes elsewhere; full cleanup with zero rows remaining.
- **Not implemented**: Telegram/WhatsApp/email/SMS/any external notification, explicit reassignment beyond self-claiming, AI Logs/audit, analytics, realtime/websockets, RAG/embeddings/vector DB, any new AI tool, customer/vehicle auto-creation.

**Prompt 13 — AI Logs / Audit Foundation**
- `AiLog` model added (`prisma/schema.prisma`, migration `20260908174017_ai_logs_audit_foundation`) — the second AI-related Prisma model: `operation` (`AI_ANALYZE`/`AI_TOOL_EXECUTION`/`AI_ESCALATION_CREATE`/`REUSE`/`CLAIM`/`RESOLVE`/`CANCEL`), `outcome` (`SUCCESS`/`ESCALATED`/`REUSED`/`FAILED`/`REJECTED`/`NO_ACTION`), optional `intent`/`confidence`/`needsHuman` (for `AI_ANALYZE` rows), a bounded server-derived `reason`, optional `toolName`/`toolSuccess`, whitelisted-shape `metadata`, and optional FKs to `Conversation`/`Message`/`AiEscalation`/`User`.
- A new `attempted: boolean` field on a failed `ToolResult` (`src/server/ai/types.ts`) distinguishes a genuine execution attempt (the real `appointmentService.ts` function ran and threw) from a gate rejection that never reached it — necessary because `errorCode` alone isn't a reliable proxy; `AI_TOOL_EXECUTION` is logged only for the former, so the audit reflects actual events, never the model's mere intentions.
- `aiLogService.ts` is the sole gatekeeper deciding what's safe to persist: a fixed metadata key whitelist, truncated `reason` (≤500 chars), no raw provider response, no chain-of-thought, no full prompt or transcript, no tool arguments, no secrets. Writes are fire-and-forget — `writeLog()` catches and reports a failure but never rethrows, so a logging failure can never roll back or mask the real business action it describes; the business action (booking, escalation, staff transition) is always durable first.
- `AI_ANALYZE` logging computes exactly one outcome per `analyze` call, only after full structural + safety validation: `FAILED` for a tool-limit-exceeded or malformed result, `REJECTED` for a caught safety-layer rejection, `ESCALATED` when `needsHuman` is genuinely eligible and true, `SUCCESS` otherwise — plus a durable `FAILED` record (never a false `SUCCESS`) for a genuine provider/configuration failure.
- Escalation create-vs-reuse is never conflated: `escalationService.createOrReuseActiveEscalation()` — the one place that genuinely knows which happened — logs `AI_ESCALATION_CREATE`/`REUSE` accordingly, and a genuine creation failure logs nothing at all. The three staff actions log `AI_ESCALATION_CLAIM`/`RESOLVE`/`CANCEL` with the acting `actorUserId` only after a real, non-idempotent state transition — an idempotent no-op logs nothing.
- API: `GET /api/ai-logs`, `GET /api/ai-logs/:id` — deliberately no `POST /api/ai-logs`; every field a client could otherwise forge (`tenantId`/`businessId`/`actorUserId`/`outcome`/`provider`/`toolSuccess`/`confidence`/`needsHuman`/`createdAt`) is always server-derived.
- Owner/admin/manager all get identical read access — the same operational exception already established for every other AI/staff-facing domain.
- Settings UI: `/settings/ai-logs` — filterable (operation/outcome/date range), paginated list plus a safe detail panel; explicitly not a dashboard.
- 47 new unit tests (947 total): `tests/aiLogService.test.ts` is new (17 — metadata whitelist/truncation, reason truncation, non-throwing write-failure, permission/tenant-scoping); `tests/aiService.test.ts` gained an "AI Logs / Audit" section (+11); `tests/escalationService.test.ts` gained an equivalent section (+13); `tests/tenantIsolation.test.ts` gained an "AI Log" section (+6).
- A real Supabase smoke test (two tenants, two businesses, no mocks, 28 checks) verified: independent per-tenant `AI_ANALYZE` logging; cross-tenant and cross-business log reads both `404`; a genuine create followed by a genuine reuse produces exactly one `AI_ESCALATION_CREATE` and a separate `AI_ESCALATION_REUSE`, never two creates; a provider failure produces `FAILED` and no false `SUCCESS`; a real tool call produces exactly one `SUCCESS` tool log, an invalid one exactly one `FAILED` tool log with only a safe `errorCode`; claim/resolve/cancel each produce their own audit row; the full AI answer text is never persisted into any log row; every `metadata` object contains only whitelisted keys; full cleanup with a post-cleanup re-count confirming zero rows remain.
- **Not implemented**: any Dashboard/Analytics UI (Prompt 14), external notifications, realtime/websockets, RAG/embeddings, any new AI tool, customer/vehicle auto-creation, Team Management.

## Not implemented yet

An autonomous or multi-agent framework, a fifth AI tool or dynamic tool
registration, embeddings, vector database, RAG, semantic search, a
Dashboard/Analytics UI built on top of the new AI Logs audit trail,
explicit escalation reassignment beyond self-claiming,
external notification of a human of any kind, Telegram, WhatsApp,
Instagram, Facebook Messenger, Avito, VK, MAX, website chat, email
integration, SMS, voice AI, phone integration, webhooks, CRM (pipeline/
kanban), Kommo, external calendar sync (Google Calendar/Outlook),
background jobs, online payments, billing, subscriptions, customer
self-service portal, recurring appointments, drag-and-drop calendar UI,
reminders/follow-ups, notifications, automation engine, final
UI/UX & design system, marketing site, advanced dashboard, Team Management.

`Conversation`/`Message` (Prompt 08), a first AI Core — intent
classification, entity extraction, a draft answer, confidence/needsHuman
(Prompt 09) — a real AI Tool Layer for booking (Prompt 10, see
[AI Booking](#ai-booking)), grounded AI Customer Support including
Service History (Prompt 11, see [AI Customer Support](#ai-customer-support)),
a real Human Escalation workflow (Prompt 12, see
[Human Escalation](#human-escalation)), and a safe AI Logs / Audit
foundation (Prompt 13, see [AI Logs / Audit](#ai-logs--audit)) **are**
implemented, but the AI still cannot do anything beyond checking
availability, creating/rescheduling/cancelling an Appointment, answering
read-only questions, and creating/reusing an escalation it can never
itself resolve: no CustomerRequest creation, no customer/vehicle search or
auto-creation, no tool of any other kind; `channel` remains a label, not a
live connection.

These are intentionally out of scope for this stage. The codebase leaves room
for them (e.g. `CRMAdapter` / `CalendarAdapter` / `ChannelAdapter` /
`PaymentAdapter` integration layers, and future domain models like
`AutomationRule`, `Subscription`, `UsageEvent`)
without committing to their shape yet. (`AuditLog` is no longer one of
these — `AiLog`, Prompt 13, already fills that role; see
[AI Logs / Audit](#ai-logs--audit).)
`KnowledgeItem`/`BusinessRule` were built as plain structured data, with no
embeddings/RAG layer of any kind — AI Core (Prompt 09) reads them directly
as-is, the same way it reads Services, rather than through any semantic
search. `Lead` is deliberately kept separate from `Appointment` — a
Lead is an inquiry, an Appointment is a confirmed booking (see
[Leads](#leads) and [Appointments](#appointments)); `Appointment` itself is
foundation-only, with no recurrence, external calendar sync, or reminders yet.
