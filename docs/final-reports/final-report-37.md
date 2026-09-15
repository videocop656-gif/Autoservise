## Final Report — Prompt 37: Request → Appointment Operational Flow Audit

### 1. Audit Result

Everything the prompt asked about already existed and was found coherent, tenant-safe, and working — no code was missing.

**Request Detail → Appointment** (`src/components/requests/RequestDetailPanel.tsx`, read in full):
1. Displays the current appointment when one is linked — `GET /api/appointments/:id` (fetched once, only for the opened request, not per-row), shown with its real date/time and status badge.
2. `CustomerRequestDto.appointmentId` is already present and populated from the real column.
3. A link to Appointment Detail already exists: `<Link to={`/appointments?open=${appointment.id}`}>` — the same `?open=` cross-navigation convention used everywhere else in this app.
4. The request can already create an appointment — an inline quick-create mini-form (built in Prompt 31), shown in place of the link whenever `request.appointmentId` is null and the request is still in a non-terminal status.
5. That flow is sufficient: it reuses the exact same `POST /api/appointments` endpoint and validation `AppointmentsSettingsPage.tsx`'s own "Новая запись" form uses — no second form, no second endpoint.
6. Appointment creation correctly attaches to the request — the mini-form's submit handler calls `POST /api/appointments` and then, on success, `PATCH /api/customer-requests/:id { appointmentId: <new id> }`, using the exact same PATCH the "Редактировать" form already used to set `appointmentId` manually.
7. The request's status/lifecycle is unaffected by appointment creation — confirmed again by reading `customerRequestService.ts`'s `updateCustomerRequest`: setting `appointmentId` (with or without an accompanying `status` field) never auto-transitions status. `CONVERTED` remains a separate, explicit action the operator makes afterward via the existing status control. This is unchanged since Prompt 27/31 and was re-verified, not assumed.

**Appointment Detail → Request** (`src/components/appointments/AppointmentDetailPanel.tsx`, read in full):
1. An Appointment has no direct FK to `CustomerRequest` (by design — see Data Model below) but the reverse lookup already exists and is used: `GET /api/customer-requests?appointmentId=<id>&pageSize=5`.
2. `CustomerRequest.appointmentId` is exactly what powers that lookup.
3. The originating request is displayed — subject + real status badge.
4. A navigation path back to Request Detail already exists: `<Link to={`/requests?open=${r.id}`}>` — reusing the same `?open=` convention.
5–6. Tenant-safe — see Security below.

### 2. Findings

**No real gaps found.** Request → Appointment → Request navigation is already complete, coherent, and was built and refined across Prompts 24/27/28/31 specifically to satisfy this exact continuity. This audit re-verified each piece against the current, live source (not against memory of earlier prompts) and found nothing to fix.

One pre-existing, already-documented limitation (unchanged, not newly discovered, and explicitly out of scope for this prompt per its own "unless absolutely necessary" instruction): a request can only ever link to *one* appointment via a single `appointmentId` column, so if an operator ever needs a second, independent appointment for the same request, there is no second slot — this was already the known shape of the relation and is not something Prompt 37 was asked to change.

### 3. Implementation

**No application code changes were necessary.** Nothing in `src/`, `api/`, `prisma/`, or `tests/` was modified.

### 4. Security

Re-verified by reading the actual query-building code, not assumed:

- `GET /api/customer-requests?appointmentId=` → `customerRequestRepository.list()` builds its `where` clause via `withTenant(tenantId, { businessId, ...(opts.appointmentId ? { appointmentId } : {}), ... })` (`src/server/repositories/customerRequestRepository.ts:32`). Because `tenantId`/`businessId` are always part of the same `where` object regardless of which optional filter is present, a foreign-tenant `CustomerRequest` row can never match this query no matter what `appointmentId` value is passed — Appointment Detail cannot expose another tenant's request.
- `GET /api/appointments/:id` → `appointmentRepository.findById(tenantId, businessId, id)` (`src/server/repositories/appointmentRepository.ts:46`) — tenant-scoped `findFirst`, confirmed unchanged.
- Appointment creation (`createAppointment` in `appointmentService.ts`) and the request-side link (`updateCustomerRequest`'s `assertRelations` → `appointmentRepository.findById(ctx.tenant.id, ctx.business.id, appointmentId)` in `customerRequestService.ts`) both already reject a foreign-tenant id with 404 and a cross-customer/cross-vehicle mismatch with 400 — confirmed by re-reading the functions directly (these are the same `assertEntitiesActiveAndOwned`/`assertRelations` helpers Prompts 27/31/34 already built and tested; not duplicated or altered here).
- No unscoped Prisma lookup exists anywhere in this path; no authorization shortcut was added (none was needed).
- Empirically confirmed with a direct, read-only database query during this audit: exactly one real `CustomerRequest` in the live dev database currently has a non-null `appointmentId` ("покраска крыши", tenant "Torque"), and it belongs to the same tenant as its linked `Appointment` — consistent with the isolation guarantee above.

### 5. Regression Check

Prompts 33–36 remain fully intact — none of their files were read for modification purposes beyond confirming they were untouched:
- Prompt 33 (`serviceCompletionState()`, ServiceRecord visibility): not touched.
- Prompt 34 (appointment creation, `SCHEDULED` initial status): not touched.
- Prompt 35 (`/appointments` date navigation): not touched.
- Prompt 36 (`/operations` today's-appointments queue): not touched.

### 6. Validation

- TypeScript: **PASS**
- Build: **PASS**
- Tests: **1260/1260** passed (the actual current result, run fresh for this audit — matches the expected baseline exactly, confirming no drift since Prompt 36)
- Manual validation: a live, real test case was located in the dev database via a direct read-only query (one `CustomerRequest` — "покраска крыши" — genuinely linked to a real `Appointment`, in the "Torque" tenant), confirming Outcome A isn't just a code-reading exercise but has a real, currently-existing example in this environment. However, that tenant's login belongs to the user (not the dev-seed account this session has credentials for), so an actual browser click-through of that specific pair was not performed by this session — doing so would require the user's own credentials, which this session does not have and should not attempt to guess or bypass. The code-level audit above (reading the exact tenant-scoped query-building code on both sides of the relation) stands as the verification; if you'd like a visual confirmation, opening `/requests`, finding "покраска крыши", and clicking through to its appointment and back would take under a minute with your own login.

### 7. Git

- Branch: `master`
- Commit(s): none — no application or documentation code changed in a way requiring a commit beyond this report itself, which is committed as a single docs-only commit (`docs: preserve prompt 37 verbatim and add final report 37 (audit only, no code changes)`) alongside `docs/prompts/prompt-37.md`, matching this project's own established documentation-preservation convention (e.g. Prompt 32).
- Push status: **nothing pushed** — per this prompt's explicit instruction.
- Working tree: clean immediately before this docs commit (confirmed via `git status`), with only the pre-existing, unrelated `.mcp.json` and `marketing/` untracked — both left untouched, as required.

STOP.
