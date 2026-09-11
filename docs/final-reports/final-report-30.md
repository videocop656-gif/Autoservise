# Final Report 30 — End-to-End Operational Flow Audit v1

## 1. Executive Summary

The core operational journey — Contact → Conversation → Customer Request
→ Vehicle → Appointment → COMPLETED → Service History — is real, backed
by genuine data relations end to end, and an administrator **can**
actually carry a customer through it using only existing screens and
APIs. It is not fully automated (nor should it be, given the current
data model): a handful of transitions require the admin to consciously
move between two screens (e.g. create an Appointment separately, then
return to link it to a Request). This audit found and closed **four**
concrete, real cross-navigation dead ends using only already-loaded data
and existing routes (no new backend, no new relation). It also confirmed
**two** structural gaps (no underlying relation exists) that were
correctly left unbuilt, and one systemic limitation (open-detail state
is not URL-persisted, so a page refresh returns to the list) that is
real but out of this prompt's implementation scope.

## 2. Tested User Journey

Audited via direct code/API inspection (route handlers, service-layer
validation, repository queries, and every relevant frontend Detail
panel's data-fetching) — not a live browser click-through (no
Playwright/Cypress infrastructure exists in this project; confirmed by
its absence from `package.json` and the repo). Each step below cites the
real code that proves it, not an assumption.

| Step | Result |
|---|---|
| Customer exists / creatable | **PASS** — `/clients`, real CRUD |
| Conversation created (Telegram or manual) | **PASS** — real webhook (Prompt 18) or manual create form |
| Customer Request created, linkable to Customer/Vehicle/Service/Conversation | **PASS** — all four links are real fields, settable via the existing create/edit forms |
| Request lifecycle transitions (NEW → IN_PROGRESS → QUALIFIED) | **PASS** — enforced server-side (`ALLOWED_TRANSITIONS`), frontend now only offers real next statuses (Prompt 27) |
| Appointment created, linked to Customer/Vehicle/Service | **PASS** — real, required fields, validated against working hours + conflicts |
| Request ↔ Appointment linked | **PARTIAL** — real and working, but only from the Request's own Edit form (select an *already-existing* Appointment); no "create appointment from this request" shortcut |
| Appointment lifecycle (SCHEDULED → CONFIRMED/IN_PROGRESS → COMPLETED) | **PASS** — enforced server-side, frontend transition-aware (Prompt 28) |
| ServiceRecord created / visible | **PARTIAL** — fully manual, real form, now pre-fillable and one click away from a COMPLETED Appointment (Prompts 29–30); never automatic |

## 3. Entity Continuity

- **Customer ID**: `Customer.id` → `CustomerRequest.customerId` (required)
  → `Appointment.customerId` (required) → `ServiceRecord.customerId`
  (required). All four are real, backend-validated FKs
  (`assertRelations`/`assertEntitiesActiveAndOwned` at every write) — the
  same physical customer is enforced end to end, never just assumed by
  the UI. **Continuous.**
- **Vehicle ID**: `Vehicle.id` → `CustomerRequest.vehicleId` (optional)
  → `Appointment.vehicleId` (required) → `ServiceRecord.vehicleId`
  (required), with an explicit backend check that the vehicle belongs to
  the same customer at every step. **Continuous** (with the one honest
  caveat that a Request's vehicle link is optional — a request can exist
  before a specific vehicle is identified, by design).
- **Service ID**: `Service.id` → `CustomerRequest.serviceId` (optional)
  → `Appointment.serviceId` (required) → `ServiceRecord.serviceId`
  (required). **Continuous**, same optional-until-Appointment pattern.
- **Request ID**: `CustomerRequest.id` → `Appointment` via
  `CustomerRequest.appointmentId` (optional, backend-validated
  consistency of customer/vehicle/service on link) → visible from both
  sides (Request Detail's "Запись" section since Prompt 27; the reverse
  `GET /api/customer-requests?appointmentId=` lookup in Appointment
  Detail since Prompt 28). **Continuous, bidirectional.**
