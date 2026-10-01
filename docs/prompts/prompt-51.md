# Prompt 51 — Booking Availability UX

> Verbatim — reproduced exactly as provided in the development
> conversation for this project (not reconstructed, not paraphrased).

---

# PROMPT 51 — BOOKING AVAILABILITY UX
## Real available slots for appointment create + reschedule

You are working in the existing production-oriented project `Autoservise`.

IMPORTANT:
Do not redesign the product.
Do not create a parallel booking architecture.
Do not add future CRM, CPBS, billing, technician/resource scheduling, outbound retention messaging, or unrelated features.

This prompt builds directly on Prompt 50 — Service Capacity Foundation.

--------------------------------------------------
0. CURRENT VERIFIED BASELINE
--------------------------------------------------

Repository/project:
- Project: Autoservise
- Branch: master
- Prompt 50 commit: `48cfeb1 feat: add service capacity foundation`
- Prompt 50 has already been pushed to origin/master.
- Working tree was clean after push.

Stack:
- React + TypeScript + Vite
- Tailwind + shadcn/ui + lucide-react
- Vercel-compatible serverless REST API
- PostgreSQL / Supabase
- Prisma
- Zod
- Vitest
- custom auth:
  - email/password
  - Argon2id
  - server-side sessions
  - HttpOnly cookie
- multi-tenant isolation
- roles: owner/admin/manager

Existing product lifecycle:

Customer
→ CustomerRequest
→ Appointment
→ Service
→ ServiceRecord
→ Service History
→ ServiceFollowUp

Prompt 50 added workshop/service-bay capacity.

Existing Prompt 50 behavior includes:

- `Business.serviceBayCapacity`
- integer >= 1
- default 1
- editable in `/settings/business`
- Russian UI label: `Количество постов`

Appointments occupying capacity:
- SCHEDULED
- CONFIRMED
- IN_PROGRESS

Appointments NOT occupying capacity:
- COMPLETED
- CANCELLED
- NO_SHOW

Capacity logic:
- half-open intervals
- max concurrent appointment occupancy
- NOT naive "any overlap = unavailable"
- vehicle conflict remains enforced
- create/reschedule transaction locks business row
- capacity + vehicle conflict checks occur under the same lock
- race-safe booking behavior

Full interval returns:
- HTTP 409
- code: `CAPACITY_EXCEEDED`
- Russian user-facing meaning:
  `На выбранное время нет свободных постов.`

Prompt 50 also added/reused availability functionality:
- existing 30-minute slot generation skips full-capacity slots
- a read-only endpoint exists:
  `GET /api/appointments/availability`
- single-interval availability checking exists
- shared server-side capacity/availability service exists

IMPORTANT:
Find the actual implementation before changing anything.
Do not assume exact file names, query parameters, response shapes, or component names from this prompt.

Prompt 50 validation baseline:
- 1488 tests passed
- TypeScript PASS
- Build PASS
- Prisma validation PASS
- live Supabase migration applied
- concurrency tests passed
- mobile 390px checked

--------------------------------------------------
1. OBJECTIVE
--------------------------------------------------

Build the operator-facing Booking Availability UX.

Current problem:

The backend now knows whether workshop capacity exists, but an operator should not have to manually guess a booking time and discover only after Save that capacity is full.

The UI must help the operator choose a genuinely available appointment time BEFORE submitting the appointment.

Implement availability UX for BOTH:

A. creating a new Appointment
B. rescheduling/editing an existing Appointment's date/time

The backend remains authoritative.

The UI is assistance, not a replacement for the existing transactional validation.

--------------------------------------------------
2. FIRST: AUDIT BEFORE IMPLEMENTATION
--------------------------------------------------

Before writing code, inspect the existing implementation.

Audit at minimum:

1. Appointment create UI:
   - component/page/dialog/form
   - current date/time controls
   - selected customer
   - selected vehicle
   - selected service
   - duration source
   - business timezone handling
   - submission flow
   - existing error handling

2. Appointment detail/reschedule UI:
   - where startAt/endAt are changed
   - whether editing is inline, modal, panel, etc.
   - current validation/error handling

3. Existing availability implementation from Prompt 50:
   - endpoint
   - service
   - repository helpers
   - slot generator
   - capacity calculations
   - vehicle conflict calculations
   - business hours
   - timezone conversion
   - duration handling
   - auth/tenant checks

4. Existing AI availability logic:
   - inspect only to identify shared reusable service logic
   - DO NOT expand AI booking in this prompt

