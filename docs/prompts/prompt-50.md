# Prompt 50 — Service Capacity & Available Slots Foundation

> Verbatim — reproduced exactly as provided in the development
> conversation for this project (not reconstructed, not paraphrased).

---

# PROMPT 50 — Service Capacity & Available Slots Foundation

## CONTEXT

Autoservise is an AI-administrator / operational SaaS for auto-service businesses.

Current stable state is pushed to GitHub.

Expected baseline:

- branch: master
- local master = origin/master
- HEAD = 8f4a1c4
- working tree clean
- Prompt 49 + 49.1 complete and accepted
- tests: 1420/1420 PASS
- Supabase schema up to date
- local DATABASE_URL uses the documented session connection on port 5432
- migrations use DIRECT_URL
- Prompt 50 has NOT started

Existing operational lifecycle:

Conversation
→ CustomerRequest
→ Appointment
→ Service
→ ServiceRecord
→ Service History
→ ServiceFollowUp

Existing Appointment protections already include:

- tenant/business isolation;
- business-hours validation;
- vehicle conflict validation;
- controlled status transitions;
- timezone-aware date handling.

KNOWN GAP:

Appointment conflicts currently protect the VEHICLE, but the system does not model the physical capacity of the auto-service.

Therefore multiple vehicles can potentially be booked for the same time without the system knowing whether the workshop has enough service bays / simultaneous capacity.

Prompt 50 introduces the smallest correct capacity foundation.

DO NOT start Prompt 51.

---

# 1. PRIMARY PRODUCT GOAL

The system must know:

"Can this auto-service accept one more vehicle during this time interval?"

For v1, model workshop capacity as:

NUMBER OF SIMULTANEOUS SERVICE BAYS / POSTS

Example:

capacity = 3

means the business may have at most 3 capacity-consuming active appointments overlapping at any instant.

Prompt 50 is NOT technician scheduling.

Prompt 50 is NOT assignment of a specific physical bay.

Prompt 50 is NOT a drag-and-drop calendar.

It is the capacity foundation that later booking/AI workflows can safely use.

---

# 2. AUDIT FIRST — DO NOT IMPLEMENT YET

Inspect the actual source of truth.

At minimum inspect:

- prisma/schema.prisma
- Business model
- Service model
- Appointment model
- Appointment statuses
- appointment create/update services
- appointment repositories
- appointment conflict logic
- business-hours logic
- timezone utilities
- Appointment create/edit UI
- Settings UI
- Operations
- API routes for appointments
- tests for appointment conflicts
- tests for business hours
- tenant isolation tests
- docs/final reports for the relevant appointment prompts
- PRODUCT_BLUEPRINT if present

Determine:

1. where business timezone is stored;
2. where business hours are stored;
3. how Appointment start/end is represented;
4. whether duration comes from Appointment, Service, or calculation;
5. which statuses currently block a time interval;
6. how vehicle overlap is calculated;
7. whether there is already any capacity/resource field;
8. whether Appointment updates re-run conflict validation;
9. whether cancelled/no-show/completed appointments participate in conflicts;
10. whether an existing availability helper/API already exists;
11. whether AI-related slot logic already exists somewhere;
12. how Settings currently stores business operational configuration.

Do not duplicate existing logic.

---

# 3. GIT BASELINE

Run:

git status
git fetch origin
git log --oneline -n 12

Confirm:

- branch = master
- HEAD = 8f4a1c4
- local master = origin/master
- working tree clean

If materially different:

STOP and report before modifying anything.

---

# 4. CAPACITY MODEL — V1 SEMANTICS

For v1, use a BUSINESS-LEVEL simultaneous appointment capacity.

Conceptually:

serviceBayCapacity = positive integer

Example:

1 = only one vehicle can be serviced at a time
2 = two simultaneous vehicles
5 = five simultaneous vehicles

Choose the final field name based on existing naming conventions.

Prefer a clear domain name such as:

serviceBayCapacity

or an equivalent consistent name.