- **Appointment ID**: `Appointment.id` → `ServiceRecord.appointmentId`
  (optional, one-to-many, backend-validated consistency on link) →
  visible from both sides as of this prompt (Appointment Detail's
  filtered Service History section since Prompt 28; the new
  Service-History-row link back to the Appointment, added this prompt).
  **Continuous, bidirectional.**
- **ServiceRecord ID**: terminal — nothing references it downstream, by
  design (it is history, not a workflow state).

## 4. Request Lifecycle

Real, enforced transition table (`customerRequestService.ts`, unchanged
since audited in Prompt 27):

```
NEW → IN_PROGRESS, CLOSED, CANCELLED
IN_PROGRESS → WAITING_CUSTOMER, QUALIFIED, CLOSED, CANCELLED
WAITING_CUSTOMER → IN_PROGRESS, CLOSED, CANCELLED
QUALIFIED → CONVERTED, CLOSED, CANCELLED
CONVERTED / CLOSED / CANCELLED → (terminal)
```

`CONVERTED` requires a linked `appointmentId`, enforced server-side.
Frontend (Request Detail, Operations) only ever offers the real next
statuses for the current state.

## 5. Appointment Lifecycle

Real, enforced transition table (`appointmentService.ts`, audited in
Prompt 28):

```
SCHEDULED → CONFIRMED, IN_PROGRESS, CANCELLED, NO_SHOW
CONFIRMED → IN_PROGRESS, CANCELLED, NO_SHOW
IN_PROGRESS → COMPLETED, CANCELLED
COMPLETED / CANCELLED / NO_SHOW → (terminal)
```

Rescheduling (time-field PATCH) and cancellation
(`PATCH {status: CANCELLED}`) both reuse the same update endpoint and
validation (working hours, per-vehicle conflict, blocked once terminal).

## 6. Completed Behavior

Confirmed again this prompt (re-reading `updateAppointment()` in full):
transitioning to `COMPLETED` changes **only** the `Appointment.status`
column. No `ServiceRecord` is created, no other table is touched, no
side effect fires. This was independently re-verified as part of this
E2E audit and matches Prompt 29's own finding exactly.

## 7. Service History

`ServiceRecord` remains fully manual and independent of the Appointment
lifecycle (see Prompt 29). This prompt's own contribution: the
`appointmentId` a `ServiceRecord` already carries is now surfaced as a
real, working link **everywhere** a `ServiceRecord` row is rendered
(`/settings/service-history`, Client Detail, Vehicle Detail) — previously
the data existed but no UI exposed it as navigation.

## 8. Cross-navigation Matrix

| Source | Target | Exists | Working |
|---|---|---:|---:|
| Conversation | Request | ✅ (direct field) | ✅ **fixed this prompt** |
| Conversation | Client | ✅ (direct field) | ✅ **fixed this prompt** |
| Conversation | Vehicle | ✅ (via linked Request) | ✅ (Prompt 22/26) |
| Conversation | Appointment | ❌ no relation | — |
| Request | Conversation | ✅ (`customerRequestId` filter) | ✅ (Prompt 24) |
| Request | Client | ✅ (direct field) | ✅ (Prompt 24) |
| Request | Vehicle | ✅ (direct field) | ✅ (Prompt 24/26) |
| Request | Appointment | ✅ (`appointmentId` field) | ✅ (Prompt 27) |
| Client | Conversation | ✅ (`customerId` filter) | ✅ (Prompt 23) |
| Client | Request | ✅ (`customerId` filter) | ✅ (Prompt 23) |
| Client | Vehicle | ✅ (direct, via customer detail) | ✅ (Prompt 23/26) |
| Client | Appointment | ✅ (`customerId` filter) | ✅ (Prompt 28) |
| Vehicle | Client | ✅ (direct field) | ✅ (Prompt 26) |
| Vehicle | Request | ✅ (`vehicleId` filter) | ✅ (Prompt 26) |
| Vehicle | Conversation | ❌ only a fragile two-hop join would exist | — (deliberately rejected, Prompt 26) |
| Vehicle | Appointment | ✅ (`vehicleId` filter) | ✅ (Prompt 28) |
| Appointment | Client | ✅ (direct field) | ✅ (Prompt 28) |
| Appointment | Request | ✅ (`appointmentId` filter) | ✅ (Prompt 28) |
| Appointment | Vehicle | ✅ (direct field) | ✅ (Prompt 28) |
| Appointment | Conversation | ❌ no relation | — |
| Appointment | Service History | ✅ (`vehicleId` filter + client match) | ✅ (Prompt 28/29) |

