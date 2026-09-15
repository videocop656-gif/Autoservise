# Prompt 35 — Appointment List & Date Navigation UX

> Verbatim — reproduced exactly as provided in the development
> conversation for this project (not reconstructed, not paraphrased).

---

# Prompt 35 — Appointment List & Date Navigation UX

## ROLE

You are continuing development of the existing **Autoservise** application.

This is NOT the «Отпечаток стиля» project.

Work strictly inside the existing Autoservise codebase.

The goal of this prompt is to improve the **Appointments / «Записи» list experience** for an actual auto-service operator.

Do not redesign unrelated parts of the application.

---

# CURRENT VERIFIED STATE

The application already has a working Appointment workflow.

Verified manually:

**Запланирована → Подтверждена → Выполняется → Завершена**

and alternative outcomes:

**Отмена / Клиент не пришел**

Service completion also works:

**Завершена → Результат обслуживания зафиксирован**

Prompt 33 implemented Service Completion Visibility.

Prompt 34 audited Appointment Creation and found that creation was already implemented correctly. The actual problem was that the **«Новая запись»** button was silently disabled when the tenant had no customers or services.

Prompt 34 added an explanatory notice and links to the existing Clients and Services screens.

Current validated state:

* TypeScript: PASS
* Build: PASS
* Tests: 1236/1236
* Git: `master = origin/master = a885911`
* working tree: clean

Do NOT break this baseline.

---

# PRIMARY OBJECTIVE

Audit and improve the existing **Appointments list (`/appointments`)** so that an auto-service employee can efficiently understand and navigate scheduled work.

The focus is:

* date-oriented appointment visibility
* useful filtering/navigation
* clear status visibility
* opening appointment details
* today's/upcoming appointments where appropriate
* preserving the existing creation and status workflows

Do NOT redesign the entire application.

---

# STEP 1 — AUDIT FIRST

Before changing code, inspect the current implementation of:

* `/appointments`
* appointment list component(s)
* appointment API
* appointment service
* Prisma Appointment model
* status enum/constants
* existing query parameters
* existing pagination, if any
* existing date handling
* existing appointment detail navigation
* existing create/edit flows

Also inspect the history of previous appointment prompts if documentation exists.

In particular, verify the previously identified gaps:

* appointment search
* date-range UI
* useful today/upcoming visibility
* appointment filtering

Do not assume any of these are currently missing.

---

# STEP 2 — PRESERVE EXISTING DOMAIN

Do NOT change:

* Appointment Prisma model unless genuinely required
* appointment statuses
* ServiceRecord
* Service History
* `serviceCompletionState()`
* authentication
* tenant architecture
* existing appointment creation
* existing appointment status transitions

Existing statuses remain:

* `SCHEDULED` — Запланирована / Запланировано according to current UI
* `CONFIRMED` — Подтверждена
* `IN_PROGRESS` — Выполняется
* `COMPLETED` — Завершена
* `CANCELLED` — Отмена
* `NO_SHOW` — Клиент не пришел

Use the actual enum values from the codebase.

Do not rename enums.

---

# STEP 3 — DATE NAVIGATION

If the current appointment list does not provide a useful way to navigate appointments by date, implement a lightweight date-oriented filter.

Preferred UX:

* Сегодня
* Завтра
* Эта неделя
* Следующая неделя
* Произвольный период

Only implement options that fit naturally with the current UI.

If the existing list already provides equivalent functionality, do not duplicate it.

### Requirements

Date filtering must:

* use the existing appointment date/time field
* respect the existing timezone convention
* be server-side when the current API architecture supports it
* not load an unnecessarily huge dataset and filter everything in the browser
* preserve tenant isolation

Do not introduce a new date/time library unless absolutely necessary.

---

# STEP 4 — TODAY / UPCOMING

The operator should be able to quickly answer:

> Какие записи у нас сегодня?

and:

> Какие записи ближайшие?

If the current screen already answers these questions clearly, preserve it.

Otherwise implement an appropriate default view or quick filter.

The UI should make the selected period obvious.

For example:

**Сегодня**

or

**14 сентября — 20 сентября**