5. Existing appointment date preset/filter logic:
   - inspect only where useful for shared date/time utilities

6. Existing tests covering:
   - appointment creation
   - appointment reschedule
   - availability
   - capacity
   - business hours
   - vehicle conflict
   - timezone behavior

Report the audit briefly before implementation.

Prefer reuse/refactoring over duplication.

--------------------------------------------------
3. PRODUCT UX — CREATE APPOINTMENT
--------------------------------------------------

When an operator creates an Appointment, the form should expose available booking times.

Do NOT replace the existing Customer / Vehicle / Service selection flow.

Use the existing design system and dark graphite/gold visual language.

The operator should be able to:

1. choose the relevant booking date
2. see available time slots for that date
3. select an available slot
4. submit the Appointment normally

Availability must reflect the actual existing server rules.

At minimum account for:

- business hours
- selected service duration
- service-bay capacity
- existing appointments occupying capacity
- vehicle conflict where vehicle is known
- tenant/business isolation
- business timezone

Do NOT reproduce these rules independently in React.

The frontend must request server-calculated availability.

--------------------------------------------------
4. AVAILABILITY SLOT PRESENTATION
--------------------------------------------------

Use the existing 30-minute slot foundation unless the current implementation proves a different canonical interval.

Display available slots in a compact operator-friendly control.

Examples of acceptable UI:

09:00
09:30
10:00
10:30

Do NOT render hundreds of slots in an unwieldy select if a compact responsive slot picker is more appropriate.

Requirements:

- available slot clearly selectable
- selected slot clearly distinguishable
- loading state
- empty state
- server error state
- mobile-safe at 390px
- keyboard accessible
- no horizontal overflow

Use existing shadcn/UI patterns where possible.

Do not introduce a new UI library.

--------------------------------------------------
5. DATE CHANGES
--------------------------------------------------

When the operator changes the booking date:

- fetch/recompute availability for that date
- do not retain a selected time that is no longer valid
- if the previously selected slot is unavailable for the new date, clear it
- never silently submit a stale slot

Avoid unnecessary requests where practical.

Do not build an elaborate client cache.

--------------------------------------------------
6. SERVICE / DURATION CHANGES
--------------------------------------------------

Availability depends on appointment duration.

Determine the canonical duration source from the current codebase.

If Service already provides duration, reuse it.

When the selected service/duration changes:

- refresh availability
- clear a selected slot if it is no longer valid

Do not invent a second duration model.

Do not add arbitrary duration rules.

--------------------------------------------------
7. VEHICLE CHANGES
--------------------------------------------------

Where a vehicle is selected and the backend availability API supports vehicle-aware checking:

- availability should exclude slots that conflict for that vehicle

If the existing endpoint does not yet accept vehicle context but the shared backend availability service already supports it:

- make the smallest additive extension necessary
- preserve backwards compatibility
- validate tenant ownership server-side

Do NOT implement vehicle-conflict logic in React.

If the existing architecture already handles this correctly, simply reuse it.

--------------------------------------------------
8. RESCHEDULING AN EXISTING APPOINTMENT
--------------------------------------------------

The same availability UX must be available when changing the date/time of an existing Appointment.

Important:

The current Appointment itself must not incorrectly block its own proposed slot.

Audit how the backend currently handles reschedule availability.

If necessary, support an optional appointment exclusion such as the existing appointment ID, but:

- only if required
- validate tenant ownership
- do not create a security bypass
- do not weaken the final transactional validation

For rescheduling:

- show server-calculated available slots
- preserve current date/time until the operator deliberately changes it
- selecting a new date should load valid slots
- selecting a slot updates the proposed start/end
- Save continues through the existing Appointment update path

Do not create a second appointment as a reschedule mechanism.

--------------------------------------------------
9. BUSINESS TIMEZONE
--------------------------------------------------

This is critical.

The slot picker must show times in the BUSINESS timezone, consistent with the existing appointment UI.

Do not accidentally use:

- browser timezone
- UTC display
- hard-coded Kazakhstan/Russia timezone

Audit and reuse the project's existing timezone utilities.

Server timestamps must remain consistent with the existing storage/API convention.

Add regression tests where appropriate.

--------------------------------------------------
10. BUSINESS HOURS
--------------------------------------------------

Do not offer slots outside configured Business Hours.

Reuse existing server business-hours logic.

Consider:

- closed day
- start/end working hours
- service duration extending past closing time

Example:

If business closes at 18:00 and service duration is 60 minutes,
17:30 must not be offered if it would finish at 18:30.

Do not hard-code opening hours in frontend.

--------------------------------------------------
11. CAPACITY SEMANTICS
--------------------------------------------------

Preserve Prompt 50 semantics exactly.

Example:

Capacity = 2

Existing:
- Appointment A: 10:00–11:00

Then another appointment MAY still be available at 10:00 if only one bay is occupied.

If:
- A: 10:00–11:00
- B: 10:30–11:30

Then a third appointment overlapping the period where both are active must not be offered when capacity = 2.

Use the existing max-concurrency implementation.

Do not replace it with a simple overlap count.

--------------------------------------------------
12. FINAL SERVER AUTHORITY / RACE CONDITIONS
--------------------------------------------------

Availability shown in UI is advisory because another operator/request can book the slot before Save.

Therefore:

DO NOT remove or weaken the Prompt 50 transaction lock.

DO NOT assume:
"slot was displayed as available → creation must succeed."

The final create/reschedule request must still perform all authoritative checks.

If the slot becomes full between selection and Save:

- backend should still return existing 409 `CAPACITY_EXCEEDED`
- frontend should show the existing Russian error
- availability should refresh
- stale selected slot should be cleared if no longer available

The UI must handle this gracefully.

--------------------------------------------------
13. LOADING / EMPTY / ERROR STATES
--------------------------------------------------

Provide concise Russian operator-facing states consistent with the current product.

Examples of meaning, not mandatory exact copy:

Loading:
`Проверяем свободное время…`

No availability:
`На выбранную дату свободного времени нет.`

Load error:
`Не удалось проверить свободное время.`

Capacity race:
`На выбранное время уже нет свободных постов. Выберите другое время.`

Do not expose:
- stack traces
- Prisma errors
- raw database errors
- internal English error codes as the primary UI message

Keep API error codes internally where useful.

--------------------------------------------------
14. EXISTING MANUAL DATE/TIME INPUT
--------------------------------------------------

Audit the existing form before deciding whether to remove, retain, or subordinate manual time input.

Preferred product behavior:

- date selection remains explicit
- time selection comes primarily from server-provided available slots

But do NOT make a destructive UI rewrite merely to satisfy this preference.

If existing architecture requires keeping a time input:
- ensure invalid/full times cannot be presented as if verified
- integrate availability clearly
- avoid two contradictory sources of truth

Choose the smallest coherent UX improvement.

Document the decision in the Final Report.

--------------------------------------------------
15. API CONTRACT
--------------------------------------------------

Reuse `GET /api/appointments/availability` if viable.

Do not create a second availability endpoint unless the current endpoint fundamentally cannot serve this UX.

Audit its current contract first.

If additive changes are needed, they should be minimal and backwards compatible.

Potential inputs may include existing equivalents of:

- business/date
- service or duration
- vehicle
- exclude appointment ID for reschedule

But DO NOT blindly implement these names.

Use the project's actual conventions.

Validate all IDs server-side for:
- tenant ownership
- business ownership
- active/valid related entities where current domain rules require it

Never trust tenantId from the client.

--------------------------------------------------
16. SECURITY / TENANT ISOLATION
--------------------------------------------------

Availability must never leak another tenant's appointments, capacity, vehicles, services, or business configuration.

Verify:

- auth middleware
- tenant scoping
- business scoping
- vehicle ownership
- service ownership
- appointment exclusion ownership if introduced

Add or extend tenant-isolation tests if API behavior changes.

--------------------------------------------------
17. DO NOT ADD
--------------------------------------------------

Do NOT add:

- technicians
- mechanics
- employees as schedulable resources
- individual service bays as entities
- bay assignment
- drag-and-drop calendar
- full calendar redesign
- Google Calendar integration
- CRM integration
- CPBS
- SMS
- WhatsApp
- email reminders
- Telegram outbound automation
- payment/billing
- invoices
- WorkOrders
- inventory
- AI booking expansion
- new retention messaging
- unrelated dashboard work
- frontend framework migration
- new UI framework

Those are outside Prompt 51.

--------------------------------------------------
18. DATABASE
--------------------------------------------------

Expected outcome:

NO Prisma schema change.

Prompt 50 already introduced the capacity data required for this UX.

Do not create a migration unless the audit proves an unavoidable data-model gap.

If you believe a schema change is required:
STOP before creating it and explain why.

--------------------------------------------------
19. TESTS
--------------------------------------------------

