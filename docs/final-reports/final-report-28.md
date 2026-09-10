# Final Report — Prompt 28: Appointment Detail & Scheduling Audit v1

## 1. Audit Summary

Audited `Appointment` in `prisma/schema.prisma`, `appointmentService.ts`,
`appointment.schemas.ts`, `api/appointments/index.ts` and `[id].ts`, the
existing `/appointments` screen (`AppointmentsSettingsPage.tsx`), and
every related model (`Customer`, `Vehicle`, `Service`, `CustomerRequest`,
`ServiceRecord`, `Conversation`). No Technician/Employee/Staff-assignment
model, no Work Order, Job, or Schedule model exists anywhere in the
codebase.

## 2. Appointment Data Model

Real fields (unchanged since Prompt 05):

```
id, tenantId, businessId, customerId, vehicleId, serviceId,
startAt, endAt, status, notes, createdAt, updatedAt
```

`customerId`, `vehicleId`, `serviceId` are all **required** (not
optional) direct foreign keys — an Appointment cannot exist without all
three. Real `AppointmentStatus` enum: `SCHEDULED, CONFIRMED, IN_PROGRESS,
COMPLETED, CANCELLED, NO_SHOW`. No priority, SLA, deadline, or
health/diagnostic field of any kind exists.

## 3. Appointment Lifecycle

Real, enforced transition table — audited directly from
`appointmentService.ts`'s `ALLOWED_TRANSITIONS` constant and its
`assertValidTransition()` guard:

| Current | Available next statuses |
|---|---|
| SCHEDULED | CONFIRMED, IN_PROGRESS, CANCELLED, NO_SHOW |
| CONFIRMED | IN_PROGRESS, CANCELLED, NO_SHOW |
| IN_PROGRESS | COMPLETED, CANCELLED |
| COMPLETED | *(none — terminal)* |
| CANCELLED | *(none — terminal)* |
| NO_SHOW | *(none — terminal)* |

- **Cancellation**: a plain `PATCH {status: "CANCELLED"}` — no separate
  cancellation endpoint or workflow exists.
- **Rescheduling**: a plain `PATCH {startAt, endAt}` — re-validated
  against duration limits, business working hours, and per-vehicle
  conflict detection (the same checks `createAppointment` runs). Blocked
  entirely once the appointment is in a terminal status (a real, explicit
  guard added at some point in this codebase's history, confirmed still
  present: `"Cannot modify a {status} appointment's time or relations"`).
- **Completion**: `PATCH {status: "COMPLETED"}` — a real terminal state,
  but nothing else happens automatically. No `ServiceRecord` is created,
  no notification fires, no other entity changes.

## 4. Existing Appointment API

- `GET /api/appointments` — list, `page/pageSize/status/customerId/vehicleId/serviceId/dateFrom/dateTo/includeCancelled` (unchanged). **No search filter exists** — `appointmentRepository` has no search implementation at all.
- `POST /api/appointments` — create (owner/admin/manager, unchanged)
- `GET /api/appointments/:id` — single detail, bare appointment, no embedded relations (unchanged)
- `PATCH /api/appointments/:id` — update, including status/time/relations (owner/admin/manager, unchanged)
- **No DELETE** — by design, confirmed in `api/appointments/[id].ts`'s own comment: an appointment's lifecycle is status-only.

## 5. Current /appointments Screen

Before this prompt: a flat CRUD list (already the canonical top-level
route since Prompt 19 — "Записи" in the sidebar) with a status filter and
an "include cancelled" checkbox, but **no search, no date-range filter
UI** (despite the backend supporting `dateFrom`/`dateTo`), inline
quick-status-select and edit-pencil per row, and **no way to open a
specific appointment** as its own screen — confirmed the exact gap this
prompt's context section named.

## 6. Appointment Semantics

Based on the code: Appointment represents **a confirmed, scheduled slot
for a specific customer's specific vehicle to receive a specific
service** — not a bare time slot (customer/vehicle/service are all
required at creation), and not yet "work performed" (that's
`ServiceRecord`, a separate, optionally-linked historical record).

