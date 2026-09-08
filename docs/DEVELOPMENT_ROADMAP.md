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

### 08 — Conversations + Messages

**Status: COMPLETED**

- `Conversation`: `customerId`/`customerRequestId` (both optional — a conversation can begin before anyone is identified), `channel` (`ConversationChannel` — a label only, no live integration), `status` (`ConversationStatus`: `OPEN`/`CLOSED`, defaults `OPEN`), `subject`, `startedAt`, `lastMessageAt`, `closedAt`. All fields from the original plan are present in `prisma/schema.prisma` exactly as specified.
- `Message`: `direction` (`MessageDirection`: `INBOUND`/`OUTBOUND`), `senderType` (`MessageSenderType`: `CUSTOMER`/`STAFF`/`SYSTEM` — deliberately no `AI` value at this stage), `content` (1–10,000 chars). Append-only: no `PATCH`/`DELETE` endpoint exists for a message.
- Customer/CustomerRequest consistency enforced when both are set on a Conversation (`400` on mismatch); ownership re-verified server-side only for relations actually being set/changed.
- Two-state lifecycle with no history kept for it (`CustomerRequestStatusHistory` remains the only status-history model): closing sets `closedAt`; reopening always clears it; a closed conversation rejects new messages with `409 CONVERSATION_CLOSED`.
- `lastMessageAt` kept atomically consistent with the actual last message via an interactive Prisma transaction, reusing the pattern introduced in Prompt 07.
- The local dev API router (`vite.config.ts`) was generalized to resolve nested dynamic routes (`api/conversations/[id]/messages.ts`), needed for `POST /api/conversations/:id/messages` — a necessary infrastructure change, not a scope expansion; fully backward compatible with every existing route.
- Manager granted full create/update/status-change access, including sending messages.
- Frontend: `/settings/conversations` (list with filters/pagination, create form, detail panel with chronological messages, a send-message form, and Close/Reopen).
- No AI, LLM, embeddings, or external channel integration of any kind — channel values are labels only.
- 65 tests covering schema validation, service-layer business rules, and cross-tenant isolation (part of the project's 603-test suite as of this stage).

### 09 — AI Core

**Status: COMPLETED**

- **Read-only, no actions.** `POST /api/ai/analyze` classifies a test message in the context of an existing Conversation and returns a structured draft — it never creates a Message, never touches Appointment/Customer/Vehicle/ServiceRecord/KnowledgeItem/BusinessRule, and never calls any external channel. Zero new Prisma models — the entire feature reuses existing tables (`Conversation`, `Message`, `Business`, `Service`, `KnowledgeItem`, `BusinessRule`, `Customer`, `Vehicle`, `CustomerRequest`) plus a handful of plain TypeScript/Zod types under `src/server/ai/` that persist nothing.
- **Provider abstraction**: `AiProvider` interface (`src/server/ai/provider.ts`) with two implementations — `OpenAiProvider` (official `openai` SDK, Chat Completions with Structured Outputs / `json_schema` response format) and `MockAiProvider` (deterministic, keyword-based, zero network access). `aiProviderFactory.ts` selects `OpenAiProvider` when `OPENAI_API_KEY` is configured and transparently falls back to `MockAiProvider` when it isn't — this environment has no real key, so `MockAiProvider` is what actually answers every request here, including the real Supabase smoke test.
- **Context builder** (`src/server/ai/contextBuilder.ts`): assembles only business name/description/contact/timezone/currency, active Services, active KnowledgeItems, active BusinessRules, and — only when actually known via the Conversation's `customerId`/linked `CustomerRequest.vehicleId` — a Customer/Vehicle summary. No `tenantId`/`businessId`/internal ids/Customer notes/session data/secrets ever leave this function; every lookup is tenant-scoped through the existing repositories. Service history is deliberately **not** included by default — deciding when it's actually needed requires the intent-based tool-calling mechanism explicitly deferred to Prompt 10+.
- **Prompt architecture**: system instructions, business context, conversation history (last 20 messages), and the current user message are always passed to the provider as four separate fields, never concatenated — the user's own message is the only untrusted value in the whole request, and the system prompt explicitly tells the model to treat it as data, not instructions.
- **Structured output + Zod gate**: the model is constrained via OpenAI's `json_schema` Structured Outputs, and the result is independently re-validated server-side against `aiResultSchema` regardless of what the API claims to guarantee. A result that fails this validation never throws — it degrades to a safe `{ intent: "UNKNOWN", needsHuman: true, ... }` fallback, since the provider did respond, just not usably.
- **Safety layer**: confidence `< 0.50` always forces `needsHuman = true` server-side (never trusting the model's own flag alone); a regex-based check rejects and replaces any draft answer that falsely claims a real action was taken ("I've booked you...", "your appointment is confirmed...") with a safe fallback, also forcing `needsHuman = true`.
- **Errors**: `AI_PROVIDER_UNAVAILABLE` (502) and `AI_CONFIGURATION_ERROR` (500) for genuine provider/config failures where no model output exists at all; `404`/`409` for an unknown/foreign-tenant/closed Conversation, matching existing conventions exactly (reusing Conversation/Message's own `CONVERSATION_CLOSED` code).
- Manager granted the same operational read access as Appointment/Conversation/Customer Requests.
- Frontend: `/settings/ai` — select an existing Conversation, type a test message, Analyze, see intent/confidence/entities/draft answer/needsHuman/reason, with an explicit "Draft only — message was not sent." notice. No chat UI, no send button.
- 75 new tests (678 total): AI result schema validation, request schema validation, mock provider behavior (incl. prompt-injection resistance), safety layer (confidence policy + fabricated-action rejection), context builder (active-only filtering, customer/vehicle inclusion rules, no-secrets-leak assertions), provider configuration/factory selection, full service-layer orchestration (successful analysis, provider failure, malformed provider result, low-confidence escalation, closed-conversation rejection, conversation-not-found), and a dedicated cross-tenant test in `tests/tenantIsolation.test.ts` proving `analyzeMessage` itself returns 404 for a foreign-tenant Conversation without ever building context or calling the provider.
- One new dependency: `openai` (official SDK) — server-side only, verified absent from the built frontend bundle.
- No AI actions, function calling, tools, external channels, RAG, embeddings, vector database, AI logs, or escalation database — exactly as scoped.

## Current

**Status: 10 — AI Booking is CURRENT / NEXT IMPLEMENTATION.**

Every stage through AI Core (01–09) is verified complete in the code.
Prompt 10 (AI checks real availability, proposes slots, creates/updates/
cancels appointments through the existing Appointment service/validation)
has not been started — `POST /api/ai/analyze` performs no actions and no
Tool Layer exists yet.

## Future Roadmap

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

**Planned channels**: Website, Telegram, WhatsApp, Phone. The `Conversation`/`Message` architecture they're meant to feed into already exists (Prompt 08) — but no channel itself is connected to anything real, and none of the four listed values does more today than label which channel a manually-created Conversation came from.

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