**19 of 21 real, working links; 2 confirmed structural absences** (no
underlying relation — correctly left unbuilt rather than faked via a
derived join).

## 9. Context Loss

- **None found while navigating via a link.** Every Detail panel
  independently re-resolves and displays its own customer/vehicle/
  service/request context on load (not relying on in-memory state
  carried from the previous screen) — so hopping
  Conversation → Request → Appointment → Service History never leaves
  the admin wondering "wait, whose car is this again?".
- **One real, systemic limitation**: the currently-open Detail (in
  Conversations/Clients/Vehicles/Requests/Appointments) is **not**
  reflected in the browser URL once opened by clicking a row (only the
  one-time incoming `?open=` cross-navigation link is URL-based, and it
  is stripped immediately after being consumed). A page refresh while
  viewing, say, Request Detail returns the admin to the plain list, not
  back to that request — the "which request was I on" context is lost
  on refresh, not on navigation. This is real, was independently
  discovered during this audit, and is **not** fixed here (see §25, P1)
  — fixing it would mean changing the routing pattern on five separate
  pages, well beyond a "small fix."

## 10. Dead Ends

| Dead end | Classification |
|---|---|
| `CustomerRequest.CLOSED` / `.CANCELLED` | **Valid endpoint** — a real, intentional terminal state |
| `Appointment.CANCELLED` / `.NO_SHOW` | **Valid endpoint** — a real, intentional terminal state |
| `Appointment.COMPLETED` with no ServiceRecord yet | **Valid, actionable state** — not a dead end since Prompt 29/30: a real "Добавить запись" link is present |
| `ServiceRecord` created | **Valid endpoint** — this is the intentional end of the tracked journey; nothing downstream is expected to exist |
| Conversation with no linked Request | **Valid state**, not a dead end — Prompt 21's own spec explicitly allows an unlinked, "not yet a formal request" conversation |
| Conversation → Appointment (no path) | **Product gap, not a dead end in the tested journey** — reachable only by going through Request; documented, not fixed (§8) |

No previously-hidden dead end was found in the core tested journey
itself — the four gaps this prompt fixed (§8) were link-*display* gaps
(the data and the target screen both already existed), not missing
capability.

## 11. Form/Data Integrity

Spot-checked by tracing each create/edit flow's payload against its own
schema and the DTO returned afterward (Requests, Appointments,
ServiceRecords, Vehicles, Conversations) — every field submitted by
these forms is present, unchanged, in the corresponding single-GET
response used by that entity's own Detail panel. No data-loss pattern
was found. (This reuses the same field-level scrutiny already applied
individually in Prompts 24/26/27/28/29 — re-confirmed here at the
cross-entity level, not re-litigated line by line.)

## 12. Status Consistency

Every status label map audited across this project
(`REQUEST_STATUS_LABELS`, `APPOINTMENT_STATUS_LABELS`,
`ESCALATION_STATUS_LABELS`) is keyed by the **real** Prisma enum values,
confirmed by direct schema comparison, with translation only at the
display layer — no frontend-invented status value exists anywhere in
this codebase's UI for these three entities.

