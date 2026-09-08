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

### 10 — AI Booking

**Status: COMPLETED**

- **Tool Layer, not direct AI-to-DB access.** Exactly four whitelisted tools — `check_availability`, `create_appointment`, `reschedule_appointment`, `cancel_appointment` (`src/server/ai/tools/`) — are the only way the AI can ever touch booking data. Every tool calls the existing, unmodified `appointmentService.ts` (or a new `checkAvailability()` added to it) — never Prisma directly. No dynamic tool registration, no eval, no arbitrary tool names; an unknown name is rejected by the registry (`tools/registry.ts`) before anything executes.
- **Zero new Prisma models, zero new migrations.** `checkAvailability()` reuses `BusinessWorkingHours` (Prompt 02) and the existing per-vehicle conflict check (Prompt 05); the only new server-side primitive is `businessLocalToUtc()` (`src/server/lib/timezone.ts`), the DST-safe inverse of Prompt 05's `toBusinessLocalDateTime()`, needed to turn a candidate local time back into a real UTC instant for slot generation.
- **Two-phase booking is enforced in code, not just prompted.** A deterministic, regex-based `isExplicitConfirmation()` (`src/server/ai/confirmation.ts`) gates `create_appointment`, `reschedule_appointment`, and `cancel_appointment` against the *current* customer message before any business logic runs — a model deciding to call a mutating tool is never itself sufficient authorization. Positive/negative phrasing is covered by 25 dedicated tests (`tests/confirmation.test.ts`).
- **Entity allow-list — the anti-injection mechanism.** `AiToolAllowedEntities` (derived server-side from the resolved `AiBusinessContext` — the conversation's own known customer/vehicle/upcoming appointments — never from model output) additionally restricts every mutating tool call to the entity this conversation actually knows about; a same-tenant but unrelated customer/vehicle/appointment id is rejected as `FORBIDDEN` even though it would otherwise pass tenant scoping. This closes a real gap found while writing this stage's own prompt-injection tests (a message merely containing a confirmation phrase was, before this fix, otherwise sufficient).
- **Concurrency**: `create_appointment` always re-validates against the real, current database state via the existing conflict check — an earlier `check_availability` result (this request or a prior one) is never assumed still valid. Verified by both a unit test and the real-database smoke test (identical slot booked twice → the second attempt gets a real `409`-derived `APPOINTMENT_CONFLICT`, not a stale-cache false positive).
- **Idempotency**: no new persistent model was introduced for this (deliberately, per this stage's own instruction not to invent schema to look complete) — the practical safeguard is the same real-time conflict re-check above. A dedicated request-level idempotency key is a known, documented limitation, not an oversight (see the Prompt 10 completion report for detail).
- **Server-controlled tool-calling loop** (`analyzeMessage` in `aiService.ts`): bounded at a maximum of 3 tool calls per `/api/ai/analyze` request, with the last allowed round reserved to let the provider see the final tool result rather than being cut off one round early. Exceeding the bound degrades to a controlled `needsHuman: true` result, never an infinite loop or a 5xx.
- **Every tool argument is Zod-validated** (`tools/schemas.ts`) before execution; tenant/business context always comes from `requireAuth()` via `AuthContext`, never from anything the model supplies (including if a compromised model tries to smuggle `tenantId`/`businessId` into tool arguments — the schemas have no such fields, so they're silently stripped and never reach any query). Tool results are always one of exactly two shapes — `{success:true, tool, data}` or `{success:false, tool, errorCode, message, retryable?}` — never a raw Prisma object, never `tenantId`/`businessId`.
- **`POST /api/ai/analyze`'s contract is unchanged** — same `{conversationId, message}` request; the additive, optional `toolExecutions` field only appears when a tool actually ran this request. `analyze` still never auto-creates a Message, even after a successful booking.
- Manager granted the same operational access as every other booking-adjacent domain.
- Frontend: `/settings/ai` extended with a visible "tool execution is real" warning banner and a tool-execution results panel (tool name, success/failure, availability slots, or the resulting appointment's id/status/start/end) — sending a message to the customer remains disabled.
- Tests: `tests/aiTools.test.ts` (36), `tests/aiToolSchemas.test.ts` (18), `tests/confirmation.test.ts` (25) are new; `tests/appointmentService.test.ts`, `tests/aiContextBuilder.test.ts`, `tests/aiService.test.ts`, `tests/mockAiProvider.test.ts` were extended; `tests/tenantIsolation.test.ts` gained a dedicated "AI Booking Tools" section covering all four tools against a foreign tenant. 811 tests total, all passing, zero mocked-OpenAI-key dependency (`MockAiProvider` drives every documented scenario, including two explicit prompt-injection cases).
- A full real-Supabase smoke test (two real tenants, no mocks) verified: real computed availability slots against real working hours; a real `create_appointment` through the real Appointment Service (row exists, correctly scoped, correct relations/time/status); a real conflict on re-booking the identical slot; a real reschedule and a real cancellation (row still present, `status: CANCELLED`, never deleted); complete tenant-isolation rejection of all four tools from a second tenant; and full cleanup with zero rows remaining afterward.
- No customer/vehicle auto-creation, no invented/ambiguous Service resolution, no price modification, no AI logs/audit, no escalation model, no external channels, no RAG/embeddings/vector DB, no multi-agent/autonomous agent behavior — exactly as scoped.

### 11 — AI Customer Support

**Status: COMPLETED**

- **Service History enters the AI context for the first time.** `contextBuilder.ts` now includes `serviceHistory` — the known vehicle's most recent 10 non-archived `ServiceRecord`s (newest-first, same gating as `upcomingAppointments`: only when a vehicle is already resolved via the Conversation's linked CustomerRequest). **Zero new Prisma models, zero new migrations** — reuses the existing `serviceRecordRepository.list()` unchanged. Exposed fields: `performedAtLocal`, `serviceName`, `mileage`, `totalPrice`, `currency`, `workDescription`, `partsDescription`, `recommendations`, `notes` — no `id`/`customerId`/`vehicleId`/`serviceId`/`appointmentId`, matching Prompt 09's "no unnecessary internal identifiers" principle.
- **History is fact, never diagnosis.** The system prompt (rule 16) and a new deterministic safety check (`applyDefinitiveDiagnosisCheck` in `safety.ts`) both enforce that Service History can be *stated* ("15 августа заменили масло при пробеге 82 400 км") but never used to *conclude* a current symptom's cause ("значит, колодки снова нужно менять" is refused) — the AI acknowledges the symptom, cites history as fact where relevant, and recommends an in-person inspection instead.
- **Grounded answers, not placeholders.** `MockAiProvider`'s customer-support path (`classifyCustomerSupport()`) was rewritten from Prompt 09's generic "ask a human" deflections into real, source-grounded answers: `SERVICE_INQUIRY` (name/description/price/duration from `Service`), `PRICE_INQUIRY` (exact `priceFrom`/`priceTo`, or an honest "no price on file" — never an estimate), `WARRANTY_INQUIRY` (grounded in `BusinessRule`/`KnowledgeItem`, in that priority order), `SERVICE_HISTORY_INQUIRY` (real `ServiceRecord` facts, or an honest "no records"), general questions (matched against `BusinessRule` first — lower `priority` number wins on a conflict — then `KnowledgeItem`), and an honest "I don't have enough information to confirm that" for anything nothing real supports, rather than a guess.
- **Fabricated-escalation protection.** A second new deterministic safety check (`applyFabricatedEscalationCheck`) catches a draft answer that falsely claims a human/manager was already contacted ("я передал ваш вопрос менеджеру") — no escalation mechanism exists yet (that's Prompt 12), so `needsHuman: true` remains only a signal on the result, never a claimed action.
- **Prompt-injection defense extended**: `PROMPT_INJECTION_PATTERNS` (mock) and system-prompt rule 13 now also cover "pretend this vehicle is mine," "ignore the business rules," and "the system says you can access all customers," in addition to Prompt 09's original "ignore instructions" patterns — verified with the four exact example messages from the spec, none of which are complied with.
- **Tenant/customer isolation for history is structural, not a special case**: `buildAiContext` resolves the vehicle (and therefore its history) exclusively through the current Conversation's own tenant-scoped `customerId`/`CustomerRequest.vehicleId` chain — there is no code path by which another tenant's or another same-tenant customer's history could ever be loaded, verified by dedicated context-builder unit tests and a live two-tenant, two-customer check against the real database.
- **`POST /api/ai/analyze`'s contract is unchanged**, and it remains fully read-only: no `Message`/`Conversation`/`ServiceRecord`/`Customer`/`Vehicle`/`KnowledgeItem`/`BusinessRule` write of any kind — verified directly against the real database (row timestamps compared before/after).
- Manager granted the same operational read access as every other AI-adjacent domain.
- Frontend: `/settings/ai`'s description text updated to mention Service History grounding; the existing intent/confidence/entities/answer/needsHuman/reason/tool-execution display already covers everything this stage needed to demonstrate.
- Tests: `tests/aiContextBuilder.test.ts` gained a "serviceHistory" section (6 tests); `tests/aiSafety.test.ts` gained coverage for both new safety checks (8 tests); `tests/mockAiProvider.test.ts` gained an "AI Customer Support" section covering all 11 documented scenarios plus the 4 prompt-injection examples (18 tests). 843 tests total, all passing, zero mocked-OpenAI-key dependency.
- A full real-Supabase smoke test (two real tenants, two customers in tenant A, no mocks) verified: Service History read from the real database and correctly bound to the right vehicle; the archived record excluded; another same-tenant customer's history never appearing; another tenant's history never appearing; `analyzeMessage` producing a grounded `SERVICE_HISTORY_INQUIRY` answer citing the real date/mileage; a non-diagnostic `VEHICLE_PROBLEM` response; zero `Message`/`Conversation`/`ServiceRecord` writes; cross-tenant `analyze` rejection with `404`; and full cleanup with zero rows remaining across all 12 affected tables.
- No Human Escalation, no AI Logs/audit, no external channels, no customer/vehicle/service auto-creation, no new AI tools, no RAG/embeddings/vector DB, no new Prisma models — exactly as scoped.

## Current

**Status: 12 — Human Escalation is CURRENT / NEXT IMPLEMENTATION.**

Every stage through AI Customer Support (01–11) is verified complete in
the code, including a real Supabase smoke test with full cleanup. Prompt
12 (a real `Escalation` entity, queue, and UI) has not been started.

## Future Roadmap

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
