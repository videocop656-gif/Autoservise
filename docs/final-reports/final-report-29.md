# Final Report 29 — Service Execution & Post-Appointment Audit v1

## 1. Audit Summary

Audited `ServiceRecord`, `Appointment`, `Service`, `Customer`, `Vehicle`,
`CustomerRequest`, `Conversation`, `Message`, `AiEscalation`, and the
whole schema for any billing/payment/technician/parts/inventory model
(`prisma/schema.prisma` — full grep, not spot-check). Also audited every
call site of `createServiceRecord`/`serviceRecordRepository.create`
across the codebase, and `appointmentService.ts`'s `updateAppointment`
line by line for any reference to `ServiceRecord`.

## 2. ServiceRecord Data Model

Real fields (unchanged since Prompt 06):

```
id, tenantId, businessId, customerId, vehicleId, serviceId,
appointmentId (optional), performedAt, mileage (optional),
totalPrice, currency, workDescription, partsDescription (optional, free text),
recommendations (optional), notes (optional), isArchived,
createdAt, updatedAt
```

Relations: `customer`/`vehicle`/`service` are required FKs (Restrict on
delete); `appointment` is an **optional** FK (Restrict on delete). No
`@@unique` constraint on `appointmentId` — only a plain `@@index`. No
status field beyond the boolean `isArchived`.

## 3. ServiceRecord Semantics

**Option A** — a purely historical record of already-performed work.
`performedAt` is a required point-in-time field (not a range, not a
draft state); there is no "in progress" sub-state anywhere on the model;
`isArchived` only hides old records from the default list, it does not
represent a workflow stage. Confirmed by the create form itself (Prompt
06): every required field (`workDescription`, `totalPrice`, `performedAt`)
describes something that has *already happened*.

## 4. Creation Flow

Exclusively manual: `POST /api/service-history` → `createServiceRecord()`
in `serviceRecordService.ts`. Grepped every reference to
`createServiceRecord` and `serviceRecordRepository.create` in the
codebase (`src/`, `api/`, excluding tests) — the **only** two call sites
are `serviceRecordService.ts` itself and `api/service-history/index.ts`'s
`POST` handler. No AI tool (`src/server/ai/tools/`), no seed script, no
other service references it. Also confirmed there is no
`create_service_record`-style AI tool at all — the AI Booking tool layer
(Prompt 10) only ever touches `Appointment`.

## 5. Appointment → ServiceRecord

Real, optional, **one-to-many** relation: `ServiceRecord.appointmentId`
is nullable with no unique constraint, so a single Appointment can have
zero, one, or (in principle) multiple linked ServiceRecords — nothing in
the schema or `serviceRecordService.ts` prevents more than one. When
provided, `assertAppointmentConsistency()` requires the record's
customer/vehicle/service to exactly match the linked appointment's own
— but linking itself is always a manual, optional choice made in the
create/edit form.

## 6. COMPLETED Behavior

Read `appointmentService.ts::updateAppointment()` in full: it validates
the transition (`assertValidTransition`), re-validates relations/time/
conflicts only for fields actually changing, and calls
`appointmentRepository.updateById()`. **At no point does it import or
call anything from `serviceRecordRepository` or `serviceRecordService`.**
Transitioning to `COMPLETED` changes exactly one thing: the
`Appointment.status` column. This matches **Variant 1 / Variant 5** from
the prompt's own list — only the status changes, and the backend
performs no special processing beyond that status change itself.

## 7. Price / Cost

Stored **only** on `ServiceRecord.totalPrice` (+ `currency`) — set once,
manually, when a ServiceRecord is created, always describing a specific
completed work item. `Appointment` itself has no price field. No
`Invoice`, `Payment`, `Transaction`, or `PaymentStatus` model or field
exists anywhere in the schema — confirmed by a full-schema grep; the only
matches for "PAYMENT" are two unrelated enum members
(`KnowledgeCategory.PAYMENT`, `BusinessRuleCategory.PAYMENT` — knowledge-
base/business-rule *topic labels*, not a billing system).

**No payment/billing concept exists in this product at all.**

## 8. Work Performed

`ServiceRecord.workDescription` (required, free text) is where completed
work is recorded — but only if and when an admin manually creates a
ServiceRecord. Nothing on the Appointment side prompts, requires, or
enforces this after `COMPLETED`. `partsDescription` is a **free-text**
field ("parts/materials used"), not a structured Part/Inventory
relation — confirmed no `Part`/`Inventory`/`Stock` model exists.

## 9. Mileage / Vehicle Condition

`ServiceRecord.mileage` (optional Int, kilometers) is the only real
"vehicle condition" signal, with a genuine backend rule: it can never
decrease across a vehicle's non-archived history
(`assertMileageIsNotDecreasing`, unchanged since Prompt 06). No odometer-
as-a-separate-concept, inspection, or diagnostic-result field exists
anywhere.

## 10. Technician / Employee

**Does not exist** as a concept tied to Appointment or ServiceRecord.
The only `assignedUserId`/`assignedUser` relation in the entire schema
belongs to `AiEscalation` (staff handling an escalated conversation) —
unrelated to who performs mechanical work.

## 11. Parts / Inventory

**Does not exist.** `ServiceRecord.partsDescription` is free text only —
no `Part`, `Inventory`, or `Stock` model, no quantity/cost-per-part
tracking of any kind.

## 12. Invoice / Payment

**Does not exist.** See §7 — confirmed by full-schema grep. No billing
workflow of any kind exists in this product today.