## 13. API Flow

A representative real sequence for one customer, using only existing endpoints:

```
POST /api/customers                                  (create customer)
POST /api/vehicles                                   (create vehicle)
POST /api/conversations                              (manual) — or a real
    Telegram webhook creating one automatically
POST /api/customer-requests                          (customerId, vehicleId?, serviceId?)
PATCH /api/customer-requests/:id  {status: IN_PROGRESS}
PATCH /api/customer-requests/:id  {status: QUALIFIED}
POST /api/appointments                               (customerId, vehicleId, serviceId, startAt, endAt)
PATCH /api/customer-requests/:id  {appointmentId, status: CONVERTED}
PATCH /api/appointments/:id       {status: CONFIRMED}
PATCH /api/appointments/:id       {status: IN_PROGRESS}
PATCH /api/appointments/:id       {status: COMPLETED}
POST /api/service-history                            (customerId, vehicleId, serviceId, appointmentId, performedAt, totalPrice, workDescription)
```

Every manual screen transition between these calls (create Appointment →
go back to Request Detail → Edit → select it → save) is a real, admin-
driven step, not hidden automation — consistent with every prior
prompt's own audit.

## 14. N+1 / Performance

No new N+1 pattern was introduced or found. This prompt's four fixes add
**zero** additional network requests anywhere — each new link reuses a
field already present on data the page had already loaded (`customerId`,
`customerRequestId`, `appointmentId`). Every Detail panel across the app
continues to use `Promise.allSettled` for its independent fetches and at
most one genuine dependent follow-up call, per the pattern established
and audited in Prompts 22–29.

## 15. Tenant Isolation

Not re-derived from scratch — relied on the existing, dedicated
124-test `tenantIsolation.test.ts` suite (unchanged, still fully
passing) plus direct confirmation that every repository call touched by
this journey goes through `withTenant()` scoping (`customerRepository`,
`vehicleRepository`, `conversationRepository`,
`customerRequestRepository`, `appointmentRepository`,
`serviceRecordRepository`, `escalationRepository` — all audited in prior
prompts, re-spot-checked here). No cross-tenant leakage path was found
or introduced.

## 16. Error Recovery

- Every create/edit form disables its submit button while a request is
  in flight (`disabled={saving}`) and surfaces the real backend error
  message on failure without losing the user's already-typed input
  (state is only cleared on confirmed success) — consistent across
  every form in the app.
- No distributed multi-step "transaction" exists across screens (e.g.
  create Appointment then link it to a Request are two separate,
  independently-recoverable API calls) — if the second step fails, the
  first one's result (the Appointment) still exists and nothing is lost;
  the admin simply retries the link. This is honest, not a gap.

## 17. Duplication Risks

- Client-side: submit buttons are disabled during `saving`, which
  prevents the common "double-click" duplicate. No server-side
  idempotency key exists for any create endpoint (Customer, Conversation,
  CustomerRequest, Appointment, ServiceRecord) — a genuine network-level
  retry after a timeout could theoretically create a duplicate. This is
  a pre-existing, accepted trade-off across the whole app, not something
  newly discovered or worsened by this prompt; per this prompt's own
  Step 19, no idempotency system was added.

## 18. Product Flow Score

| Flow | Score |
|---|---:|
| Contact → Conversation | 5/5 |
| Conversation → Request | 3/5 |
| Request → Qualification | 5/5 |
| Request → Vehicle | 5/5 |
| Request → Appointment | 3/5 |
| Appointment → IN_PROGRESS | 5/5 |
| Appointment → COMPLETED | 5/5 |
| Completed → Service History | 4/5 |
| Cross-navigation | 4/5 |
| Context preservation | 4/5 |