Use Russian date formatting consistent with the application.

---

# STEP 5 — STATUS FILTER

Inspect whether the existing appointment list supports filtering by status.

If it does not and the addition is useful, add a compact status filter.

Possible options:

* Все
* Запланированы
* Подтверждены
* Выполняются
* Завершены
* Отменены
* Не пришли

Use the real enum values.

Do not create a second status system.

Filtering must happen through the existing data/API architecture where appropriate.

---

# STEP 6 — SEARCH

Audit whether appointment search already exists.

If absent, determine whether search is genuinely useful based on the existing list and data model.

If implementing search, it should search only meaningful existing appointment-related data, such as:

* customer name
* phone
* vehicle information
* service name

Only use fields that actually exist in the current model/API relations.

Do not invent a generic full-text search system.

Do not add search if the existing appointment list is already sufficiently navigable through date/status/client filters.

The final report must explicitly state whether search was implemented and why.

---

# STEP 7 — APPOINTMENT LIST ROW

Audit the current appointment row/card.

A useful row should allow the operator to understand the appointment without opening it.

Where existing data supports it, show:

* date/time
* customer
* vehicle
* service
* status

Do not overload the row with unnecessary information.

The row/card must remain clickable/openable using the existing appointment-detail mechanism.

Do not duplicate the entire appointment detail inside the list.

---

# STEP 8 — EMPTY STATES

Improve empty states where necessary.

Examples:

### No appointments for selected period

> Записей на этот период нет

If appropriate, provide:

> Новая запись

using the existing creation flow.

### No search results

> По вашему запросу записей не найдено

Do not show misleading generic errors when the dataset is simply empty.

---

# STEP 9 — LOADING AND ERROR STATES

Audit the current list behavior.

Ensure that:

* loading state is visible
* API failure is distinguishable from an empty list
* filters do not produce stale results
* changing filters does not cause inconsistent UI state

Reuse existing loading/error components and patterns.

Do not introduce a new global state manager.

---

# STEP 10 — URL STATE

If filters/date range/search are added, prefer preserving meaningful list state in the URL query string when this fits the existing routing architecture.

Examples:

* selected date
* date range
* status
* search query

This is especially useful because opening an appointment and returning to the list should not unnecessarily destroy the operator's current context.

However:

**Do not force a routing rewrite.**

Use the simplest implementation consistent with the current application.

---

# STEP 11 — PERFORMANCE

Do not implement a naive approach that fetches every appointment in the database and filters it entirely in the browser if the tenant could eventually have a large appointment history.

Prefer server-side filtering using existing API/service patterns.

Use indexed/queryable existing fields where appropriate.

Do NOT add database indexes unless the audit demonstrates they are actually required for the implemented query.

If an index is added, explain why in the final report.

---

# STEP 12 — TENANT ISOLATION

All appointment list queries must remain tenant-scoped.

A user must never see:

* another tenant's appointments
* another tenant's clients
* another tenant's vehicles
* another tenant's services

Do not accept a browser-supplied tenantId as an authorization mechanism.

Reuse existing tenant-scoped query/service helpers.

---

# STEP 13 — APPOINTMENT CREATION REGRESSION

The existing Prompt 34 behavior must remain intact.

Specifically:

When the tenant has no customers or services:

* «Новая запись» may remain disabled
* but the existing explanatory notice must remain visible after reference data loading:

> Чтобы создать запись, сначала добавьте клиента и услугу

with the existing links to:

* `/clients`
* `/settings/services`

When customers and services exist:

* «Новая запись» must remain functional
* existing form must open
* existing create API must work
* newly created appointment must receive `SCHEDULED`

Do not replace this implementation.

---

# STEP 14 — SERVICE COMPLETION REGRESSION

Do NOT change Prompt 33.

A planned appointment must not show Service Completion Visibility.

A completed appointment without ServiceRecord must still show:

> Результат обслуживания не зафиксирован

A completed appointment with ServiceRecord must still show:

> Результат обслуживания зафиксирован

Do not duplicate `serviceCompletionState()`.

---

# STEP 15 — MOBILE / RESPONSIVE

