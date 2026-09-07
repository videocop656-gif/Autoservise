# Автосервис — AI-администратор (Foundation)

SaaS-приложение для автосервисов. This covers **Prompt 01 (Foundation)** —
auth, multi-tenant, DB — **Prompt 02 (Business Profile + Service Catalog)**,
**Prompt 03 (Knowledge Base + Business Rules)**, and **Prompt 04 (Customers,
Vehicles & Leads)**: who the customer is, what they drive, and what they
asked about. Still no AI, no communication channels (Telegram/WhatsApp/chat),
no CRM pipeline, no booking/calendar, and no final design.

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
> Appointments are not implemented in Prompt 04.

A Lead's `status` moving to `QUALIFIED` or even `WON` does **not** mean a time slot exists anywhere — that's a future `Appointment` model's job, deliberately not built yet, so the two are never conflated.

- Fields: `customerId` (required), `vehicleId` / `serviceId` (optional), `subject` (required), `description`, `notes`, `status` (`NEW` default), `source` (`MANUAL` default).
- `status`: `NEW → IN_PROGRESS → QUALIFIED → WON | LOST` (enum `LeadStatus`; a Lead is never hard-deleted — closing one out means setting `status: "LOST"`, so there is no `DELETE /api/leads/:id`).
- `source`: `MANUAL | WEBSITE | PHONE | OTHER` (enum `LeadSource`) — channel integrations (Telegram/WhatsApp/etc.) will extend this enum later, not before.
- All three relations are re-verified server-side on both create and update: `customerId`/`serviceId` must belong to the current tenant+business (404 otherwise), and if `vehicleId` is set, that vehicle must belong to the *specified* `customerId` — a vehicle from a different customer in the *same* tenant is a `400 VALIDATION_ERROR`, not a 404 (it exists, it's just the wrong customer).
- `GET /api/leads` is paginated, always sorted `createdAt DESC`, and supports `status=`, `source=`, `customerId=`, `vehicleId=`, `serviceId=`, and `search=` (subject/description) filters.

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

Enforced server-side via `requireRole()` inside each service-layer function (`businessService.ts`, `workingHoursService.ts`, `serviceCatalogService.ts`, `knowledgeService.ts`, `businessRuleService.ts`, `customerService.ts`, `vehicleService.ts`, `leadService.ts`) — the frontend also hides unavailable actions for `manager`, but that's UX only, not the security boundary. Lead `status` is treated as business state, not a cosmetic field — manager cannot change it, same as every other Lead field.

## Multi-tenancy

- One **Tenant** = one auto service company. Every user belongs to exactly one tenant; all business data is tied to a `tenantId`.
- Tenant isolation is enforced **server-side only** — never via frontend filtering. `tenantId`/`businessId` always come from the authenticated session (`requireAuth`), never from client-supplied fields — a client can send a `Service` **id** to identify a resource, but the server always re-checks `tenantId` and `businessId` against the session before acting on it.
- The reusable `withTenant()` helper (`src/server/lib/tenantScope.ts`) is meant to be the one way tenant-owned queries build their `where` clause, so future endpoints don't accidentally forget the filter — see `businessRepository.update` and `serviceRepository` for the pattern (scoped `updateMany`/`findFirst`, never a bare `findUnique({ where: { id } })`).
- A service, knowledge item, business rule, customer, vehicle, or lead belonging to another tenant is indistinguishable from one that doesn't exist: `GET/PATCH/DELETE` on any of their `:id` endpoints return a generic `404 NOT_FOUND` rather than a "belongs to another tenant" message.
- `knowledgeRepository`, `businessRuleRepository`, `customerRepository`, `vehicleRepository`, and `leadRepository` all follow the exact same scoped `updateMany`/`findFirst` pattern as `serviceRepository` — see `tests/tenantIsolation.test.ts` for cross-tenant read/update/deactivate tests covering all of them.
- Relations that span models (Vehicle→Customer, Lead→Customer/Vehicle/Service) are re-verified server-side wherever they're set, never trusted from the client — see [Vehicles](#vehicles) and [Leads](#leads).
- Role-based checks (`owner`, `admin`, `manager`) via `requireRole()` (`src/server/middleware/requireRole.ts`).

## Money

Prices are `Prisma.Decimal` end to end — never `number`/`Float` — to avoid floating-point rounding errors on currency values. `src/server/lib/dto.ts` converts each `Decimal` to a fixed-point string (`.toFixed(2)`) or `null` before it ever reaches JSON; the frontend treats prices as display strings, not numbers, except when re-submitting a form (where the input is parsed back to a plain number for validation — see `service.schemas.ts`'s `priceSchema`).

## Timezone

`Business.timezone` must be a real IANA identifier. Validation (`src/server/lib/timezone.ts`) relies on `Intl.DateTimeFormat(undefined, { timeZone })` throwing for anything invalid — this uses the ICU timezone database bundled with Node.js (Node 20+ ships full ICU by default), so no extra package or hand-maintained timezone list is needed. Working-hours times are plain `"HH:mm"` local wall-clock strings, interpreted using this timezone — they are not stored as UTC or `Date` values.

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

## Security

- Argon2id password hashing, no custom crypto.
- Server-side sessions; only a hashed, HMAC-keyed token is persisted.
- HttpOnly / Secure (prod) / SameSite=Lax cookies; nothing auth-related in localStorage/sessionStorage.
- Zod validation on every input, including business profile, working hours, service, knowledge base, business rule, customer, vehicle, and lead payloads.
- Customer PII (phone, email, notes) and Lead descriptions are never written to logs — `src/server/lib/logger.ts`'s redaction list covers them the same way it covers secrets; only route/status/generic error codes are logged for these operations.
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

## Not implemented yet

AI / LLM / OpenAI / Anthropic / Gemini, embeddings, vector database, RAG,
semantic search, prompt templates, AI administrator logic, AI receptionist,
Telegram, WhatsApp, Instagram, Facebook Messenger, Avito, VK, MAX, website
chat, email integration, SMS, voice AI, CRM (pipeline/kanban), Kommo, Google
Calendar, booking/appointments, conversations, messages, reminders/
follow-ups, payments, subscriptions, billing, analytics, notifications,
automation engine, final UI/UX & design system, marketing site, advanced
dashboard.

These are intentionally out of scope for this stage. The codebase leaves room
for them (e.g. `AIProvider` / `CRMAdapter` / `CalendarAdapter` /
`ChannelAdapter` / `PaymentAdapter` integration layers, and future domain
models like `Conversation`, `Message`, `Appointment`, `AutomationRule`,
`Subscription`, `UsageEvent`, `AuditLog`) without committing to their shape
yet. `BusinessWorkingHours` is deliberately kept separate from any future
`Appointment`/calendar model, `KnowledgeItem`/`BusinessRule` are deliberately
kept separate from any future AI/RAG layer, and `Lead` is deliberately kept
separate from any future `Appointment` — a Lead is an inquiry, never a
confirmed booking (see [Leads](#leads)).