Do NOT model individual bays yet.

Do NOT create:

ServiceBay
Technician
Workstation
Lift
ResourceCalendar

unless the audit proves an existing model already represents this concept.

Expected Prompt 50 result:

one capacity number per Business.

---

# 5. DEFAULT / BACKWARD COMPATIBILITY

Existing businesses must continue working safely after migration.

Choose a backward-compatible default deliberately.

Preferred v1 default:

1

unless existing data/architecture provides strong evidence for another value.

The migration must NOT invalidate existing appointments.

Important:

If historical/current data already contains overlapping appointments that would exceed the new default, do NOT fail the migration and do NOT rewrite/delete those appointments.

Capacity enforcement applies to new scheduling/rescheduling operations after deployment.

Explain this explicitly in the Final Report.

---

# 6. VALIDATION

Capacity must be:

integer
>= 1

Reject:

0
negative values
fractions
NaN / malformed values

Use existing validation conventions.

User-facing errors must be Russian.

Example:

Количество постов должно быть не менее 1.

Do not expose raw Prisma errors.

---

# 7. SETTINGS UI

Add the smallest understandable setting to the existing appropriate Settings area.

Preferred user-facing terminology:

Количество постов

Helper text:

Сколько автомобилей автосервис может обслуживать одновременно.

If "пост" is already used differently in the product, choose a clearer equivalent based on existing terminology.

Do NOT create a new top-level navigation item solely for capacity.

Reuse existing Business/operational settings.

The administrator must be able to:

- see current capacity;
- edit it;
- save it.

Do not redesign Settings.

---

# 8. WHAT COUNTS AGAINST CAPACITY

Audit current Appointment statuses first.

Define explicitly which statuses consume workshop capacity.

Preferred semantics:

SCHEDULED
CONFIRMED
IN_PROGRESS

consume capacity.

Terminal/non-active statuses such as:

COMPLETED
CANCELLED
NO_SHOW

do NOT consume future scheduling capacity.

But do not blindly use these names if the actual enum differs.

Use the real existing enum.

Document the final set.

---

# 9. OVERLAP SEMANTICS

Use half-open time intervals:

[startAt, endAt)

Therefore:

Appointment A:
10:00–11:00

Appointment B:
11:00–12:00

DO NOT overlap.

Appointment B:
10:59–12:00

DO overlap.

Use the same overlap semantics for:

- vehicle conflict;
- capacity calculation;
- availability calculation.

If current vehicle conflict uses different semantics, carefully unify it only if safe and covered by tests.

Do not introduce inconsistent overlap rules.

---

# 10. DURATION / END TIME

Use the existing canonical duration logic.

Do NOT invent a second duration calculation.

Audit whether:

- Appointment stores endAt;
- Service.durationMinutes is used;
- Appointment duration is calculated elsewhere.

Capacity must evaluate the actual appointment interval using the same canonical logic as scheduling.

If an appointment has no safely determinable end time:

STOP and report rather than guessing.

---

# 11. CAPACITY CHECK

Before creating an Appointment, server-side logic must determine whether the proposed interval would exceed business capacity.

Conceptually:

existing overlapping capacity-consuming appointments
+
proposed appointment
<= serviceBayCapacity

If not:

reject creation.

User-facing error:

На выбранное время нет свободных постов.

Use a structured internal error code, for example:

CAPACITY_EXCEEDED

only if consistent with existing error conventions.

Do not rely on frontend checks.

---

# 12. UPDATE / RESCHEDULE CHECK

Capacity must also be validated when an existing Appointment changes in a way that affects its interval.

Examples:

- start time changes;
- service/duration changes;
- status changes from non-capacity-consuming to capacity-consuming.

When checking an update:

exclude the appointment being updated from its own overlap count.

Do not block harmless updates that do not affect capacity.

---

# 13. CONCURRENCY — CRITICAL

Two operators or API calls may try to book the last available slot simultaneously.

Both must NOT succeed if together they exceed capacity.

This must be protected server-side.

