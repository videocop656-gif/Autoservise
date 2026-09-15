## Final Report — Prompt 41: Operational Lifecycle Integrity Audit

### 1. Audit Result

**Outcome C** — one real, confirmed business-logic gap found and fixed (ServiceRecord could be linked to a CANCELLED/NO_SHOW appointment). Every other explicit question in this prompt's own checklist was investigated and confirmed either already correctly blocked or already deliberately/documentedly allowed — no other code changes were needed.

### 2. CustomerRequest Audit

Re-confirmed against the live source (not assumed from memory of Prompt 37):

- Prisma model: `CustomerRequest` — `customerId` (required FK), `vehicleId`/`serviceId` (optional FKs), `appointmentId` (optional FK — the one and only relation to Appointment), `status: CustomerRequestStatus`.
- API: `api/customer-requests/index.ts` (list/create), `api/customer-requests/[id].ts` (get/update) — unchanged.
- Request Detail (`RequestDetailPanel.tsx`): shows the linked appointment (via `GET /api/appointments/:id`) or an inline "Создать запись" mini-form when none exists yet (Prompt 31); links to `/appointments?open=<id>`.
- Status transitions: `ALLOWED_TRANSITIONS` in `customerRequestService.ts` — `NEW → IN_PROGRESS → {WAITING_CUSTOMER, QUALIFIED} → CONVERTED`, with `CLOSED`/`CANCELLED` reachable from most non-terminal states. `CONVERTED` requires `appointmentId` already set (`assertValidTransition` + the explicit check in `updateCustomerRequest`) — unchanged.
- Active statuses (for queue purposes): `NEW`, `IN_PROGRESS`, `WAITING_CUSTOMER`, `QUALIFIED` — `CONVERTED`/`CLOSED`/`CANCELLED` are the real terminal ones (`NEXT_STATUSES[status].length === 0`), unchanged since Prompt 27.
- **Request → Appointment**: uses `CustomerRequest.appointmentId` exclusively — confirmed no alternative relation exists or was added.
- **Appointment → originating Request**: uses the reverse query `GET /api/customer-requests?appointmentId=` (tenant-scoped via `withTenant`) — confirmed, unchanged since Prompt 28, re-verified working end to end in Prompt 37.

No changes needed here — re-confirms Prompt 37's own Outcome A for this exact pairing.

### 3. Appointment Lifecycle Audit

`appointmentService.ts`'s `ALLOWED_TRANSITIONS` (unchanged, re-read): `SCHEDULED → {CONFIRMED, IN_PROGRESS, CANCELLED, NO_SHOW}`, `CONFIRMED → {IN_PROGRESS, CANCELLED, NO_SHOW}`, `IN_PROGRESS → {COMPLETED, CANCELLED}`; `COMPLETED`/`CANCELLED`/`NO_SHOW` are real terminal states (`TERMINAL_STATUSES`, no outgoing transitions). `assertValidTransition` is the sole server-side gate — an impossible transition (e.g. `SCHEDULED → COMPLETED` directly) is rejected with 400, confirmed by the existing, unmodified test suite (`tests/appointmentService.test.ts`'s own `it.each` rejection table).

**COMPLETED**: confirmed again by re-reading `appointmentService.ts` in full — completing an appointment is purely `status: 'COMPLETED'`; the function never touches `serviceRecordRepository` in any way. No ServiceRecord is ever auto-created. This is preserved, unchanged, and remains correct.

**Linked CustomerRequest on any Appointment status change**: `updateAppointment` never touches `CustomerRequest` at all — a request's own `appointmentId`/`status` are only ever changed by the request's own endpoint, confirmed unchanged.

No changes needed here.

### 4. ServiceRecord Audit

Re-read `serviceRecordService.ts` in full. Answers to the six explicit questions:

1. **Created for CANCELLED?** — Previously **yes** (no check existed). **Fixed this prompt**: now rejected with 400.
2. **Created for NO_SHOW?** — Previously **yes**. **Fixed this prompt**: now rejected with 400.
3. **Created before COMPLETED (i.e. SCHEDULED/CONFIRMED/IN_PROGRESS)?** — **Still yes, deliberately left allowed.** The existing UI never offers this path (`AppointmentDetailPanel`'s create-result link only appears once `serviceCompletionState()` is `'missing'`, which itself requires `status === 'COMPLETED'`), and this project has never imposed a stricter server-side ordering requirement than what a real, provable impossibility demands. CANCELLED/NO_SHOW are provable impossibilities (the visit never happened, full stop); "not yet finished" is not — an operator logging real, already-performed work partway through a longer visit is not an impossible or fabricated state the way a CANCELLED/NO_SHOW link would be.
4. **One Appointment, multiple ServiceRecords?** — **Yes, allowed**, confirmed as an already-existing, already-documented, already-tested deliberate choice (Prompt 33's own test explicitly pins this: "a second ServiceRecord for the same appointmentId is NOT rejected ... duplicate-safety is a UI concern"). Not changed.
5. **Cross-tenant ServiceRecord?** — **No, already blocked.** `assertRelationsOwnedAndActive`/`assertAppointmentConsistency` both call tenant-scoped `findById(ctx.tenant.id, ctx.business.id, id)` for every referenced entity; a foreign-tenant id returns 404 before any write happens. Not changed.
6. **ServiceRecord linking an Appointment to a mismatched vehicle/service?** — **No, already blocked.** `assertAppointmentConsistency`'s explicit `appointment.customerId/vehicleId/serviceId !== refs.*` checks (all three) reject any mismatch with 400. Not changed.

**The one real gap (questions 1 and 2)**: fixed inside `assertAppointmentConsistency` itself — the single existing helper both `createServiceRecord` and `updateServiceRecord` already call whenever `appointmentId` is being set — by adding `if (appointment.status === 'CANCELLED' || appointment.status === 'NO_SHOW') throw ...`. No new helper, no new validation layer, no schema change.

This was not a purely theoretical API gap: `ServiceHistorySettingsPage.tsx`'s own "Appointment (optional)" `<select>` listed every appointment matching customer/vehicle/service with **no status filter at all**, so an operator manually filling that form could already reach and select a CANCELLED/NO_SHOW appointment before this fix. Also fixed: that picker now excludes CANCELLED/NO_SHOW appointments (widening its own local `AppointmentDto` to read the `status` field the API already returned).

### 5. Service History Audit

Re-confirmed unchanged and consistent (Prompt 39's fixes intact): `/settings/service-history`, Client Detail, Vehicle Detail, and Appointment Detail all render `vehicle` (Client Detail only, since Vehicle/Appointment Detail are already scoped to one), `service`, `mileage`, `performedAt`, `totalPrice`+`currency`, `recommendations`, and the appointment link, sourced from the same `GET /api/service-history` endpoint(s) and the same `toServiceRecordDto`. All four are tenant-scoped via the same `withTenant`-wrapped repository calls; no cross-tenant/cross-client/cross-vehicle leakage path exists or was found. No new history endpoint was created or needed.

### 6. Retention / Repeat Service Audit

Confirmed the manual loop is already complete, using only existing capabilities:
- The recommendation is visible directly on Client Detail/Vehicle Detail/Appointment Detail's own history rows (Prompt 38/39) — the manager is already *on* the client/vehicle screen when reading it, so "navigate to client/vehicle" requires no extra action.
- A next `CustomerRequest` can already be created from Client Detail's own quick-create form (Prompt 23), correctly pre-filled with that same `customerId` — no risk of a mismatched customer.
- A next `Appointment` can already be created either directly (`/appointments`, Prompt 34) or from a `CustomerRequest`'s own "Создать запись" action (Prompt 31), both requiring an explicit customer/vehicle selection tied to the real relations, not an inferred or copied one.
- No automatic follow-up, reminder, or CRM action exists or was added — confirmed by grep, nothing in this codebase schedules or auto-creates anything from a `recommendations` value.

No changes needed here — this reconfirms Prompt 38's own conclusion.

### 7. Closed Lifecycle / Queue Audit

- **Operations** (`OperationsPage.tsx`): `splitAppointmentsByActivity`/`ACTIVE_APPOINTMENT_STATUSES` (Prompt 36) already excludes COMPLETED/CANCELLED/NO_SHOW from the active "Сегодняшние записи" rows — confirmed unchanged, re-read directly.
- **Dashboard**: the appointments KPI breakdown (`appointments.completed`/`.cancelled`/`.noShow`) is an explicit, labeled *breakdown by status*, not an "active work" claim — showing a completed/cancelled count there is correct, not a queue-contamination bug. The now-`startAt`-scoped query (Prompt 40) means these counts are also correctly period-bound by when the appointment happened, not when it was booked.
- **Requests/Appointments/Escalations list screens**: each already has (or, for Appointments, gained in Prompt 35) a status filter that defaults to showing non-terminal-biased or all-with-explicit-filter views; none was found to silently misrepresent a terminal record as pending. This ground was already covered by Prompts 24/25/35/36 and was not re-litigated field-by-field here beyond the Appointment/ServiceRecord axis this prompt centers on.

No changes needed here.

### 8. Cross-Screen Consistency

| Entity | Screen | Source | Status/date semantics | Tenant scope | Navigation |
|---|---|---|---|---|---|
| Request | `/requests` | `GET /api/customer-requests` | all statuses, filterable | `withTenant` | `?open=<id>` |
| Request | `/operations` | `GET /api/customer-requests?status=NEW\|IN_PROGRESS\|WAITING_CUSTOMER` | active statuses only | `withTenant` | `?open=<id>` |
| Appointment | `/appointments` | `GET /api/appointments?dateFrom=&dateTo=&status=` | `startAt`-scoped (Prompt 35), all statuses filterable | `withTenant` | `?open=<id>` |
| Appointment | `/operations` | same endpoint, `dateFrom`/`dateTo` = today | `startAt`-scoped, active statuses only for the row list (Prompt 36) | `withTenant` | `?open=<id>` |
| Appointment | `/dashboard` | `GET /api/dashboard` (KPI) + `GET /api/appointments?dateFrom=now` (upcoming list) | `startAt`-scoped as of Prompt 40 for both | `withTenant` | `?open=<id>` (Prompt 40) |
| ServiceRecord | Client Detail | `GET /api/service-history?customerId=` | `performedAt`, `createdAt` for the analytics-only revenue metric | `withTenant` | `?open=<id>` on the appointment link |
| ServiceRecord | Vehicle Detail | `GET /api/service-history?vehicleId=` | same | `withTenant` | same |
| ServiceRecord | Appointment Detail | same list, filtered client-side to this `appointmentId` | same | `withTenant` | n/a (already on the appointment) |
| ServiceRecord | `/settings/service-history` | `GET /api/service-history` (full list) | same | `withTenant` | `?open=<id>` on the appointment link |

No unresolved contradictions found beyond the one already fixed (Prompt 40's `startAt` alignment) and the one fixed in this prompt (CANCELLED/NO_SHOW linkage).

### 9. Security / Tenant Isolation

Re-verified by reading the actual code, not assumed:
- `ServiceRecord(appointmentId=A [tenant A], vehicleId=B [tenant B])`: **blocked** — `assertRelationsOwnedAndActive` resolves `vehicleId` via `vehicleRepository.findById(ctx.tenant.id, ...)`; a tenant-B vehicle is invisible to a tenant-A context and returns 404 regardless of what `appointmentId` was also supplied.
- `ServiceRecord(appointmentId=A, serviceId=B [tenant B])`: **blocked** — same mechanism via `serviceRepository.findById`.
- `Appointment(customerId=A [tenant A], vehicleId=B [tenant B])`: **blocked** — `appointmentService.ts`'s own `assertEntitiesActiveAndOwned` resolves both via tenant-scoped `findById`, plus the explicit `vehicle.customerId !== refs.customerId` check even for a same-tenant mismatch.

All three scenarios use the exact existing `withTenant`/`assertRelationsOwnedAndActive`/`assertAppointmentConsistency`/`assertEntitiesActiveAndOwned` helpers — no new authorization framework, no unscoped Prisma lookup, was introduced.

### 9b. Existing Data Audit

No new records were created for this audit. A real, complete lifecycle already exists in the dev database (tenant "Torque", first surfaced during Prompts 37–39's own audits and re-confirmed here): CustomerRequest "покраска крыши" (`status: IN_PROGRESS`, `appointmentId` set) → Appointment (`status: COMPLETED`) → ServiceRecord (`workDescription`, `recommendations: "приехать через год"`, `mileage: 3`, `totalPrice: 99999.97 RUB`) → visible in that vehicle's/client's service history. This chain was used as the basis for reasoning about the fix above; no data was created or mutated to produce it.

### 10. Implementation

- `src/server/services/serviceRecordService.ts` — `assertAppointmentConsistency` now additionally rejects a linked appointment whose `status` is `CANCELLED` or `NO_SHOW` (400 `VALIDATION_ERROR`). This single function is called by both `createServiceRecord` and `updateServiceRecord` (whenever `appointmentId` is being set), so both paths are covered by one change.
- `src/pages/settings/ServiceHistorySettingsPage.tsx` — widened the local `AppointmentDto` to declare `status: string` (already returned by `GET /api/appointments`, just not previously read here) and excluded `CANCELLED`/`NO_SHOW` from `matchingAppointments`, the list powering the create/edit form's "Appointment (optional)" picker.

No Prisma schema change. No new endpoint. No new relation — `CustomerRequest.appointmentId` and `Appointment.status` are both reused exactly as they already existed. `customerRequestService.ts` was deliberately left untouched: a `CustomerRequest` legitimately records "an appointment was created for this," which remains a true statement even if that appointment is later cancelled — a fundamentally different claim from a `ServiceRecord`'s "this work was actually performed."

### 11. Validation

TypeScript: **PASS**
Build: **PASS**
Tests: **1267/1267** passed (1260 baseline + 7 new, all in `tests/serviceRecordService.test.ts`: CANCELLED/NO_SHOW rejection at create time via `it.each`, SCHEDULED/CONFIRMED/IN_PROGRESS/COMPLETED still allowed via `it.each`, and CANCELLED rejection via the update path).

### 12. Manual Validation

Performed against the running dev server via Playwright: `/settings/service-history` loads without a crash or console/network error after this prompt's changes (only the expected pre-login 401 on `/api/auth/me`), confirming the widened `AppointmentDto` type and the new picker filter didn't break page rendering.

**Could not verify**: actually opening the "Appointment" picker with a real CANCELLED/NO_SHOW appointment present and confirming it's absent from the dropdown, or submitting a create attempt against the fixed backend and seeing the real 400 error rendered — the one tenant with real appointment/service-history data ("Torque") is the user's own login, which this session does not hold (the same limitation reported in Prompts 37, 38, 39, and 40). The backend behavior itself is verified by the 7 new automated tests above, which exercise the exact code path directly.

### 13. Regression

- Prompt 33 (`serviceCompletionState()`): **intact** — not touched; still governs when the "Добавить результат обслуживания" link appears, unaffected by this prompt's stricter linkage rule (that link only ever targets a COMPLETED appointment anyway).
- Prompt 34 (Appointment creation, `SCHEDULED`-only initial status): **intact** — not touched.
- Prompt 35 (`startAt` date navigation/URL state): **intact** — not touched.
- Prompt 36 (Operations active-appointment logic): **intact** — not touched.
- Prompt 37 (Request ↔ Appointment navigation): **intact** — re-confirmed by direct re-read, not touched.
- Prompt 38 (Recommendations visibility): **intact** — not touched.
- Prompt 39 (Service History context — vehicle/service/mileage/price): **intact** — not touched.
- Prompt 40 (Dashboard `startAt` appointment KPI, list-row navigation): **intact** — not touched.

### 14. Git

Branch: `master`
Commits:
- `5293588` — `fix: reject linking a ServiceRecord to a CANCELLED or NO_SHOW appointment`
- (this Final Report + verbatim prompt, committed separately as docs, per this project's established convention)

Push: **nothing pushed** — per this prompt's explicit instruction.
Working tree: clean immediately before the docs commit; `.mcp.json` and `marketing/` remain untouched throughout.

STOP.
