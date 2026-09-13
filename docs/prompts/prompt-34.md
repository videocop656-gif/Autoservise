# Prompt 34 — Создание новой записи

> Verbatim — reproduced exactly as provided in the development
> conversation for this project (not reconstructed, not paraphrased).

---

# Prompt 34 — Создание новой записи

## ROLE

You are continuing development of the existing **Autoservise** application.

This is NOT the «Отпечаток стиля» project.

Work strictly inside the existing Autoservise codebase.

The goal of this prompt is to make the existing **«Новая запись»** action in the **«Записи»** section actually functional.

Do not redesign unrelated parts of the application.

---

# CURRENT STATE

The application already contains an Appointments / «Записи» section.

Existing appointment statuses are:

* `PLANNED` — Запланировано
* `CONFIRMED` — Подтверждена
* `IN_PROGRESS` — Выполняется
* `COMPLETED` — Завершена
* `CANCELLED` — Отмена
* `NO_SHOW` — Клиент не пришел

The UI already contains a **«Новая запись»** button.

However, the button is currently not functional for creating a new appointment.

The application also already has:

* Clients
* Vehicles
* Requests
* Conversations
* Appointment Detail
* Service History
* ServiceRecord
* tenant isolation
* authentication/session system
* existing appointment APIs/services
* existing status handling

Prompt 33 was recently completed.

Prompt 33 introduced:

`serviceCompletionState()`

and the existing ServiceRecord workflow.

Prompt 33 validation:

* TypeScript: PASS
* Build: PASS
* Tests: 1233/1233

Prompt 33 commit:

`f06e1d2`

Do NOT break this baseline.

---

# PRIMARY OBJECTIVE

Make **«Новая запись»** fully functional.

The expected workflow:

**Записи → Новая запись → заполнение формы → Сохранить → новая запись появляется в списке → открыть запись → корректный статус**

The initial status of a newly created appointment must be:

**Запланировано**

Do not automatically mark a newly created appointment as confirmed, in progress, or completed.

---

# STEP 1 — AUDIT EXISTING IMPLEMENTATION

Before changing anything, inspect the existing code.

Find:

* appointment Prisma model
* appointment service
* appointment API routes
* appointment list page
* appointment detail page/panel
* existing appointment creation logic, if any
* existing status enum/constants
* existing client/vehicle relations
* existing validation
* existing tenant-isolation helpers
* existing UI components used by appointment forms

Do not assume field names.

Use the actual schema and existing implementation.

### IMPORTANT

If a create-appointment API/service already exists but the UI button is not wired to it:

**wire the existing functionality instead of creating another API.**

If creation logic partially exists:

**complete it rather than duplicating it.**

Only create a new endpoint/service if the current architecture genuinely has no appropriate creation path.

---

# STEP 2 — DETERMINE REQUIRED FIELDS

Inspect the actual Appointment schema.

Identify which fields are required for creating an appointment.

Do not invent fields.

The creation form should expose the minimum useful information required by the current domain model.

At minimum, if supported by the existing model, the operator should be able to select:

* Client
* Vehicle
* Date
* Time
* Service / reason / request context, if the existing model supports it
* Notes, if supported

Only include fields that actually exist or are already represented by the application's domain model.

Do not create duplicate client or vehicle data-entry systems.

---

# STEP 3 — NEW APPOINTMENT FORM

Make the existing **«Новая запись»** button open an appropriate form.

Use the application's existing UI conventions and shadcn/ui components.

Do not create a new visual language.

The form should have a clear title:

> Новая запись

Required actions:

> Отмена

> Создать запись

### UX requirements

The form must:

* clearly indicate required fields
* validate required fields
* show validation errors
* show API errors
* show loading state while saving
* prevent accidental double submission
* close correctly after successful creation
* not lose data silently on validation failure

Use Russian UI text consistent with the rest of Autoservise.

---

# STEP 4 — CLIENT SELECTION

Reuse the existing Client domain and UI patterns.

Do NOT create a duplicate client.

The operator must select an existing client if the appointment requires a client relation.

If the existing architecture already supports creating a client from another workflow, do not duplicate that workflow here.

Keep this prompt focused on appointment creation.

---

# STEP 5 — VEHICLE SELECTION

If Appointment requires a vehicle:

* vehicle must belong to the selected client
* only appropriate vehicles should be selectable
* changing the client must not leave an invalid vehicle selected

Server-side validation must still verify the relationship.

Do not trust browser-supplied `clientId` / `vehicleId`.

---

# STEP 6 — DATE AND TIME

Use the existing appointment date/time representation.

Do not change the database representation unless absolutely necessary.

The form must:

* require a valid appointment date/time if the schema requires it
* reject invalid dates
* reject invalid time values
* preserve the existing timezone conventions

Do not introduce a new timezone system.

---

# STEP 7 — CREATE APPOINTMENT

On submit:

1. validate the form
2. send the request using the existing API architecture
3. authenticate the user server-side
4. validate all relations server-side
5. enforce tenant isolation
6. create the appointment
7. set initial status to:

`PLANNED`

8. return the created appointment

The browser must NOT be allowed to choose an arbitrary initial status.

The server should establish the correct initial status.

---

# STEP 8 — TENANT ISOLATION

This is mandatory.

The create operation must verify that:

* authenticated user belongs to the current tenant
* selected client belongs to the same tenant
* selected vehicle belongs to the same tenant
* vehicle belongs to the selected client where the domain requires this
* any selected request belongs to the same tenant
* any other appointment relation belongs to the same tenant

Do not trust tenant IDs from the client.

Reuse existing helpers such as:

`assertRelationsOwnedAndActive`

and:

`assertAppointmentConsistency`

where applicable.

Do not weaken or bypass existing authorization.