Do not implement:

read count
→ if free
→ create

without concurrency protection.

Audit existing transaction/locking patterns from Prompt 48.1 and Prompt 49.

Implement the smallest safe strategy appropriate to PostgreSQL/Prisma.

Possible strategies include:

- locking the relevant Business row inside the scheduling transaction;
- another deterministic serialization mechanism.

Prefer a short transaction.

Inside the transaction:

1. lock the relevant capacity scope;
2. re-read/verify relevant state;
3. count overlapping appointments;
4. create/update only if capacity remains.

Do not lock the entire database.

---

# 14. MULTI-TENANT SAFETY

Capacity is scoped to the Business/Tenant.

Never count appointments from another tenant/business.

A tenant must not:

- read another business's capacity;
- modify another business's capacity;
- influence another tenant's availability;
- infer another tenant's appointment count.

Use existing server-side ownership guards.

Add explicit isolation tests.

---

# 15. EXISTING VEHICLE CONFLICT

Vehicle conflict protection must remain.

Capacity and vehicle conflict are separate rules.

Example:

capacity = 3

Even if capacity has space, the same vehicle must not have overlapping appointments if that is the current invariant.

Therefore appointment creation should require BOTH:

vehicle is available

AND

business capacity is available.

Do not remove or weaken the existing vehicle conflict.

---

# 16. BUSINESS HOURS

Existing business-hours validation remains authoritative.

Capacity does NOT override opening hours.

An appointment must satisfy:

business is open
AND
vehicle is available
AND
capacity is available.

Do not create a second business-hours implementation.

---

# 17. AVAILABLE-SLOTS DOMAIN SERVICE

Prompt 50 must create/reuse a small backend domain capability that can answer availability questions for a date/time range.

The purpose is to avoid Prompt 51 and future AI booking implementing their own capacity logic.

Create/reuse a service/helper conceptually capable of answering:

is this interval available?

and, if architecturally clean:

how many capacity units remain?

Example conceptual result:

{
  available: true,
  capacity: 3,
  occupied: 2,
  remaining: 1
}

Do not expose unnecessary internal data if it creates privacy/tenant concerns.

The canonical calculation must live server-side.

---

# 18. AVAILABLE SLOTS API — MINIMAL FOUNDATION

If no equivalent API exists, add the smallest read-only endpoint needed for future booking UI.

Conceptually:

GET /api/appointments/availability

or an equivalent route consistent with existing API architecture.

Possible inputs:

date / startAt
serviceId
optional endAt if the architecture requires it

The server determines:

- business timezone;
- business hours;
- service duration;
- vehicle conflict when vehicleId is supplied;
- capacity.

Do not create a huge scheduling API.

Prompt 51 will build the richer booking UX.

Prompt 50 only needs a stable backend foundation.

---

# 19. SLOT GENERATION

If the existing code already generates candidate slots for AI or appointment flows:

REUSE IT.

Do not build a parallel generator.

If no slot generator exists:

implement only the minimum deterministic slot calculation needed to validate the capacity foundation.

Use a sensible existing scheduling increment if one exists.

If no increment exists, do NOT invent a product rule without documenting it.

In that case the availability API may validate requested intervals rather than generating an entire day of slots.

Prompt 51 can decide the UI slot grid.

---

# 20. SERVICE-SPECIFIC CAPACITY

Do NOT add separate capacity per Service in Prompt 50.

Example:

oil change capacity = 2
diagnostics capacity = 1

is OUT OF SCOPE.

V1 capacity is business-wide.

This keeps the model understandable and prevents premature resource scheduling complexity.

---

# 21. SPECIFIC BAY ASSIGNMENT

Do NOT assign:

Post 1
Post 2
Lift A
Lift B

to appointments.

The system only knows how many simultaneous vehicles can be accepted.

Individual resource assignment is a later feature if real users require it.

---

# 22. APPOINTMENT UI

Do not build Prompt 51 early.

Existing Appointment create/edit UI may receive only minimal capacity feedback required for correctness.