## 13. Service History Screen

`/settings/service-history` (unchanged route) already supports: full
create/edit, archive/restore, `customerId`/`vehicleId`/`includeArchived`
filters + pagination, and reference-data-resolved customer/vehicle/
service names — all pre-existing (Prompt 06/26). It has **no per-record
detail/click-through** and **no `appointmentId` query filter** on
`GET /api/service-history` (confirmed again this prompt) — only
`customerId`/`vehicleId`/`includeArchived`/`dateFrom`/`dateTo` are
supported server-side.

## 14. Appointment Detail

Extended, minimally: when an appointment's status is `COMPLETED`, a
"Добавить запись" link now appears beside its existing Service History
section, pointing into the existing, unmodified Service History create
form with the customer/vehicle/service/appointment already pre-filled.
This does not simulate an automatic link — the admin still manually
reviews and submits the real form; it only removes the busywork of
re-selecting values already known on this screen.

## 15. Product Decision

**B.** ServiceRecord exists, but completion is not automated — and
should not be faked. No new business entity was created; the existing
ServiceRecord flow was made more discoverable and pre-filled from
Appointment Detail, using only the existing backend contract
(`POST /api/service-history` with pre-filled fields, submitted by the
admin exactly as before).

## 16. Implementation

- `AppointmentDetailPanel.tsx`: a conditional "Добавить запись" link in
  the Service History section, shown only when `appointment.status ===
  'COMPLETED'` and the viewer `canManage`, linking to
  `/settings/service-history?vehicleId=&customerId=&serviceId=&appointmentId=`.
- `ServiceHistorySettingsPage.tsx`: `openCreateForm()` now accepts an
  optional prefill object; a new mount-only effect reads
  `customerId`/`vehicleId`/`serviceId`/`appointmentId` from the URL (only
  when `appointmentId` is present, signalling this specific deep-link),
  opens the create form pre-filled with them, then clears those params
  from the URL. The plain "Add" button's call site was updated to keep
  calling `openCreateForm()` with no arguments.

No completion wizard, no automatic ServiceRecord creation, no new field,
no new status.

## 17. Files Changed

- `src/components/appointments/AppointmentDetailPanel.tsx`
- `src/pages/settings/ServiceHistorySettingsPage.tsx`

No other files were touched.

## 18. API Used

- `PATCH /api/appointments/:id` (unchanged — status transitions, already existing)
- `POST /api/service-history` (unchanged — still submitted manually by the admin, just with a pre-filled form)

No new endpoint was created or called.

## 19. Backend / Prisma

```text
backend changes: NO
Prisma changes: NO
migrations: NO
```

## 20. N+1 Audit

No change to how any list loads. The new "Добавить запись" link needs no
extra request at all — it reuses fields already present on the loaded
`appointment` object. The prefill effect on `/settings/service-history`
reads only `URLSearchParams` (no network call) before opening the
already-existing, already-loaded create form. Zero additional requests
introduced anywhere, list or detail.

## 21. Cross-navigation

| Source → Target | Status |
|---|---|
| Appointment → Client | ✅ (Prompt 28, unchanged) |
| Appointment → Vehicle | ✅ (Prompt 28, unchanged) |
| Appointment → Request | ✅ (Prompt 28, unchanged) |
| Appointment → Service History | ✅ (Prompt 28's display, now with a real pre-filled "add" action when COMPLETED — this prompt) |
| Client → Appointment | ✅ (Prompt 28, unchanged) |
| Vehicle → Appointment | ✅ (Prompt 28, unchanged) |
| Request → Appointment | ✅ (Prompt 27, unchanged) |
| Service History → Appointment | ❌ still not implemented — `ServiceRecordDto.appointmentId` is available but no list row surfaces it as a link yet (same gap Prompt 28 already flagged; still out of scope for a pure audit-first prompt) |

## 22. Validation

- **TypeScript** (`npx tsc --noEmit`): **PASS**
- **Build** (`npm run build`): **PASS** (890.76 kB main chunk, gzip
  194.64 kB — the pre-existing chunk-size warning, unrelated to this change)
- **Tests** (`npm test -- --run`): **1221/1221 passed**, 60 test files, unchanged

## 23. Git

- Commit hash: `70fe7bf`
- Commit message: `feat: improve service execution flow`
- Pushed to `origin/master` successfully, no force push

## 24. Limitations / Product Gaps

- **No WorkOrder / Job / ServiceOrder exists** — confirmed again this
  prompt; `Appointment.COMPLETED` and `ServiceRecord` remain two fully
  independent, manually-operated records with no enforced link.
- **No billing/payment workflow exists at all** — no Invoice, Payment,
  or payment-status field anywhere. If the business ever needs to bill a
  customer for a completed service, that is a real, undeveloped product
  gap, not something inferable from current data.
- **No technician/employee assignment workflow exists** — nobody is
  recorded as having performed the work.
- **No parts/inventory system exists** — `partsDescription` is free text
  only; there is no per-part cost, quantity, or stock tracking.
- **No automatic ServiceRecord creation after COMPLETED** — by design,
  per this prompt's own explicit prohibition; the new pre-fill link is a
  UX convenience, not an automation.
- **`ServiceRecord` rows still don't surface their own `appointmentId`
  link** in any list (Service History page, Client Detail) — the data
  is available; wiring the display remains a small, real, undone
  follow-up (already flagged in Prompt 28's Final Report, confirmed
  still true here).

## 25. Screenshot

No screenshot validation performed.
