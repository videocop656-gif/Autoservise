# Prompt 36 — Operations Daily Work Queue

> Verbatim — reproduced exactly as provided in the development
> conversation for this project (not reconstructed, not paraphrased).

---

# Prompt 36 — Operations Daily Work Queue

## ROLE

You are continuing development of the existing **Autoservise** application.

This is NOT the «Отпечаток стиля» project.

Work strictly inside the existing Autoservise codebase.

The goal of this prompt is to audit and, where necessary, improve the **Operations / «Операции»** screen as the daily working queue for an auto-service administrator.

Do not redesign unrelated parts of the application.

---

# CURRENT VERIFIED STATE

The application currently has a working operational flow:

**Client → Vehicle → Service → Appointment → Status → Completed → ServiceRecord → Service History**

Appointment statuses are already working:

* `SCHEDULED` — Запланирована
* `CONFIRMED` — Подтверждена
* `IN_PROGRESS` — Выполняется
* `COMPLETED` — Завершена
* `CANCELLED` — Отмена
* `NO_SHOW` — Клиент не пришел

Prompt 33:

* Service Completion Visibility
* `serviceCompletionState()`
* ServiceRecord visibility

Prompt 34:

* audited Appointment Creation
* existing creation flow confirmed
* explanatory empty-reference-data notice added

Prompt 35:

* Appointment list date navigation
* date presets
* custom date range
* status filtering
* URL persistence
* appointment-list empty states

Current validated baseline:

**1255/1255 tests**

Git:

* `master = origin/master`
* current HEAD: `92a41d2`
* working tree has no staged/modified files
* pre-existing untracked `.mcp.json` and `marketing/` must remain untouched

Do NOT break this baseline.

---

# PRIMARY OBJECTIVE

Audit the existing **`/operations`** screen.

Determine whether it already provides a useful daily operational view of:

* active escalations
* customer requests requiring attention
* follow-ups
* today's appointments / appointments requiring action

The goal is NOT to duplicate the `/appointments` page.

The goal is to answer:

> **Что администратору нужно сделать сегодня?**

The Operations screen should function as an **action queue**, while `/appointments` remains the detailed appointment-management screen.

---

# STEP 1 — AUDIT CURRENT OPERATIONS

Before changing code, inspect:

* `/operations`
* Operations page/components
* Operations API endpoints
* relevant services/repositories
* Prisma models involved
* current filters
* current status logic
* appointment queries
* customer request queries
* AI escalation queries
* follow-up queries
* existing navigation from Operations into detail screens

Do NOT assume anything is missing.

Document what already exists.

---

# STEP 2 — CURRENT OPERATIONAL ENTITIES

From previous project audits, Operations already includes or may include:

### AI Escalations

Active:

* `OPEN`
* `IN_PROGRESS`

### Customer Requests

Relevant:

* `NEW`

### Follow-ups

Relevant:

* `IN_PROGRESS`
* `WAITING_CUSTOMER`

### Appointments

Previous audit identified a possible gap around today's appointments.

Verify whether this has already been implemented since the earlier audit.

Do not duplicate an existing implementation.

---

# STEP 3 — DEFINE THE ROLE OF OPERATIONS

Keep the conceptual distinction clear:

## `/appointments`

Used for:

* appointment calendar/list
* date navigation
* status filtering
* creating appointments
* editing appointments
* appointment details

## `/operations`

Used for:

* things requiring attention
* today's operational workload
* unresolved customer requests
* escalations
* follow-ups
* appointments requiring action today

Do not turn Operations into a second copy of `/appointments`.

---

# STEP 4 — TODAY'S APPOINTMENTS

If Operations currently does NOT show today's appointments, add a compact section:

> Сегодняшние записи

The section should show only appointments relevant to today's operational work.

At minimum, where existing data supports it, show:

* time
* client
* vehicle
* service
* appointment status

Use the Business's existing local timezone.

Do NOT use the browser timezone if the application already has a Business timezone convention.

---

# STEP 5 — WHICH APPOINTMENTS BELONG IN OPERATIONS?

Do not blindly display every historical appointment.

Audit the existing appointment status model and determine appropriate operational statuses.

Likely operational appointments are:

* `SCHEDULED`
* `CONFIRMED`
* `IN_PROGRESS`