Audit the appointment list at narrower widths.

Do not redesign mobile navigation.

Ensure:

* filters remain usable
* appointment rows/cards do not overflow
* date controls remain understandable
* status remains readable
* opening appointment detail remains possible

Use existing responsive patterns.

---

# STEP 16 — TESTS

Add tests only for behavior actually changed.

At minimum, if corresponding functionality is implemented, cover:

1. date filtering returns only appointments in the requested period
2. today filter uses the correct local date/time convention
3. status filtering works
4. search works, if implemented
5. empty filtered result is handled correctly
6. appointment list remains tenant-isolated
7. existing appointment detail lookup still works
8. existing appointment creation still works
9. Prompt 33 ServiceRecord behavior remains intact

Do NOT duplicate existing tests unnecessarily.

If a requested scenario is already covered by the existing suite, document that in the final report instead of creating a duplicate test.

---

# STEP 17 — VALIDATION

Run:

* TypeScript
* production build
* full test suite

Current baseline:

**1236/1236**

Report:

* baseline test count
* new tests
* final test count
* TypeScript
* build

Do not declare completion with failing tests.

---

# STEP 18 — MANUAL UI CHECK

If possible, manually verify:

### A. Default list

Open:

`/appointments`

Confirm appointments are understandable at a glance.

### B. Today

Select today's period.

Confirm only today's relevant appointments are shown.

### C. Another period

Select another date/range.

Confirm the list updates correctly.

### D. Status

Filter by a status.

Confirm only matching appointments appear.

### E. Search

If implemented, search by an existing client/vehicle/service value.

### F. Open detail

Open an appointment.

Confirm the existing Appointment Detail still works.

### G. Return to list

Return to the appointment list.

Confirm list context behaves sensibly according to the implemented URL/state strategy.

### H. Existing test appointment

Use the existing test appointment where appropriate.

Do not create unnecessary duplicate test data.

---

# DO NOT DO

Do NOT:

* add AI
* add LLM/OpenAI
* add Telegram
* add WhatsApp
* add CRM integrations
* add payments
* add SMS
* add voice AI
* create WorkOrder
* create a new ServiceRecord model
* change ServiceRecord architecture
* change authentication
* change tenant architecture
* redesign Dashboard
* redesign Clients
* redesign Requests
* redesign Conversations
* redesign the entire Appointments Detail screen
* rename appointment statuses
* replace the existing appointment creation form
* create duplicate appointment APIs
* create duplicate business logic
* introduce unnecessary dependencies
* modify `serviceCompletionState()`
* automatically create ServiceRecords
* automatically change appointment statuses

This prompt is specifically about:

**making the existing Appointment list easier to navigate by date/status and more useful for daily operations.**

If the audit shows that one of these capabilities already exists, preserve it instead of rebuilding it.

---

# FINAL REPORT

After implementation provide:

## Final Report — Prompt 35: Appointment List & Date Navigation UX

### Validation

* TypeScript:
* Build:
* Tests:
* Baseline:
* New tests:
* Final total:

### Audit Findings

Explain what the existing `/appointments` implementation already had.

Explicitly state whether these existed before the prompt:

* date filtering:
* today view:
* upcoming view:
* status filtering:
* search:
* URL state:
* empty states:

### Implemented

List only actual changes.

### Date Navigation

Describe the implemented date controls and their behavior.

### Status Filtering

Describe whether it was already present or added.

### Search

State:

* implemented / not implemented
* reason

### API / Prisma

* Existing API reused:
* New API created:
* Prisma schema changed:
* Migration required:
* New indexes:

### Security

Confirm:

* authentication
* tenant isolation
* server-side filtering
* relation ownership validation

### Regression

Confirm:

* Prompt 34 appointment creation still works
* `SCHEDULED` remains the initial status
* Prompt 33 remains intact
* ServiceRecord workflow remains intact

### Tests

List only newly added tests and identify important existing tests that were reused rather than duplicated.

### Manual Validation

State what was manually verified and what could not be verified.

### Git

Provide:

* commit hash
* commit message
* push status

Do NOT push to GitHub unless explicitly instructed.

STOP after the final report.