If server returns capacity error, show natural Russian:

На выбранное время нет свободных постов.

Do NOT build:

- slot calendar;
- capacity heatmap;
- drag/drop;
- timeline;
- bay selector.

That belongs later.

---

# 23. OPERATIONS / DASHBOARD

Do NOT redesign Operations or Dashboard.

Capacity does not need a new dashboard KPI in Prompt 50.

Only make changes there if technically required to prevent a regression.

---

# 24. AI INTEGRATION

Do NOT connect AI to capacity yet.

However, design the availability domain service so future AI booking can call the SAME canonical availability logic.

Future architecture should be:

AI asks availability service
→ availability service checks hours + vehicle + capacity
→ AI offers valid slot

NOT:

AI calculates capacity itself.

Document this boundary.

---

# 25. EXISTING DATA AUDIT

Before enforcing capacity, inspect existing appointment data safely.

Determine whether existing businesses currently contain overlapping active appointments.

Report:

- number of businesses checked;
- whether overlaps already exist;
- whether any overlap exceeds the proposed default capacity.

Do not expose private customer information in the report.

Do not modify historical appointments.

---

# 26. MIGRATION

A schema change is expected if Business has no capacity field.

Before migration:

npx prisma validate
npx prisma migrate status

Create exactly one forward migration with a descriptive name, for example:

add_business_service_capacity

or equivalent.

Migration requirements:

- additive;
- safe for existing rows;
- no data deletion;
- no table recreation unless Prisma/PostgreSQL genuinely requires it;
- no destructive SQL.

Do NOT use:

prisma migrate reset
prisma db push --force-reset
DROP
TRUNCATE

Apply with the existing safe Supabase migration workflow.

After deployment:

npx prisma migrate status

must show database up to date.

---

# 27. CONCURRENCY TESTS

Explicitly test the last-slot race.

Example:

capacity = 1
existing occupancy = 0

Send 10 simultaneous appointment-create attempts for overlapping times using different vehicles.

Expected:

exactly 1 succeeds
the others receive the normal capacity conflict response
database contains exactly 1 capacity-consuming appointment for that interval

Also test:

capacity = 3

Three simultaneous compatible appointments may succeed.

A fourth overlapping appointment must fail.

No 500 errors for expected capacity races.

---

# 28. CORE TEST MATRIX

Record baseline first.

Expected baseline:

1420 tests.

Add tests for at least:

1. capacity defaults correctly for existing/new business;
2. capacity rejects 0;
3. capacity rejects negative integer;
4. capacity rejects fraction;
5. capacity update is tenant-scoped;
6. one appointment fits capacity 1;
7. second overlapping appointment fails at capacity 1;
8. adjacent [start,end) appointment succeeds;
9. overlapping appointment fails;
10. cancelled appointment does not consume capacity;
11. no-show does not consume capacity;
12. completed appointment behavior matches defined semantics;
13. scheduled consumes capacity;
14. confirmed consumes capacity;
15. in-progress consumes capacity;
16. vehicle conflict still works independently;
17. business hours still work independently;
18. reschedule checks capacity;
19. changing duration/service checks capacity;
20. appointment excludes itself during update;
21. foreign tenant appointments are not counted;
22. foreign tenant cannot modify capacity;
23. concurrency at capacity 1;
24. concurrency at capacity >1;
25. rollback on failed creation;
26. availability domain service agrees with create validation;
27. availability endpoint is tenant-scoped;
28. timezone/day-boundary behavior.

Use actual enum/status names from the project.

Do not weaken existing tests.

Run full suite.

---

# 29. TIMEZONE

Use the Business timezone already implemented in the project.

Do not calculate business availability using the browser timezone.

Test at least:

- normal daytime interval;
- near business closing;
- day boundary;
- timezone conversion relevant to the existing business-hours implementation.

Do not introduce a second timezone library if one is already used.

No new dependency unless absolutely necessary.

---

# 30. PERFORMANCE