Completed/cancelled/no-show appointments generally should not dominate the active daily queue.

However:

**Use the actual business logic already present in the application.**

Do not invent a new status.

If completed appointments are useful as a small "today completed" summary, that can be shown separately, but do not mix them into the active queue.

---

# STEP 6 — TODAY'S DATE

The definition of "today" must use the existing Business timezone.

Reuse the same calendar/timezone helpers introduced or used by Prompt 35 where appropriate.

Do NOT duplicate date arithmetic logic if a reusable helper already exists.

Avoid introducing a second timezone implementation.

---

# STEP 7 — APPOINTMENT ACTIONS

Each appointment shown in Operations should have a clear way to open its existing Appointment Detail.

Do not create a second appointment-detail component.

Prefer the existing route/query convention.

If the current application uses:

`/appointments?open=...`

reuse it.

Do not invent a new route unless the existing routing cannot support the workflow.

---

# STEP 8 — OPERATIONS SECTIONS

Audit the existing layout.

If the current Operations page already has separate sections/cards for:

* Escalations
* Customer Requests
* Follow-ups

preserve them.

If today's appointments are added, keep the sections visually distinct.

Suggested conceptual ordering:

1. **Требуют внимания**
2. **Сегодняшние записи**
3. **Заявки**
4. **Follow-ups / Ожидания**

But do NOT blindly reorder the existing UI.

Use the existing information hierarchy unless the audit demonstrates that it is confusing.

---

# STEP 9 — EMPTY STATES

Each operational section must distinguish:

### No work

Example:

> Сегодня записей нет

from:

### Loading

and:

### API error

Do not show an error when the query simply returns zero records.

Do not make the page look broken when there is simply no work.

---

# STEP 10 — TODAY'S APPOINTMENT COUNTS

If useful and consistent with the existing UI, show a compact count such as:

> Сегодня — 3 записи

Do not add unnecessary dashboard-style KPIs.

The purpose is operational scanning, not analytics.

---

# STEP 11 — STATUS VISIBILITY

Appointments in Operations must retain their actual status.

Examples:

* Запланирована
* Подтверждена
* Выполняется

Use the existing status badges/styles.

Do not create a second appointment-status visual system.

---

# STEP 12 — NO DUPLICATE BUSINESS LOGIC

This is important.

Do NOT duplicate:

* appointment status transition logic
* tenant isolation
* ServiceRecord logic
* `serviceCompletionState()`
* appointment ownership checks

Reuse existing services/helpers.

Operations should primarily **query and present existing operational data**.

---

# STEP 13 — TENANT ISOLATION

All Operations queries must remain tenant-scoped.

A user must never see another tenant's:

* appointments
* customer requests
* escalations
* follow-ups
* customers
* vehicles

Do not accept tenantId from the browser as an authorization mechanism.

Reuse existing tenant-scoped repository/service patterns.

---

# STEP 14 — PERFORMANCE

Do not fetch the entire appointment history and filter it in the browser.

Today's appointments should be queried efficiently using the existing:

* tenant scope
* business scope
* startAt/date range

Prefer the already indexed appointment date query used by `/api/appointments`.

Do not introduce a new database index unless the audit proves it is necessary.

---

# STEP 15 — RELATION CONSISTENCY

When displaying an appointment:

* customer must correspond to the appointment
* vehicle must correspond to the appointment
* service must correspond to the appointment

Do not make additional client-side assumptions about relationships.

Use existing server-side relation validation and scoped queries.

---

# STEP 16 — LINK TO EXISTING WORKFLOWS

Operations should be a gateway into existing workflows.

Examples:

Appointment
→ existing Appointment Detail

Customer Request
→ existing Request Detail

Conversation / Escalation
→ existing Conversation / escalation handling

Do not build duplicate detail pages.

---

# STEP 17 — PROMPT 35 REGRESSION

The existing `/appointments` functionality must remain unchanged:

* date presets
* custom date range
* status filtering
* URL persistence
* appointment creation
* appointment detail
* empty states

Do not move this functionality into Operations.

Operations can link to `/appointments` where appropriate.

---

# STEP 18 — PROMPT 33 / SERVICERECORD REGRESSION

Do NOT modify:

`serviceCompletionState()`

