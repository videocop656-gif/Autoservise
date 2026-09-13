## Final Report — Prompt 34: Appointment Creation

### Validation

* TypeScript: PASS
* Build: PASS
* Tests: 1236/1236 passed
* Baseline: 1233
* New tests: 3
* Final total: 1236

### Implemented

1. Audited the full existing appointment-creation path (Prisma model, service, API route, schema, list page, Detail panel) before writing anything — found it **already complete and already functional**: the "Новая запись" button already opens a real form, already submits to the existing `POST /api/appointments`, already enforces the correct initial status server-side, and already enforces tenant isolation. No second form, endpoint, or service was created.
2. Identified the actual, concrete reason the button reads as "not functional": it is silently `disabled` whenever the current tenant has zero customers or zero services (an appointment requires both) — confirmed by querying the real dev database directly (both existing tenants currently have 0 customers/0 vehicles/0 services/0 appointments), with **no on-screen explanation** for why the button was greyed out.
3. Fixed that: `AppointmentsSettingsPage.tsx` now shows a short notice under the page header — "Чтобы создать запись, сначала добавьте клиента и услугу" (or just the one that's actually missing) — with links to the existing `/clients` and `/settings/services` screens. Shown only once the reference-data fetch has actually resolved (a new `referenceLoaded` flag), so it never flashes before the real customer/service counts are known.
4. Added 3 regression tests closing the small, genuinely-missing gaps found during the audit (service-layer assertion that a created appointment's status is `SCHEDULED`; a `getAppointment` success-path test) — every other requested test scenario was already covered by the existing suite (see Tests section).

### Appointment Creation

* **Form**: already existed (`AppointmentsSettingsPage.tsx`'s inline create `Card`, toggled by `showForm`) — title "Новая запись", fields Клиент / Автомобиль / Услуга / Дата / Начало / Окончание / Заметки, actions "Сохранить" / "Отмена". Unchanged by this prompt.
* **Required fields**: Клиент, Автомобиль, Услуга, Дата, Начало, Окончание are all HTML `required` client-side and `z.string().uuid()`/`isoDateTime`-validated server-side (`createAppointmentSchema`); Заметки is optional. No field was added, removed, or invented.
* **Client selection**: a `<select>` over the existing customer reference list (`GET /api/customers?pageSize=100&includeInactive=true`, fetched once). No duplicate client-creation UI was introduced — creating a client remains the existing `/clients` workflow.
* **Vehicle selection**: a `<select>` filtered client-side to `customerVehicles = vehicles.filter(v => v.customerId === form.customerId)`; changing the client resets `vehicleId` to `''` (`onChange={(e) => setForm({ ...form, customerId: e.target.value, vehicleId: '' })}`), so an invalid vehicle can never be left selected after switching clients. Server-side, `assertEntitiesActiveAndOwned` independently re-verifies `vehicle.customerId === refs.customerId`, rejecting any browser-supplied mismatch with 400 regardless of what the UI allowed.
* **Date/time**: unchanged existing representation — local date + start/end time inputs converted via the existing `zonedTimeToUtc(date, time, timezone)` helper into UTC `startAt`/`endAt` before the request is sent; the server independently re-validates duration (15 min – 24 h), working hours, and same-local-day, all pre-existing checks. No new timezone system.
* **Initial status**: enforced server-side, not chosen by the browser. `createAppointmentSchema` restricts the optional `status` field to `CREATABLE_STATUSES = ['SCHEDULED']` — any other value is a 400 before the request ever reaches the service layer — and `createAppointment()` itself falls back to `status: input.status ?? 'SCHEDULED'`. The create form never sends a `status` field at all, so every appointment created through it starts `SCHEDULED` ("Запланировано").
* **Post-create behavior**: unchanged — `closeForm()` then `await loadAppointments()`; no full page reload, no navigation away from `/appointments`. The new appointment appears in the list immediately with its real status badge; opening it uses the existing `?open=<id>` / inline-panel Detail pattern.

### API / Prisma

* Existing API reused: **yes** (`POST /api/appointments`, unchanged since Prompt 05)
* New API created: **no**
* Prisma schema changed: **no**
* Migration required: **no**

### Security

* **Authentication**: unchanged — `requireAuth` resolves `ctx` server-side from the session cookie; nothing here bypasses it.
* **Tenant isolation**: unchanged and re-confirmed by audit — `assertEntitiesActiveAndOwned` looks up customer/vehicle/service via `customerRepository.findById(ctx.tenant.id, ctx.business.id, id)` etc.; a foreign-tenant id is a 404, never a leak. `tenantId`/`businessId` are taken from `ctx`, never trusted from the request body.
* **Server-side relation validation**: unchanged — active-state and existence checks run for all three relations on every create.
* **Client/vehicle consistency validation**: unchanged — `vehicle.customerId !== refs.customerId` is rejected with 400 server-side regardless of what the form's own filtering already prevented client-side.
* **Initial status enforced server-side**: confirmed by direct audit of `appointment.schemas.ts` (`CREATABLE_STATUSES = ['SCHEDULED']`) and `appointmentService.ts` (`status: input.status ?? 'SCHEDULED'`) — the browser cannot create an appointment in any status other than `SCHEDULED`. This was already true before this prompt; it is now additionally pinned by a new service-layer test (see below).

### Prompt 33 Regression

* `serviceCompletionState()` — **untouched**, not modified or removed.
* Existing `ServiceRecord` creation mechanism (`POST /api/service-history`, `createServiceRecord`, its validation) — **untouched**.
* Completed-appointment → ServiceRecord-visibility behavior — **untouched**; `tests/appointmentServiceCompletionState.test.ts` (8 tests) and `tests/serviceRecordService.test.ts` both pass unchanged in the full run.
* No automatic `ServiceRecord` is created anywhere in this prompt's changes — `createAppointment()` still never touches `serviceRecordRepository` (confirmed again by re-reading the file).
* A newly created `SCHEDULED` appointment correctly shows neither the "не зафиксирован" warning nor the "зафиксирован" success badge in its Detail view — `serviceCompletionState('SCHEDULED', 0, false)` returns `'not-applicable'`, exactly the pre-existing, unmodified logic from Prompt 33 (verified by reading the classifier; no duplicate logic was written for this).

### Naming discrepancy noted (spec §"CURRENT STATE"/§11)

This prompt's own text described the statuses as `PLANNED / CONFIRMED / IN_PROGRESS / COMPLETED / CANCELLED / NO_SHOW`. The real, audited `AppointmentStatus` enum in `prisma/schema.prisma` is `SCHEDULED / CONFIRMED / IN_PROGRESS / COMPLETED / CANCELLED / NO_SHOW` — the UI label "Запланировано" the prompt asked for is already the exact label mapped to `SCHEDULED` (`APPOINTMENT_STATUS_LABELS.SCHEDULED = 'Запланировано'`), unchanged since Prompt 19/24. No enum value was renamed, added, or removed — per the prompt's own instruction ("Do not assume field names. Use the actual schema."), the real `SCHEDULED` value was used throughout.

### Tests

New (3):
1. `tests/appointmentService.test.ts` — `getAppointment`: "returns the appointment when it exists in-tenant (a freshly created one can be opened afterward)" — §14 Test 7.
2. `tests/appointmentService.test.ts` — `createAppointment — initial status (Prompt 34)`: "defaults to SCHEDULED when status is omitted from input" — §14 Test 2.
3. `tests/appointmentService.test.ts` — `createAppointment — initial status (Prompt 34)`: "accepts an explicitly provided SCHEDULED status" — reinforces §14 Test 2/§7.

Already covered by the pre-existing suite (confirmed by direct audit, not duplicated):
- Test 1 (valid creation succeeds) — multiple existing `createAppointment` working-hours/conflict tests already assert a successful create.
- Test 3 (missing required field rejected) — `tests/appointment.schemas.test.ts` (customer/vehicle/service/startAt/endAt all tested missing).
- Test 4 (invalid client/vehicle relationship rejected) — "returns 400 when the vehicle belongs to a different customer in the same tenant".
- Test 5 (cross-tenant client rejected) — "returns 404 when the customer belongs to another tenant / does not exist".
- Test 6 (cross-tenant vehicle rejected) — "returns 404 when the vehicle belongs to another tenant / does not exist".
- Test 8 (existing status functionality intact) — the entire `updateAppointment`/transition-guard describe blocks pass unchanged.
- Test 9 (ServiceRecord/Prompt 33 intact) — `tests/serviceRecordService.test.ts` + `tests/appointmentServiceCompletionState.test.ts` pass unchanged.
- Test 10 (tenant isolation remains green) — the full 1236/1236 run, including every tenant-isolation-labeled test across all suites, passes.

### Git

Commit: `74da184`
Message: `fix: explain why "Новая запись" is disabled when no clients/services exist`

Not pushed, per this prompt's own instruction ("Do NOT push to GitHub unless the existing workflow explicitly requires it").

STOP.
