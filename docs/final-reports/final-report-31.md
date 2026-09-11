## Final Report — Prompt 31: Operational Flow UX Hardening

### Validation

TypeScript: PASS
Build: PASS
Tests: 1224/1224 passed (1221 pre-existing + 3 new)

### Audit (spec §1) — what already existed before this prompt

Read first, per spec §1, before writing any code:

- `/conversations` (`ConversationsSettingsPage.tsx`) + `ConversationDetailPanel.tsx`
- `/requests` (`CustomerRequestsSettingsPage.tsx`) + `RequestDetailPanel.tsx`
- `/appointments` (`AppointmentsSettingsPage.tsx`) + `AppointmentDetailPanel.tsx`
- `api/appointments/index.ts` + `[id].ts`, `src/server/services/appointmentService.ts`, `appointmentRepository.ts`
- `src/server/services/customerRequestService.ts` (its `ALLOWED_TRANSITIONS` table and `assertRelations`)
- `src/server/services/conversationService.ts` / `conversationRepository.ts`
- `prisma/schema.prisma` — `Conversation.customerRequestId` (optional FK to `CustomerRequest`), `CustomerRequest.appointmentId` (optional FK to `Appointment`), `Appointment.customerRequests` (reverse relation)
- `tests/customerRequestService.test.ts`, `tests/appointmentService.test.ts`, `tests/conversationService.test.ts`

Findings:

- **Conversation ↔ Request**: the real relation (`Conversation.customerRequestId`) was already fully wired into the UI — `ConversationDetailPanel`'s "Заявка" section already links to `/requests?open=<id>` with the request's real status, and shows "Заявка не связана" when none exists (built in Prompt 22). **No change needed.**
- **Request ↔ Conversation**: `RequestDetailPanel`'s "Обращение" section already fetches `GET /api/conversations?customerRequestId=` and links each result to `/conversations?open=<id>` (built in Prompt 24). **No change needed.**
- **Appointment context**: `AppointmentDetailPanel` already shows Customer, Vehicle, Service, and the linked Request (via `GET /api/customer-requests?appointmentId=`, linking to `/requests?open=<id>`) — built in Prompt 28. **No change needed.**
- **Request → Appointment**: this was the real, confirmed gap. `RequestDetailPanel` already displayed an existing linked appointment, but when a request had none, it only showed static guidance text telling the operator to go edit the request and pick an *already-existing* appointment from a dropdown — there was no way to create one from Request Detail itself. This is the gap this prompt closes.
- A smaller, real bug found during the same audit: the existing "already has an appointment" card linked to the bare `/appointments` list, not `/appointments?open=<id>` — every other Detail-to-Detail link in the app deep-links. Fixed alongside the main change (in scope of hardening this exact relationship).

### Implemented

- `RequestDetailPanel.tsx`'s "Запись" section: when a request has no `appointmentId` and is not in a terminal state (`NEW`/`IN_PROGRESS`/`WAITING_CUSTOMER`/`QUALIFIED`), a **"Создать запись"** button now expands an inline quick-create mini-form (vehicle, service, date, start/end time, notes) — the same architecture as Client Detail's existing vehicle/request quick-create forms (Prompt 23), not a new component or route.
  - The form is pre-filled with the request's own `vehicleId`/`serviceId` when already set; the customer is fixed to the request's own customer (matches `appointmentService.ts`'s own validation that a vehicle must belong to the appointment's customer).
  - Submitting calls the existing `POST /api/appointments`, then the existing `PATCH /api/customer-requests/:id { appointmentId }` to link it. No new endpoints.
  - The section always shows the section header once the request is non-terminal or already linked, so a request is never silently left looking "unaware" of appointments — it either shows the create action or the existing appointment.
- Fixed the existing-appointment link to deep-link via `/appointments?open=<id>` instead of the bare `/appointments` list (the same `?open=` cross-navigation convention already used everywhere else — Prompts 23/24/26/28).
- The "Запись" section's visibility condition was broadened from "has appointment OR status===QUALIFIED" to "has appointment OR not terminal" — so the create action is reachable through the request's whole active lifecycle (NEW/IN_PROGRESS/WAITING_CUSTOMER too), not only while QUALIFIED, while still never offering to create an appointment for a CLOSED/CANCELLED request that has none.

### Conversation ↔ Request

Unchanged — audited and confirmed already correct (see Audit above). Conversation Detail's "Заявка" section still links to the real linked request when one exists, and shows a neutral "Заявка не связана" state otherwise. No auto-creation of a Request from a Conversation was added or considered — none was requested.

### Request ↔ Appointment