Do NOT modify ServiceRecord creation.

Do NOT create automatic ServiceRecords.

Do NOT change the meaning of:

> Результат обслуживания не зафиксирован

or:

> Результат обслуживания зафиксирован

A planned or confirmed appointment shown in Operations must not be treated as completed.

---

# STEP 19 — RESPONSIVE UX

Audit Operations at desktop and narrower widths.

Ensure:

* sections remain readable
* appointment rows do not overflow
* status remains visible
* action/open controls remain accessible
* long customer/service names do not break the layout

Use existing responsive patterns.

Do not redesign global navigation.

---

# STEP 20 — TESTS

Add tests only for behavior actually changed.

If today's appointments are implemented, test:

1. today's appointment query returns today's appointments
2. appointment outside today's date range is excluded
3. Business timezone is respected
4. active appointment statuses are handled correctly
5. completed/cancelled/no-show behavior follows the chosen business logic
6. tenant isolation is preserved
7. appointment detail navigation remains correct

Also verify existing Operations behavior for:

* active AI escalations
* customer requests
* follow-ups

If existing tests already cover those behaviors, do not duplicate them.

---

# STEP 21 — VALIDATION

Run:

* TypeScript
* production build
* full test suite

Current baseline:

**1255/1255**

Report:

* baseline
* new tests
* final total
* TypeScript
* build

Do not declare completion with failing tests.

---

# STEP 22 — MANUAL VALIDATION

If possible, manually verify:

### A. Operations opens

`/operations`

### B. Today's appointments

If implemented, verify today's appointment appears.

Use the existing test appointment where appropriate.

### C. Appointment status

Verify the displayed status matches the real appointment.

### D. Open appointment

Click the appointment and confirm the existing Appointment Detail opens.

### E. Existing queues

Verify existing escalation/request/follow-up sections still work.

### F. Empty state

Verify a section with no items does not display a false error.

### G. Prompt 35 regression

Verify `/appointments` date filtering still works.

### H. Prompt 33 regression

Verify completed appointment + ServiceRecord behavior remains unchanged.

---

# DO NOT DO

Do NOT:

* add AI
* add LLM/OpenAI
* add Telegram
* add WhatsApp
* add CRM
* add payments
* add SMS
* add voice AI
* create WorkOrder
* create a new ServiceRecord model
* create a second appointment system
* create duplicate appointment APIs
* create duplicate detail pages
* change appointment statuses
* redesign `/appointments`
* redesign Dashboard
* redesign Clients
* redesign Requests
* redesign Conversations
* change authentication
* change tenant architecture
* introduce unnecessary dependencies
* create a global state manager
* modify `serviceCompletionState()`
* automatically create ServiceRecords
* automatically change appointment statuses

This prompt is specifically about:

**making `/operations` a useful daily action queue while preserving `/appointments` as the appointment-management screen.**

If the audit shows today's appointments are already implemented correctly, do NOT rebuild them. Instead report that finding and implement only remaining genuine gaps.

---

# FINAL REPORT

After implementation provide:

## Final Report — Prompt 36: Operations Daily Work Queue

### Validation

* TypeScript:
* Build:
* Tests:
* Baseline:
* New tests:
* Final total:

### Audit Findings

Describe what `/operations` already had before this prompt.

Explicitly state whether it already had:

* active AI escalations:
* customer requests:
* follow-ups:
* today's appointments:
* appointment status visibility:
* appointment detail navigation:
* empty states:
* Business-timezone handling:

### Implemented

List only actual changes.

### Today's Appointments

Explain:

* whether added or already existed
* query/filter logic
* timezone handling
* statuses included/excluded
* navigation to Appointment Detail

### Existing Operations Queues

Confirm that existing:

* escalations
* requests
* follow-ups

remain functional.

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

* Prompt 35 appointment list remains intact
* Prompt 34 appointment creation remains intact
* Prompt 33 Service Completion Visibility remains intact
* ServiceRecord workflow remains intact

### Tests

List only newly added tests.

Identify important existing tests reused rather than duplicated.

### Manual Validation

State exactly what was manually verified.

### Git

Provide:

* commit hash
* commit message
* push status

Do NOT push to GitHub unless explicitly instructed.

STOP after the final report.
