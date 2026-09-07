# Автосервис — AI-администратор (Foundation)

SaaS-приложение для автосервисов. This covers **Prompt 01 (Foundation)** —
auth, multi-tenant, DB — plus **Prompt 02 (Business Profile + Service
Catalog)**: a real Business profile, working hours, and a service catalog.
Still no AI, integrations, or final design.

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

## Roles

| Action                              | owner | admin | manager |
|--------------------------------------|:---:|:---:|:---:|
| Read Business profile                 | ✅ | ✅ | ✅ |
| Update Business profile               | ✅ | ✅ | ❌ |
| Read working hours                    | ✅ | ✅ | ✅ |
| Replace working hours                 | ✅ | ✅ | ❌ |
| List/read services (active or all)    | ✅ | ✅ | ✅ |
| Create / update / deactivate a service| ✅ | ✅ | ❌ |

Enforced server-side via `requireRole()` inside each service-layer function (`businessService.ts`, `workingHoursService.ts`, `serviceCatalogService.ts`) — the frontend also hides unavailable actions for `manager`, but that's UX only, not the security boundary.

## Multi-tenancy

- One **Tenant** = one auto service company. Every user belongs to exactly one tenant; all business data is tied to a `tenantId`.
- Tenant isolation is enforced **server-side only** — never via frontend filtering. `tenantId`/`businessId` always come from the authenticated session (`requireAuth`), never from client-supplied fields — a client can send a `Service` **id** to identify a resource, but the server always re-checks `tenantId` and `businessId` against the session before acting on it.
- The reusable `withTenant()` helper (`src/server/lib/tenantScope.ts`) is meant to be the one way tenant-owned queries build their `where` clause, so future endpoints don't accidentally forget the filter — see `businessRepository.update` and `serviceRepository` for the pattern (scoped `updateMany`/`findFirst`, never a bare `findUnique({ where: { id } })`).
- A service belonging to another tenant is indistinguishable from one that doesn't exist: `GET/PATCH/DELETE /api/services/:id` all return a generic `404 NOT_FOUND` rather than a "belongs to another tenant" message.
- Role-based checks (`owner`, `admin`, `manager`) via `requireRole()` (`src/server/middleware/requireRole.ts`).

## Money

Prices are `Prisma.Decimal` end to end — never `number`/`Float` — to avoid floating-point rounding errors on currency values. `src/server/lib/dto.ts` converts each `Decimal` to a fixed-point string (`.toFixed(2)`) or `null` before it ever reaches JSON; the frontend treats prices as display strings, not numbers, except when re-submitting a form (where the input is parsed back to a plain number for validation — see `service.schemas.ts`'s `priceSchema`).

## Timezone

`Business.timezone` must be a real IANA identifier. Validation (`src/server/lib/timezone.ts`) relies on `Intl.DateTimeFormat(undefined, { timeZone })` throwing for anything invalid — this uses the ICU timezone database bundled with Node.js (Node 20+ ships full ICU by default), so no extra package or hand-maintained timezone list is needed. Working-hours times are plain `"HH:mm"` local wall-clock strings, interpreted using this timezone — they are not stored as UTC or `Date` values.

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

## Security

- Argon2id password hashing, no custom crypto.
- Server-side sessions; only a hashed, HMAC-keyed token is persisted.
- HttpOnly / Secure (prod) / SameSite=Lax cookies; nothing auth-related in localStorage/sessionStorage.
- Zod validation on every input, including business profile, working hours, and service payloads.
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

## Not implemented yet

AI / LLM / OpenAI, AI receptionist, Telegram, WhatsApp, Avito, VK, MAX, website
chat, CRM, Kommo, Google Calendar, booking/appointments, leads, contacts,
conversations, messages, reminders/follow-ups, payments, subscriptions,
billing, analytics, notifications, email provider, SMS, voice AI, message
generation, final UI/UX & design system, marketing site, advanced dashboard.

These are intentionally out of scope for this stage. The codebase leaves room
for them (e.g. `AIProvider` / `CRMAdapter` / `CalendarAdapter` /
`ChannelAdapter` / `PaymentAdapter` integration layers, and future domain
models like `KnowledgeItem`, `Contact`, `Lead`, `Conversation`, `Message`,
`Appointment`, `AutomationRule`, `Subscription`, `UsageEvent`, `AuditLog`)
without committing to their shape yet. `BusinessWorkingHours` is deliberately
kept separate from any future `Appointment`/calendar model.