- **No appointment yet** (and non-terminal status): "Создать запись" button → inline mini-form → creates the Appointment via the existing endpoint → links it to the request via the existing PATCH endpoint → UI immediately shows the new appointment card. On a create failure, the form's own error area shows the real server message (no fake success, no local state pretending the link exists). On a create-success-but-link-failure (rare, e.g. a race), the error is shown distinctly ("Запись создана, но не удалось связать её с заявкой: …") and the request state is reloaded from the server rather than assumed.
- **Already has an appointment**: the create action is fully replaced by the existing appointment summary card, deep-linking to `/appointments?open=<id>`. Reopening Request Detail after a successful create shows this card, never the create form again — there is no path in this UI to create a second appointment for the same request.
- **Status automation**: audited `customerRequestService.ts` directly — setting `appointmentId` (via PATCH, with or without a status change) never auto-transitions the request's status. This was **not changed**; no automation was invented. The request's own status control still offers `CONVERTED` as an explicit next step once `appointmentId` is set (existing behavior from Prompt 27), and the operator makes that transition as a separate, deliberate action — exactly as before.

### Tenant Isolation

No server-side code was changed. The new UI action is two calls to already-existing, already-tenant-scoped endpoints:

- `POST /api/appointments` → `createAppointment` → `assertRelations` → tenant-scoped `customerRepository`/`vehicleRepository`/`serviceRepository` lookups (unchanged).
- `PATCH /api/customer-requests/:id { appointmentId }` → `updateCustomerRequest`, where `input.appointmentId !== undefined` already sets `relationsChanged = true` (audited directly in the source), which runs `assertRelations` — including a tenant-scoped `appointmentRepository.findById(ctx.tenant.id, ctx.business.id, appointmentId)` — before saving. A foreign-tenant or non-existent `appointmentId` was already rejected with 404 before this prompt; a cross-customer appointment was already rejected with 400.

Because this is exactly the call shape the new "Создать запись" flow now uses in production (a plain PATCH with `appointmentId` and no status change — previously only exercised indirectly through the "Редактировать" form), 3 regression tests were added to pin this specific path (see below), so a future refactor of `updateCustomerRequest` can't silently drop the tenant check for it.

### API / Prisma Changes

- **New endpoints**: none. Reused `POST /api/appointments` and `PATCH /api/customer-requests/:id`, both unchanged since Prompts 05/24.
- **Prisma models changed**: none. `Conversation.customerRequestId` and `CustomerRequest.appointmentId` already existed and were already sufficient for every relation this prompt needed.

### Tests Added

`tests/customerRequestService.test.ts` — new `describe('Prompt 31 — linking an appointment via a plain PATCH (no status change)')`:

- links a real, same-tenant appointment with no status change (confirms the plain-update path is used, not the status-history path)
- returns 404 when linking an appointment that belongs to another tenant / does not exist
- returns 400 when the appointment belongs to a different customer than the request

No frontend component-test framework exists in this project (the entire suite is backend service/schema-level `vitest`, confirmed by `package.json`/`tests/` — consistent with every prior Detail-panel prompt, none of which added React component tests either); the new UI's contract is what these 3 backend tests pin — it's the same convention already used for Prompts 22–30.

Scenario coverage against spec §13's list:
- A (create → linked) — covered by the new backend test above (the create+link call shape) plus manual code-path review of the frontend handler; the frontend calls the two endpoints in sequence and reloads on success.
- B (has appointment → no create action, existing one shown) — covered by the existing conditional rendering (`request.appointmentId ? … : …`), unchanged in shape, only the destination link fixed.
- C/D (Conversation↔Request cross-navigation) — pre-existing, unchanged; already covered by Prompts 22/24's own manual verification, no regression risk since no code changed there.
- E (tenant isolation) — covered by the new backend tests plus the pre-existing create-time tenant tests in the same file.
- F (double-submit) — the mini-form's submit button is `disabled={apptSaving}` and the handler early-returns if `apptSaving` is already true, preventing a second in-flight submit from the same form instance.

### Product Gaps Remaining

- No auto-transition to `CONVERTED` when an appointment is linked — this remains a manual, explicit second step (unchanged from Prompt 27; confirmed still true here, not invented around).
- URL/detail-open state still is not persisted in the address bar for any Detail screen (the systemic P1 documented in Prompt 30) — explicitly out of scope for this prompt per spec §7.
- No API-level idempotency guard against a genuine double-submit across two different tabs/devices (only the single-form in-memory guard implemented here) — explicitly out of scope per spec §10.

### Git

Commit: `8b75e9b`
Message: `feat: operational flow UX hardening (Prompt 31)`
Pushed: no

### Screenshot Validation

Not performed — TypeScript/build/test validation covered the change; no interactive screenshot pass was run against the new "Создать запись" flow this round.

STOP.