Capacity checking must not introduce an obvious N+1 pattern.

Prefer a bounded overlap query such as conceptually:

startAt < proposedEnd
AND
endAt > proposedStart
AND
status IN (...)

scoped to business/tenant.

Use indexes appropriately.

Audit whether existing Appointment indexes support this.

If an additional index is clearly required, include it in the same Prompt 50 migration and explain why.

Do not add speculative indexes without evidence.

---

# 31. SETTINGS UX VALIDATION

Browser validate:

Настройки
→ appropriate business settings section
→ Количество постов

Verify:

- current value visible;
- can change from 1 to 2;
- save;
- refresh;
- value persists;
- invalid 0 rejected in Russian;
- another tenant cannot modify it.

Return the test value to the intended test state after validation if appropriate.

---

# 32. APPOINTMENT VALIDATION IN BROWSER

Using test data only:

Scenario A:
capacity = 1
create first appointment
→ succeeds

Scenario B:
different vehicle
same overlapping interval
→ fails with:
На выбранное время нет свободных постов.

Scenario C:
adjacent interval
→ succeeds

Scenario D:
cancel first appointment
→ overlapping slot becomes available according to defined status semantics

Scenario E:
capacity = 2
two different vehicles may overlap
third overlapping vehicle fails

Do not alter real user appointments.

---

# 33. MOBILE

Settings capacity control and any minimal appointment error feedback must work around 390 px.

No horizontal overflow.

Do not redesign mobile navigation.

---

# 34. STRICTLY OUT OF SCOPE

Do NOT implement:

- technicians;
- mechanic assignment;
- named service bays;
- lift assignment;
- resource calendars;
- shift scheduling;
- employee schedules;
- drag-and-drop calendar;
- slot heatmap;
- Prompt 51 booking UI;
- AI booking;
- AI service inference;
- AI-generated responses;
- CRM;
- CPBS;
- email;
- WhatsApp;
- SMS;
- newsletters;
- automated retention messages;
- billing;
- payments;
- inventory;
- WorkOrder;
- Invoice;
- launch-screen changes;
- Dashboard redesign;
- broad localization cleanup.

Do NOT start Prompt 51.

---

# 35. SECURITY / DATA SAFETY

Never print:

- DATABASE_URL;
- DIRECT_URL;
- passwords;
- Supabase keys;
- tokens.

Do not commit `.env`.

Before commit inspect the diff for secrets.

Do not delete existing test or real data merely to make capacity tests pass.

---

# 36. REGRESSION

Run:

npm run typecheck
npm run build
npm test

Also:

npx prisma validate
npx prisma migrate status

Report actual final test count.

All existing Conversation, Request, Appointment, ServiceRecord and FollowUp tests must continue passing.

---

# 37. SUPABASE VALIDATION

Validate against the restored main Supabase using isolated test data.

Before applying migration:

- verify migration history is consistent;
- verify only the new Prompt 50 migration is pending.

Apply safely.

After migration verify:

- capacity column exists;
- default/constraint correct;
- indexes if added;
- schema matches Prisma;
- existing data preserved.

Run the concurrency scenarios against Supabase, not only mocks/local tests.

---

# 38. DOCUMENTATION

Create:

docs/prompts/prompt-50.md

docs/final-reports/final-report-50.md

Update PRODUCT_BLUEPRINT if it is the current architecture source of truth.

Update README only if necessary.

Final Report must contain:

1. Initial state
2. Capacity architecture audit
3. Existing appointment conflict behavior
4. Capacity model decision
5. Statuses consuming capacity
6. Interval/overlap semantics
7. Schema/migration
8. Existing-data overlap audit
9. Settings implementation
10. Capacity domain service
11. Availability API
12. Create validation
13. Update/reschedule validation
14. Vehicle-conflict coexistence
15. Business-hours coexistence
16. Concurrency strategy
17. Concurrency results
18. Tenant isolation
19. Timezone validation
20. Performance/query/index assessment
21. Tests before/after
22. Typecheck
23. Build
24. Prisma validation/migration status
25. Supabase validation
26. Browser validation
27. Mobile validation
28. Files changed
29. Security/data safety
30. Remaining limitations
31. Git state
32. Push status
33. LOCAL APP URL