## 7. Request → Appointment Relationship

Confirmed real and already partially wired (Prompt 27): `CustomerRequest.appointmentId`
is a real, optional FK to `Appointment`, and `CustomerRequest.status = CONVERTED`
requires it to be set. The reverse direction — `GET /api/customer-requests?appointmentId=` —
is a real, existing filter (confirmed in `customerRequestService.ts`),
used in this prompt to show "which request(s) led to this appointment"
in Appointment Detail. `CONVERTED` does **not** auto-create an Appointment
— an admin must create it separately and link it via the existing Edit
form, exactly as Prompt 27 already documented.

## 8. Service History Relationship

`ServiceRecord.appointmentId` is a real, optional FK. However,
`GET /api/service-history` has **no `appointmentId` query filter** —
only `customerId`/`vehicleId`/`includeArchived`. Appointment Detail
works around this honestly: it fetches the vehicle's service history via
the real `vehicleId` filter (a single bulk request) and filters the
result client-side to records whose own `appointmentId` matches — not a
new backend capability, just using data already returned.

## 9. Product Decision

**A. Full Appointment Detail justified.** All required context (owner,
vehicle, service, linked request, service history) is available through
existing, real, direct relations and endpoints — no invented entity, no
missing capability blocked this.

## 10. Implementation

- `AppointmentsSettingsPage.tsx` rewritten: rows open the new Detail
  (full-screen swap) instead of exposing inline controls; create form
  unchanged, relocated to a PageHeader action; PageHeader subtitle
  translated to Russian for consistency with every other promoted screen.
- New `AppointmentDetailPanel.tsx`: header with a transition-aware status
  control (mirrors Prompt 27's `NEXT_STATUSES` pattern — only real valid
  transitions are ever offered), a one-click "Отменить" action, Edit
  (full existing field set, ported unchanged) — Customer/Vehicle/Service
  context — linked Request(s) — filtered Service History.
- `ClientDetailPanel.tsx` and `VehicleDetailPanel.tsx` each gained a
  small, **read-only** "Записи" section (real `customerId`/`vehicleId`
  filters) linking into the new Appointment Detail — closing the
  `Client → Appointment` / `Vehicle → Appointment` gaps identified in §12.
- Both `CustomersSettingsPage.tsx` and `VehiclesSettingsPage.tsx` gained
  a `timezone` prop (from `useAuth().business.timezone`, the same source
  every other timezone-aware screen already uses) passed down to their
  respective Detail panels, needed to format the new appointment
  date/times consistently with the rest of the app.

## 11. Files Changed

- `src/components/appointments/shared.ts` (new)
- `src/components/appointments/AppointmentDetailPanel.tsx` (new)
- `src/pages/settings/AppointmentsSettingsPage.tsx` (rewritten)
- `src/components/clients/ClientDetailPanel.tsx` (+Appointments section)
- `src/components/clients/shared.ts` (widened `ServiceRecordDto` with the
  already-real `appointmentId` field, needed for the vehicleId-filter +
  client-filter Service History lookup in Appointment Detail)
- `src/components/vehicles/VehicleDetailPanel.tsx` (+Appointments section)
- `src/pages/settings/CustomersSettingsPage.tsx` (+`timezone` prop)
- `src/pages/settings/VehiclesSettingsPage.tsx` (+`timezone` prop)

## 12. API Used

- `GET/POST/PATCH /api/appointments[/:id]` (unchanged since Prompt 05)
- `GET /api/customer-requests?appointmentId=` (existing filter)
- `GET /api/service-history?vehicleId=` (existing filter, client-filtered further by `appointmentId`)
- `GET /api/appointments?customerId=` / `?vehicleId=` (existing filters, used by the new Client/Vehicle Detail sections)
- `GET /api/customers`, `/api/vehicles`, `/api/services` (existing reference-data endpoints, already loaded by the parent list pages)