Maintain all existing tests.

Add focused tests for the new/changed behavior.

Backend/API tests should cover applicable cases such as:

1. available slots returned for open working day
2. full-capacity slots excluded
3. capacity > 1 still exposes slot while one bay remains
4. service duration respected
5. slots extending beyond closing excluded
6. closed day returns no slots
7. vehicle-conflicting slot excluded where vehicle-aware
8. reschedule excludes current appointment from self-conflict
9. foreign-tenant vehicle/service/appointment cannot be used
10. unauthorized request rejected
11. timezone-sensitive date behavior
12. existing transactional create still rejects a slot that becomes full

Frontend logic tests:
If the project still has no frontend testing infrastructure, DO NOT introduce a large new frontend testing stack just for this prompt.

Instead:
- extract/test pure functions with existing Vitest where sensible
- manually/browser validate interaction states
- document the remaining frontend-test limitation

Do not lower the existing test count by deleting coverage.

--------------------------------------------------
20. MANUAL / BROWSER VALIDATION
--------------------------------------------------

Perform browser validation against the existing UI.

At minimum verify:

CREATE:
- open create Appointment flow
- choose customer
- choose vehicle where required
- choose service
- choose date
- available slots appear
- select slot
- create appointment
- resulting appointment has correct displayed local business time

FULL CAPACITY:
- create/prepare occupancy that fills a period
- confirm full slot is not offered
- confirm adjacent valid slots behave correctly

CAPACITY > 1:
- set serviceBayCapacity > 1 in test business
- verify partially occupied slot remains selectable until actual capacity is reached

RESCHEDULE:
- open existing Appointment
- change date/time
- current appointment does not block itself
- select available slot
- save
- verify detail/list reflect new time

EMPTY DAY:
- choose closed or fully occupied date
- verify clear empty state

RACE/409:
- where practical, simulate or test backend race behavior
- verify UI does not remain in misleading selected state after capacity rejection

MOBILE:
- 390px width
- no horizontal overflow
- slot controls usable

Use only test tenant/data.

Do not modify production/business data.

Restore temporary capacity settings after validation.

--------------------------------------------------
21. QUALITY GATES
--------------------------------------------------

Run:

- TypeScript/typecheck
- build
- full test suite
- Prisma validate if Prisma is touched or as part of normal project validation
- relevant lint/check scripts if present

All must pass.

Do not hide failures.

--------------------------------------------------
22. DOCUMENTATION
--------------------------------------------------

Follow the existing project documentation convention.

Create/update the appropriate Prompt 51 documentation under the existing docs structure, consistent with previous prompts:

- `docs/prompts/`
- `docs/final-reports/`

Use existing naming conventions discovered in the repository.

Do not invent a conflicting documentation structure.

--------------------------------------------------
23. GIT
--------------------------------------------------

Before implementation:
- inspect `git status`
- verify branch is `master`
- verify Prompt 50 baseline is present

Do not modify:
- unrelated files
- `.mcp.json`
- `marketing/`
unless they are already tracked and genuinely required by this prompt (they should not be).

After all validation passes:

Commit with a concise message such as:

`feat: add booking availability ux`

Do NOT force push.

Do NOT merge branches.

If repository state is unexpectedly dirty before work begins:
STOP and report the unexpected changes before modifying code.

--------------------------------------------------
24. FINAL REPORT
--------------------------------------------------

Return a concise but complete Final Report containing:

1. Audit result
2. UX implemented
3. Existing architecture reused
4. API changes, if any
5. Create Appointment behavior
6. Reschedule behavior
7. Capacity handling
8. Vehicle conflict handling
9. Business hours/timezone handling
10. Race-condition behavior
11. Security/tenant isolation
12. Database/schema status
13. Tests:
    - previous count
    - new count
    - pass/fail
14. TypeScript/build/Prisma results
15. Browser validation
16. Mobile validation
17. Files changed
18. Commit hash
19. Remaining gaps explicitly NOT solved by Prompt 51

Include screenshots only if the environment supports reliable screenshot capture.

--------------------------------------------------
25. STOP CONDITION
--------------------------------------------------

STOP after Prompt 51 is implemented, validated, documented, and committed.

Do NOT proceed automatically to Prompt 52.

Do NOT start:
- technician/resource scheduling
- CRM
- CPBS
- billing
- outbound retention communications
- AI booking expansion
- calendar redesign
- any unrelated P1/P2 gap

Wait for the next instruction.
