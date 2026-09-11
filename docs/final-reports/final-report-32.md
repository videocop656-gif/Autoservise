## Final Report — Prompt 32: Service Completion Domain Audit & Design

### Validation

TypeScript: NOT RUN
Build: NOT RUN
Tests: NOT RUN

Prompt 32 is a read-only audit/design prompt (spec §16: "по умолчанию не изменяй код"). No file under `src/`, `api/`, `prisma/`, or `tests/` was touched during this investigation — only `Read`/`Grep` were used. `git status` confirms a clean working tree (only the pre-existing, unrelated untracked `.mcp.json`). Because nothing in the codebase changed, there is nothing new for TypeScript/build/tests to validate; the suite's last confirmed state is Prompt 31's **1224/1224 passing, TypeScript PASS, Build PASS**, and that state is unaffected by this report.

### Current Domain Audit

#### Appointment

`model Appointment` (`prisma/schema.prisma:503`) — a scheduled service slot. Required FKs: `tenantId`, `businessId`, `customerId`, `vehicleId`, `serviceId` (all `onDelete: Restrict` — an Appointment is history and outlives changes to what it references). `startAt`/`endAt` (UTC), `status: AppointmentStatus` (default `SCHEDULED`), `notes`.

`AppointmentStatus` enum (schema.prisma:69-76) already is:
```
SCHEDULED → CONFIRMED → IN_PROGRESS → COMPLETED
                                    ↘ CANCELLED
                                    ↘ NO_SHOW
```
— audited directly from `appointmentService.ts`'s `ALLOWED_TRANSITIONS` table (`APPOINTMENT_NEXT_STATUSES` on the frontend, `src/components/appointments/shared.ts:51-58`, is a verified mirror). This **already is** the exact "SCHEDULED/CONFIRMED/COMPLETED/CANCELLED/NO_SHOW" outcome lifecycle spec §8 asks whether to introduce — plus `IN_PROGRESS` as a real intermediate state. Nothing to add.

Appointment has no `outcome`/`result` field beyond `status`, no cost field, no "what was done" field — by design: those belong to ServiceRecord (below), not to the scheduling record.

#### Customer Request