---

# STEP 9 — DUPLICATE / DOUBLE SUBMISSION PROTECTION

The UI must prevent accidental duplicate creation caused by:

* double-clicking the submit button
* pressing Enter repeatedly
* slow API response followed by another submission

At minimum:

* disable the submit button while saving
* show a loading state

Do not introduce unnecessary infrastructure.

---

# STEP 10 — AFTER SUCCESSFUL CREATION

After successful creation:

1. close the creation form
2. refresh the appointment list using the existing data-fetching pattern
3. show the newly created appointment
4. show status:

> Запланировано

5. allow the operator to open the appointment detail

Do NOT require a full browser reload.

Do NOT navigate to an unrelated page.

If the existing application already has a post-create navigation convention, follow it.

---

# STEP 11 — APPOINTMENT STATUS FLOW

Do NOT redesign the appointment status system.

Preserve these existing statuses:

| Internal status | UI               |
| --------------- | ---------------- |
| `PLANNED`       | Запланировано    |
| `CONFIRMED`     | Подтверждена     |
| `IN_PROGRESS`   | Выполняется      |
| `COMPLETED`     | Завершена        |
| `CANCELLED`     | Отмена           |
| `NO_SHOW`       | Клиент не пришел |

A newly created appointment must always start as:

`PLANNED`

Do not automatically advance it.

Do not change existing status transition rules unless the current implementation is demonstrably broken and the change is strictly required for this prompt.

---

# STEP 12 — DO NOT BREAK PROMPT 33

This is critical.

Do NOT modify or remove:

`serviceCompletionState()`

Do NOT change the existing ServiceRecord creation mechanism.

Do NOT create automatic ServiceRecords.

Do NOT change:

`POST /api/service-history`

Do NOT change the meaning of:

> Результат обслуживания не зафиксирован

or:

> Результат обслуживания зафиксирован

The existing completed-appointment → ServiceRecord workflow must continue working exactly as before.

---

# STEP 13 — APPOINTMENT DETAIL

After creating a new appointment, opening its detail should show the correct appointment information.

Because the initial status is `PLANNED`:

* Service Completion Visibility must NOT incorrectly appear
* ServiceRecord should NOT be required
* the appointment must not be treated as completed

This should naturally follow the existing `serviceCompletionState()` logic.

Do not duplicate that logic.

---

# STEP 14 — TESTS

Add focused tests for the new functionality.

At minimum test:

### Test 1

Valid appointment creation succeeds.

### Test 2

New appointment receives initial status:

`PLANNED`

### Test 3

Missing required field is rejected.

### Test 4

Invalid client/vehicle relationship is rejected.

### Test 5

Cross-tenant client cannot be used.

### Test 6

Cross-tenant vehicle cannot be used.

### Test 7

A newly created appointment can be retrieved/opened afterward.

### Test 8

Existing appointment status functionality remains intact.

### Test 9

Existing ServiceRecord / Prompt 33 behavior remains intact.

### Test 10

Existing tenant-isolation tests remain green.

Prefer backend/service tests where appropriate.

Do NOT introduce a frontend testing framework just for this feature if the project does not already use one.

---

# STEP 15 — VALIDATION

Run:

* TypeScript
* production build
* full test suite

Current baseline:

**1233/1233**

Report:

* previous test count
* number of new tests
* final test count
* TypeScript result
* build result

Do not declare completion with failing tests.

---

# STEP 16 — VISUAL / MANUAL CHECK

If possible, manually verify:

1. Open `/appointments` / «Записи»
2. Click **«Новая запись»**
3. Form opens
4. Select client
5. Select vehicle
6. Enter valid date/time
7. Create appointment
8. Form closes
9. New appointment appears in list
10. Status is **«Запланировано»**
11. Open appointment
12. Detail is correct
13. No ServiceRecord warning is shown for this planned appointment
14. Existing completed appointment + ServiceRecord behavior still works

Do not redesign the screen during this prompt.

---

# DO NOT DO

Do NOT:

* add AI
* add LLM/OpenAI
* add Telegram
* add WhatsApp
* add CRM integration
* add payment integration
* add SMS
* add voice AI
* create WorkOrder
* create a new ServiceRecord model
* redesign Service History
* redesign Dashboard
* redesign Conversations
* redesign Clients
* redesign Requests
* change authentication
* change session architecture
* change tenant architecture
* introduce a new global state manager
* add unnecessary dependencies
* modify Prompt 33 business logic
* automatically create ServiceRecords
* automatically confirm appointments
* automatically complete appointments

This prompt is ONLY about:

**making «Новая запись» functional and creating a valid appointment through the existing architecture.**

---

# FINAL REPORT

After implementation provide:

## Final Report — Prompt 34: Appointment Creation

### Validation

* TypeScript:
* Build:
* Tests:
* Baseline:
* New tests:
* Final total:

### Implemented

1.
2.
3.
4.

### Appointment Creation

Describe:

* form
* required fields
* client selection
* vehicle selection
* date/time
* initial status
* post-create behavior

### API / Prisma

* Existing API reused: yes/no
* New API created: yes/no
* Prisma schema changed: yes/no
* Migration required: yes/no

### Security

Confirm:

* authentication
* tenant isolation
* server-side relation validation
* client/vehicle consistency validation
* initial status enforced server-side

### Prompt 33 Regression

Confirm that:

* `serviceCompletionState()` remains intact
* existing ServiceRecord creation remains intact
* completed appointment behavior remains intact
* no automatic ServiceRecord is created

### Tests

List the new tests.

### Git

Provide:

* commit hash
* commit message

Do NOT push to GitHub unless the existing workflow explicitly requires it.

STOP after the final report. Do not proceed to another feature automatically.
