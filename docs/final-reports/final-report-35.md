## Final Report — Prompt 35: Appointment List & Date Navigation UX

### Validation

* TypeScript: PASS
* Build: PASS
* Tests: 1255/1255 passed
* Baseline: 1236
* New tests: 19
* Final total: 1255

### Audit Findings

What `/appointments` already had, confirmed by reading the actual code before changing anything:

* **date filtering**: partially — `GET /api/appointments` already accepted `dateFrom`/`dateTo` server-side (`api/appointments/index.ts` → `listAppointments` → `appointmentRepository.list`'s `startAt: { gte: dateFrom, lt: dateTo }`, tenant-scoped, ordered `startAt: 'asc'`, already indexed via `@@index([tenantId, businessId, startAt])`), but **the frontend never sent them** — no date UI existed at all.
* **today view**: did not exist.
* **upcoming view**: did not exist as a distinct concept; the default (no date filter, ascending by `startAt`) technically puts the earliest appointment first, but that includes indefinitely-far-past `SCHEDULED` rows too — no way to jump to "today" or "this week."
* **status filtering**: already fully implemented (a `<select>` over the real `AppointmentStatus` enum, feeding `?status=`) — unchanged by this prompt.
* **search**: did not exist. `appointmentRepository` has no join-based lookup over customer/vehicle/service at all (confirmed again by reading the repository) — the Prompt 28 comment noting this was still accurate.
* **URL state**: only `?open=<id>` existed (consumed once on mount, then stripped) — no filter was ever persisted in the URL.
* **empty states**: a single generic "Записей пока нет", shown identically whether the tenant had zero appointments ever or the current filters simply matched nothing.

### Implemented

1. A quick date-preset row (**Все / Сегодня / Завтра / Эта неделя / Следующая неделя / Период**) wired to the existing `dateFrom`/`dateTo` query parameters — no new endpoint.
2. A short, live Russian period label next to the presets ("Сегодня, 15 сентября" / "14 сентября — 20 сентября" / "Все").
3. Two native date inputs, shown only for the "Период" preset, for a custom inclusive range.
4. `?range=&from=&to=&status=` persisted in the URL, reusing the exact `useSearchParams`/`setSearchParams` this page already used for `?open=`.
5. Fixed the `?open=` handler, which previously wiped the *entire* query string (`setSearchParams({})`) when consuming `open` — it now strips only that one key, so it can no longer silently erase a filter selection that happened to be in the URL at the same time.
6. A period/status-aware empty state: "Записей на этот период нет" when a filter is narrowing the results vs. the original "Записей пока нет" when the tenant genuinely has none yet — plus an inline "Новая запись" action reusing the exact existing creation flow, shown only when creation is actually possible (a customer and a service already exist — same gate as Prompt 34).
7. Page resets to 1 on any date/status filter change (extended the existing reset effect).

Nothing else on the page changed — the list row, pagination, loading skeleton, error-and-retry state, and the create form itself are all byte-for-byte what they were before this prompt.

### Date Navigation

Implemented as pure, framework-free calendar-date-string math in `src/components/appointments/shared.ts` (`addDaysToDateStr`, `appointmentDateRangeBounds`, `appointmentDateRangeLabel`), anchored on `utcToZonedParts(new Date(), timezone).dateStr` — the Business's own local "today," never the browser's. Weeks start Monday (matching `BusinessWorkingHours`' own Monday-first `DayOfWeek` convention). "Период" bypasses the preset math entirely and sends the two picked dates directly (end date treated as inclusive, converted to the API's exclusive `dateTo` via `addDaysToDateStr(customTo, 1)`). "Все" sends no date params at all — byte-identical to the pre-Prompt-35 request, so an operator who never touches this row sees no behavior change.

### Status Filtering

Already present before this prompt; not modified. Confirmed unchanged: same `<select>`, same real `AppointmentStatus` values, same `?status=` query param — now additionally persisted in the URL alongside the new date range.

### Search

**Not implemented.** `appointmentRepository` has no capability to filter by customer name, phone, vehicle info, or service name today — none of `Customer`/`Vehicle`/`Service` are joined in `appointmentRepository.list`'s query at all. Building that would mean either a new, nontrivial Prisma query (joining three relations with an `OR` across several text fields) or fetching the tenant's entire reference data and appointment set to filter client-side — both disproportionate to this prompt's scope and explicitly warned against ("do not invent a generic full-text search system," "do not add search if the existing list is already sufficiently navigable through date/status/client filters"). With the new date presets, a typical daily or weekly appointment list is small enough to scan visually; a customer's specific appointment history remains reachable today via Client Detail's own "История" section. Search is deferred, not built.

### API / Prisma

* Existing API reused: **yes** (`GET /api/appointments?dateFrom=&dateTo=`, unchanged since it was added — confirmed already present, not written by this prompt)
* New API created: **no**
* Prisma schema changed: **no**
* Migration required: **no**
* New indexes: **none** — `@@index([tenantId, businessId, startAt])` already exists and already covers this exact query shape (tenant/business scope + an `startAt` range); confirmed by reading `prisma/schema.prisma` before concluding no index work was needed.

### Security

* **Authentication**: unchanged.
* **Tenant isolation**: unchanged — `appointmentRepository.list`'s `where` clause is built via `withTenant(tenantId, {...})`, and the new `dateFrom`/`dateTo` values are just two more fields folded into that same already-scoped clause. No new query path was added that could bypass it.
* **Server-side filtering**: the date range is applied by the database query (`startAt: { gte, lt }`), not fetched-then-filtered in the browser — confirmed by reading the repository, not assumed.
* **Relation ownership validation**: unaffected — this prompt touches only the list query, never `createAppointment`/`updateAppointment`'s relation checks.

### Regression

* Prompt 34 appointment creation: **intact** — `openCreateForm`/`handleSubmit`/the create `<Card>` form are byte-for-byte unchanged; the disabled-button notice logic (`referenceLoaded && (customers.length === 0 || services.length === 0)`) is untouched, and now additionally reachable from the new period-aware empty state when creation is actually possible.
* `SCHEDULED` remains the initial status: **confirmed** — no backend code was touched (`appointmentService.ts`/`appointment.schemas.ts` untouched).
* Prompt 33 (`serviceCompletionState()`): **intact** — not imported, not modified, not duplicated by this prompt at all; `AppointmentDetailPanel.tsx` was not touched.
* ServiceRecord workflow: **intact** — `tests/serviceRecordService.test.ts` and `tests/appointmentServiceCompletionState.test.ts` both pass unchanged in the full run.

### Tests

New (19):
- `tests/appointmentDateRange.test.ts` (18 tests) — `addDaysToDateStr` (month/year rollover, subtraction), `appointmentDateRangeBounds` (all six presets, including the Monday-anchoring for `week`/`nextWeek` regardless of which weekday "today" falls on — spec §16 Tests 1/2), and `appointmentDateRangeLabel` (today/tomorrow/range/single-day-collapse formatting).
- `tests/appointmentService.test.ts` (+1) — `listAppointments` forwards `dateFrom`/`dateTo` to the repository unchanged. Note: the repository's own Prisma `where`-clause construction is not unit-tested anywhere in this project for any entity (no repository-level test file exists at all — repositories are always exercised through a service test with the repository mocked); this new test follows that exact, pre-existing convention rather than introducing a new one.

Already covered by the pre-existing suite, confirmed and not duplicated:
- §16 Test 3 (status filtering) — pre-existing, unchanged, still covered by whatever coverage it already had.
- §16 Test 6 (tenant isolation) — the full 1255/1255 run, including every existing tenant-isolation-labeled test, passes.
- §16 Test 7 (appointment detail lookup) — `AppointmentDetailPanel`/`getAppointment` untouched; Prompt 34's own new success-path test for `getAppointment` still passes.
- §16 Test 8 (appointment creation) — `createAppointment` tests (permissions, ownership, working hours, duration, conflict, initial-status) all pass unchanged.
- §16 Test 9 (ServiceRecord/Prompt 33) — see Regression above.
- §16 Test 4 (search) — not implemented; N/A.
- §16 Test 5 (empty filtered result) — this is a pure JSX conditional (period-aware empty-state text), consistent with this project's established convention of not building component-test infrastructure for UI-only rendering (Prompts 31/33/34's own precedent); verified instead by direct code review and by the manual Playwright check below, which specifically exercised the empty-state path.