`model CustomerRequest` (schema.prisma:601) — "what the customer wants." `status: CustomerRequestStatus` (NEW/IN_PROGRESS/WAITING_CUSTOMER/QUALIFIED/CONVERTED/CLOSED/CANCELLED), optional `appointmentId` (the request's own downstream Appointment, once one exists — `CONVERTED` requires it, audited in Prompt 27/31). CustomerRequest has no relation whatsoever to ServiceRecord — by design, it stops mattering once an Appointment exists; it is not re-consulted for the actual service outcome.

#### Vehicle

`model Vehicle` (schema.prisma:437) — owned by exactly one `Customer` (`customerId`, required, `onDelete: Restrict`). Carries `mileage: Int?` (kilometers, no separate unit field) directly on the vehicle record itself — this is the *current/last-known* mileage, separate from the *per-visit* mileage stored on each ServiceRecord (see below; `assertMileageIsNotDecreasing` in `serviceRecordService.ts` enforces the per-visit value only, and does not itself update `Vehicle.mileage` — confirmed by reading `vehicleRepository.ts`/`serviceRecordRepository.ts`: no write path from ServiceRecord back to `Vehicle.mileage` exists). Has direct relations to `appointments`, `serviceRecords`, `customerRequests`, `leads` — Vehicle is already the natural aggregation point for "everything that happened to this car," exactly as spec §7 requires.

#### Existing Service / History

**`ServiceRecord` already exists** (`prisma/schema.prisma:540-599`) and is exactly the "what actually happened" fact the whole prompt is asking whether to build. It already has every field spec §7's "minimally potentially useful data" list asks for:

| Spec §7 field | ServiceRecord field |
|---|---|
| date | `performedAt: DateTime` |
| service type | `serviceId: String` (FK to `Service`) |
| mileage, если существует | `mileage: Int?` |
| performed work | `workDescription: String @db.Text` (required) |
| recommendations | `recommendations: String? @db.Text` |
| total amount, если существует | `totalPrice: Decimal(12,2)` + `currency: String` |
| source Appointment | `appointmentId: String?` (optional — supports pre-app historical records too) |
| source Request | *(not directly — see Data Ownership below; reachable transitively via Appointment)* |

Plus fields beyond that minimum: `partsDescription: String? @db.Text` (free-text, not a structured Part entity), `notes: String? @db.Text`, `isArchived: Boolean` (soft-hide, no hard delete — "a completed service visit is a historical fact").

Ownership/tenant shape: `tenantId`, `businessId`, `customerId`, `vehicleId`, `serviceId` all required and `onDelete: Restrict`; `appointmentId` optional and `onDelete: Restrict`. `serviceRecordService.ts`'s `assertRelationsOwnedAndActive()` + `assertAppointmentConsistency()` (read in full — see below) already enforce every cross-tenant/cross-customer/cross-vehicle guard spec §12 is worried about.

Backend service (`src/server/services/serviceRecordService.ts`, 202 lines, read in full):
- `createServiceRecord`/`updateServiceRecord`, both `requireRole('owner','admin','manager')`.
- `assertRelationsOwnedAndActive`: customer/vehicle/service must exist in `ctx.tenant.id`/`ctx.business.id`, vehicle must belong to that customer, all three must be active (tenant-scoped `findById` calls — never a bare-ID lookup).
- `assertAppointmentConsistency`: if `appointmentId` is given, the appointment must exist in-tenant AND match the record's own `customerId`/`vehicleId`/`serviceId` exactly — this is the guard that makes "create a ServiceRecord for someone else's Appointment" structurally impossible.
- `assertMileageIsNotDecreasing`: enforces non-decreasing mileage per vehicle across non-archived records.
- Update path only re-validates relations that actually changed (never blocks editing a record whose Customer/Vehicle/Service was since deactivated) — same convention as `Appointment`/`CustomerRequest`.

Frontend: `ServiceHistorySettingsPage.tsx` (`/settings/service-history`) is the create/list/edit screen (mini-form pre-fillable via `?vehicleId=&customerId=&serviceId=&appointmentId=` query params — the exact mechanism `AppointmentDetailPanel`'s "Добавить запись" link uses for a `COMPLETED` appointment, built in Prompt 29). `VehicleDetailPanel.tsx` and `ClientDetailPanel.tsx` **both already embed a "История обслуживания" section** (`GET /api/service-history?vehicleId=`/`?customerId=`, 5 most recent, with a "see all" link to the filtered settings page) — this is Prompt 26's "Option A" decision (no separate Vehicle Detail *domain model*, but a real embedded history section) plus its Client Detail mirror.

Tests: `tests/serviceRecordService.test.ts` (35 tests) + `tests/serviceRecord.schemas.test.ts` (25 tests) already cover create/update, relation validation, appointment consistency, mileage monotonicity, and role checks.

**No WorkOrder, Invoice, Payment, Inventory, Part, or Technician model exists anywhere in `prisma/schema.prisma`** — confirmed by listing every `model`/`enum` in the file (23 models, 20 enums; none of those five names appear).

### Audit Matrix

| Requirement | Exists? | Current Entity | Current UI/API | Gap |
|---|---|---|---|---|
| 1. Appointment | Yes | `Appointment` | `/appointments`, `AppointmentDetailPanel`, `POST/GET/PATCH /api/appointments` | None |
| 2. Service / service catalog | Yes | `Service` | `/settings/services`, `/api/services` | None |
| 3. WorkOrder | No | — | — | Not needed now — see Core Domain Decision |
| 4. ServiceRecord | Yes | `ServiceRecord` | `/settings/service-history`, `/api/service-history`, embedded in Vehicle/Client Detail | None (already the "what actually happened" record) |
| 5. Performed work | Yes | `ServiceRecord.workDescription` (free text, required) | Shown in Vehicle/Client Detail history rows | None for MVP; no structured line items (deferred, see WorkItem) |
| 6. Recommended work | Yes | `ServiceRecord.recommendations` (free text, optional) | Stored, not yet surfaced as a standalone "outstanding recommendations" list anywhere | Minor: no UI aggregates recommendations across visits (e.g. "open recommendations for this vehicle") — not required for MVP |
| 7. Parts | Partial | `ServiceRecord.partsDescription` (free text, optional) | Stored, shown in the record's own detail | No structured Part/Inventory entity — deliberately deferred (§10) |
| 8. Labor | No | — | — | No separate labor tracking; folded into `workDescription`/`totalPrice` — acceptable for MVP, deferred structurally |
| 9. Price | Yes | `ServiceRecord.totalPrice` + `currency` | Shown in history rows | None |
| 10. Total amount | Yes | Same as above (single total, not a computed sum of line items) | Shown | None for MVP |
| 11. Visit status | Yes | `Appointment.status` (COMPLETED/CANCELLED/NO_SHOW are real terminal outcomes) | Status control in `AppointmentDetailPanel` | None — see §8 finding above |
| 12. Completed date | Yes | `ServiceRecord.performedAt` (the actual completion/service date — deliberately separate from `Appointment.startAt`, since a visit can be logged for a different date than originally scheduled) | Shown in history | None |
| 13. Vehicle service history | Yes | `ServiceRecord[]` via `vehicleId`, `GET /api/service-history?vehicleId=` | `VehicleDetailPanel`'s "История обслуживания" section | None |
| 14. Client service history | Yes | `ServiceRecord[]` via `customerId`, `GET /api/service-history?customerId=` | `ClientDetailPanel`'s "История обслуживания" section | None |
| 15. Appointment outcome | Yes | `Appointment.status` (COMPLETED/CANCELLED/NO_SHOW) + optionally a linked `ServiceRecord` for what was actually done | Status control + "Добавить запись" link (Prompt 29) | Real gap: an Appointment can be marked `COMPLETED` with **no** `ServiceRecord` ever created — nothing enforces or even visually flags this (see Risks) |

### Core Domain Decision

#### Appointment
Sufficient as-is. Represents "when the customer is booked" plus a real, already-adequate outcome lifecycle (`status`). No change.

#### WorkOrder
**Not needed now — deferred.** An Appointment already carries everything a WorkOrder would add at this stage (who/what/when, a status lifecycle including `IN_PROGRESS`/`COMPLETED`). Introducing a WorkOrder today would mean either (a) duplicating fields already on Appointment, or (b) making WorkOrder the "real" execution record and demoting Appointment to pure scheduling — which only pays off once there is a genuine need for *multiple, separately-trackable* work efforts per appointment (e.g. several technicians each closing their own portion) or a formal "open/in-progress/closed" ticket workflow distinct from the calendar slot. Neither exists in this product yet. See §9 comparison below.

#### ServiceRecord
**Already exists and is sufficient.** It is exactly the "what was actually done, what it cost, what's recommended, tied to a Vehicle" record the prompt describes wanting to design. No new fields are needed for the currently supported use cases; the only structural gap is *adoption* (an Appointment reaching `COMPLETED` doesn't guarantee a `ServiceRecord` gets created — a UX/workflow gap, not a schema gap).

#### Service
Already exists (`Service` catalog model) and is correctly reused by `Appointment`, `CustomerRequest`, `Lead`, and `ServiceRecord` alike. No change.

#### Work Items
**Deferred.** `ServiceRecord.serviceId` is a single required FK (one canonical service per record) plus free-text `workDescription` for the specifics of what was actually done. A structured `WorkItem[]` (one row per distinct billable line item, each with its own service/price) would matter once a single visit routinely covers multiple distinct, separately-priced services — not evidenced as a current need, and no UI anywhere assumes multiple services per visit today (Appointment itself is also single-`serviceId`).

#### Parts / Inventory
**Deferred**, per spec §10 (explicitly listed as out of scope). `ServiceRecord.partsDescription` (free text) already gives operators a place to note parts used, without committing to a stock/inventory model, part catalog, or per-part pricing — exactly the "don't add fields you don't need to support yet" principle from spec §7.

#### Invoice
**Deferred**, per spec §10. `ServiceRecord.totalPrice`/`currency` already record the financial outcome of a visit as a single fact; no separate billing document exists or is proposed. If/when true invoicing (multi-line, tax, discounts, a document lifecycle of its own) is needed, it should be a new entity that *reads from* ServiceRecord rather than replacing it — see the future-connection sketch below.

#### Payment
**Deferred**, per spec §10. No payment tracking exists; nothing here depends on it.

### Recommended Minimal Model

No new entities. The existing pair already is the minimal, correct model:

**Appointment** (unchanged)
- Purpose: represents a scheduled service slot and its scheduling-level outcome (attended/no-show/cancelled/in-progress/completed).
- Ownership: belongs to `Customer` + `Vehicle` + `Service`, scoped to `tenantId`/`businessId`.
- Required relations: `customerId`, `vehicleId`, `serviceId` (all required, `Restrict`).
- Critical fields: `startAt`, `endAt`, `status`.
- Tenant isolation: `tenantId`/`businessId` columns + every read/write scoped through `appointmentRepository.findById(tenant.id, business.id, id)` — already the case.

**ServiceRecord** (unchanged)
- Purpose: represents the actual, historical fact of service performed — what was done, when, for how much, on which vehicle, with what recommendations.
- Ownership: belongs to `Customer` + `Vehicle` + `Service`, optionally to one `Appointment`.
- Required relations: `customerId`, `vehicleId`, `serviceId` required; `appointmentId` optional (supports both "created from a completed appointment" and "logging pre-existing/off-app history").
- Critical fields: `performedAt`, `workDescription`, `totalPrice`+`currency`; optional `mileage`, `partsDescription`, `recommendations`, `notes`.
- Tenant isolation: `tenantId`/`businessId` columns + `assertRelationsOwnedAndActive`/`assertAppointmentConsistency`, already enforced and already tested.

### Lifecycle

```
CustomerRequest (what the customer wants)
    ↓  (CONVERTED once appointmentId is set — Prompt 27/31)
Appointment (when the customer is booked; status: SCHEDULED → CONFIRMED → IN_PROGRESS → COMPLETED / CANCELLED / NO_SHOW)
    ↓  (manual, optional — "Добавить запись" pre-fills the form, Prompt 29)
ServiceRecord (what was actually done, cost, recommendations — permanent Vehicle/Client history)
    ↓
Vehicle/Client service history (embedded sections in VehicleDetailPanel/ClientDetailPanel)
    ↓
A later CustomerRequest/Conversation from the same customer/vehicle can reference this history
    (no automated linkage exists or is proposed here — an operator reads the history
    manually today; that remains true after this prompt)
```

### Vehicle Service History

- **Source**: `ServiceRecord[]` filtered by `vehicleId`, via the existing `GET /api/service-history?vehicleId=` endpoint.
- **Ownership**: primarily `Vehicle` (spec §7's own instruction — "не только к Client, потому что один клиент может иметь несколько автомобилей"), secondarily surfaced per-`Customer` via the same table's `customerId` FK for Client Detail's own section.
- **Required data**: already fully covered — see the Audit Matrix's rows 5/6/7/9/10/12 above; nothing further is required for the currently supported feature set.
- **Future UI**: no new screen needed. `/vehicles/:id/history` as a separate route is **not** recommended — the existing full-screen-swap `VehicleDetailPanel` section (5 most recent + a "see all" link into the existing filtered `/settings/service-history?vehicleId=` list) already serves this without adding a route, consistent with this app's established no-new-route Detail pattern.

### Deferred

Explicitly not to be built as part of this prompt or the next:

- WorkOrder
- Invoice
- Payment
- Inventory / Warehouse / Parts catalog
- Technician management
- Structured `WorkItem`/per-line-item performed-service records
- Any Prisma schema change or migration
- Any new API endpoint
- Any new page or UI component

### Risks / Existing Gaps

1. **A `COMPLETED` Appointment can have zero linked `ServiceRecord`s, and nothing surfaces this.** `appointmentService.ts` never touches `serviceRecordRepository` (confirmed by direct read, also documented in Prompt 29's Final Report) — completing an appointment is purely a status change. The "Добавить запись" link (Prompt 29) makes logging one click away, but an operator can skip it entirely with no visual signal anywhere (not in `AppointmentDetailPanel`, not in `OperationsPage`) that a completed visit was never logged. This is a workflow-adoption gap, not a schema gap — flagged per spec §16 ("зафиксируй, не исправляй"), candidate for Prompt 33.
2. **`Vehicle.mileage` (the vehicle's own current-mileage field) is never updated from a `ServiceRecord`'s per-visit `mileage`.** Two separate mileage values exist (`Vehicle.mileage` and each `ServiceRecord.mileage`) with no reconciliation between them — `Vehicle.mileage` can silently go stale even as service history accumulates newer, higher mileage readings. Existing behavior, not introduced or worsened by this audit; flagged as a pre-existing gap.
3. **`ServiceRecord` has no direct relation to `CustomerRequest`** — the "source Request" column in spec §7's own field list is only reachable transitively (`ServiceRecord.appointmentId` → `Appointment.customerRequests[]`, and only when a request happens to be linked to that appointment). For the current, always-manual creation flow this is adequate; it would only become a real gap if a future prompt needs to jump directly from a Request to "the resulting service record" without an Appointment as the middle hop.
4. **Single `serviceId` per `Appointment`/`ServiceRecord`** means a visit that genuinely covered multiple distinct services has no structured way to represent that beyond free text — acceptable today (see Work Items, deferred) but worth remembering if a future prompt is tempted to bolt a second `serviceId` onto one of these models instead of introducing a proper line-item entity later.

None of the above requires a code or schema fix as part of Prompt 32 (per spec §16, "не исправляй её автоматически, просто зафиксируй").

### Recommended Prompt 33

A UX-only follow-up (no new Prisma models, no WorkOrder/Invoice/Payment/Inventory), most plausibly targeting Risk #1 above:

- On `AppointmentDetailPanel`, when `status === 'COMPLETED'` and no `ServiceRecord` references this appointment, show an explicit, honest "Обслуживание не залогировано" (or similar) indicator next to the existing "Добавить запись" link — currently the link is shown but its absence-of-use is invisible.
- Optionally surface the same signal as a filterable/visible state on `/operations`, if (and only if) the audit confirms Operations already aggregates appointments in a way this fits without inventing a new urgency/SLA concept (Prompt 25's own prohibition on inventing such signals still applies).
- Explicitly NOT in scope for Prompt 33: WorkOrder, Invoice, Payment, Inventory, structured Work Items/Parts, `Vehicle.mileage` reconciliation (a separate, smaller, well-defined follow-up if ever prioritized).

This report does not implement Prompt 33 — it is a recommendation only, per the STOP condition.

### Prisma Changes

NONE

### API Changes

NONE

### Git

No code commit required. `git status` confirms a clean working tree at the end of this audit (only the pre-existing, unrelated untracked `.mcp.json`); this report itself is the only new file, added via a single docs commit.

### Screenshot Validation

Not performed.

STOP.
