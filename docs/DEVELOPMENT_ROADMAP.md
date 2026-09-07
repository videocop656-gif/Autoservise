# AI-администратор для автосервисов — Development Roadmap

> This roadmap reflects the actual state of the repository as verified
> against `prisma/schema.prisma`, `api/`, and `src/` at the time of
> writing. A stage is marked **COMPLETED** only when its models, API
> routes, and frontend pages were confirmed present in the current code —
> not because a prior plan assumed it would be.

## Completed

### 01 — Authentication + Multi-Tenancy

**Status: COMPLETED**

- `Tenant`, `User`, `Business`, `Session` models.
- Registration, login, logout, current-user (`/api/auth/register|login|logout|me`).
- Server-side sessions: Argon2id password hashing, cryptographically random session tokens, HMAC-SHA256-hashed before storage, HttpOnly/SameSite cookies.
- Role architecture: `owner` / `admin` / `manager` (`UserRole` enum), enforced via `requireRole()`.
- Tenant isolation primitives (`withTenant()`, `requireAuth()`) that every later stage reuses unchanged.

### 02 — Business Profile + Services

**Status: COMPLETED**

- Business profile fields (name, description, phone, email, address, `timezone`, `currency`).
- `BusinessWorkingHours` (7-day schedule, created by default at registration).
- `Service` catalog: `Decimal` money fields, currency snapshot, soft-delete via `isActive`.
- Full Service CRUD; manager is read-only on Business profile, working hours, and Services (owner/admin only for writes).

### 03 — Knowledge Base + Business Rules

**Status: COMPLETED**

- `KnowledgeItem` (title/content/category/isActive) with `KnowledgeCategory` enum.
- `BusinessRule` (name/description/category/priority/isActive) with `BusinessRuleCategory` enum, sorted by priority.
- Full CRUD for both; tenant isolation and manager-read-only permissions consistent with Prompt 02.

### 04 — Customers + Vehicles + Leads

**Status: COMPLETED**

- `Customer` (soft-deletable, active-email duplicate protection).
- `Vehicle` (belongs to exactly one Customer, server-verified ownership).
- `Lead` (`customerId` required, `vehicleId`/`serviceId` optional; `LeadStatus`/`LeadSource` enums).
- Search, pagination (`page`/`pageSize`, capped at 100), and filters on all three list endpoints.
- Soft deactivation (`isActive`) for Customer/Vehicle; Lead uses `status` instead (no delete).
- Full tenant isolation, including cross-entity ownership checks (a Vehicle must belong to its stated Customer, etc.).

### 05 — Appointments + Booking

**Status: COMPLETED**

- `Appointment` (`customerId`/`vehicleId`/`serviceId` all required, `startAt`/`endAt` UTC, `AppointmentStatus`).
- Working-hours validation against the existing `BusinessWorkingHours`/`Business.timezone` (no second schedule model), DST-aware via `Intl.DateTimeFormat`.
- Vehicle-scoped conflict detection (standard interval overlap), excluding non-blocking terminal statuses.
- Full customer/vehicle/service ownership + active-state validation.
- Explicit status-transition allow-list; terminal statuses (`COMPLETED`/`CANCELLED`/`NO_SHOW`) never reopen; cancellation via `PATCH { status: "CANCELLED" }`, no `DELETE`.
- Manager granted full create/update access (the first "operational" exception to the manager-read-only pattern).

### 06 — Service History

**Status: COMPLETED**

- `ServiceRecord` (`customerId`/`vehicleId`/`serviceId` required, `appointmentId` optional, `performedAt`, `mileage`, `totalPrice`/`currency`, `workDescription`/`partsDescription`/`recommendations`/`notes`, `isArchived`).
- Non-decreasing mileage per vehicle across non-archived records (checked on create/update/restore, not on archive).
- Appointment-consistency check when `appointmentId` is supplied.
- No hard delete ever — archive/restore only, via `PATCH { isArchived }`.
- Historical-data-survives-deactivation principle applied identically to Lead/Appointment.
- Manager granted full create/update/archive/restore access.

### 07 — Customer Requests + Status History

**Status: COMPLETED**

> The original plan for this stage described `CustomerRequest` as the
> **next** implementation step. Verifying the actual repository shows
> this stage was already fully implemented (Prisma models, migration,
> validation, service/repository layers, API routes, frontend page, and
> tests all present and committed) before this documentation pass. This
> is recorded here as **COMPLETED**, not "current", to match the real
> code — see the discrepancy note at the end of this document.