### Manual Validation

Verified against the running dev server via Playwright (screenshots taken, not just DOM assertions):
- Default `/appointments` view renders the new preset row, all six buttons present, "Все" active by default (no behavior change from before this prompt).
- Clicking "Сегодня" activates it and updates the period label to "Сегодня, 15 сентября" (the environment's real current date), with no console/network errors.
- Clicking "Период" reveals two empty native date inputs and updates the URL to `?range=custom`, confirming URL persistence works.
- Waiting for the request to fully settle (rather than a short fixed delay) confirmed the true empty state — "Записей пока нет" — renders correctly once loading completes, with the Prompt 34 "Чтобы создать запись, сначала добавьте клиента и услугу" notice still shown above it (this tenant currently has 0 customers/0 services).

Not verified: the list rendering an actual populated appointment row for a given date/status combination, since no tenant with seeded appointment data was available in this session without creating test data outside the ritual's normal flow (creating that data was intentionally left to the user, consistent with earlier turns in this conversation). The row-rendering code itself (customer/vehicle/service name + status badge) is unchanged from Prompt 28 and was not touched by this prompt.

### Git

Commit: `5be0a57`
Message: `feat: add date navigation and preserve status filtering on Appointments list`
Push status: not pushed (per this prompt's own instruction — "Do NOT push to GitHub unless explicitly instructed").

STOP.