No new endpoint was created.

## 13. Backend / Prisma

```text
backend changes: NO
Prisma changes: NO
migrations: NO
```

## 14. N+1 Audit

- **List**: unchanged — one `GET /api/appointments` per page load plus
  the existing bulk reference-data fetch (customers/vehicles/services),
  not per-row.
- **Detail**: 2 requests run in parallel via `Promise.allSettled`
  (`GET /api/appointments/:id`, `GET /api/customer-requests?appointmentId=`
  — the latter needs only the id already known from props, not the
  fetched appointment), then one dependent follow-up
  (`GET /api/service-history?vehicleId=`, which genuinely needs the
  appointment's `vehicleId`, only known once the first fetch resolves).
  Total: 3 requests for one opened appointment, never inside `.map()`.
- **Reference data** (Client/Vehicle Detail's new Appointments sections):
  one additional bulk request each (`?customerId=`/`?vehicleId=`),
  added to each panel's existing `Promise.allSettled` group — not a new
  per-row cost on any list.

## 15. Cross-navigation

| Source → Target | Status |
|---|---|
| Appointment → Client | ✅ implemented |
| Appointment → Vehicle | ✅ implemented |
| Appointment → Request | ✅ implemented (via the real reverse `appointmentId` filter) |
| Appointment → Conversation | ❌ not implemented — no relation exists (Appointment has no conversationId/requestId-mediated cheap path; Conversation has no appointmentId at all) |
| Appointment → Service History | ✅ implemented (vehicleId-filtered + client-side matched) |
| Client → Appointment | ✅ implemented (this prompt) |
| Vehicle → Appointment | ✅ implemented (this prompt) |
| Request → Appointment | ✅ already implemented (Prompt 27's "Запись" section) |
| Conversation → Appointment | ❌ not implemented — same missing relation as above |
| Service History → Appointment | ❌ not implemented — `ServiceRecordDto` now carries `appointmentId`, but neither the standalone `/settings/service-history` page nor Client Detail's Service History rows link it yet (out of this prompt's file scope; flagged as a small future enhancement, not silently skipped) |

## 16. Validation

- **TypeScript** (`npx tsc --noEmit`): **PASS**
- **Build** (`npm run build`): **PASS** (889.77 kB main chunk, gzip
  194.46 kB — the pre-existing chunk-size warning, unrelated to this change)
- **Tests** (`npm test -- --run`): **1221/1221 passed**, 60 test files, unchanged

## 17. Git

- Commit hash: `c95ddee`
- Commit message: `feat: appointment detail v1`
- Pushed to `origin/master` successfully, no force push

## 18. Limitations / Product Gaps

- **`GET /api/service-history` has no `appointmentId` filter.** Worked
  around honestly (vehicleId fetch + client-side match), not treated as
  a reason to invent a new backend capability.
- **No Conversation ↔ Appointment link exists or was built** — no
  relation exists in either direction; a real product gap if a future
  prompt wants "see the conversation that led to this appointment"
  (it would have to go through the linked Request, which is itself
  optional).
- **Service History rows don't yet surface their own `appointmentId`
  link** in the UI (Client Detail, standalone Service History page) —
  the data is now available (`ServiceRecordDto.appointmentId`), wiring
  the display was left out of this prompt's scope.
- **No date-range filter UI on `/appointments`** despite the backend
  supporting `dateFrom`/`dateTo` — the existing list behavior (status +
  includeCancelled only) was preserved unchanged, consistent with "не
  переписывай экран целиком без необходимости."
- **No downstream-of-COMPLETED workflow** — confirmed again in this
  audit: completing an appointment does not create a `ServiceRecord`
  automatically; that remains a fully separate, manual, optional record.
  Same gap already documented in Prompt 27's Final Report, now confirmed
  from the Appointment side too.
- **Appointment creation/editing still requires a customer with at least
  one vehicle** (unchanged pre-existing constraint, not something this
  prompt touched).

## 19. Screenshot

No screenshot validation performed.