- `CustomerRequest`: `customerId` (required) + optional `vehicleId`/`serviceId`/`appointmentId`, `source` (`CustomerRequestSource`), `status` (`CustomerRequestStatus`), `subject`, `description`, `requestedDate`, `requestedTimeFrom`/`requestedTimeTo`, `notes`, `createdAt`/`updatedAt`. All fields listed in the original plan are present in `prisma/schema.prisma` exactly as specified.
- `CustomerRequestStatusHistory`: `fromStatus`/`toStatus`/`changedByUserId`/`createdAt`, written atomically with every status change (including the initial `null → NEW`) via an interactive Prisma transaction; read-only through the API, included on `GET /api/customer-requests/:id` only.
- Explicit status-transition allow-list (`NEW → IN_PROGRESS ⇄ WAITING_CUSTOMER → QUALIFIED → CONVERTED`, plus `CLOSED`/`CANCELLED` from any non-terminal state); `CONVERTED`/`CLOSED`/`CANCELLED` are terminal; `CONVERTED` requires a linked `appointmentId` and can never lose it afterward.
- No hard delete — `DELETE /api/customer-requests/:id` is `405`.
- Manager granted full create/update/status-change access.
- Frontend: `/settings/customer-requests` (search, status/source filters, pagination, Customer→Vehicle cascading select, embedded status-history panel on the edit form).
- 91 tests covering schema validation, service-layer business rules, and cross-tenant isolation (part of the project's 538-test suite as of this stage).

## Current

**Status: none in progress.**

Every stage originally planned through "Customer Requests" (01–07) is
verified complete in the code. There is no partially-implemented stage
at the time of writing. The next stage to begin, on explicit instruction,
is **08 — Conversations + Messages** below.

## Future Roadmap

### 08 — Conversations + Messages

**Goal**: create a conversation/message layer sitting between channels and `CustomerRequest`, so a `CustomerRequest` can be linked to the actual back-and-forth that produced it. Not started — no `Conversation`/`Message` models exist in the schema today.

### 09 — AI Core

**Goal**: intent detection; context assembly; knowledge retrieval; rules retrieval; customer context; vehicle context; service-history context; structured AI decision output. No AI/LLM code of any kind exists in this repository yet.

### 10 — AI Booking

**Goal**: the AI checks availability, proposes slots, creates/updates/cancels appointments. All existing booking rules (working hours, conflict detection, active-entity checks, status transitions from Prompt 05) remain the server-side source of truth — the AI calls the same backend logic, it does not get a separate/looser path.

### 11 — AI Customer Support

**Goal**: the AI answers questions about services, prices, working hours, preparation, warranty, payment, and policies, sourced exclusively from the existing Knowledge Base + Services + Business Rules (Prompts 02–03) — no separate knowledge store.

### 12 — Human Escalation

**Goal**: an `Escalation` entity; escalation UI; assignment to a manager; reason/priority/status fields; the ability to return a conversation to the AI. Not started.

### 13 — AI Logs / Audit

**Goal**: record AI decisions, which tools were called, their arguments and results, the final response given, any escalation, and any errors — full auditability per `AI_BEHAVIOR_CONTRACT.md` §14. Not started.

### 14 — Dashboard / Analytics

**Goal**: requests, appointments, conversion, AI-handled vs. escalated volume, response time, workload, service demand. Today's Dashboard is a minimal summary (from Prompt 02) with no analytics of this kind.

### 15 — Team Management

**Goal**: user list, role management, invitations, team administration UI. Roles (`owner`/`admin`/`manager`) already exist as an enum and are enforced everywhere, but there is no UI or API to invite/manage team members today — the only way to create a `User` is the registration flow, which creates exactly one `owner`.

### 16 — Channel Integrations

**Planned channels**: Website, Telegram, WhatsApp, Phone. Each channel is meant to feed into the shared Conversation architecture from Prompt 08 — none are implemented, and this stage is explicitly out of scope until then.

### 17 — Production Hardening

**Goal**: security review, rate limiting (a basic limiter already exists from Prompt 01 — `src/server/middleware/rateLimit.ts` — this stage means a full production-grade pass), logging, monitoring, error handling, backups, reliability, performance, production deployment, privacy, audit.

## Development Rule

Each future stage must, before writing any code:

1. Read `PRODUCT_BLUEPRINT.md`.
2. Read `DEVELOPMENT_ROADMAP.md` (this document).
3. Read `AI_BEHAVIOR_CONTRACT.md`.
4. Verify the actual current state of the code — never assume a prior document is still accurate.
5. Implement **only** the current stage — never pre-build a future stage's models/endpoints/UI.
6. Run the test suite.
7. Run TypeScript checking.
8. Run the production build.
9. Run a real-database smoke test whenever the stage touches the database, with full cleanup afterward.
10. Stop after the current stage — do not auto-proceed to the next one.

## Documentation Source of Truth

This document describes the intended product architecture.

For already implemented functionality: the current repository code and
database schema are the source of truth.

For future functionality: this document and `PRODUCT_BLUEPRINT.md` define
the intended direction.