Rationale for the three non-5 scores: **Conversation → Request** and
**Request → Appointment** both work but require a deliberate, separate
manual step with no "create X from here" shortcut (by design — building
one would mean adding new form surfaces, out of an audit prompt's
scope). **Completed → Service History / Cross-navigation / Context
preservation** all score 4 rather than 5 because of the one real,
unfixed systemic gap: open-detail state isn't URL-persisted (§9, §25).

## 19. Product Decision

**B.** The workflow is fundamentally continuous and well-connected — no
fundamental product gap blocks the core journey. Four concrete, real
navigation-display gaps were found and closed using only existing data
already loaded on each screen and existing routes; no new business
entity, endpoint, or relation was introduced.

## 20. Implementation

- `ConversationDetailPanel.tsx`: made the "Клиент" and "Заявка" context
  sections clickable, navigating to `/clients?open=` and
  `/requests?open=` respectively — both already used `detail.customerId`
  / `detail.customerRequestId`, already-loaded, real fields.
- `ServiceHistorySettingsPage.tsx`: added a small "Открыть запись" icon
  button on each list row when `record.appointmentId` is set, linking to
  `/appointments?open=`.
- `ClientDetailPanel.tsx` and `VehicleDetailPanel.tsx`: their compact
  Service History sections now link each row to its linked Appointment
  the same way, when `appointmentId` is present.

## 21. Files Changed

- `src/components/conversations/ConversationDetailPanel.tsx`
- `src/pages/settings/ServiceHistorySettingsPage.tsx`
- `src/components/clients/ClientDetailPanel.tsx`
- `src/components/vehicles/VehicleDetailPanel.tsx`

No other files were touched.

## 22. Backend / Prisma

```text
backend changes: NO
Prisma changes: NO
migrations: NO
```

## 23. Validation

- **TypeScript** (`npx tsc --noEmit`): **PASS**
- **Build** (`npm run build`): **PASS** (892.94 kB main chunk, gzip
  194.88 kB — the pre-existing chunk-size warning, unrelated to this change)
- **Tests** (`npm test -- --run`): **1221/1221 passed**, 60 test files,
  including the 124-test `tenantIsolation.test.ts` suite, unchanged
- **E2E/manual flow**: audited via direct code inspection (route
  handlers, service-layer validation, repository queries, and every
  Detail panel's actual data-fetching code) across the full journey —
  no live browser walkthrough was performed (no Playwright/Cypress
  infrastructure exists in this project)

## 24. Git

- Commit hash: `11dd6a6`
- Commit message: `feat: audit end-to-end operational flow`
- Pushed to `origin/master` successfully, no force push

## 25. Product Gaps

### P0 — blocks the core workflow
None found.

### P1 — significantly degrades the workflow
- **Open-detail state is not URL-persisted.** Refreshing the browser
  while viewing any Detail screen (Conversation/Client/Vehicle/Request/
  Appointment) returns to that entity's plain list, losing the "which
  record was I on" context. Discovered independently during this audit
  (§9). Fixing it would require changing the routing pattern (e.g. to a
  real `/requests/:id`-style URL or a persisted `?id=`) on five separate
  pages — a real, non-trivial, cross-cutting change, correctly out of
  this audit prompt's "small fixes only" scope.
- **No way to create an Appointment directly from a QUALIFIED Request**
  (or a CustomerRequest directly from an open Conversation). Both links
  work once created manually elsewhere, but the two-screen back-and-forth
  is real, repeated friction for the single most common conversion in
  the whole product (a qualified inquiry becoming a booked appointment).

### P2 — minor UX/technical debt
- No server-side idempotency on any create endpoint (accepted,
  pre-existing, unchanged trade-off — see §17).
- No `/appointments` date-range filter UI despite backend support
  (already flagged in Prompt 28).
- `Appointment` has no dedicated "today's appointments" surface in
  `/operations` — not a bug (Appointments already have their own
  dedicated, filterable list), just a possible future convenience.

## 26. Screenshot

No screenshot validation performed.