---

# 39. GIT

Before implementation:

git status
git fetch origin
git log --oneline -n 12

Expected:

HEAD = 8f4a1c4
origin/master = 8f4a1c4
working tree clean

After successful implementation and validation:

git status
git diff
git log --oneline -n 12

Create exactly ONE local commit:

feat: add service capacity foundation

DO NOT PUSH.

Do not amend previous commits.

Do not force push.

Do not touch main.

Expected final state:

master exactly 1 commit ahead of origin/master.

---

# 40. ACCEPTANCE CRITERIA

Prompt 50 is complete only if:

AC1. Business has explicit simultaneous service capacity.

AC2. Capacity is a positive integer.

AC3. Existing businesses receive a safe backward-compatible value.

AC4. Existing appointment data is preserved.

AC5. Operator can configure capacity in Settings.

AC6. Capacity is enforced server-side on appointment creation.

AC7. Capacity is enforced on relevant rescheduling/update operations.

AC8. Active statuses consuming capacity are explicitly defined.

AC9. Terminal/non-consuming statuses behave correctly.

AC10. Half-open interval semantics are consistent.

AC11. Existing vehicle conflict remains enforced.

AC12. Existing business-hours rules remain enforced.

AC13. Capacity check is tenant/business scoped.

AC14. Concurrent last-slot booking cannot overbook capacity.

AC15. Capacity >1 works correctly.

AC16. Availability domain logic is reusable.

AC17. Minimal availability API exists or an existing equivalent is reused.

AC18. Availability result agrees with actual appointment creation.

AC19. Business timezone remains authoritative.

AC20. No technician/resource assignment is introduced.

AC21. No AI booking is introduced.

AC22. No destructive migration.

AC23. Existing data unchanged except isolated test/config data.

AC24. No DB connection regression from Prompt 48.3.

AC25. Typecheck PASS.

AC26. Build PASS.

AC27. All tests PASS.

AC28. Prisma validate PASS.

AC29. Migration status clean.

AC30. Supabase validation PASS.

AC31. Browser validation PASS.

AC32. Mobile validation PASS.

AC33. Exactly one local Prompt 50 commit.

AC34. Nothing pushed.

---

# 41. STOP CONDITIONS

STOP and report before improvising if:

- Appointment interval cannot be determined reliably;
- current schema already has a materially different capacity/resource model;
- safe concurrency would require a destructive architecture change;
- migration history is inconsistent;
- existing appointments cannot be preserved;
- capacity cannot be isolated per tenant/business;
- implementation would require technicians/resources to be introduced now;
- git baseline materially differs from expected.

Do not hide architectural conflicts.

---

# 42. EXECUTION ORDER

1. Git baseline
2. Read source of truth
3. Audit Appointment interval/status/conflict architecture
4. Audit existing capacity/availability code
5. Audit existing appointment overlaps
6. Decide minimal Business capacity field
7. Define capacity-consuming statuses
8. Define canonical overlap semantics
9. Design concurrency protection
10. Prisma schema + safe migration if required
11. Capacity settings backend
12. Settings UI
13. Canonical capacity domain service
14. Minimal availability API/reuse existing API
15. Appointment create enforcement
16. Appointment update/reschedule enforcement
17. Tenant isolation tests
18. Concurrency tests
19. Timezone tests
20. Full test suite
21. Prisma validate/status
22. Safe Supabase migration deploy
23. Supabase concurrency validation
24. Browser validation
25. Mobile validation
26. Existing-data safety check
27. Security/diff review
28. Documentation
29. Git review
30. One local commit
31. Final Report
32. STOP

DO NOT PUSH.
DO NOT start Prompt 51.

At the end provide:

LOCAL APP URL: http://localhost:...

Then STOP.
